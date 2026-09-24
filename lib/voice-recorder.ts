import type { RecordMode } from './translation';

type Callbacks = { onSentence: (blob: Blob, boundary?: 'speaker-before' | 'speaker-after') => void; onSpeechStart?: () => void; onLevel: (level: number) => void; onError: (message: string) => void; onProgress?: (seconds: number) => void; onLimit?: () => void };
export class VoiceRecorder {
  private context?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private source?: MediaStreamAudioSourceNode;
  private generation = 0;
  private finish?: () => void;
  private stopping?: Promise<void>;
  constructor(private callbacks: Callbacks) {}
  prepare() {
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext();
    void this.context.resume().catch(() => {});
  }
  setPlayback(active: boolean) { this.node?.port.postMessage({ type: 'playback', active }); }
  async start(mode: Exclude<RecordMode, 'idle'> = 'hold', detectSpeaker = true, deviceId = '', maxSeconds = 0, conversation = false) {
    const token = ++this.generation;
    await this.stopping;
    if (token !== this.generation) return false;
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('Recording is unavailable. Please use an up-to-date Chrome or Safari browser.');
    this.prepare();
    const context = this.context!;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    if (token !== this.generation) { stream.getTracks().forEach(track => track.stop()); return false; }
    this.stream = stream;
    try {
      await context.audioWorklet.addModule('/voice-processor.js');
      if (token !== this.generation) { stream.getTracks().forEach(track => track.stop()); return false; }
      const node = new AudioWorkletNode(context, 'lucky-voice'); this.node = node;
      node.port.postMessage({ type: 'config', mode, detectSpeaker, maxSeconds, conversation });
      node.port.onmessage = ({ data }) => {
        if (data.type === 'flushed') { this.finish?.(); return; }
        if (token !== this.generation) return;
        if (data.type === 'level') this.callbacks.onLevel(data.level);
        if (data.type === 'progress') this.callbacks.onProgress?.(data.seconds);
        if (data.type === 'limit') this.callbacks.onLimit?.();
        if (data.type === 'speech-start') this.callbacks.onSpeechStart?.();
        if (data.type === 'sentence') this.callbacks.onSentence(new Blob([data.wav], { type: 'audio/wav' }), data.boundary);
      };
      node.onprocessorerror = () => { if (token === this.generation) this.callbacks.onError('Recording was interrupted. Please try again.'); };
      this.source = context.createMediaStreamSource(stream); this.source.connect(node); node.connect(context.destination);
      stream.getAudioTracks().forEach(track => { track.onended = () => { if (token === this.generation) this.callbacks.onError('The microphone disconnected. Please reconnect it.'); }; });
      return true;
    } catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
  }
  stop(commit = true): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = undefined;
    const node = this.node, context = this.context, source = this.source;
    this.node = undefined; this.context = undefined; this.source = undefined;
    if (!node || !commit) this.generation++;
    const cleanup = () => { this.generation++; node?.disconnect(); source?.disconnect(); void context?.close().catch(() => {}); this.callbacks.onLevel(0); };
    if (!node || !commit) { cleanup(); return Promise.resolve(); }
    this.stopping = new Promise<void>(resolve => {
      const timer = setTimeout(() => this.finish?.(), 300);
      this.finish = () => { clearTimeout(timer); this.finish = undefined; cleanup(); this.stopping = undefined; resolve(); };
      node.port.postMessage({ type: 'flush' });
    });
    return this.stopping;
  }
}
