/** English-only device fallback. No cloud request or cloud usage event is made. */
export function speakOnDevice(text: string, signal: AbortSignal, rate: number, onStarted: () => void): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException('Playback cancelled', 'AbortError'));
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return Promise.reject(new Error('Voice playback is unavailable. Please try again shortly.'));
  const synth = speechSynthesis;
  return new Promise((resolve, reject) => {
    let utterance: SpeechSynthesisUtterance | undefined, settled = false;
    let voiceTimer: ReturnType<typeof setTimeout> | undefined, startTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(voiceTimer); clearTimeout(startTimer);
      signal.removeEventListener('abort', abort); synth.removeEventListener('voiceschanged', voicesReady);
      if (utterance) utterance.onstart = utterance.onend = utterance.onerror = null;
      if (error) { synth.cancel(); reject(error); } else resolve();
    };
    const abort = () => finish(new DOMException('Playback cancelled', 'AbortError'));
    const start = () => {
      if (settled || utterance) return;
      clearTimeout(voiceTimer); synth.removeEventListener('voiceschanged', voicesReady);
      const voices = synth.getVoices(), english = voices.filter(voice => /^en(?:[-_]|$)/i.test(voice.lang));
      if (voices.length && !english.length) { finish(new Error('Please enable an English voice in your device speech settings, then tap the speaker again.')); return; }
      utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'en-US'; utterance.rate = rate;
      const voice = english.find(item => item.localService) || english.find(item => item.default) || english[0];
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
      utterance.onstart = () => { if (!settled) { clearTimeout(startTimer); onStarted(); } };
      utterance.onend = () => finish();
      utterance.onerror = event => finish(new Error(event.error === 'not-allowed' ? 'Tap the speaker button to allow audio playback.' : 'Your device could not read this aloud. Check its English voice settings and try again.'));
      startTimer = setTimeout(() => finish(new Error('Tap the speaker button to allow audio playback. Check that an English voice is enabled on your device.')), 8000);
      try { synth.speak(utterance); } catch (error) { finish(error instanceof Error ? error : new Error('Could not play the device voice.')); }
    };
    const voicesReady = () => { if (synth.getVoices().length) start(); };
    signal.addEventListener('abort', abort, { once: true });
    if (synth.getVoices().length) start();
    else { synth.addEventListener('voiceschanged', voicesReady); voiceTimer = setTimeout(start, 500); }
  });
}

export class SpeechFallback {
  private retryCloudAt = 0;
  constructor(private device = speakOnDevice, private now = Date.now) {}
  async play(text: string, signal: AbortSignal, rate: number, cloud: (onStarted: () => void) => Promise<void>, onStarted: () => void) {
    if (signal.aborted) throw new DOMException('Playback cancelled', 'AbortError');
    if (this.now() >= this.retryCloudAt) {
      let began = false;
      try { await cloud(() => { began = true; onStarted(); }); return; }
      catch (error) {
        const kind = (error as { kind?: string })?.kind;
        // Never restart an already audible segment, bypass account checks or speak after Stop.
        if (signal.aborted || began || ['unauthorized', 'forbidden', 'limit'].includes(kind || '') || (error instanceof Error && ['AbortError', 'NotAllowedError'].includes(error.name))) throw error;
        this.retryCloudAt = this.now() + 60_000;
      }
    }
    await this.device(text, signal, rate, onStarted);
  }
}
