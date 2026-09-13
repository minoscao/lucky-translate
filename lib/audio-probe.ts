import { selectSink } from './audio-routing';

export type ProbeEngine = 'web-audio' | 'media-element';
export type ProbeId = 'a' | 'b';
export type ProbeConfig = { id: ProbeId; blob: Blob; deviceId: string; volume: number; engine: ProbeEngine };
export type ProbeStatus = { state: 'idle' | 'preparing' | 'playing' | 'error'; message: string; browserSink?: string };
type RoutedContext = AudioContext & { sinkId?: string | object; setSinkId?: (id: string) => Promise<void> };
type Output = { ready: Promise<void>; play: () => Promise<void>; stop: () => void; sink: () => string | undefined; volume: (value: number) => void };
const cancelled = () => new DOMException('Playback cancelled', 'AbortError');

function webOutput(config: ProbeConfig, signal: AbortSignal): Output {
  const context = new AudioContext({ latencyHint: 'interactive' }) as RoutedContext;
  const gain = context.createGain(); gain.gain.value = config.volume; gain.connect(context.destination);
  let source: AudioBufferSourceNode | undefined, stopped = false;
  const stop = () => { if (stopped) return; stopped = true; try { source?.stop(); } catch {} source?.disconnect(); gain.disconnect(); void context.close().catch(() => {}); signal.removeEventListener('abort', stop); };
  signal.addEventListener('abort', stop, { once: true });
  // Resume during the click gesture, before decoding or output selection.
  const resumed = context.resume();
  const ready = (async () => {
    if (context.setSinkId) {
      await context.setSinkId(config.deviceId);
      if (context.sinkId !== config.deviceId) throw new Error('Web Audio did not select the requested output.');
    } else if (config.deviceId) throw new Error('This browser cannot choose a Web Audio output.');
    if (signal.aborted) throw cancelled();
    const decoded = await context.decodeAudioData(await config.blob.arrayBuffer());
    await resumed;
    if (signal.aborted) throw cancelled();
    source = context.createBufferSource(); source.buffer = decoded; source.loop = true; source.connect(gain);
  })();
  // A rejected resume must be observed even when output selection fails first.
  void resumed.catch(() => {});
  return { ready, stop, sink: () => typeof context.sinkId === 'string' ? context.sinkId : undefined,
    volume: value => { gain.gain.value = value; },
    play: async () => {
      if (signal.aborted || !source) throw cancelled();
      if (context.setSinkId && context.sinkId !== config.deviceId) throw new Error('The selected output changed before playback. Scan devices again.');
      source.start();
    },
  };
}

function mediaOutput(config: ProbeConfig, signal: AbortSignal): Output {
  const audio = new Audio(), url = URL.createObjectURL(config.blob);
  audio.src = url; audio.loop = true; audio.volume = config.volume; audio.preload = 'auto';
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; audio.pause(); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); signal.removeEventListener('abort', stop); };
  signal.addEventListener('abort', stop, { once: true });
  const ready = (async () => {
    await selectSink(audio, config.deviceId);
    if (signal.aborted) throw cancelled();
    if (audio.readyState >= 3) return;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); audio.removeEventListener('canplay', loaded); audio.removeEventListener('error', failed); signal.removeEventListener('abort', aborted); };
      const loaded = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('This browser could not decode the selected audio file. Try an MP3 or WAV.')); };
      const aborted = () => { cleanup(); reject(cancelled()); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Audio preparation timed out. Try a smaller file.')); }, 15000);
      audio.addEventListener('canplay', loaded); audio.addEventListener('error', failed); signal.addEventListener('abort', aborted, { once: true }); audio.load();
    });
  })();
  return { ready, stop, sink: () => typeof audio.sinkId === 'string' ? audio.sinkId : undefined, volume: value => { audio.volume = value; },
    play: async () => { if (signal.aborted) throw cancelled(); await selectSink(audio, config.deviceId); if (signal.aborted) throw cancelled(); await audio.play(); },
  };
}

export class AudioProbe {
  private sessions = new Map<ProbeId, { abort: AbortController; output: Output }>();
  constructor(private notify: (id: ProbeId, status: ProbeStatus) => void, private createOutput = (config: ProbeConfig, signal: AbortSignal) => config.engine === 'web-audio' ? webOutput(config, signal) : mediaOutput(config, signal)) {}
  stop(id: ProbeId) { const session = this.sessions.get(id); session?.abort.abort(); session?.output.stop(); this.sessions.delete(id); this.notify(id, { state: 'idle', message: 'Stopped' }); }
  stopAll() { this.stop('a'); this.stop('b'); }
  volume(id: ProbeId, value: number) { this.sessions.get(id)?.output.volume(Math.max(0, Math.min(1, value))); }
  async start(configs: ProbeConfig[]) {
    const started: Array<{ config: ProbeConfig; abort: AbortController; output: Output }> = [];
    try {
      for (const config of configs) {
        this.stop(config.id);
        this.notify(config.id, { state: 'preparing', message: 'Preparing audio…' });
        const abort = new AbortController(), output = this.createOutput(config, abort.signal);
        const session = { config, abort, output }; started.push(session); this.sessions.set(config.id, session);
        void output.ready.catch(() => {});
      }
      await Promise.all(started.map(session => session.output.ready));
      if (started.some(session => session.abort.signal.aborted)) {
        for (const session of started) if (this.sessions.get(session.config.id) === session) this.stop(session.config.id);
        return;
      }
      // Both are ready before either starts. Starting one never stops its peer.
      await Promise.all(started.map(session => session.output.play()));
      for (const session of started) if (!session.abort.signal.aborted) this.notify(session.config.id, { state: 'playing', message: 'Playing — check which device you hear', browserSink: session.output.sink() });
    } catch (error) {
      for (const session of started) if (!session.abort.signal.aborted) {
        this.stop(session.config.id);
        this.notify(session.config.id, { state: 'error', message: error instanceof Error ? error.message : 'Could not start playback.' });
      }
      // Creation itself can fail before a session exists.
      for (const config of configs) if (!started.some(session => session.config.id === config.id)) this.notify(config.id, { state: 'error', message: error instanceof Error ? error.message : 'Audio is unavailable.' });
    }
  }
}

export function demoMusic(id: ProbeId) {
  const rate = 24000, notes = id === 'a' ? [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25] : [196, 0, 246.94, 0, 293.66, 246.94, 196, 0];
  const step = id === 'a' ? .3 : .45, samples = new Float32Array(Math.floor(rate * step * notes.length));
  for (let i = 0; i < samples.length; i++) {
    const time = i / rate, note = notes[Math.floor(time / step)], within = time % step;
    const envelope = Math.min(1, within / .015, (step - within) / .06);
    samples[i] = note ? (Math.sin(2 * Math.PI * note * time) + .18 * Math.sin(4 * Math.PI * note * time)) * envelope * .2 : 0;
  }
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const text = (at: number, value: string) => [...value].forEach((letter, index) => view.setUint8(at + index, letter.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.round(sample * 32767), true));
  return new Blob([buffer], { type: 'audio/wav' });
}
