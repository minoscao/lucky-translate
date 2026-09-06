/* Microphone processing stays off the UI thread. Audio is held in memory only. */
class LuckyVoice extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Int16Array(16000 * 20); this.size = 0;
    this.pre = new Int16Array(3200); this.preSize = 0;
    this.silenceSeconds = 0; this.voiced = 0; this.tick = 0; this.active = true;
    this.autoSilenceSeconds = Infinity; this.detectSpeaker = false; this.freshSegment = true;
    this.phase = 0; this.resampleSum = 0; this.resampleCount = 0;
    this.pitchFrames = 0; this.speakerPitch = 0; this.changeCandidate = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'config') { this.autoSilenceSeconds = data.mode === 'continuous' ? 5 : Infinity; this.detectSpeaker = data.mode === 'continuous' && data.detectSpeaker !== false; }
      if (data.type === 'flush') { this.emit('stop'); this.active = false; this.port.postMessage({ type: 'flushed' }); }
    };
  }
  ensure(count) {
    if (count <= this.samples.length) return;
    let length = this.samples.length;
    while (length < count && length < 16000 * 600) length = Math.min(16000 * 600, length * 2);
    if (length < count) return;
    const next = new Int16Array(length); next.set(this.samples.subarray(0, this.size)); this.samples = next;
  }
  downsample(input) {
    const output = [];
    for (const value of input) {
      this.resampleSum += value; this.resampleCount++; this.phase += 16000;
      if (this.phase >= sampleRate) {
        const average = this.resampleSum / this.resampleCount;
        output.push(Math.round(Math.max(-1, Math.min(1, average)) * (average < 0 ? 32768 : 32767)));
        this.phase -= sampleRate; this.resampleSum = 0; this.resampleCount = 0;
      }
    }
    return Int16Array.from(output);
  }
  keepPre(chunk) {
    const incoming = chunk.subarray(Math.max(0, chunk.length - this.pre.length));
    const keep = Math.min(this.preSize, this.pre.length - incoming.length);
    this.pre.copyWithin(0, this.preSize - keep, this.preSize); this.pre.set(incoming, keep); this.preSize = keep + incoming.length;
  }
  append(chunk) {
    this.ensure(this.size + chunk.length);
    if (this.size + chunk.length <= this.samples.length) { this.samples.set(chunk, this.size); this.size += chunk.length; }
  }
  estimatePitch() {
    const count = Math.min(2048, this.size); if (count < 1600) return 0;
    const from = this.size - count; let mean = 0;
    for (let i = from; i < this.size; i++) mean += this.samples[i]; mean /= count;
    let energy = 0; for (let i = from; i < this.size; i++) { const value = this.samples[i] - mean; energy += value * value; }
    if (!energy) return 0;
    let bestLag = 0, best = 0;
    for (let lag = 40; lag <= 320; lag++) {
      let sum = 0, left = 0, right = 0;
      for (let i = from + lag; i < this.size; i++) { const a = this.samples[i] - mean, b = this.samples[i - lag] - mean; sum += a * b; left += a * a; right += b * b; }
      const score = sum / Math.sqrt(Math.max(1, left * right)); if (score > best) { best = score; bestLag = lag; }
    }
    return best >= .32 && bestLag ? 16000 / bestLag : 0;
  }
  checkSpeaker() {
    if (!this.detectSpeaker || this.size < 16000 * .6) return;
    this.pitchFrames += 128; if (this.pitchFrames < sampleRate * .5) return; this.pitchFrames = 0;
    const pitch = this.estimatePitch(); if (!pitch) return;
    if (!this.speakerPitch) { this.speakerPitch = pitch; return; }
    const distance = Math.abs(Math.log2(pitch / this.speakerPitch));
    if (distance > .42) this.changeCandidate++; else { this.changeCandidate = 0; this.speakerPitch = this.speakerPitch * .85 + pitch * .15; }
    if (this.changeCandidate < 2) return;
    const before = this.freshSegment && this.size < 16000 * 2;
    this.speakerPitch = pitch; this.changeCandidate = 0; this.emit(before ? 'speaker-before' : 'speaker-after');
  }
  emit(reason) {
    if (this.voiced >= 2000 && this.size) {
      const buffer = new ArrayBuffer(44 + this.size * 2), view = new DataView(buffer);
      const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
      text(0, 'RIFF'); view.setUint32(4, 36 + this.size * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, this.size * 2, true);
      for (let i = 0; i < this.size; i++) view.setInt16(44 + i * 2, this.samples[i], true);
      this.port.postMessage({ type: 'sentence', wav: buffer, boundary: reason }, [buffer]);
    }
    this.size = 0; this.silenceSeconds = 0; this.voiced = 0; this.preSize = 0;
    this.freshSegment = reason === 'silence'; this.pitchFrames = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0]; if (!this.active || !input?.length) return true;
    let sum = 0; for (const value of input) sum += value * value;
    const rms = Math.sqrt(sum / input.length), voice = rms >= .008, chunk = this.downsample(input);
    this.tick += input.length;
    if (this.tick >= sampleRate / 10) { this.tick = 0; this.port.postMessage({ type: 'level', level: Math.min(1, rms * 14) }); }
    if (!this.size && !voice) { this.keepPre(chunk); return true; }
    if (!this.size) { this.append(this.pre.subarray(0, this.preSize)); this.preSize = 0; }
    this.append(chunk);
    if (voice) { this.voiced += chunk.length; this.silenceSeconds = 0; this.checkSpeaker(); }
    else this.silenceSeconds += input.length / sampleRate;
    if (this.silenceSeconds >= this.autoSilenceSeconds) this.emit('silence');
    return true;
  }
}
registerProcessor('lucky-voice', LuckyVoice);
