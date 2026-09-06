'use client';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createConversationStore, language, Pair, RecordGesture, RecordMode, Speaker, Translation } from '@/lib/translation';
import { VoiceRecorder } from '@/lib/voice-recorder';
import { translateDirect, TranslationProvider } from '@/lib/direct-api';
import { saveCloudRecord } from '@/lib/account';

type Job = { id?: number; audio?: Blob; text?: string; pair: Pair; replaceId?: number; speaker: Speaker; sourceSide?: 0 | 1; autoSpeakSide?: 0 | 1 };
type PendingTurn = { id: number; sourceSide: 0 | 1; speaker: Speaker; text: string };
type UsageTotals = { day: string; dayTokens: number; dayCost: number; month: string; monthTokens: number; monthCost: number; totalTokens: number; totalCost: number };
const currentDay = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};
const emptyUsageTotals = (): UsageTotals => ({ day: currentDay(), dayTokens: 0, dayCost: 0, month: currentMonth(), monthTokens: 0, monthCost: 0, totalTokens: 0, totalCost: 0 });
export function useTranslator() {
  const [pair, setPair] = useState<Pair>(['en', 'zh-CN']);
  const [selfOnTop, setSelfOnTop] = useState(false);
  const [mode, setMode] = useState<RecordMode>('idle');
  const [phase, setPhase] = useState<'ready' | 'permission' | 'listening' | 'stopping'>('ready');
  const [level, setLevel] = useState(0), [pending, setPending] = useState(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [conversation] = useState(createConversationStore);
  const history = useSyncExternalStore(conversation.subscribe, conversation.snapshot, conversation.snapshot);
  const [openaiKey] = useState(''), [deepseekKey] = useState('managed');
  const [translationProvider] = useState<TranslationProvider>('deepseek');
  const [usage, setUsage] = useState({ tokens: 0, cost: 0 });
  const [usageTotals, setUsageTotals] = useState<UsageTotals>(emptyUsageTotals);
  const [multiplier, setMultiplier] = useState(1);
  const [needsSettings, setNeedsSettings] = useState(false);
  const [failed, setFailed] = useState<Job>();
  const [pendingTurns, setPendingTurns] = useState<PendingTurn[]>([]);
  const [autoSpeech, setAutoSpeech] = useState<{ id: number; text: string; lang: string }>();
  const gesture = useRef(new RecordGesture()), recorder = useRef<VoiceRecorder | undefined>(undefined);
  const live = useRef({ pair, openaiKey, deepseekKey, translationProvider, selfOnTop });
  useEffect(() => { live.current = { pair, openaiKey, deepseekKey, translationProvider, selfOnTop }; }, [pair, openaiKey, deepseekKey, translationProvider, selfOnTop]);
  const activeCapture = useRef<{ pair: Pair; speaker: Speaker; side: 0 | 1; autoSpeakSide?: 0 | 1 }>({ pair, speaker: 'self', side: 1 });
  const speechSequence = useRef(0);
  const jobSequence = useRef(0);
  const generation = useRef(0), active = useRef(false), queue = useRef<Job[]>([]);
  const controller = useRef<AbortController | undefined>(undefined);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const limitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const recordingRequest = useRef(0);
  const pointerOwner = useRef<number | undefined>(undefined);
  const pumping = useRef(false), mounted = useRef(true);
  const pumpRef = useRef<() => void>(() => {});

  const addUsage = useCallback((tokens: number, cost: number) => {
    const safeTokens = Number.isFinite(tokens) ? Math.max(0, Math.round(tokens)) : 0;
    const safeCost = Number.isFinite(cost) ? Math.max(0, cost) : 0;
    if (!safeTokens && !safeCost) return;
    setUsage(current => ({ tokens: current.tokens + safeTokens, cost: current.cost + safeCost }));
    setUsageTotals(current => {
      const day = currentDay(), month = currentMonth();
      const base = {
        ...current, day, month,
        dayTokens: current.day === day ? current.dayTokens : 0,
        dayCost: current.day === day ? current.dayCost : 0,
        monthTokens: current.month === month ? current.monthTokens : 0,
        monthCost: current.month === month ? current.monthCost : 0,
      };
      const next = { ...base, dayTokens: base.dayTokens + safeTokens, dayCost: base.dayCost + safeCost, monthTokens: base.monthTokens + safeTokens, monthCost: base.monthCost + safeCost, totalTokens: base.totalTokens + safeTokens, totalCost: base.totalCost + safeCost };
      try { localStorage.setItem('lucky-usage-totals', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

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
    queue.current = []; pumping.current = false; setPending(0); setPendingTurns([]);
    void stop(false);
  }, [stop]);
  const pump = useCallback(() => {
    if (pumping.current || queue.current.length === 0 || !mounted.current) return;
    const job = queue.current.shift()!;
    const token = generation.current, abort = new AbortController(); controller.current = abort;
    pumping.current = true; setPending(queue.current.length + 1);
    const timeout = setTimeout(() => abort.abort('timeout'), 65000);
    translateDirect({ audio: job.audio, text: job.text, pair: job.pair, context: conversation.context(job.replaceId), provider: live.current.translationProvider, openaiKey: live.current.openaiKey, deepseekKey: live.current.deepseekKey, signal: abort.signal,
      onTranscribed: job.id !== undefined && job.sourceSide !== undefined ? text => { if (token === generation.current && mounted.current) setPendingTurns(current => [...current.filter(item => item.id !== job.id), { id: job.id!, sourceSide: job.sourceSide!, speaker: job.speaker, text }]); } : undefined,
    })
      .then(data => {
        if (token !== generation.current || !mounted.current) return;
        if (data.empty) { if (job.id !== undefined) setPendingTurns(current => current.filter(item => item.id !== job.id)); setNotice('没有听清，请再说一次'); return; }
        const result: Translation = { upper: data.upper, lower: data.lower, original: data.original, pair: job.pair, id: Date.now(), speaker: job.speaker };
        addUsage(data.usage.tokens, data.usage.cost);
        const saved = { ...result, id: job.replaceId ?? result.id };
        if (job.replaceId !== undefined) conversation.replace(job.replaceId, saved); else conversation.append(saved);
        void saveCloudRecord(`translation-${saved.id}`, 'translation', saved).then(({ account }) => { if (account.storage.warning) setNotice('云空间即将用满，请尽快导出完整对话'); }).catch(() => {});
        if (job.id !== undefined) setPendingTurns(current => current.filter(item => item.id !== job.id));
        if (job.autoSpeakSide !== undefined) {
          const side = job.autoSpeakSide;
          setAutoSpeech({ id: ++speechSequence.current, text: side === 0 ? result.upper : result.lower, lang: job.pair[side] });
        }
        setNotice(job.replaceId !== undefined ? '已保存并重新翻译' : '');
      })
      .catch(cause => {
        if (token !== generation.current || !mounted.current) return;
        if (job.id !== undefined) setPendingTurns(current => current.filter(item => item.id !== job.id));
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
  }, [stop, conversation, addUsage]);
  useEffect(() => { pumpRef.current = pump; }, [pump]);
  const enqueue = useCallback((job: Job) => {
    if (queue.current.length >= 4) { setError('翻译暂时跟不上，已停止录音；最后一句未发送，请稍后重说'); void stop(false); return; }
    queue.current.push(job); setPending(queue.current.length + (pumping.current ? 1 : 0)); pumpRef.current();
  }, [stop]);
  const speakerForSide = (side: 0 | 1): Speaker => (live.current.selfOnTop ? side === 0 : side === 1) ? 'self' : 'other';
  const start = async (side: 0 | 1, autoSpeakSide?: 0 | 1, detectSpeaker = true) => {
    const translationKey = live.current.translationProvider === 'deepseek' ? live.current.deepseekKey : live.current.openaiKey;
    if (!translationKey.trim()) { gesture.current.cancel(); sync(); setError('翻译服务尚未连接，请联系管理员'); return; }
    if (!navigator.onLine) { gesture.current.cancel(); sync(); setError('当前没有网络，请联网后再试'); return; }
    setError(''); setNotice(''); setFailed(undefined); setPhase('permission'); active.current = true;
    activeCapture.current = { pair: [...live.current.pair], speaker: speakerForSide(side), side, autoSpeakSide: autoSpeakSide ?? (gesture.current.mode === 'hold' ? (1 - side) as 0 | 1 : undefined) };
    const attempt = ++recordingRequest.current;
    window.speechSynthesis?.cancel();
    try {
      const started = await recorder.current!.start(gesture.current.mode === 'continuous' ? 'continuous' : 'hold', detectSpeaker);
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
  const dispatch = (action: 'start' | 'stop' | undefined, side: 0 | 1, autoSpeakSide?: 0 | 1, detectSpeaker = true) => { sync(); if (action === 'start') void start(side, autoSpeakSide, detectSpeaker); if (action === 'stop') void stop(); };
  const pointerDown = (event: React.PointerEvent<HTMLButtonElement>, side: 0 | 1, autoSpeakSide?: 0 | 1, detectSpeaker = true) => {
    if (!event.isPrimary || event.button !== 0 || pointerOwner.current !== undefined || phase === 'stopping') return false;
    pointerOwner.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    try { recorder.current?.prepare(); } catch { /* start() reports unavailable audio */ }
    gesture.current.down(performance.now());
    clearTimeout(holdTimer.current); holdTimer.current = setTimeout(() => dispatch(gesture.current.hold(performance.now()), side, autoSpeakSide, detectSpeaker), RecordGesture.HOLD_MS + 5);
    return true;
  };
  const pointerUp = (event: React.PointerEvent<HTMLButtonElement>, side: 0 | 1, autoSpeakSide?: 0 | 1, detectSpeaker = true) => { if (pointerOwner.current !== event.pointerId) return; pointerOwner.current = undefined; clearTimeout(holdTimer.current); dispatch(gesture.current.up(performance.now()), side, autoSpeakSide, detectSpeaker); };
  const toggle = (side: 0 | 1, autoSpeakSide?: 0 | 1, detectSpeaker = true) => { if (pointerOwner.current !== undefined) return; try { recorder.current?.prepare(); } catch {} dispatch(gesture.current.toggle(), side, autoSpeakSide, detectSpeaker); };
  const dispose = useCallback(() => {
    mounted.current = false; generation.current++; controller.current?.abort();
    clearTimeout(holdTimer.current); clearTimeout(limitTimer.current); window.speechSynthesis?.cancel();
  }, []);
  useEffect(() => {
    mounted.current = true;
    const currentRecorder = new VoiceRecorder({
      onSentence: (audio, boundary) => {
        if (!mounted.current || document.hidden) return;
        if (boundary === 'speaker-before') { activeCapture.current.side = (1 - activeCapture.current.side) as 0 | 1; activeCapture.current.speaker = speakerForSide(activeCapture.current.side); }
        enqueue({ id: ++jobSequence.current, audio, pair: [...activeCapture.current.pair], speaker: activeCapture.current.speaker, sourceSide: activeCapture.current.side, autoSpeakSide: activeCapture.current.autoSpeakSide });
        if (boundary === 'speaker-after') { activeCapture.current.side = (1 - activeCapture.current.side) as 0 | 1; activeCapture.current.speaker = speakerForSide(activeCapture.current.side); }
      },
      onLevel: value => { if (mounted.current) setLevel(value); },
      onError: message => { if (mounted.current) { setError(message); void stop(false); } },
    });
    recorder.current = currentRecorder;
    queueMicrotask(() => {
      if (!mounted.current) return;
      try {
        const saved = JSON.parse(localStorage.getItem('lucky-preferences') || 'null');
        if (saved && Array.isArray(saved.pair) && saved.pair.length === 2 && saved.pair[0] !== saved.pair[1] && saved.pair.every((code: string) => language(code))) { setPair(saved.pair as Pair); setSelfOnTop(Boolean(saved.selfOnTop)); }
        const savedMultiplier = Number(localStorage.getItem('lucky-price-multiplier'));
        if (Number.isFinite(savedMultiplier) && savedMultiplier >= .1 && savedMultiplier <= 100) setMultiplier(savedMultiplier);
        const savedUsage = JSON.parse(localStorage.getItem('lucky-usage-totals') || 'null') as Partial<UsageTotals> | null;
        if (savedUsage && [savedUsage.monthTokens, savedUsage.monthCost, savedUsage.totalTokens, savedUsage.totalCost].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
          const day = currentDay(), month = currentMonth();
          const validDay = savedUsage.day === day && typeof savedUsage.dayTokens === 'number' && Number.isFinite(savedUsage.dayTokens) && savedUsage.dayTokens >= 0 && typeof savedUsage.dayCost === 'number' && Number.isFinite(savedUsage.dayCost) && savedUsage.dayCost >= 0;
          setUsageTotals({ day, dayTokens: validDay ? savedUsage.dayTokens! : 0, dayCost: validDay ? savedUsage.dayCost! : 0, month, monthTokens: savedUsage.month === month ? savedUsage.monthTokens! : 0, monthCost: savedUsage.month === month ? savedUsage.monthCost! : 0, totalTokens: savedUsage.totalTokens!, totalCost: savedUsage.totalCost! });
        }
      } catch {}
      void fetch('/api/cloud?type=translation', { credentials: 'same-origin' }).then(async response => response.ok ? await response.json() as { records?: Array<{ data: Translation }> } : null).then(payload => {
        const records = payload?.records?.map(record => record.data).filter(item => item && typeof item.id === 'number' && typeof item.original === 'string').sort((a, b) => a.id - b.id);
        if (records?.length) conversation.replaceAll(records.slice(-2000));
      }).catch(() => {});
      void fetch('/api/cloud?type=preferences', { credentials: 'same-origin' }).then(async response => response.ok ? await response.json() as { records?: Array<{ data: { pair?: Pair; selfOnTop?: boolean } }> } : null).then(payload => {
        const saved = payload?.records?.at(-1)?.data;
        if (saved && Array.isArray(saved.pair) && saved.pair.length === 2 && saved.pair[0] !== saved.pair[1] && saved.pair.every(code => language(code))) { setPair(saved.pair); setSelfOnTop(Boolean(saved.selfOnTop)); }
      }).catch(() => {});
    });
    const leave = () => { cancel(); setNotice('已暂停，长按或双击可继续'); };
    const visibility = () => { if (document.hidden) leave(); };
    const offline = () => { cancel(); setError('网络已断开，请联网后重试'); };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', leave); window.addEventListener('offline', offline);
    return () => { dispose(); void currentRecorder.stop(false); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', leave); window.removeEventListener('offline', offline); };
  }, [cancel, conversation, enqueue, stop, dispose]);
  const changePair = (value: Pair) => {
    if (mode !== 'idle' || pending || phase !== 'ready') return;
    setPair(value); setFailed(undefined); setError(''); setNotice(''); window.speechSynthesis?.cancel();
    try { localStorage.setItem('lucky-preferences', JSON.stringify({ pair: value, selfOnTop })); } catch {}
    void saveCloudRecord('preferences', 'preferences', { pair: value, selfOnTop }).catch(() => {});
  };
  return {
    pair, selfOnTop, changePair, mode, phase, level, pending, pendingTurns, error, notice, history, openaiKey, deepseekKey, translationProvider, usage, usageTotals, multiplier, autoSpeech, addUsage,
    canTranslate: true,
    setMultiplier: (value: number) => { if (!Number.isFinite(value) || value < .1 || value > 100) return; setMultiplier(value); try { localStorage.setItem('lucky-price-multiplier', String(value)); } catch {} },
    swapSides: () => {
      if (mode !== 'idle' || pending || phase !== 'ready') return false;
      const value: Pair = [pair[1], pair[0]]; setPair(value); setSelfOnTop(!selfOnTop);
      setFailed(undefined); setError(''); setNotice(''); window.speechSynthesis?.cancel();
      try { localStorage.setItem('lucky-preferences', JSON.stringify({ pair: value, selfOnTop: !selfOnTop })); } catch {}
      void saveCloudRecord('preferences', 'preferences', { pair: value, selfOnTop: !selfOnTop }).catch(() => {});
      return true;
    },
    needsSettings, setNeedsSettings, setCredentials: (_value: { openaiKey: string; deepseekKey: string; provider: TranslationProvider }) => { setNeedsSettings(false); },
    clearCredentials: () => {
      setError(''); setFailed(undefined); setNotice('服务由管理员统一配置');
    },
    failed, retry: () => { if (failed) { setError(''); const job = failed; setFailed(undefined); enqueue(job); } },
    clear: () => { cancel(); conversation.clear(); setPendingTurns([]); setUsage({ tokens: 0, cost: 0 }); setError(''); setFailed(undefined); setNotice('已清空对话'); void fetch('/api/cloud?type=translation', { method: 'DELETE', credentials: 'same-origin' }).catch(() => {}); },
    submitText: (text: string, side: 0 | 1) => { setError(''); enqueue({ text, pair: [...pair], speaker: speakerForSide(side) }); return true; },
    retranslate: (id: number, text: string) => { const existing = history.find(item => item.id === id); setError(''); enqueue({ text, pair: [...pair], replaceId: id, speaker: existing?.speaker || 'self' }); return true; },
    stop, toggle, pointerDown, pointerUp, setError, setNotice,
  };
}
