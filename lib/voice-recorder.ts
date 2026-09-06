type Callbacks = { onSentence: (blob: Blob) => void; onLevel: (level: number) => void; onError: (message: string) => void };
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
  async start() {
    const token = ++this.generation;
    await this.stopping;
    if (token !== this.generation) return false;
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('此浏览器无法录音，请用新版 Safari 或 Chrome 打开');
    this.prepare();
    const context = this.context!;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    if (token !== this.generation) { stream.getTracks().forEach(track => track.stop()); return false; }
    this.stream = stream;
    try {
      await context.audioWorklet.addModule('/voice-processor.js');
      if (token !== this.generation) { stream.getTracks().forEach(track => track.stop()); return false; }
      const node = new AudioWorkletNode(context, 'lucky-voice'); this.node = node;
      node.port.onmessage = ({ data }) => {
        if (data.type === 'flushed') { this.finish?.(); return; }
        if (token !== this.generation) return;
        if (data.type === 'level') this.callbacks.onLevel(data.level);
        if (data.type === 'sentence') this.callbacks.onSentence(new Blob([data.wav], { type: 'audio/wav' }));
      };
      node.onprocessorerror = () => { if (token === this.generation) this.callbacks.onError('录音中断，请重试'); };
      this.source = context.createMediaStreamSource(stream); this.source.connect(node); node.connect(context.destination);
      stream.getAudioTracks().forEach(track => { track.onended = () => { if (token === this.generation) this.callbacks.onError('麦克风已断开，请重新连接'); }; });
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
