import type { SpeechResource } from './speech-cache';

/** Incremental WAV reader. Only complete PCM frames are emitted. Unknown formats
 * use browser decoding after download; they never produce guessed samples. */
export class WavStream {
  private pending = new Uint8Array(0);
  private riff = false;
  private data = false;
  private remaining = 0;
  private format?: { code: number; channels: number; rate: number; bits: number; align: number };
  unsupported = false;
  emitted = false;
  constructor(private emit: (channels: Float32Array[], rate: number) => void) {}
  push(chunk: Uint8Array) {
    if (this.unsupported) return;
    const joined = new Uint8Array(this.pending.length + chunk.length); joined.set(this.pending); joined.set(chunk, this.pending.length); this.pending = joined;
    if (!this.riff) {
      if (this.pending.length < 12) return;
      if (this.text(0) !== 'RIFF' || this.text(8) !== 'WAVE') { this.unsupported = true; return; }
      this.riff = true; this.pending = this.pending.slice(12);
    }
    while (!this.data && this.pending.length >= 8) {
      const name = this.text(0), length = new DataView(this.pending.buffer).getUint32(4, true);
      if (name === 'data') {
        if (!this.format) { this.unsupported = true; return; }
        this.data = true; this.remaining = length; this.pending = this.pending.slice(8); break;
      }
      if (length > 65536) { this.unsupported = true; return; }
      if (this.pending.length < 8 + length + (length % 2)) return;
      if (name === 'fmt ') {
        if (length < 16) { this.unsupported = true; return; }
        const view = new DataView(this.pending.buffer, 8, length);
        const code = view.getUint16(0, true), channels = view.getUint16(2, true), rate = view.getUint32(4, true), align = view.getUint16(12, true), bits = view.getUint16(14, true);
        if (!((code === 1 && [16, 24, 32].includes(bits)) || (code === 3 && bits === 32)) || channels < 1 || channels > 2 || rate < 8000 || rate > 96000 || align !== channels * bits / 8) { this.unsupported = true; return; }
        this.format = { code, channels, rate, align, bits };
      }
      this.pending = this.pending.slice(8 + length + (length % 2));
    }
    this.drain(false);
  }
  private text(at: number) { return String.fromCharCode(...this.pending.subarray(at, at + 4)); }
  private drain(final: boolean) {
    if (!this.data || !this.format || this.unsupported) return;
    const { code, channels, rate, bits, align } = this.format;
    const frames = Math.floor(Math.min(this.pending.length, this.remaining) / align);
    if (!frames || (!final && frames < rate * .12 && this.pending.length < this.remaining)) return;
    const samples = Array.from({ length: channels }, () => new Float32Array(frames)), view = new DataView(this.pending.buffer);
    for (let i = 0; i < frames; i++) for (let channel = 0; channel < channels; channel++) {
      const offset = i * align + channel * bits / 8;
      let value = code === 3 ? view.getFloat32(offset, true) : bits === 16 ? view.getInt16(offset, true) / 32768 : bits === 32 ? view.getInt32(offset, true) / 2147483648 : ((view.getUint8(offset) | view.getUint8(offset + 1) << 8 | view.getInt8(offset + 2) << 16) / 8388608);
      if (!Number.isFinite(value)) value = 0;
      samples[channel][i] = Math.max(-1, Math.min(1, value));
    }
    const consumed = frames * align; this.remaining -= consumed; this.pending = this.pending.slice(consumed); this.emitted = true; this.emit(samples, rate);
  }
  finish() { this.drain(true); if (this.data && this.remaining > 0) throw new Error('The audio download was incomplete. Please try again.'); }
}

export class StreamingSpeechPlayer {
  private context: AudioContext;
  private resumed: Promise<void>;
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private stopped = false;
  constructor(private signal: AbortSignal, private speed = 1) {
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.resumed = this.context.resume(); void this.resumed.catch(() => {});
    signal.addEventListener('abort', this.stop, { once: true });
  }
  stop = () => { if (this.stopped) return; this.stopped = true; this.signal.removeEventListener('abort', this.stop); for (const source of this.sources) { try { source.stop(); } catch {} source.disconnect(); } this.sources.clear(); void this.context.close().catch(() => {}); };
  async play(resource: SpeechResource, onStarted: () => void) {
    let unsubscribe = () => {}, started = false, complete = false, pending = 0;
    let resolveEnd!: () => void, rejectEnd!: (cause: unknown) => void;
    const ended = new Promise<void>((resolve, reject) => { resolveEnd = resolve; rejectEnd = reject; }); void ended.catch(() => {});
    const abort = () => rejectEnd(new DOMException('Playback cancelled', 'AbortError'));
    this.signal.addEventListener('abort', abort, { once: true });
    const schedule = (buffer: AudioBuffer) => {
      if (this.stopped || this.signal.aborted) return;
      const source = this.context.createBufferSource(); source.buffer = buffer; source.playbackRate.value = this.speed; source.connect(this.context.destination);
      const time = Math.max(this.context.currentTime + .03, this.nextTime); this.nextTime = time + buffer.duration / this.speed;
      pending++; this.sources.add(source);
      source.onended = () => { this.sources.delete(source); source.disconnect(); pending--; if (complete && !pending) resolveEnd(); };
      source.start(time);
      if (!started) { started = true; onStarted(); }
    };
    const parser = new WavStream((channels, rate) => { const buffer = this.context.createBuffer(channels.length, channels[0].length, rate); channels.forEach((samples, index) => buffer.getChannelData(index).set(samples)); schedule(buffer); });
    try {
      if (this.signal.aborted) throw new DOMException('Playback cancelled', 'AbortError');
      // Mobile autoplay can leave resume() pending. A cloud error or Stop must
      // still finish the request; otherwise the device fallback is never reached.
      const resumeTimeout = setTimeout(() => rejectEnd(new DOMException('Tap the speaker button to allow audio playback.', 'NotAllowedError')), 1500);
      try { await Promise.race([this.resumed, resource.audio.then(() => this.resumed), ended]); }
      finally { clearTimeout(resumeTimeout); }
      if (this.signal.aborted) throw new DOMException('Playback cancelled', 'AbortError');
      // Parser errors belong to this playback; they must not poison the shared download.
      unsubscribe = resource.subscribe(chunk => { try { parser.push(chunk); } catch (cause) { rejectEnd(cause); } });
      const blob = await Promise.race([resource.audio, ended.then(() => { throw new Error('Audio playback interrupted.'); })]);
      parser.finish();
      if (!parser.emitted) schedule(await this.context.decodeAudioData(await blob.arrayBuffer()));
      complete = true; if (!pending) resolveEnd(); await ended;
    } catch (cause) { this.stop(); throw cause; }
    finally { unsubscribe(); this.signal.removeEventListener('abort', abort); }
  }
}
