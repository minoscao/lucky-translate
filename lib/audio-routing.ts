export type AudioChannel = 'both' | 'left' | 'right';
export type AudioRoute = { deviceId: string; channel: AudioChannel };
export const DEFAULT_AUDIO_ROUTE: AudioRoute = { deviceId: '', channel: 'both' };

export async function selectSink(audio: HTMLAudioElement, deviceId: string) {
  if (!deviceId) return;
  if (typeof audio.setSinkId !== 'function') throw new Error('This browser cannot choose separate speakers. Use the system output or split left / right channels.');
  // Never silently send a private translation to another output.
  await audio.setSinkId(deviceId);
}

export function channelWav(samples: Float32Array, sampleRate: number, channel: AudioChannel): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 4), view = new DataView(buffer);
  const label = (at: number, text: string) => [...text].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  label(36, 'data'); view.setUint32(40, samples.length * 4, true);
  samples.forEach((value, i) => {
    const sample = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
    view.setInt16(44 + i * 4, channel === 'right' ? 0 : sample, true);
    view.setInt16(46 + i * 4, channel === 'left' ? 0 : sample, true);
  });
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function routeAudio(blob: Blob, channel: AudioChannel): Promise<Blob> {
  if (channel === 'both') return blob;
  const context = new OfflineAudioContext(1, 1, 24000);
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  const mono = new Float32Array(decoded.length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += data[i] / decoded.numberOfChannels;
  }
  return channelWav(mono, decoded.sampleRate, channel);
}

export function testTone(channel: AudioChannel) {
  const rate = 24000, samples = new Float32Array(rate * .45);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 2 * Math.PI * 660 / rate) * .15 * Math.min(i / 240, (samples.length - i) / 240, 1);
  return channelWav(samples, rate, channel);
}

/** Keep the first audible segment small without changing any generated words. */
export function speechSegments(text: string): string[] {
  const boundary = /[.!?。！？](?:["”’)]*)(?:\s+|$)/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(text))) {
    const end = match.index + match[0].length;
    if (end >= 45 && end < text.length) return [text.slice(0, end), text.slice(end)];
  }
  return [text];
}
