'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = { label: string; prompt: string; value?: Blob; onChange: (audio: Blob) => void };

export function AudioSampleRecorder({ label, prompt, value, onChange }: Props) {
  const [recording, setRecording] = useState(false), [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | undefined>(undefined), stream = useRef<MediaStream | undefined>(undefined), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stop = () => { clearTimeout(timer.current); if (recorder.current?.state === 'recording') recorder.current.stop(); };
  const cleanup = () => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = undefined; recorder.current = undefined; setRecording(false); };
  useEffect(() => () => { clearTimeout(timer.current); stream.current?.getTracks().forEach(track => track.stop()); }, []);
  const start = async () => {
    setError('');
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      stream.current = media;
      const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
      const mimeType = candidates.find(type => MediaRecorder.isTypeSupported(type));
      const chunks: BlobPart[] = [], next = mimeType ? new MediaRecorder(media, { mimeType }) : new MediaRecorder(media);
      recorder.current = next;
      next.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      next.onerror = () => { setError('录音失败，请重新录制'); cleanup(); };
      next.onstop = () => { const audio = new Blob(chunks, { type: next.mimeType || 'audio/webm' }); if (audio.size) onChange(audio); else setError('没有录到声音，请重新录制'); cleanup(); };
      next.start(250); setRecording(true); timer.current = setTimeout(stop, 30000);
    } catch (cause) {
      setError((cause as DOMException).name === 'NotAllowedError' ? '请允许使用麦克风' : '无法开始录音，请重试'); cleanup();
    }
  };
  return <section className="voice-step">
    <span className="field-label">{label}</span><p>{prompt}</p>
    <Button type="button" variant={recording ? 'destructive' : 'secondary'} onClick={() => recording ? stop() : void start()}>{recording ? <><Square />停止录音</> : value ? <><Check />已录好，点击重录</> : <><Mic />开始录音</>}</Button>
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>;
}
