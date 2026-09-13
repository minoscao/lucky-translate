'use client';
import { useEffect, useRef, useState } from 'react';
import { Headphones, LoaderCircle, Mic, RefreshCw, Square, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AudioChannel, AudioRoute, DEFAULT_AUDIO_ROUTE, selectSink, testTone } from '@/lib/audio-routing';
import { audioDeviceName, audioDeviceOptions, discoverAudioDevices, namedAudioDevices } from '@/lib/audio-devices';
import { Pair, language } from '@/lib/translation';

type Props = { pair: Pair; enabled: boolean; routes: Record<string, AudioRoute>; locked?: boolean; onEnabled: (value: boolean) => void; onRoute: (lang: string, value: AudioRoute) => void };
export function AudioOutputSettings({ pair, enabled, routes, locked = false, onEnabled, onRoute }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [supported, setSupported] = useState(false), [canChooseOutput, setCanChooseOutput] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [level, setLevel] = useState(0), [outputCheck, setOutputCheck] = useState('');
  const mounted = useRef(true), revision = useRef(0), discovery = useRef<Promise<MediaDeviceInfo[]> | null>(null);
  const playback = useRef<HTMLAudioElement | null>(null), url = useRef('');
  const input = useRef<MediaStream | null>(null), context = useRef<AudioContext | null>(null), frame = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stop = () => {
    playback.current?.pause(); playback.current = null;
    if (url.current) URL.revokeObjectURL(url.current); url.current = '';
    cancelAnimationFrame(frame.current); clearTimeout(timer.current);
    input.current?.getTracks().forEach(track => { track.onended = null; track.stop(); }); input.current = null;
    if (context.current) void context.current.close().catch(() => {}); context.current = null;
  };
  const finish = () => { revision.current++; stop(); setBusy(''); setLevel(0); };
  const refresh = async () => {
    const found = await discoverAudioDevices(navigator.mediaDevices);
    if (mounted.current) setDevices(found);
  };
  const scan = async () => {
    const token = ++revision.current; stop(); setBusy('scan'); setError('');
    try {
      if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Audio device discovery is unavailable. Open Lucky in a supported browser over HTTPS.');
      discovery.current ||= discoverAudioDevices(navigator.mediaDevices, true).finally(() => { discovery.current = null; });
      const found = await discovery.current;
      if (token === revision.current) setDevices(found);
    } catch { if (token === revision.current) { void refresh().catch(() => {}); setError('Allow microphone access to list system microphones and speakers, then scan again.'); } }
    finally { if (token === revision.current) setBusy(''); }
  };
  useEffect(() => {
    mounted.current = true;
    setSupported(typeof HTMLMediaElement.prototype.setSinkId === 'function' && 'sinkId' in HTMLMediaElement.prototype);
    setCanChooseOutput(typeof (navigator.mediaDevices as MediaDevices & { selectAudioOutput?: unknown })?.selectAudioOutput === 'function');
    void scan();
    const update = () => { void refresh().catch(() => {}); };
    const hide = () => { if (document.hidden) finish(); };
    navigator.mediaDevices?.addEventListener('devicechange', update); document.addEventListener('visibilitychange', hide);
    return () => { mounted.current = false; revision.current++; stop(); navigator.mediaDevices?.removeEventListener('devicechange', update); document.removeEventListener('visibilitychange', hide); };
  }, []);
  const chooseOutput = async () => {
    const token = ++revision.current; setBusy('output'); setError('');
    try {
      const media = navigator.mediaDevices as MediaDevices & { selectAudioOutput: () => Promise<MediaDeviceInfo> };
      await media.selectAudioOutput();
      if (token === revision.current) await refresh();
    } catch { if (token === revision.current) setError('Speaker access was not granted. You can choose from the devices already listed.'); }
    finally { if (token === revision.current) setBusy(''); }
  };
  const test = async (lang: string, kind: 'input' | 'output') => {
    const token = ++revision.current; stop(); setBusy(`${kind}-${lang}`); setError(''); setLevel(0); setOutputCheck('');
    try {
      const route = routes[lang] || DEFAULT_AUDIO_ROUTE;
      if (kind === 'input') {
        const capture = new AudioContext(); context.current = capture;
        await capture.resume();
        if (token !== revision.current) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: route.inputDeviceId ? { deviceId: { exact: route.inputDeviceId } } : true, video: false });
        if (token !== revision.current) { stream.getTracks().forEach(track => track.stop()); return; }
        input.current = stream;
        const analyser = capture.createAnalyser(); analyser.fftSize = 256;
        capture.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const measure = () => {
          if (token !== revision.current) return;
          analyser.getByteTimeDomainData(samples);
          setLevel(Math.min(1, Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length) * 4));
          frame.current = requestAnimationFrame(measure);
        };
        stream.getTracks().forEach(track => { track.onended = () => { if (token === revision.current) { finish(); setError('The microphone disconnected. Choose a connected input.'); } }; });
        measure(); timer.current = setTimeout(() => { if (token === revision.current) finish(); }, 5000);
      } else {
        const audio = new Audio(); playback.current = audio;
        url.current = URL.createObjectURL(testTone(route.channel)); audio.src = url.current;
        await selectSink(audio, supported ? route.deviceId : '');
        if (token !== revision.current) return;
        setOutputCheck(`${supported ? 'Browser-selected output' : 'System-controlled output'}: ${audioDeviceName(devices, 'audiooutput', supported ? audio.sinkId : '')}`);
        audio.onerror = () => { if (token === revision.current) { finish(); setError('Could not play on the selected speaker. Choose another output.'); } };
        audio.onended = () => { if (token === revision.current) finish(); };
        await audio.play();
      }
    } catch { if (token === revision.current) { finish(); setError(kind === 'input' ? 'Could not open the selected microphone. Check its connection and permission.' : 'Could not switch to this speaker. Playback was stopped. Check the device connection and browser permissions.'); } }
  };
  const inputs = namedAudioDevices(devices, 'audioinput'), outputs = namedAudioDevices(devices, 'audiooutput');
  return <section className="audio-output-settings" aria-label="Microphone and speaker channels">
    {!supported && <div className="audio-routing-limitation" role="status"><strong>The current translator player uses system output here</strong><p>Selecting a microphone does not switch the speaker.</p><p>{audioDeviceName(devices, 'audiooutput')}</p><p>Try the audio lab below to test another playback method.</p></div>}
    <a className="audio-test-back" href="/audio-test">Open two-speaker audio test →</a>
    <div className="audio-output-actions"><Button variant="outline" disabled={Boolean(busy) || locked} onClick={() => void scan()}>{busy === 'scan' ? <LoaderCircle className="spinning" /> : <RefreshCw />}Scan system devices</Button>{canChooseOutput && <Button variant="outline" disabled={Boolean(busy) || locked} onClick={() => void chooseOutput()}>Allow another speaker</Button>}</div>
    <p role="status">{busy === 'scan' ? 'Finding microphones and speakers…' : `${inputs.length} microphones · ${outputs.length} named audio outputs exposed`}</p>
    {locked && <p role="status">Finishing the current conversation. Device settings will be available shortly.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {outputCheck && <p className="audio-device-name" role="status">{outputCheck}</p>}
    {supported && enabled && (routes[pair[0]]?.deviceId || '') === (routes[pair[1]]?.deviceId || '') && <p role="status">Both channels currently use the same output: {audioDeviceName(devices, 'audiooutput', routes[pair[0]]?.deviceId || '')}. Choose different named speakers for separate playback.</p>}
    <Button variant={enabled ? 'default' : 'outline'} aria-pressed={enabled} disabled={Boolean(busy) || locked} onClick={() => onEnabled(!enabled)}><Headphones />{supported ? 'Use channel devices' : 'Use selected microphones'} · {enabled ? 'On' : 'Off'}</Button>
    {pair.map((lang, index) => {
      const route = routes[lang] || DEFAULT_AUDIO_ROUTE;
      return <fieldset key={lang} className="audio-output-route" disabled={locked}><legend>Channel {index + 1} · {language(lang)?.name}</legend>
        {([{ kind: 'input', label: 'Microphone', deviceKind: 'audioinput', id: route.inputDeviceId || '' }, { kind: 'output', label: 'Speaker', deviceKind: 'audiooutput', id: route.deviceId }] as const).map(item => {
          const options = audioDeviceOptions(devices, item.deviceKind, item.id);
          const selectedName = audioDeviceName(devices, item.deviceKind, item.id);
          return <div key={item.kind} className="audio-device-field">
            <label className="field-label" htmlFor={`${item.kind}-${lang}`}>{item.label}</label>
            {item.kind === 'output' && !supported ? <p className="audio-device-name">System-controlled output · {audioDeviceName(devices, 'audiooutput')}</p> : <>
              <Select items={options} disabled={Boolean(busy) || locked} value={item.id || 'system'} onValueChange={value => { if (value) { setOutputCheck(''); onRoute(lang, { ...route, [item.kind === 'input' ? 'inputDeviceId' : 'deviceId']: value === 'system' ? '' : value }); } }}><SelectTrigger id={`${item.kind}-${lang}`} className="app-input" title={selectedName}><SelectValue>{selectedName}</SelectValue></SelectTrigger><SelectContent className="audio-device-menu">{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
              <p className="audio-device-name">{selectedName}</p>
            </>}
            {busy === `${item.kind}-${lang}` ? <div className="audio-input-test">{item.kind === 'input' && <><p>Speak into this microphone.</p><meter aria-label={`Channel ${index + 1} microphone level`} min={0} max={1} value={level} /></>}<Button variant="outline" onClick={finish}><Square />Stop test</Button></div> : <Button variant="outline" disabled={Boolean(busy)} onClick={() => void test(lang, item.kind)}>{item.kind === 'input' ? <Mic /> : <Volume2 />}{item.kind === 'output' && !supported ? 'Test system output' : `Test ${item.label.toLowerCase()}`}</Button>}
          </div>;
        })}
        <details className="inline-help"><summary>Advanced speaker options</summary><label className="field-label" htmlFor={`channel-${lang}`}>Stereo playback</label><Select disabled={Boolean(busy) || locked} value={route.channel} onValueChange={value => { if (value) onRoute(lang, { ...route, channel: value as AudioChannel }); }}><SelectTrigger id={`channel-${lang}`} className="app-input"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="both">Both</SelectItem><SelectItem value="left">Left only</SelectItem><SelectItem value="right">Right only</SelectItem></SelectContent></Select></details>
      </fieldset>;
    })}
    <details className="inline-help"><summary>How the channels work</summary><p>Each channel belongs to one person. Its microphone records that person's language. Its speaker plays the other person's translated words. Hold a person's record button to use their selected microphone, then release to send the translation to the other channel's speaker.</p><p>One microphone records at a time. Plug in or pair devices before scanning. Full device names come from your system. If the browser does not report a headset model, Lucky marks it as unavailable rather than guessing. Browser permissions determine which devices are listed. These choices apply to this tab.</p></details>
  </section>;
}
