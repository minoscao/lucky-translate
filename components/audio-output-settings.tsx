'use client';
import { useEffect, useRef, useState } from 'react';
import { Headphones, LoaderCircle, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AudioChannel, AudioRoute, DEFAULT_AUDIO_ROUTE, selectSink, testTone } from '@/lib/audio-routing';
import { Pair, language } from '@/lib/translation';

type Props = { pair: Pair; enabled: boolean; routes: Record<string, AudioRoute>; onEnabled: (value: boolean) => void; onRoute: (lang: string, value: AudioRoute) => void };
export function AudioOutputSettings({ pair, enabled, routes, onEnabled, onRoute }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const mounted = useRef(true);
  const revision = useRef(0), playback = useRef<HTMLAudioElement | null>(null), url = useRef('');
  const stop = () => { playback.current?.pause(); playback.current = null; if (url.current) URL.revokeObjectURL(url.current); url.current = ''; };
  const refresh = async () => {
    const outputs = await navigator.mediaDevices?.enumerateDevices();
    if (!mounted.current) return;
    setDevices((outputs || []).filter(device => device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default'));
  };
  useEffect(() => {
    mounted.current = true;
    setSupported(typeof HTMLMediaElement.prototype.setSinkId === 'function');
    const update = () => { void refresh().catch(() => {}); };
    update(); navigator.mediaDevices?.addEventListener('devicechange', update);
    return () => { mounted.current = false; revision.current++; stop(); navigator.mediaDevices?.removeEventListener('devicechange', update); };
  }, []);
  const choose = async (lang: string) => {
    const token = ++revision.current; setBusy(lang); setError('');
    try {
      const media = navigator.mediaDevices as MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
      if (media.selectAudioOutput) {
        const device = await media.selectAudioOutput();
        if (token !== revision.current) return;
        onRoute(lang, { ...(routes[lang] || DEFAULT_AUDIO_ROUTE), deviceId: device.deviceId });
      } else {
        const stream = await media.getUserMedia({ audio: true }); stream.getTracks().forEach(track => track.stop());
      }
      if (token === revision.current) await refresh();
    } catch { if (token === revision.current) setError('Could not access audio devices. Check browser permissions and your Bluetooth connection.'); }
    finally { if (token === revision.current) setBusy(''); }
  };
  const test = async (lang: string) => {
    const token = ++revision.current; stop(); setBusy(`test-${lang}`); setError('');
    try {
      const route = routes[lang] || DEFAULT_AUDIO_ROUTE;
      const audio = new Audio(); playback.current = audio;
      await selectSink(audio, route.deviceId);
      if (token !== revision.current) return;
      url.current = URL.createObjectURL(testTone(route.channel)); audio.src = url.current;
      audio.onerror = () => { if (token === revision.current) { stop(); setBusy(''); setError('Could not play the test sound. Try another output.'); } };
      audio.onended = () => { if (token === revision.current) { stop(); setBusy(''); } };
      await audio.play();
    } catch { if (token === revision.current) { stop(); setBusy(''); setError('Could not play on this output. Reconnect it and choose it again.'); } }
  };
  return <section className="audio-output-settings" aria-label="Live interpretation audio">
    <Button variant={enabled ? 'default' : 'outline'} aria-pressed={enabled} disabled={Boolean(busy)} onClick={() => onEnabled(!enabled)}><Headphones />Dual-channel interpretation · {enabled ? 'On' : 'Off'}</Button>
    {enabled && <>
      <p className="field-label">Each language plays to its assigned listener.</p>
      {pair.map((lang, index) => {
        const route = routes[lang] || DEFAULT_AUDIO_ROUTE;
        const missing = route.deviceId && !devices.some(device => device.deviceId === route.deviceId);
        return <fieldset key={lang} className="audio-output-route" disabled={Boolean(busy)}><legend>Channel {index + 1} · {language(lang)?.name}</legend>
          <label className="field-label" htmlFor={`output-${lang}`}>Playback device</label>
          <Select disabled={!supported} value={route.deviceId || 'system'} onValueChange={value => { if (value) onRoute(lang, { ...route, deviceId: value === 'system' ? '' : value }); }}><SelectTrigger id={`output-${lang}`} className="app-input"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">System output</SelectItem>{missing && <SelectItem value={route.deviceId}>Selected device unavailable — reconnect</SelectItem>}{devices.map((device, i) => <SelectItem key={device.deviceId} value={device.deviceId}>{device.label || `Audio output ${i + 1}`}</SelectItem>)}</SelectContent></Select>
          <label className="field-label" htmlFor={`channel-${lang}`}>Ear / channel</label>
          <Select value={route.channel} onValueChange={value => { if (value) onRoute(lang, { ...route, channel: value as AudioChannel }); }}><SelectTrigger id={`channel-${lang}`} className="app-input"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="both">Both</SelectItem><SelectItem value="left">Left only</SelectItem><SelectItem value="right">Right only</SelectItem></SelectContent></Select>
          <div className="audio-output-actions">{supported && <Button variant="outline" onClick={() => void choose(lang)}>{busy === lang ? <LoaderCircle className="spinning" /> : <Headphones />}Find devices</Button>}<Button variant="outline" onClick={() => void test(lang)}>{busy === `test-${lang}` ? <LoaderCircle className="spinning" /> : <Volume2 />}Test sound</Button></div>
        </fieldset>;
      })}
      {!supported && <p role="status">This browser uses the system output. A stereo headset can still use Left only / Right only.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <details className="inline-help"><summary>Connection & speaking guide</summary><p>Connect headphones or speakers in your device settings first. Choose one output per language, then test both. For one shared stereo headset, assign one language to Left only and the other to Right only. Turn off mono audio in your device settings.</p><p>Hold the speaking person’s microphone button and release to translate. The other person hears their language. Use one microphone at a time; this mode translates completed phrases. Separate Bluetooth outputs depend on your device and browser. Audio choices apply to this tab; set them up again after reloading.</p></details>
    </>}
  </section>;
}
