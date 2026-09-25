// oxlint-disable-next-line import/default -- Vite generates the default URL export for worker assets.
import workerUrl from './local-voice.worker?worker&url';

export type VoiceState = { state: 'idle' | 'loading' | 'ready' | 'error'; progress: number; phase?: 'downloading' | 'preparing'; downloadedBytes?: number; totalBytes?: number; error?: string };
type AudioData = { samples: Float32Array<ArrayBuffer>; sampleRate: number };
type Pending = { resolve: (audio: AudioData) => void; reject: (error: Error) => void };
const cancelled = () => new DOMException('Playback cancelled', 'AbortError');

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** One account's local engine and in-memory reply audio. No cloud speech calls. */
export class LocalSpeech {
  private worker?: Worker;
  private context?: AudioContext;
  private ready?: Promise<void>;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private loadTimer?: ReturnType<typeof setTimeout>;
  private sequence = 0;
  private pending = new Map<number, Pending>();
  private cache = new Map<string, AudioData>();
  private disposed = false;
  private sources = new Set<AudioBufferSourceNode>();
  private playbackAborts = new Set<() => void>();
  constructor(private notify: (state: VoiceState) => void = () => {}, private createWorker = () => new Worker(workerUrl, { type: 'module' })) {}

  prepare(): Promise<void> {
    if (this.disposed) return Promise.reject(cancelled());
    if (this.ready) return this.ready;
    this.notify({ state: 'loading', progress: 0, phase: 'downloading' });
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    const operation = this.ready;
    this.loadTimer = setTimeout(() => this.fail(new Error('Voice download is taking too long. Check your connection and retry.')), 240_000);
    try {
      this.worker = this.createWorker();
      this.worker.onmessage = event => {
        const message = event.data;
        if (message.type === 'progress') this.notify({ state: 'loading', phase: 'downloading', progress: message.progress, downloadedBytes: message.downloadedBytes, totalBytes: message.totalBytes });
        else if (message.type === 'preparing') this.notify({ state: 'loading', phase: 'preparing', progress: 100 });
        else if (message.type === 'ready') { clearTimeout(this.loadTimer); this.notify({ state: 'ready', progress: 100 }); this.readyResolve?.(); }
        else if (message.type === 'audio') { this.pending.get(message.id)?.resolve({ samples: message.samples, sampleRate: message.sampleRate }); this.pending.delete(message.id); }
        else if (message.type === 'error') this.fail(new Error(message.message));
      };
      this.worker.onerror = () => this.fail(new Error('Local voice could not start. Please retry the voice download.'));
      this.worker.postMessage({ id: 0 });
    } catch { this.fail(new Error('Local voice is unavailable in this browser. Try an updated Chrome, Edge or Safari.')); }
    return operation;
  }

  private fail(error: Error) {
    clearTimeout(this.loadTimer); this.worker?.terminate(); this.worker = undefined;
    this.readyReject?.(error); this.ready = undefined;
    this.pending.forEach(job => job.reject(error)); this.pending.clear();
    if (!this.disposed) this.notify({ state: 'error', progress: 0, error: error.message });
  }

  /** Call synchronously inside a click/touch/key handler, before any network await. */
  unlock(): Promise<void> {
    if (this.disposed) return Promise.reject(cancelled());
    try {
      this.context ??= new AudioContext({ latencyHint: 'interactive' });
      // A reused context retains the gesture permission for later automatic replies.
      return this.context.state === 'running' ? Promise.resolve() : this.context.resume();
    } catch { return Promise.reject(new Error('Audio playback is unavailable in this browser.')); }
  }

  private async generate(text: string, signal: AbortSignal): Promise<AudioData> {
    if (signal.aborted) throw cancelled();
    const hit = this.cache.get(text);
    if (hit) { this.cache.delete(text); this.cache.set(text, hit); return hit; }
    await abortable(this.prepare(), signal);
    if (signal.aborted) throw cancelled();
    const id = ++this.sequence;
    const operation = new Promise<AudioData>((resolve, reject) => { this.pending.set(id, { resolve, reject }); });
    const timer = setTimeout(() => this.fail(new Error('Your device is taking too long to generate speech. Please try a shorter reply.')), 90_000);
    this.worker!.postMessage({ id, text });
    try {
      const audio = await abortable(operation, signal);
      if (signal.aborted || this.disposed) throw cancelled();
      this.cache.set(text, audio);
      while (this.cache.size > 24 || [...this.cache.values()].reduce((sum, item) => sum + item.samples.byteLength, 0) > 16 * 1024 * 1024) this.cache.delete(this.cache.keys().next().value!);
      return audio;
    } finally { clearTimeout(timer); this.pending.delete(id); }
  }

  async play(segments: string[], signal: AbortSignal, rate: number, onStarted: () => void) {
    if (signal.aborted) throw cancelled();
    // Resume while a manual replay's user gesture is still active.
    const resume = this.unlock();
    const timeout = new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('Tap a reply’s speaker button to enable sound.')), 2000); resume.finally(() => clearTimeout(timer)).catch(() => {}); });
    await abortable(Promise.race([resume, timeout]), signal);
    if (!segments.length) return;
    let next = this.generate(segments[0], signal);
    for (let index = 0; index < segments.length; index++) {
      const audio = await next;
      if (signal.aborted || this.disposed) throw cancelled();
      if (index + 1 < segments.length) { next = this.generate(segments[index + 1], signal); void next.catch(() => {}); }
      await this.playBuffer(audio, signal, rate, onStarted);
    }
  }

  private playBuffer(audio: AudioData, signal: AbortSignal, rate: number, onStarted: () => void) {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted || !this.context || this.context.state !== 'running') { reject(signal.aborted ? cancelled() : new Error('Tap a reply’s speaker button to enable sound.')); return; }
      const buffer = this.context.createBuffer(1, audio.samples.length, audio.sampleRate); buffer.copyToChannel(audio.samples, 0);
      const source = this.context.createBufferSource(); source.buffer = buffer; source.playbackRate.value = rate; source.connect(this.context.destination); this.sources.add(source);
      const clean = () => { signal.removeEventListener('abort', abort); this.playbackAborts.delete(abort); source.onended = null; source.disconnect(); this.sources.delete(source); };
      const abort = () => { clean(); source.stop(); reject(cancelled()); };
      this.playbackAborts.add(abort);
      signal.addEventListener('abort', abort, { once: true });
      source.onended = () => { clean(); resolve(); };
      source.start(); onStarted();
    });
  }

  dispose() {
    this.disposed = true; this.fail(cancelled()); this.cache.clear();
    this.playbackAborts.forEach(abort => abort()); this.playbackAborts.clear();
    this.sources.forEach(source => { source.stop(); source.disconnect(); }); this.sources.clear();
    if (this.context) void this.context.close().catch(() => {});
    this.context = undefined;
  }
}
