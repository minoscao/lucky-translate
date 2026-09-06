/* The microphone is processed off the UI thread. Audio never enters storage. */
class LuckyVoice extends AudioWorkletProcessor {
  constructor() {
    super(); this.samples = new Float32Array(sampleRate * 12); this.pre = new Float32Array(Math.ceil(sampleRate * .2));
    this.size = 0; this.preSize = 0; this.silence = 0; this.voiced = 0; this.tick = 0; this.active = true;
    this.port.onmessage = ({ data }) => { if (data.type === 'flush') { this.emit(); this.active = false; this.port.postMessage({ type: 'flushed' }); } };
  }
  emit() {
    if (this.voiced >= sampleRate * .125) {
      const ratio = sampleRate / 16000, count = Math.floor(this.size / ratio);
      const buffer = new ArrayBuffer(44 + count * 2), view = new DataView(buffer);
      const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
      text(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      text(36, 'data'); view.setUint32(40, count * 2, true);
      for (let i = 0; i < count; i++) {
        const from = Math.floor(i * ratio), to = Math.min(this.size, Math.floor((i + 1) * ratio));
        let total = 0; for (let j = from; j < to; j++) total += this.samples[j];
        const value = Math.max(-1, Math.min(1, total / Math.max(1, to - from)));
        view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      }
      this.port.postMessage({ type: 'sentence', wav: buffer }, [buffer]);
    }
    this.size = 0; this.silence = 0; this.voiced = 0; this.preSize = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0]; if (!this.active || !input?.length) return true;
    let sum = 0; for (const v of input) sum += v * v;
    const rms = Math.sqrt(sum / input.length), voice = rms >= .008;
    this.tick += input.length;
    if (this.tick >= sampleRate / 10) { this.tick = 0; this.port.postMessage({ type: 'level', level: Math.min(1, rms * 14) }); }
    if (!this.size && !voice) {
      const keep = Math.min(this.preSize, this.pre.length - input.length);
      this.pre.copyWithin(0, this.preSize - keep, this.preSize); this.pre.set(input, keep); this.preSize = keep + input.length; return true;
    }
    if (!this.size) { this.samples.set(this.pre.subarray(0, this.preSize)); this.size = this.preSize; this.preSize = 0; }
    if (this.size + input.length > this.samples.length) this.emit();
    this.samples.set(input, this.size); this.size += input.length;
    if (voice) { this.voiced += input.length; this.silence = 0; } else this.silence += input.length;
    if (this.silence >= sampleRate * .7 || this.size >= sampleRate * 10) this.emit();
    return true;
  }
}
registerProcessor('lucky-voice', LuckyVoice);
