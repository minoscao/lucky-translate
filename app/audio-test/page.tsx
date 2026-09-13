'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, Headphones, Play, RefreshCw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { audioDeviceName, audioDeviceOptions, discoverAudioDevices, namedAudioDevices } from '@/lib/audio-devices';
import { AudioProbe, demoMusic, ProbeEngine, ProbeId, ProbeStatus } from '@/lib/audio-probe';

const CHANNELS = [{ id: 'a', title: 'Speaker A', music: 'Bright melody' }, { id: 'b', title: 'Speaker B', music: 'Low rhythmic melody' }] as const;
const RESULTS = [
  { value: 'not-tested', label: 'Not tested yet' },
  { value: 'separate-devices', label: 'Different music on two separate devices' },
  { value: 'same-device', label: 'Both tracks on the same device' },
  { value: 'one-or-no-track', label: 'Only one track, or no sound' },
];
type Channel = { deviceId: string; volume: number; file?: File };
const INITIAL_STATUS: ProbeStatus = { state: 'idle', message: 'Ready' };

export default function AudioTestPage() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [scanning, setScanning] = useState(false), [error, setError] = useState('');
  const [engine, setEngine] = useState<ProbeEngine>('web-audio');
  const [capabilities, setCapabilities] = useState({ web: false, media: false, chooser: false, secure: false });
  const [channels, setChannels] = useState<Record<ProbeId, Channel>>({ a: { deviceId: '', volume: .4 }, b: { deviceId: '', volume: .4 } });
  const [status, setStatus] = useState<Record<ProbeId, ProbeStatus>>({ a: INITIAL_STATUS, b: INITIAL_STATUS });
  const [heard, setHeard] = useState('not-tested');
  const mounted = useRef(true), scanId = useRef(0), automaticStop = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const events = useRef<Array<Record<string, unknown>>>([]);
  const record = (event: Record<string, unknown>) => { events.current = [...events.current.slice(-199), { at: new Date().toISOString(), ...event }]; };
  const [probe] = useState(() => new AudioProbe((id, next) => { if (mounted.current) { record({ channel: id, ...next }); setStatus(current => ({ ...current, [id]: next })); } }));
  const [demos] = useState(() => ({ a: demoMusic('a'), b: demoMusic('b') }));
  const supported = engine === 'web-audio' ? capabilities.web : capabilities.media;
  const stopAll = () => { clearTimeout(automaticStop.current); probe.stopAll(); };
  const scan = async (permission = false) => {
    const token = ++scanId.current; setScanning(true); setError('');
    try {
      if (!navigator.mediaDevices) throw new Error('Open this test over HTTPS in your browser.');
      const found = await discoverAudioDevices(navigator.mediaDevices, permission);
      if (mounted.current && token === scanId.current) setDevices(found);
    } catch (cause) { if (mounted.current && token === scanId.current) setError(cause instanceof Error ? cause.message : 'Could not scan audio devices.'); }
    finally { if (mounted.current && token === scanId.current) setScanning(false); }
  };
  useEffect(() => {
    mounted.current = true;
    const web = typeof AudioContext !== 'undefined' && typeof (AudioContext.prototype as AudioContext & { setSinkId?: unknown }).setSinkId === 'function';
    const media = typeof HTMLMediaElement.prototype.setSinkId === 'function';
    setCapabilities({ web, media, chooser: typeof (navigator.mediaDevices as MediaDevices & { selectAudioOutput?: unknown })?.selectAudioOutput === 'function', secure: window.isSecureContext });
    if (!web && media) setEngine('media-element');
    void scan();
    const changed = () => { stopAll(); void scan(); };
    const hidden = () => { if (document.hidden) stopAll(); };
    navigator.mediaDevices?.addEventListener('devicechange', changed); document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', stopAll);
    return () => { mounted.current = false; scanId.current++; stopAll(); navigator.mediaDevices?.removeEventListener('devicechange', changed); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', stopAll); };
  }, [probe]);
  const update = (id: ProbeId, patch: Partial<Channel>) => { probe.stop(id); setHeard('not-tested'); setChannels(current => ({ ...current, [id]: { ...current[id], ...patch } })); };
  const start = (ids: ProbeId[]) => {
    setError(''); setHeard('not-tested');
    record({ action: 'start', engine, channels: ids.map(id => ({ id, deviceId: channels[id].deviceId, name: audioDeviceName(devices, 'audiooutput', channels[id].deviceId), source: channels[id].file?.name || CHANNELS.find(channel => channel.id === id)?.music })) });
    clearTimeout(automaticStop.current); automaticStop.current = setTimeout(stopAll, 120000);
    void probe.start(ids.map(id => ({ id, engine, deviceId: channels[id].deviceId, blob: channels[id].file || demos[id], volume: channels[id].volume })));
  };
  const choose = async () => {
    stopAll(); setError('');
    try { await (navigator.mediaDevices as MediaDevices & { selectAudioOutput: () => Promise<MediaDeviceInfo> }).selectAudioOutput(); await scan(); }
    catch { setError('Output permission was not granted. Use an output already listed below.'); }
  };
  const download = () => {
    const report = { version: 'web-audio-test-1', createdAt: new Date().toISOString(), userAgent: navigator.userAgent, capabilities, engine,
      devices: devices.map(device => ({ kind: device.kind, label: device.label, deviceId: device.deviceId })),
      channels: CHANNELS.map(({ id, music }) => ({ channel: id, selectedDeviceId: channels[id].deviceId, selectedDeviceName: audioDeviceName(devices, 'audiooutput', channels[id].deviceId), source: channels[id].file?.name || music, volume: channels[id].volume, ...status[id] })),
      userObservedResult: heard, events: events.current, note: 'Browser output IDs are not independent proof of physical speaker routing. User listening observation is recorded separately. No audio is included.',
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'lucky-web-audio-test.json'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const playing = CHANNELS.some(({ id }) => status[id].state === 'playing' || status[id].state === 'preparing');
  return <main className="audio-test-page" lang="en"><div className="audio-test-shell">
    <header><a href="/" className="audio-test-back"><ArrowLeft size={18} />Lucky</a><p className="mode-brand">LUCKY AUDIO LAB</p><h1>Two speakers. Two tracks.</h1><p>Web version of the Android audio test. Play different music on your headphones and speaker at the same time.</p></header>
    <section className="audio-test-controls" aria-label="Test setup">
      <div className="audio-output-actions"><Button variant="outline" disabled={scanning || playing} onClick={() => void scan(true)}><RefreshCw className={scanning ? 'spinning' : ''} />{scanning ? 'Scanning…' : 'Scan system devices'}</Button>{capabilities.chooser && <Button variant="outline" disabled={playing} onClick={() => void choose()}>Allow another speaker</Button>}</div>
      <label className="field-label" htmlFor="test-engine">Playback method</label>
      <Select value={engine} onValueChange={value => { if (value) {
        stopAll(); setEngine(value as ProbeEngine); setHeard('not-tested');
        if (!(value === 'web-audio' ? capabilities.web : capabilities.media)) {
          setChannels(current => ({ a: { ...current.a, deviceId: '' }, b: { ...current.b, deviceId: '' } }));
          setError('This method only exposes system output. Both output choices have been reset to system default.');
        } else setError('');
      } }}><SelectTrigger id="test-engine" className="app-input"><SelectValue>{engine === 'web-audio' ? 'Web Audio · Separate audio engines' : 'Media players · Two audio players'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="web-audio">Web Audio · Separate audio engines</SelectItem><SelectItem value="media-element">Media players · Two audio players</SelectItem></SelectContent></Select>
      <p role="status">{namedAudioDevices(devices, 'audiooutput').length} named outputs found · {supported ? 'This method exposes output selection' : 'This method exposes system output only'}</p>
      {!supported && <p className="audio-routing-limitation">You can still play both tracks together to test system behavior. This method cannot assign a named output on this browser.</p>}
      {channels.a.deviceId === channels.b.deviceId && <p>Both tracks currently target {audioDeviceName(devices, 'audiooutput', channels.a.deviceId)}. Choose different named outputs to request separate speakers.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
    <div className="audio-test-channels">{CHANNELS.map(({ id, title, music }) => {
      const options = audioDeviceOptions(devices, 'audiooutput', channels[id].deviceId), selectedName = audioDeviceName(devices, 'audiooutput', channels[id].deviceId);
      return <section className="audio-output-route" key={id} aria-label={title}>
        <h2><Headphones />{title}</h2>
        <label className="field-label" htmlFor={`test-output-${id}`}>Output device</label>
        <Select items={options} value={channels[id].deviceId || 'system'} disabled={!supported || playing} onValueChange={value => { if (value) update(id, { deviceId: value === 'system' ? '' : value }); }}><SelectTrigger id={`test-output-${id}`} className="app-input" title={selectedName}><SelectValue>{selectedName}</SelectValue></SelectTrigger><SelectContent className="audio-device-menu">{options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
        <p className="audio-device-name">{selectedName}</p>
        <label className="field-label" htmlFor={`music-${id}`}>Music · {channels[id].file?.name || music}</label>
        <input hidden id={`music-${id}`} type="file" accept="audio/*" disabled={playing} onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 30 * 1024 * 1024) { setError('Choose an audio file smaller than 30 MB.'); event.target.value = ''; return; } update(id, { file }); }} />
        <Button variant="outline" disabled={playing} onClick={() => document.getElementById(`music-${id}`)?.click()}>Choose music file</Button>
        {channels[id].file && <Button variant="ghost" disabled={playing} onClick={() => { update(id, { file: undefined }); const input = document.getElementById(`music-${id}`) as HTMLInputElement; if (input) input.value = ''; }}>Use demo melody</Button>}
        <label className="field-label" htmlFor={`volume-${id}`}>Volume · {Math.round(channels[id].volume * 100)}%</label><input id={`volume-${id}`} type="range" min="0" max="1" step=".01" value={channels[id].volume} onChange={event => { const volume = Number(event.target.value); probe.volume(id, volume); setChannels(current => ({ ...current, [id]: { ...current[id], volume } })); }} />
        <div className="audio-output-actions"><Button disabled={status[id].state === 'preparing'} onClick={() => start([id])}><Play />Play {id.toUpperCase()}</Button><Button variant="outline" onClick={() => probe.stop(id)} disabled={status[id].state === 'idle'}><Square />Stop {id.toUpperCase()}</Button></div>
        <p role={status[id].state === 'error' ? 'alert' : 'status'} className={status[id].state === 'error' ? 'form-error' : ''}>{status[id].message}</p>
        {status[id].state === 'playing' && <p className="audio-device-name">Browser-reported output: {status[id].browserSink === undefined ? 'Not reported' : audioDeviceName(devices, 'audiooutput', status[id].browserSink)}</p>}
      </section>;
    })}</div>
    <section className="audio-test-controls"><div className="audio-output-actions"><Button onClick={() => { stopAll(); start(['a', 'b']); }} disabled={CHANNELS.some(({ id }) => status[id].state === 'preparing')}><Play />Play both together</Button><Button variant="outline" onClick={stopAll}><Square />Stop all</Button></div><p>Two different demo melodies are ready. You may choose two music files instead. Playback loops for up to two minutes; changing tabs stops it.</p></section>
    <section className="audio-test-controls"><h2>What did you hear?</h2><Select items={RESULTS} value={heard} onValueChange={value => { if (value) { setHeard(value); record({ action: 'listening-result', result: value }); } }}><SelectTrigger className="app-input" aria-label="Observed output result"><SelectValue>{RESULTS.find(result => result.value === heard)?.label}</SelectValue></SelectTrigger><SelectContent>{RESULTS.map(result => <SelectItem key={result.value} value={result.value}>{result.label}</SelectItem>)}</SelectContent></Select><Button variant="outline" onClick={download}><Download />Save test report</Button></section>
    <details className="audio-test-controls"><summary>Test details</summary><p>Web Audio output selection: {String(capabilities.web)} · Media player output selection: {String(capabilities.media)} · Secure page: {String(capabilities.secure)}</p><p>Device names are copied from the browser, including models when reported. A reported output selection is not proof of the physical speaker that made sound. Your listening result is recorded separately.</p><p>Selected music stays on this device. The scan briefly uses microphone permission to read device names; no recording is saved. This test uses no AI, tokens or account login.</p><p>This is a playback test. Android app recording and microphone filtering are not included.</p></details>
  </div></main>;
}
