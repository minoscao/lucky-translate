'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createConversationStore, language, Pair, RecordGesture, RecordMode, Translation } from '@/lib/translation';
import { VoiceRecorder } from '@/lib/voice-recorder';

type Job = { audio?: Blob; text?: string; pair: Pair; replaceId?: number };
export function useTranslator() {
  const [pair, setPair] = useState<Pair>(['en', 'zh-CN']);
  const [selfOnTop, setSelfOnTop] = useState(false);
  const [mode, setMode] = useState<RecordMode>('idle');
  const [phase, setPhase] = useState<'ready' | 'permission' | 'listening' | 'stopping'>('ready');
  const [level, setLevel] = useState(0), [pending, setPending] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [conversation] = useState(createConversationStore);
  const history = useSyncExternalStore(conversation.subscribe, conversation.snapshot, conversation.snapshot);
  const [credential, setCredential] = useState('');
  const [usage, setUsage] = useState({ tokens: 0, cost: 0 });
  const [multiplier, setMultiplier] = useState(1);
  const [needsSettings, setNeedsSettings] = useState(false);
  const [failed, setFailed] = useState<Job>();
  const gesture = useRef(new RecordGesture()), recorder = useRef<VoiceRecorder | undefined>(undefined);
  const live = useRef({ pair, credential });
  useEffect(() => { live.current = { pair, credential }; }, [pair, credential]);
  const generation = useRef(0), active = useRef(false), queue = useRef<Job[]>([]);
  const controller = useRef<AbortController | undefined>(undefined);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const recordingRequest = useRef(0);
  const pointerOwner = useRef<number | undefined>(undefined);
  const pumping = useRef(false), mounted = useRef(true);
  const pumpRef = useRef<() => void>(() => {});

  const sync = () => { setMode(gesture.current.mode); };
  const stop = useCallback(async (commit = true) => {
    pointerOwner.current = undefined;
    recordingRequest.current++;
    gesture.current.cancel(); setMode('idle'); clearTimeout(holdTimer.current); clearTimeout(limitTimer.current);
    active.current = false; setPhase('stopping');
    await recorder.current?.stop(commit);
    if (mounted.current) { setPhase('ready'); setLevel(0); }
  }, []);
  const cancel = useCallback(() => {
    generation.current++; controller.current?.abort(); controller.current = undefined;
    queue.current = []; pumping.current = false; setPending(0);
    void stop(false);
  }, [stop]);
  const pump = useCallback(() => {
    if (pumping.current || queue.current.length === 0 || !mounted.current) return;
    const job = queue.current.shift()!;
    const token = generation.current, abort = new AbortController(); controller.current = abort;
    pumping.current = true; setPending(queue.current.length + 1);
    const timeout = setTimeout(() => abort.abort('timeout'), 65000);
    const form = new FormData(); form.set('upper', job.pair[0]); form.set('lower', job.pair[1]);
    form.set('context', JSON.stringify(conversation.context(job.replaceId)));
    if (job.audio) form.set('audio', job.audio, 'speech.wav'); else form.set('text', job.text || '');
    fetch('/api/translate', { method: 'POST', body: form, headers: { 'x-translation-key': live.current.credential }, signal: abort.signal })
      .then(async response => {
        const raw = await response.json().catch(() => ({ error: '服务连接中断，请重试' }));
        const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '翻译失败，请重试');
        if (token !== generation.current || !mounted.current) return;
        if (data.empty) { setNotice('没有听清，请再说一次'); return; }
        if (typeof data.upper !== 'string' || typeof data.lower !== 'string' || typeof data.original !== 'string') throw new Error('没有收到完整译文，请重试');
        const result: Translation = { upper: data.upper, lower: data.lower, original: data.original, pair: job.pair, id: Date.now() };
        const received = data.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : {};
        setUsage(current => ({ tokens: current.tokens + (typeof received.tokens === 'number' && Number.isFinite(received.tokens) ? Math.max(0, received.tokens) : 0), cost: current.cost + (typeof received.cost === 'number' && Number.isFinite(received.cost) ? Math.max(0, received.cost) : 0) }));
        if (job.replaceId !== undefined) conversation.replace(job.replaceId, { ...result, id: job.replaceId }); else conversation.append(result);
        setNotice(job.replaceId !== undefined ? '已保存并重新翻译' : '');
      })
      .catch(cause => {
        if (token !== generation.current || !mounted.current) return;
        const skipped = queue.current.length;
        const message = abort.signal.aborted ? '连接超时，请重试' : cause instanceof TypeError ? '无法连接，请检查网络' : cause.message;
        setError(message + (skipped ? `；后续 ${skipped} 句未发送，请稍后重说` : ''));
        setFailed(job); queue.current = []; void stop(false);
      })
      .finally(() => {
        clearTimeout(timeout);
        if (token !== generation.current || !mounted.current) return;
        pumping.current = false; controller.current = undefined; setPending(queue.current.length); pumpRef.current();
      });
  }, [stop, conversation]);
  useEffect(() => { pumpRef.current = pump; }, [pump]);
  const enqueue = useCallback((job: Job) => {
    if (queue.current.length >= 4) { setError('翻译暂时跟不上，已停止录音；最后一句未发送，请稍后重说'); void stop(false); return; }
    queue.current.push(job); setPending(queue.current.length + (pumping.current ? 1 : 0)); pumpRef.current();
  }, [stop]);
  const start = async () => {
    if (!live.current.credential.trim()) { gesture.current.cancel(); sync(); setNeedsSettings(true); return; }
    if (!navigator.onLine) { gesture.current.cancel(); sync(); setError('当前没有网络，请联网后再试'); return; }
    setError(''); setNotice(''); setFailed(undefined); setPhase('permission'); active.current = true;
    const attempt = ++recordingRequest.current;
    window.speechSynthesis?.cancel();
    try {
      const started = await recorder.current!.start();
      if (attempt !== recordingRequest.current || !active.current || gesture.current.mode === 'idle') return;
      if (!started) { gesture.current.cancel(); sync(); setPhase('ready'); return; }
      setPhase('listening'); navigator.vibrate?.(20);
      clearTimeout(limitTimer.current); limitTimer.current = setTimeout(() => { void stop(); setNotice('已连续录音 10 分钟，可重新开始'); }, 600000);
    } catch (cause) {
      if (attempt !== recordingRequest.current) return;
      const stillWanted = active.current; await stop(false);
      if (!stillWanted) return;
      const e = cause as DOMException;
      setError(e.name === 'NotAllowedError' ? '请允许使用麦克风，再重新长按或双击' : e.name === 'NotFoundError' ? '没有找到麦克风，可先输入文字翻译' : e.name === 'NotReadableError' ? '麦克风被占用，请关闭其他录音应用后重试' : e.message || '无法开启麦克风，请重试');
    }
  };
  const dispatch = (action: 'start' | 'stop' | undefined) => { sync(); if (action === 'start') void start(); if (action === 'stop') void stop(); };
  const pointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || pointerOwner.current !== undefined || phase === 'stopping') return false;
    pointerOwner.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    try { recorder.current?.prepare(); } catch { /* start() reports unavailable audio */ }
    gesture.current.down(performance.now());
    clearTimeout(holdTimer.current); holdTimer.current = setTimeout(() => dispatch(gesture.current.hold(performance.now())), RecordGesture.HOLD_MS + 5);
    return true;
  };
  const pointerUp = (event: React.PointerEvent<HTMLButtonElement>) => { if (pointerOwner.current !== event.pointerId) return; pointerOwner.current = undefined; clearTimeout(holdTimer.current); dispatch(gesture.current.up(performance.now())); };
  const toggle = () => { if (pointerOwner.current !== undefined) return; try { recorder.current?.prepare(); } catch {} dispatch(gesture.current.toggle()); };
  const dispose = useCallback(() => {
    mounted.current = false; generation.current++; controller.current?.abort();
    clearTimeout(holdTimer.current); clearTimeout(limitTimer.current); window.speechSynthesis?.cancel();
  }, []);
  useEffect(() => {
    mounted.current = true;
    const currentRecorder = new VoiceRecorder({
      onSentence: audio => { if (mounted.current && !document.hidden) enqueue({ audio, pair: [...live.current.pair] }); },
      onLevel: value => { if (mounted.current) setLevel(value); },
      onError: message => { if (mounted.current) { setError(message); void stop(false); } },
    });
    recorder.current = currentRecorder;
    queueMicrotask(() => {
      if (!mounted.current) return;
      try {
        const saved = JSON.parse(localStorage.getItem('lucky-preferences') || 'null');
        if (saved && Array.isArray(saved.pair) && saved.pair.length === 2 && saved.pair[0] !== saved.pair[1] && saved.pair.every((code: string) => language(code))) { setPair(saved.pair as Pair); setSelfOnTop(Boolean(saved.selfOnTop)); }
        const savedKey = localStorage.getItem('lucky-openai-key')?.trim();
        if (savedKey && savedKey.length <= 512 && !/[\r\n]/.test(savedKey)) setCredential(savedKey);
        const savedMultiplier = Number(localStorage.getItem('lucky-price-multiplier'));
        if (Number.isFinite(savedMultiplier) && savedMultiplier >= .1 && savedMultiplier <= 100) setMultiplier(savedMultiplier);
      } catch {}
    });
    const leave = () => { cancel(); setNotice('已暂停，长按或双击可继续'); };
    const visibility = () => { if (document.hidden) leave(); };
    const offline = () => { cancel(); setError('网络已断开，请联网后重试'); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', leave); window.addEventListener('offline', offline);
    return () => { dispose(); void currentRecorder.stop(false); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', leave); window.removeEventListener('offline', offline); };
  }, [cancel, enqueue, stop, dispose]);
  const changePair = (value: Pair) => {
    if (mode !== 'idle' || pending || phase !== 'ready') return;
    setPair(value); setFailed(undefined); setError(''); setNotice(''); window.speechSynthesis?.cancel();
    try { localStorage.setItem('lucky-preferences', JSON.stringify({ pair: value, selfOnTop })); } catch {}
  };
  return {
    pair, selfOnTop, changePair, mode, phase, level, pending, error, notice, history, credential, usage, multiplier,
    setMultiplier: (value: number) => { if (!Number.isFinite(value) || value < .1 || value > 100) return; setMultiplier(value); try { localStorage.setItem('lucky-price-multiplier', String(value)); } catch {} },
    swapSides: () => {
      if (mode !== 'idle' || pending || phase !== 'ready') return false;
      const value: Pair = [pair[1], pair[0]]; setPair(value); setSelfOnTop(!selfOnTop);
      setFailed(undefined); setError(''); setNotice(''); window.speechSynthesis?.cancel();
      try { localStorage.setItem('lucky-preferences', JSON.stringify({ pair: value, selfOnTop: !selfOnTop })); } catch {}
      return true;
    },
    needsSettings, setNeedsSettings, setCredential: (value: string) => {
      cancel(); const key = value.trim(); setCredential(key);
      try { localStorage.setItem('lucky-openai-key', key); } catch {}
      setError(''); setFailed(undefined); setNotice('已保存到这台设备，录音后开始翻译');
    },
    clearCredential: () => {
      cancel(); setCredential('');
      try { localStorage.removeItem('lucky-openai-key'); } catch {}
      setError(''); setFailed(undefined); setNotice('已从这台设备清除服务密钥');
    },
    failed, retry: () => { if (failed) { setError(''); const job = failed; setFailed(undefined); enqueue(job); } },
    clear: () => { cancel(); conversation.clear(); setUsage({ tokens: 0, cost: 0 }); setError(''); setFailed(undefined); setNotice('已清空本次对话及用量'); },
    submitText: (text: string) => { if (!credential) { setNeedsSettings(true); return false; } setError(''); enqueue({ text, pair: [...pair] }); return true; },
    retranslate: (id: number, text: string) => { if (!credential) { setNeedsSettings(true); return false; } setError(''); enqueue({ text, pair: [...pair], replaceId: id }); return true; },
    stop, toggle, pointerDown, pointerUp, setError,
  };
}
