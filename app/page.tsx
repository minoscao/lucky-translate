'use client';

import { PasswordFields } from '@/components/password-fields';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowDownUp, ArrowLeft, ArrowRight, ArrowUpFromLine, Check, ChevronDown, ChevronUp, CircleHelp, Copy, Download, GraduationCap, History, LoaderCircle, LockKeyhole, LogOut, Mic, Settings2, ShieldCheck, Square, Volume2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CoachMode } from '@/components/coach-mode';
import { INTERFACE_COPY } from '@/lib/interface-copy';
import { useCoach } from '@/hooks/use-coach';
import { useTranslator } from '@/hooks/use-translator';
import { synthesizeSpeechDirect } from '@/lib/direct-api';
import { validEmail, validUsername, validVerificationCode } from '@/lib/auth-inputs';
import { formatPoints } from '@/lib/points';
import { PLAN_DEFAULTS } from '@/lib/membership-plans';
import { AccountSnapshot, accountRequest as publicAccountRequest } from '@/lib/account';
import { createAccountScope, SESSION_CHANGED, SESSION_MARKER } from '@/lib/account-scope';
import { TimeEntry, TimeLedger } from '@/components/time-ledger';
import { LANGUAGES, LanguageCode, Pair, RecordGesture, conversationText, language, selectLanguage, transcriptForLanguage } from '@/lib/translation';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
type LayoutMode = 'face-to-face' | 'single-operator';
type SoloDirection = 'listening' | 'speaking';
type AppMode = 'translator' | 'coach';
type Profile = { name?: string; ieltsScore?: number; onboardingSeen?: boolean };

const IELTS_BANDS = [
  { score: 1, cn: '几乎不能用英文交流；只认识零散词。', en: 'You know a few words, but everyday English is still mostly unfamiliar.' },
  { score: 2, cn: '能听懂或说出极少量熟词，完整意思还很难表达。', en: 'You can catch a few familiar words, but full messages are still difficult.' },
  { score: 3, cn: '能应付非常简单的固定场景，但一离开熟悉话题就容易卡住。', en: 'You can manage set phrases in familiar situations, but free conversation is hard.' },
  { score: 4, cn: '能读懂简单短句、处理基础生活需求；一聊复杂内容就容易断。', en: 'You can handle simple everyday needs and short texts, but longer ideas often break down.' },
  { score: 5, cn: '大致相当于四级高分、六级刚过：能读简单英文，也能表达基本意思，但真实交流会吃力。', en: 'Roughly strong CET-4 / a passing CET-6: you can read simple English and get basic ideas across, but real-life conversation still takes effort.' },
  { score: 6, cn: '大致相当于六级高分：学习或工作英语基本够用，但更自然、反应更快还需要练。', en: 'Roughly a strong CET-6: English works for study and work, while natural phrasing and quicker responses still need practice.' },
  { score: 7, cn: '能比较自如地讨论熟悉或专业话题；重点是让表达更准确、更像真实交流。', en: 'You can discuss familiar and professional topics with confidence. The focus is precision, range, and natural flow.' },
  { score: 8, cn: '英文已经非常熟练；陪练更重视细微语气、表达选择和高难场景。', en: 'You are highly fluent. Coaching focuses on nuance, word choice, tone, and demanding situations.' },
  { score: 9, cn: '接近母语者水平；重点是保持表达风格，并处理极少见的细节。', en: 'You use English with near-native control. Coaching focuses on style and the rarest details.' },
] as const;

const validIeltsScore = (value: unknown): number | undefined => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 9 ? value : undefined;

const ONBOARDING_CARDS = [
  { layout: 'cover', chapter: 'BEGIN', title: 'A few words.\nA real beginning.', subtitle: '只会几个词，也可以开始。', body: 'No word lists. No grammar lessons first. Tell Lucky one small thing about your day.', note: '不用等背完单词、学完语法。把今天的一件小事，先说给 Lucky 听。', image: '/lucky-story-start.webp', alt: 'A nervous tabby kitten hides behind textbooks. Lucky, the ragdoll teacher, encourages the kitten to start talking.', details: [] },
  { layout: 'scene', chapter: 'LIVE IT', title: 'English, out\nin the world.', subtitle: '把英文，用在生活里。', body: 'Children learn by using words. You can, too. See an apple? Ask for it in English.', note: '就像孩子学说话，从眼前的东西开始。想买一颗苹果，就直接用英文说出来。', image: '/lucky-story-life.webp', alt: 'At a sunny outdoor fruit market, the kitten asks: An apple, please! Lucky watches supportively from behind.', details: [] },
  { layout: 'sequence', chapter: 'GROW', title: 'A little more,\nevery day.', subtitle: '今天一个词，明天多说一点。', body: 'No fixed textbook. Lucky follows what you can say, then helps you take the next small step.', note: '没有统一教材。Lucky 跟着你实际说出的内容，调整问题和难度。', image: '/lucky-story-grow.webp', alt: 'Two comic panels: first the kitten says Tea. Later it offers tea to Lucky: I like tea. Would you like some?', details: [] },
  { layout: 'recap', chapter: 'LOOK BACK', title: 'Look how far\nyou’ve come.', subtitle: '原来，我已经能说这么多了。', body: 'Your conversations become your own story of progress.', note: '聊过的生活，会变成你自己的学习记录。', image: '/lucky-story-recall.webp', alt: 'An overhead scrapbook of a week of conversations, vocabulary and grammar notes. Lucky and the kitten celebrate with a high five.', details: [{ title: 'Daily', body: 'Revisit your words & phrases', translation: '回顾今天的词汇与表达' }, { title: 'Weekly', body: 'See your progress over time', translation: '汇总进步，回看水平变化' }] },
] as const;

function Onboarding({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0), card = ONBOARDING_CARDS[step];
  const scrollArea = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollArea.current?.scrollTo({ top: 0 }); }, [step]);
  return <Dialog open onOpenChange={value => { if (!value) onComplete(); }}>
    <DialogContent className="story-reader" showCloseButton={false}>
      <header className="story-toolbar"><span><strong>LUCKY</strong><span lang="en">How it works</span></span><Button variant="ghost" size="icon" aria-label="Close introduction" onClick={onComplete}><X aria-hidden="true" /></Button></header>
      <div className="story-scroll" ref={scrollArea}>
        <article key={card.layout} className="story-page" data-layout={card.layout} lang="en">
          <div className="story-heading"><span className="story-chapter">0{step + 1} / {card.chapter}</span><DialogTitle className="story-title">{card.title}</DialogTitle><p className="story-subtitle" lang="zh-CN">{card.subtitle}</p></div>
          <figure className="story-picture"><Image src={card.image} width={1536} height={1024} alt={card.alt} unoptimized loading="eager" /></figure>
          <div className="story-copy"><DialogDescription>{card.body}</DialogDescription><p lang="zh-CN">{card.note}</p></div>
          {card.details.length > 0 && <div className="story-recap">{card.details.map(detail => <div key={detail.title}><strong>{detail.title}</strong><span>{detail.body}</span><small lang="zh-CN">{detail.translation}</small></div>)}<p className="story-farewell">From here, let’s speak English.<span lang="zh-CN">这是你最后一次在本 App 看到中文了。</span></p></div>}
        </article>
      </div>
      <footer className="story-footer" lang="en"><Button variant="ghost" disabled={step === 0} aria-label="Previous page" onClick={() => setStep(value => Math.max(0, value - 1))}><ArrowLeft aria-hidden="true"/><span>Back</span></Button><span className="story-pagination" role="status" aria-label={`Page ${step + 1} of ${ONBOARDING_CARDS.length}`}>0{step + 1}<span>/ 0{ONBOARDING_CARDS.length}</span></span><Button onClick={() => step === ONBOARDING_CARDS.length - 1 ? onComplete() : setStep(value => value + 1)}>{step === ONBOARDING_CARDS.length - 1 ? 'Let’s begin' : 'Next'}<ArrowRight aria-hidden="true"/></Button></footer>
    </DialogContent>
  </Dialog>;
}
function RecordButton({ controller: t, side, autoSpeakSide, detectSpeaker = true, compact = false, onBeforeRecord }: { controller: ReturnType<typeof useTranslator>; side: 0 | 1; autoSpeakSide?: 0 | 1; detectSpeaker?: boolean; compact?: boolean; onBeforeRecord: () => void }) {
  const [pressed, setPressed] = useState(false);
  const keyHeld = useRef(false), pointerHeld = useRef(false);
  const isRecording = t.mode !== 'idle';
  const stopTouch = () => { pointerHeld.current = false; setPressed(false); void t.stop(); };
  const state = t.phase === 'permission' ? 'permission' : t.mode;
  const primary = INTERFACE_COPY[t.pair[side]][state];
  return <div className={`record-area ${compact ? 'compact-record' : ''}`}>
        <Button className="record-button" data-mode={t.mode} data-pressed={pressed} aria-pressed={isRecording} aria-label={primary} disabled={t.phase === 'stopping'}
          onContextMenu={event => event.preventDefault()}
          onPointerDown={event => { onBeforeRecord(); if (t.pointerDown(event, side, autoSpeakSide, detectSpeaker)) { pointerHeld.current = true; setPressed(true); } }}
          onPointerUp={event => { pointerHeld.current = false; setPressed(false); t.pointerUp(event, side, autoSpeakSide, detectSpeaker); }}
          onPointerCancel={() => { if (pointerHeld.current) stopTouch(); }}
          onLostPointerCapture={() => { if (pointerHeld.current) stopTouch(); }}
          onPointerMove={event => { if (!pressed) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left - 28 || event.clientX > rect.right + 28 || event.clientY < rect.top - 28 || event.clientY > rect.bottom + 28) stopTouch(); }}
          onClick={event => { if (event.detail === 0) { onBeforeRecord(); t.toggle(side, autoSpeakSide, detectSpeaker); } }}
          onKeyDown={event => { if (event.key === ' ') { event.preventDefault(); if (!event.repeat && !keyHeld.current) { keyHeld.current = true; setPressed(true); onBeforeRecord(); t.toggle(side, autoSpeakSide, detectSpeaker); } } else if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) { onBeforeRecord(); t.toggle(side, autoSpeakSide, detectSpeaker); } } else if (event.key === 'Escape') stopTouch(); }}
          onKeyUp={event => { if (event.key === ' ') { event.preventDefault(); keyHeld.current = false; stopTouch(); } }}
          onBlur={() => { if (keyHeld.current) { keyHeld.current = false; stopTouch(); } }}>
          {t.phase === 'permission' ? <LoaderCircle className="spinning" /> : t.mode === 'continuous' ? <Square fill="currentColor" /> : <Mic />}
          <span className="button-copy"><span lang={t.pair[side]} dir="auto">{primary}</span></span>
          {t.mode === 'continuous' && <LockKeyhole className="lock-icon" />}
        </Button>
        <div className="meter" aria-hidden="true">{Array.from({ length: 25 }, (_, index) => <i key={index} style={{ height: `${3 + t.level * (4 + Math.abs(Math.sin(index * 1.8)) * 14)}px` }} />)}</div>
      </div>;
}

type PanelProps = {
  controller: ReturnType<typeof useTranslator>; onHistory: () => void;
  totals: { dayTokens: number; dayCost: number; monthTokens: number; monthCost: number; totalTokens: number; totalCost: number }; multiplier: number;
  side: 0 | 1; visualRow: number; isSelf: boolean; facingAway: boolean; showRecord: boolean; ownName: string; pair: Pair; entries: { id: number; text: string; speaker: 'self' | 'other'; pending?: boolean; provisional?: boolean }[]; locked: boolean; canSpeak: boolean;
  onLanguage: (pair: Pair) => void; onEdit: (id: number, text: string) => void; onSpeak: (text: string) => void; onBeforeRecord: () => void; onUsage: () => void;
};
function LanguagePanel({ controller, onHistory, totals, multiplier, side, visualRow, isSelf, facingAway, showRecord, ownName, pair, entries, locked, canSpeak, onLanguage, onEdit, onSpeak, onBeforeRecord, onUsage }: PanelProps) {
  const viewport = useRef<HTMLElement>(null), following = useRef(true), previousLanguage = useRef(pair[side]);
  const [bounds, setBounds] = useState({ top: true, bottom: true });
  useEffect(() => {
    const view = viewport.current; if (!view) return;
    const update = () => { const bottom = view.scrollHeight - view.clientHeight - view.scrollTop < 8; setBounds({ top: view.scrollTop < 8, bottom }); following.current = bottom; };
    const observer = new ResizeObserver(update); observer.observe(view);
    view.addEventListener('scroll', update, { passive: true });
    return () => { observer.disconnect(); view.removeEventListener('scroll', update); };
  }, []);
  useEffect(() => {
    const changed = previousLanguage.current !== pair[side]; previousLanguage.current = pair[side];
    const frame = requestAnimationFrame(() => {
      const view = viewport.current; if (!view) return;
      if (following.current || changed) view.scrollTop = view.scrollHeight;
      const bottom = view.scrollHeight - view.clientHeight - view.scrollTop < 8;
      setBounds({ top: view.scrollTop < 8, bottom }); following.current = bottom;
    });
    return () => cancelAnimationFrame(frame);
  }, [entries, pair, side]);
  const scroll = (direction: -1 | 1) => {
    const view = viewport.current; if (!view) return;
    following.current = false;
    view.scrollBy({ top: direction * view.clientHeight * .8, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  return <section className={`language-panel ${isSelf ? 'self' : 'partner'} ${facingAway ? 'facing-away' : ''}`} style={{ gridRow: visualRow }} aria-label={isSelf ? '你的翻译区' : '对方的翻译区'}>
    <header className="panel-head">
      <span className="side-label"><span className="side-dot" />{isSelf ? ownName : 'other speaks'}{isSelf && <Button variant="ghost" className="history-entry" onClick={onHistory} aria-label="查看完整对话"><History /><span>完整对话</span></Button>}</span>
      {isSelf && <button type="button" className="usage-meter" onClick={onUsage} aria-label={`今日费用 ${(totals.dayCost * multiplier).toFixed(2)} 美元，点击查看使用明细`}><small>今日</small><strong>${(totals.dayCost * multiplier).toFixed(2)}</strong></button>}
      <Select value={pair[side]} onValueChange={value => { if (value && language(value)) onLanguage(selectLanguage(pair, side, value as LanguageCode)); }} disabled={locked}>
        <SelectTrigger className="language-button" aria-label={isSelf ? '你的语言' : '对方的语言'}><SelectValue>{language(pair[side])?.label}</SelectValue></SelectTrigger>
        <SelectContent className={`language-options ${side === 0 ? 'upside-down' : ''}`} alignItemWithTrigger={false}>
          {LANGUAGES.map(item => <SelectItem key={item.code} value={item.code} className="language-option">{item.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </header>
    <div className="conversation-body">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to focus and scroll this reading region. */}
      <section ref={viewport} className="transcript-viewport" tabIndex={0} aria-label="对话内容，可上下滚动">
        <div className="transcript-stack" lang={pair[side]}>
          {entries.length ? entries.map((item, index) => <p key={item.id} className={`transcript-line ${index === entries.length - 1 ? 'current' : 'previous'} ${item.pending ? 'pending-turn' : ''}`} dir="auto">
            {item.pending ? <LoaderCircle className="turn-loading spinning" /> : <Button type="button" variant="ghost" className="turn-speak" onClick={() => onSpeak(item.text)} disabled={!canSpeak || locked || item.provisional} aria-label={`朗读：${item.text}`} title="朗读这句"><Volume2 /></Button>}
            {!item.pending && <span className={`turn-speaker ${item.speaker}`}>{item.speaker === 'self' ? ownName : 'other speaks'}</span>}
            {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- A button blocks the native mobile text-selection menu. */}
            <span className="turn-text" tabIndex={locked || item.pending || item.provisional ? -1 : 0} aria-disabled={locked || item.pending || item.provisional} aria-label={item.pending ? '正在翻译' : item.provisional ? '刚刚识别出的原话' : '点击修改；长按可选择、复制或全选文字'} onClick={() => { if (!locked && !item.pending && !item.provisional && !window.getSelection()?.toString()) onEdit(item.id, item.text); }} onKeyDown={event => { if (!locked && !item.pending && !item.provisional && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onEdit(item.id, item.text); } }}>{item.text}</span>
          </p>) : <p className="transcript-line current empty">{INTERFACE_COPY[pair[side]].ready}</p>}
        </div>
      </section>
      <nav className="transcript-nav" aria-label="翻阅对话"><Button variant="ghost" disabled={bounds.top} onClick={() => scroll(-1)} aria-label="向上查看较早对话" title="上一页"><ChevronUp /></Button><Button variant="ghost" disabled={bounds.bottom} onClick={() => scroll(1)} aria-label="向下查看后续对话" title="下一页"><ChevronDown /></Button></nav>
    </div>
    {showRecord && <RecordButton controller={controller} side={side} onBeforeRecord={onBeforeRecord} />}
  </section>;
}

function SoloDirectionControls({ controller: t, direction, selfSide, otherSide, onDirection, onBeforeRecord }: { controller: ReturnType<typeof useTranslator>; direction: SoloDirection; selfSide: 0 | 1; otherSide: 0 | 1; onDirection: (value: SoloDirection) => void; onBeforeRecord: () => void }) {
  /* oxlint-disable react/react-compiler -- timestamps are read only inside pointer events */
  const press = useRef<{ id: number; started: number } | undefined>(undefined);
  const activate = (value: SoloDirection) => {
    onDirection(value); onBeforeRecord();
    const input = value === 'listening' ? otherSide : selfSide, output = value === 'listening' ? selfSide : otherSide;
    t.toggle(input, output, false);
  };
  const pointerDown = (event: React.PointerEvent<HTMLButtonElement>, value: SoloDirection) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    if (t.mode !== 'idle') { press.current = undefined; if (direction === value) void t.stop(); return; }
    press.current = { id: event.pointerId, started: performance.now() }; activate(value);
  };
  const pointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = press.current; press.current = undefined;
    if (current?.id === event.pointerId && performance.now() - current.started >= RecordGesture.HOLD_MS) void t.stop();
  };
  return <fieldset className="solo-direction" aria-label="翻译方向">
    {(['listening', 'speaking'] as const).map(value => {
      const active = direction === value, unavailable = t.phase === 'permission' || t.phase === 'stopping' || (t.mode !== 'idle' && !active);
      const from = value === 'listening' ? otherSide : selfSide, to = value === 'listening' ? selfSide : otherSide;
      return <Button key={value} type="button" variant="ghost" data-active={active} data-recording={active && t.mode !== 'idle'} aria-pressed={active && t.mode !== 'idle'} aria-label={`${value === 'listening' ? 'Listening' : 'Speaking'}：${language(t.pair[from])?.label}翻译为${language(t.pair[to])?.label}。点击持续录音，长按松手停止`} disabled={unavailable}
        onPointerDown={event => pointerDown(event, value)} onPointerUp={pointerUp} onPointerCancel={() => { if (press.current) void t.stop(); press.current = undefined; }} onContextMenu={event => event.preventDefault()}
        onClick={event => { if (event.detail === 0) { if (t.mode !== 'idle') void t.stop(); else activate(value); } }}>
        {active && t.mode !== 'idle' ? <Square fill="currentColor" /> : <Mic />}<span>{value === 'listening' ? 'Listening' : 'Speaking'}</span>
      </Button>;
    })}
  </fieldset>;
}

export default function Home() {
  const [account, setAccount] = useState<AccountSnapshot | null>();
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let revision = 0, alive = true;
    const refresh = () => {
      const current = ++revision; setAccount(undefined); setLoadError(false);
      void publicAccountRequest<{ account: AccountSnapshot | null }>('/api/auth').then(data => {
        if (alive && current === revision) setAccount(data.account);
      }).catch(() => { if (alive && current === revision) { setAccount(null); setLoadError(true); } });
    };
    const changed = (event: StorageEvent) => { if (event.key === SESSION_MARKER) refresh(); };
    refresh(); window.addEventListener(SESSION_CHANGED, refresh); window.addEventListener('storage', changed);
    return () => { alive = false; window.removeEventListener(SESSION_CHANGED, refresh); window.removeEventListener('storage', changed); };
  }, []);
  if (account === undefined) return <main className="access-page"><section className="access-card" aria-busy="true"><LoaderCircle className="spinning" /> Loading your account…</section></main>;
  return <AccountWorkspace key={account?.id || 'signed-out'} initialAccount={account} onAccount={setAccount} loadError={loadError} />;
}

function AccountWorkspace({ initialAccount, onAccount, loadError }: { initialAccount: AccountSnapshot | null; onAccount: (account: AccountSnapshot | null) => void; loadError: boolean }) {
  const [scope] = useState(() => createAccountScope(initialAccount?.id || ''));
  useEffect(() => { scope.activate(); return () => scope.dispose(); }, [scope]);
  const localStorage = scope.storage, fetch = scope.fetch, saveCloudRecord = scope.save;
  const accountRequest = scope.owner ? scope.request : publicAccountRequest;
  const setAccount = (next: AccountSnapshot | null) => {
    if (next?.id !== initialAccount?.id) scope.dispose();
    onAccount(next);
  };
  const t = useTranslator(scope);
  const [appMode, setAppMode] = useState<AppMode | null>(null);
  const account = initialAccount;
  const [settingsReturnMode, setSettingsReturnMode] = useState<AppMode | null>(null);
  const [coachEntryStage, setCoachEntryStage] = useState<'chat' | 'dashboard'>('chat');
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot-password' | 'verify-email'>('login');
  const [verificationCode, setVerificationCode] = useState('');
  const [resendSeconds, setResendSeconds] = useState(0);
  useEffect(() => { if (resendSeconds <= 0) return; const timer = window.setTimeout(() => setResendSeconds(value => Math.max(0, value - 1)), 1000); return () => window.clearTimeout(timer); }, [resendSeconds]);
  const [authEmail, setAuthEmail] = useState(''), [authUsername, setAuthUsername] = useState(''), [authPassword, setAuthPassword] = useState(''), [authError, setAuthError] = useState(loadError ? '暂时无法读取账户，请刷新后重试' : '');
  const [confirmPassword, setConfirmPassword] = useState(''), [authConfirmation, setAuthConfirmation] = useState(''), [authNotice, setAuthNotice] = useState(''), [passwordBusy, setPasswordBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [dialog, setDialog] = useState<'settings' | 'help' | 'history' | 'text' | 'edit' | 'name' | 'ielts' | 'password' | 'usage' | null>(null);
  const [dialogSide, setDialogSide] = useState<0 | 1>(1);
  const [draftText, setDraftText] = useState('');
  const [formError, setFormError] = useState(''), [copied, setCopied] = useState(false);
  const [installed, setInstalled] = useState(false), [installEvent, setInstallEvent] = useState<InstallEvent>();
  const [speaking, setSpeaking] = useState(false);
  const [ownName, setOwnName] = useState('Me'), [draftName, setDraftName] = useState('');
  const [ieltsScore, setIeltsScore] = useState<number>();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]), [timeLoading, setTimeLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState(''), [nextPassword, setNextPassword] = useState('');
  const [editingId, setEditingId] = useState<number>();
  const [speechSpeed, setSpeechSpeed] = useState(1);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('face-to-face');
  const [soloDirection, setSoloDirection] = useState<SoloDirection>('listening');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const playedSpeech = useRef(0);
  const playedCoachSpeech = useRef(0);
  const speechRequest = useRef(0), speechAbort = useRef<AbortController | undefined>(undefined), speechAudio = useRef<HTMLAudioElement | undefined>(undefined), speechUrl = useRef('');
  const { addUsage, setError: reportError } = t;
  const activeAccountId = account?.status === 'active' ? account.id : '';
  const coach = useCoach(scope, t.addUsage, ieltsScore);
  useEffect(() => {
    if (dialog !== 'usage' || !activeAccountId) return;
    let cancelled = false; setTimeLoading(true); setFormError('');
    void accountRequest<{ account: AccountSnapshot; ledger: TimeEntry[] }>('/api/account?ledger=1').then(data => {
      if (!cancelled) { setTimeEntries(data.ledger); setAccount(data.account); }
    }).catch(error => { if (!cancelled) setFormError(error instanceof Error ? error.message : '无法读取明细'); }).finally(() => { if (!cancelled) setTimeLoading(false); });
    return () => { cancelled = true; };
  }, [dialog, activeAccountId]);
  const locked = t.mode !== 'idle' || t.phase !== 'ready' || t.pending > 0;
  const panelEntries = useMemo(() => {
    const panels = [transcriptForLanguage(t.history, t.pair[0]), transcriptForLanguage(t.history, t.pair[1])] as Array<Array<{ id: number; text: string; speaker: 'self' | 'other'; pending?: boolean; provisional?: boolean }>>;
    for (const turn of t.pendingTurns) {
      panels[turn.sourceSide].push({ id: -turn.id * 2, text: turn.text, speaker: turn.speaker, provisional: true });
      panels[1 - turn.sourceSide].push({ id: -turn.id * 2 - 1, text: '正在翻译…', speaker: turn.speaker, pending: true });
    }
    return panels;
  }, [t.history, t.pair, t.pendingTurns]);
  const visibleDialog = t.needsSettings ? 'settings' : dialog;
  useEffect(() => {
    try { localStorage.removeItem('lucky-openai-key'); localStorage.removeItem('lucky-custom-voice'); localStorage.removeItem('lucky-voice-setup-dismissed'); } catch {}
    queueMicrotask(() => { setInstalled(window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)); });
    queueMicrotask(() => { const speed = Number(localStorage.getItem('lucky-speech-speed')); if ([.75, 1, 1.5, 2].includes(speed)) setSpeechSpeed(speed); });
    queueMicrotask(() => { const layout = localStorage.getItem('lucky-layout'); if (layout === 'single-operator' || layout === 'same-direction') setLayoutMode('single-operator'); });
    queueMicrotask(() => { if (localStorage.getItem('lucky-solo-direction') === 'speaking') setSoloDirection('speaking'); });
    queueMicrotask(() => { try { const profile = JSON.parse(localStorage.getItem('lucky-profile') || 'null') as Profile; if (typeof profile?.name === 'string') setOwnName(profile.name.trim().slice(0, 24) || 'Me'); setIeltsScore(validIeltsScore(profile?.ieltsScore)); } catch {} });
    const before = (event: Event) => { event.preventDefault(); setInstallEvent(event as InstallEvent); };
    const installedHandler = () => { setInstalled(true); setInstallEvent(undefined); };
    window.addEventListener('beforeinstallprompt', before); window.addEventListener('appinstalled', installedHandler);
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => { window.removeEventListener('beforeinstallprompt', before); window.removeEventListener('appinstalled', installedHandler); clearTimeout(copyTimer.current); };
  }, []);
  useEffect(() => {
    if (!account || account.status !== 'active') return;
    let cancelled = false;
    void fetch('/api/cloud?type=profile', { credentials: 'same-origin' }).then(async response => response.ok ? await response.json() as { records?: Array<{ data: Profile }> } : null).then(payload => {
      if (cancelled) return;
      const remoteProfile = payload?.records?.at(-1)?.data;
      const remoteName = typeof remoteProfile?.name === 'string' ? remoteProfile.name.trim().slice(0, 24) : '';
      const remoteScore = validIeltsScore(remoteProfile?.ieltsScore);
      let localProfile: Profile = {};
      try { localProfile = JSON.parse(localStorage.getItem('lucky-profile') || 'null') || {}; } catch {}
      const name = remoteName || (typeof localProfile.name === 'string' ? localProfile.name.trim().slice(0, 24) : '') || account.username || 'Me';
      const score = remoteScore ?? validIeltsScore(localProfile.ieltsScore);
      setOwnName(name); setIeltsScore(score);
      try { localStorage.setItem('lucky-profile', JSON.stringify({ ...localProfile, ...(remoteProfile?.onboardingSeen ? { onboardingSeen: true } : {}), name, ...(score ? { ieltsScore: score } : {}) })); } catch {}
      setShowOnboarding(!remoteProfile?.onboardingSeen && !localProfile.onboardingSeen);
      if (!remoteName && !localProfile.name) { setDraftName(name); setDialog('name'); }
    }).catch(() => { if (!cancelled) { const name = account.username || 'Me'; setOwnName(name); setDraftName(name); setDialog('name'); setShowOnboarding(true); } });
    return () => { cancelled = true; };
  }, [activeAccountId]);
  useEffect(() => {
    if (!activeAccountId) return;
    let cancelled = false;
    void accountRequest<{ account: AccountSnapshot }>('/api/account').then(data => { if (!cancelled) setAccount(data.account); }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeAccountId, t.usageTotals.dayTokens, t.usageTotals.dayCost, coach.busy, t.pending]);
  const open = (name: NonNullable<typeof dialog>, side: 0 | 1 = 1) => {
    void t.stop(); t.setNeedsSettings(false); setDialogSide(side); setFormError('');
    if (name === 'name') setDraftName(ownName === 'Me' ? '' : ownName);
    if (name === 'password') { setCurrentPassword(''); setNextPassword(''); setConfirmPassword(''); }
    setDialog(name);
  };
  const closeDialog = () => { setDialog(null); if (settingsReturnMode) { setAppMode(settingsReturnMode); setSettingsReturnMode(null); } };
  const saveProfile = (next: Profile) => {
    let stored: Profile = {};
    try { stored = JSON.parse(localStorage.getItem('lucky-profile') || 'null') || {}; } catch {}
    const profile: Profile = { ...stored, ...next, name: next.name?.trim().slice(0, 24) || ownName || 'Me', ieltsScore: validIeltsScore(next.ieltsScore ?? ieltsScore) };
    setOwnName(profile.name || 'Me'); setIeltsScore(profile.ieltsScore);
    try { localStorage.setItem('lucky-profile', JSON.stringify(profile)); } catch {}
    void saveCloudRecord('profile', 'profile', profile);
  };
  const saveName = (value: string) => { saveProfile({ name: value.trim().slice(0, 24) || 'Me' }); closeDialog(); };
  const saveIeltsScore = (score: number) => { saveProfile({ name: ownName, ieltsScore: score }); closeDialog(); };
  const completeOnboarding = () => { saveProfile({ name: ownName, ieltsScore, onboardingSeen: true }); setShowOnboarding(false); };
  const changePassword = async () => {
    if (passwordBusy) return;
    setFormError('');
    if (nextPassword !== confirmPassword) { setFormError('两次输入的新密码不一致'); return; }
    setPasswordBusy(true);
    try { await accountRequest('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'change-password', currentPassword, nextPassword, confirmPassword }) }); closeDialog(); }
    catch (error) { setFormError(error instanceof Error ? error.message : '暂时无法修改密码'); }
    finally { setPasswordBusy(false); }
  };
  const editSentence = (side: 0 | 1, id: number, text: string) => { setEditingId(id); setDraftText(text); open('edit', side); };
  const stopSpeech = useCallback(() => {
    speechRequest.current++; speechAbort.current?.abort(); speechAbort.current = undefined;
    window.speechSynthesis?.cancel();
    const audio = speechAudio.current; if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    if (speechUrl.current) URL.revokeObjectURL(speechUrl.current); speechUrl.current = ''; setSpeaking(false);
  }, []);
  const playSpeech = useCallback(async (text: string, lang: string) => {
    stopSpeech();
    const requestId = ++speechRequest.current, abort = new AbortController(); speechAbort.current = abort; setSpeaking(true);
    try {
      if (lang.startsWith('zh') && 'speechSynthesis' in window) {
        const speech = new SpeechSynthesisUtterance(text); speech.lang = lang; speech.rate = speechSpeed;
        const voices = window.speechSynthesis.getVoices(), voice = voices.find(item => item.lang.toLowerCase().startsWith(lang.toLowerCase())) || voices.find(item => item.lang.toLowerCase().startsWith('zh'));
        if (voice) speech.voice = voice;
        speech.onend = () => { if (requestId === speechRequest.current) stopSpeech(); };
        speech.onerror = () => { if (requestId === speechRequest.current) { stopSpeech(); reportError('中文朗读失败，请检查设备语音设置'); } };
        window.speechSynthesis.speak(speech); return;
      }
      const result = await synthesizeSpeechDirect({ accountId: scope.owner, text, language: lang, speed: speechSpeed, signal: abort.signal });
      addUsage(result.usage.tokens, result.usage.cost); if (requestId !== speechRequest.current) return;
      const url = URL.createObjectURL(result.audio), audio = new Audio(url);
      audio.playbackRate = speechSpeed;
      audio.onended = () => { if (requestId === speechRequest.current) stopSpeech(); };
      audio.onerror = () => { if (requestId === speechRequest.current) { stopSpeech(); reportError('语音播放失败，请重试'); } };
      speechAudio.current = audio; speechUrl.current = url;
      await audio.play();
    } catch (cause) {
      if (requestId !== speechRequest.current || abort.signal.aborted) return;
      stopSpeech(); reportError(cause instanceof Error && cause.name === 'NotAllowedError' ? '浏览器阻止了自动播放，请点译文旁的喇叭播放' : cause instanceof Error ? cause.message : '朗读失败，请重试');
    }
  }, [addUsage, reportError, speechSpeed, stopSpeech]);
  useEffect(() => {
    const request = t.autoSpeech;
    const mayPlay = (t.mode === 'idle' && t.phase === 'ready') || (layoutMode === 'single-operator' && t.mode === 'continuous' && t.phase === 'listening');
    if (!request || request.id === playedSpeech.current || !mayPlay) return;
    playedSpeech.current = request.id;
    void playSpeech(request.text, request.lang);
  }, [t.autoSpeech, t.mode, t.phase, layoutMode, playSpeech]);
  useEffect(() => {
    const request = coach.speechRequest;
    if (appMode !== 'coach' || !request || request.id === playedCoachSpeech.current) return;
    playedCoachSpeech.current = request.id; void playSpeech(request.text, 'en');
  }, [appMode, coach.speechRequest, playSpeech]);
  useEffect(() => stopSpeech, [stopSpeech]);
  const copyConversation = async () => {
    try { await navigator.clipboard.writeText(conversationText(t.history, ownName)); setCopied(true); clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 1800); }
    catch { setFormError('复制失败，请尝试导出文本'); }
  };
  const exportConversation = () => {
    try {
      const blob = new Blob(['\uFEFF', conversationText(t.history, ownName)], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `Lucky-对话-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch { setFormError('导出失败，请尝试复制全部内容'); }
  };
  const authenticate = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault(); if (authBusy) return;
    setAuthBusy(true); setAuthError('');
    try {
      setAuthNotice('');
      if (!validEmail(authEmail.trim())) throw new Error('请输入有效的邮箱地址，仅支持邮箱登录');
      if (authMode === 'verify-email' && !validVerificationCode(verificationCode)) throw new Error('请输入 6 位数字验证码');
      if (authMode === 'register' && !validUsername(authUsername.trim())) throw new Error('昵称需为 2–24 个文字、数字、点、横线或下划线');
      if (authMode === 'register' && (authPassword.length < 8 || authPassword.length > 128)) throw new Error('密码需要 8–128 位');
      if (authMode === 'login' && (!authPassword || authPassword.length > 128)) throw new Error('请输入密码（最多 128 位）');
      if (authMode === 'forgot-password') {
        const result = await accountRequest<{message:string}>('/api/auth',{method:'POST',body:JSON.stringify({action:authMode,email:authEmail.trim()})});
        setAuthNotice(result.message); return;
      }
      if (authMode === 'register' && authPassword !== authConfirmation) throw new Error('两次输入的密码不一致');
      const data = await accountRequest<{ account?: AccountSnapshot; verificationRequired?: boolean }>('/api/auth', { method: 'POST', body: JSON.stringify({ action: authMode, code: verificationCode, email: authEmail.trim(), username: authUsername.trim(), password: authPassword, confirmPassword: authConfirmation }) });
      if (data.verificationRequired) { setAuthMode('verify-email'); setVerificationCode(''); setResendSeconds(60); setAuthPassword(''); setAuthConfirmation(''); setAuthNotice('验证码已发送，10 分钟内有效，请同时检查垃圾邮件。'); return; }
      if (!data.account) throw new Error('暂时无法登录，请重试');
      setAccount(data.account); setAuthPassword(''); setAuthConfirmation(''); setVerificationCode('');
      window.localStorage.setItem(SESSION_MARKER, crypto.randomUUID());
    } catch (cause) { setAuthError(cause instanceof Error ? cause.message : '暂时无法登录'); }
    finally { setAuthBusy(false); }
  };
  const resendCode = async () => {
    if (authBusy || resendSeconds > 0) return;
    setAuthBusy(true); setAuthError('');
    try { const result = await accountRequest<{message:string}>('/api/auth', {method:'POST',body:JSON.stringify({action:'resend-verification',email:authEmail.trim()})}); setAuthNotice(result.message); setResendSeconds(60); }
    catch (cause) { setAuthError(cause instanceof Error ? cause.message : '发送失败，请重试'); }
    finally { setAuthBusy(false); }
  };
  const logout = async () => {
    t.cancel(); coach.cancel(); stopSpeech();
    const pending = accountRequest('/api/auth', { method: 'DELETE' });
    try { await pending; setAccount(null); window.localStorage.setItem(SESSION_MARKER, crypto.randomUUID()); }
    catch { setFormError('退出失败，请重试'); }
  };
  const install = async () => {
    if (!installEvent) { open('help'); return; }
    await t.stop(); await installEvent.prompt(); const result = await installEvent.userChoice;
    if (result.outcome === 'accepted') setInstallEvent(undefined);
  };
  const status = t.error || (t.phase === 'permission' ? '请允许使用麦克风…' : t.phase === 'listening' ? (layoutMode === 'single-operator' ? '' : '正在聆听，双方都可以说话') : t.phase === 'stopping' ? '正在结束录音…' : t.notice);
  const usageRows = account ? [
    { label: '今日', tokens: account.usage.todayTokens, cost: account.usage.todayCost, seconds: account.usage.todaySeconds },
    { label: '本月', tokens: account.usage.monthTokens, cost: account.usage.monthCost, seconds: account.usage.monthSeconds },
    { label: '累计', tokens: account.usage.totalTokens, cost: account.usage.totalCost, seconds: account.usage.totalSeconds },
  ] : [];
  const remaining = account ? account.limits.dailySeconds > 0 ? Math.max(0, account.limits.dailySeconds - account.usage.todaySeconds) : Math.max(0, account.limits.monthlySeconds - account.usage.monthSeconds) : 0;
  const selfSide = (t.selfOnTop ? 0 : 1) as 0 | 1, otherSide = (1 - selfSide) as 0 | 1;
  const panelOrder: Array<0 | 1> = layoutMode === 'single-operator' ? [otherSide, selfSide] : [0, 1];
  if (account === undefined) return <main className="access-page"><section className="access-card" aria-busy="true">
    <div className="access-mark"><ShieldCheck /></div><h1>Lucky 同声翻译</h1><p><LoaderCircle className="spinning" />正在读取账户…</p>
  </section></main>;
  if (account === null) return <main className="access-page"><section className="access-card">
    <div className="access-mark"><ShieldCheck /></div><h1>Lucky 同声翻译</h1>
    <div className="auth-tabs"><Button type="button" variant={authMode === 'login' ? 'secondary' : 'ghost'} onClick={() => { setAuthMode('login'); setAuthError(''); setAuthNotice(''); }}>登录</Button><Button type="button" variant={authMode === 'register' ? 'secondary' : 'ghost'} onClick={() => { setAuthMode('register'); setAuthError(''); setAuthNotice(''); }}>注册</Button></div>
    <form onSubmit={authenticate} noValidate>
      <label className="field-label" htmlFor="account-email">邮箱</label>
      <Input id="account-email" type="email" inputMode="email" required className="app-input" value={authEmail} onChange={event => setAuthEmail(event.target.value)} onBlur={() => { if (authEmail && !validEmail(authEmail.trim())) setAuthError('请输入有效的邮箱地址'); }} readOnly={authMode === 'verify-email'} disabled={authBusy} autoCapitalize="none" spellCheck={false} autoComplete="email" maxLength={254} />
      {authMode === 'register' && <><label className="field-label" htmlFor="account-username">昵称</label><Input id="account-username" className="app-input" value={authUsername} onChange={event => setAuthUsername(event.target.value)} autoComplete="username" minLength={2} maxLength={24} /></>}
      {(authMode === 'login' || authMode === 'register') && <><label className="field-label" htmlFor="account-password">密码</label>
      <Input id="account-password" type="password" className="app-input" value={authPassword} onChange={event => setAuthPassword(event.target.value)} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={authMode === 'register' ? 8 : 1} maxLength={128} /></>}
      {authMode === 'register' && <><label className="field-label" htmlFor="account-confirm-password">再次输入密码</label><Input id="account-confirm-password" type="password" className="app-input" value={authConfirmation} onChange={event=>setAuthConfirmation(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required /></>}
      {authMode === 'verify-email' && <><label className="field-label" htmlFor="account-code">邮箱验证码</label><Input id="account-code" className="app-input" inputMode="numeric" autoComplete="one-time-code" value={verificationCode} onChange={event => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} maxLength={6} required /><Button type="button" variant="ghost" disabled={authBusy || resendSeconds > 0} onClick={() => void resendCode()}>{resendSeconds > 0 ? `${resendSeconds} 秒后可重新发送` : '重新发送验证码'}</Button></>}
      {authNotice && <p role="status">{authNotice}</p>}
      {authMode === 'register' && <p className="field-note">邮箱验证通过后开通 Lv1，每天获得 {formatPoints(PLAN_DEFAULTS.lv1.dailySeconds)}。</p>}
      {authError && <p role="alert" className="form-error">{authError}</p>}
      <Button type="submit" className="form-submit" disabled={authBusy}>{authBusy ? <><LoaderCircle className="spinning" />正在提交</> : authMode === 'login' ? '登录' : authMode === 'register' ? '发送验证码' : authMode === 'verify-email' ? '验证并开始使用' : '发送重设邮件'}</Button>
      {authMode === 'login' && <Button type="button" variant="ghost" onClick={()=>{setAuthMode('forgot-password');setAuthError('');setAuthNotice('');}}>忘记密码？</Button>}
    </form>
  </section></main>;
  if (account.status !== 'active') return <main className="access-page"><section className="access-card member-pending"><div className="access-mark"><ShieldCheck /></div><h1>{account.status === 'pending' ? '注册申请已提交' : account.status === 'expired' ? '会员已到期' : '账户已暂停'}</h1><p>{account.status === 'pending' ? '管理员激活会员后即可开始使用。' : '请联系管理员恢复账户。'}</p><strong>{account.email || account.username}</strong><Button className="form-submit" onClick={() => void accountRequest<{ account: AccountSnapshot | null }>('/api/auth').then(data => setAccount(data.account))}>刷新状态</Button><Button variant="ghost" onClick={() => void logout()}><LogOut />退出账户</Button></section></main>;
  if (!t.ready || !coach.ready) return <main className="access-page"><section className="access-card"><LoaderCircle className="spinning" /><p>{t.error || coach.error || 'Loading your conversations…'}</p>{(t.error || coach.error) && <Button onClick={() => window.location.reload()}>Retry</Button>}</section></main>;
  if (appMode === null) return <main className="mode-page"><section className="mode-card">{showOnboarding && <Onboarding onComplete={completeOnboarding}/>}<Image className="lucky-cat" src="/lucky-cat.webp" width={128} height={128} alt="Lucky cat" unoptimized /><p className="mode-brand">LUCKY</p><h1>What would you like to do?</h1><div className="member-summary"><span>{account.username} · {account.level.toUpperCase()}</span><strong>剩余 {formatPoints(remaining)}</strong><small>云空间 {(account.storage.bytes / 1024 / 1024).toFixed(1)} / {(account.storage.limitBytes / 1024 / 1024).toFixed(0)} MB · 云端保留 {account.storage.retentionMonths} 个月</small></div>{account.storage.warning && <button className="storage-warning" onClick={() => { setAppMode('translator'); queueMicrotask(() => open('history')); }}>云空间接近上限，请导出对话</button>}<div className="mode-options"><Button onClick={() => { setCoachEntryStage('chat'); setAppMode('coach'); if (coach.history.length === 0 && !coach.busy) void coach.beginSession(); }}><strong>English Coach</strong><span>Have a natural conversation and practise afterwards</span></Button><Button variant="outline" onClick={() => setAppMode('translator')}><strong>Translator</strong><span>Translate a live conversation in both directions</span></Button></div><div className="mode-account-actions"><Button variant="ghost" className="mode-settings" onClick={() => { setSettingsReturnMode(null); setAppMode('translator'); queueMicrotask(() => open('settings')); }}><Settings2 />设置</Button><Button variant="ghost" className="mode-settings" onClick={() => void logout()}><LogOut />退出</Button></div></section></main>;
  if (appMode === 'coach') return <CoachMode coach={coach} speaking={speaking} ieltsScore={ieltsScore} initialStage={coachEntryStage} onBack={() => { stopSpeech(); void coach.stopRecording(); setCoachEntryStage('chat'); setAppMode(null); }} onSettings={() => { stopSpeech(); void coach.stopRecording(); setCoachEntryStage('dashboard'); setSettingsReturnMode('coach'); setAppMode('translator'); queueMicrotask(() => open('settings')); }} onIelts={() => { stopSpeech(); void coach.stopRecording(); setCoachEntryStage('dashboard'); setSettingsReturnMode('coach'); setAppMode('translator'); queueMicrotask(() => open('ielts')); }} onSecurity={() => { stopSpeech(); void coach.stopRecording(); setCoachEntryStage('dashboard'); setSettingsReturnMode('coach'); setAppMode('translator'); queueMicrotask(() => open('password')); }} onLogout={() => void logout()} onHowItWorks={() => { stopSpeech(); void coach.stopRecording(); setAppMode(null); queueMicrotask(() => setShowOnboarding(true)); }} onSpeak={text => void playSpeech(text, 'en')} />;
  return <main className="translator"><div className={`app-frame ${layoutMode === 'single-operator' ? 'single-operator' : ''}`}>
    {panelOrder.map((side, index) => <LanguagePanel key={side} controller={t} onHistory={() => open('history')} totals={{ ...t.usageTotals, dayCost: account.usage.todayCost, dayTokens: account.usage.todayTokens, monthCost: account.usage.monthCost, monthTokens: account.usage.monthTokens }} multiplier={account.costMultiplier} side={side} visualRow={layoutMode === 'single-operator' ? index + 1 : side === 0 ? 1 : 3} isSelf={side === selfSide} facingAway={layoutMode === 'face-to-face' && side === 0} showRecord={layoutMode === 'face-to-face'} ownName={ownName} pair={t.pair} entries={panelEntries[side]} locked={locked} canSpeak={true} onLanguage={t.changePair} onEdit={(id, text) => editSentence(side, id, text)} onSpeak={text => void playSpeech(text, t.pair[side])} onBeforeRecord={stopSpeech} onUsage={() => open('usage', side)} />)}
    <section className={`control-deck ${layoutMode === 'single-operator' ? 'single-control-deck' : ''}`} aria-label="录音控制">
      <div className="deck-top">{layoutMode === 'face-to-face' && <Button variant="outline" className="side-swap" onClick={() => t.swapSides()} disabled={locked} aria-label="上下切换双方位置" title="上下切换"><ArrowDownUp /><span>切换</span></Button>}<h1 className="wordmark">LUCKY<span>同声翻译</span></h1><div className="deck-actions">
        <Button variant="ghost" onClick={() => open('history')} aria-label="对话记录" title="对话记录"><History /></Button>
        <Button variant="ghost" onClick={() => open('settings')} aria-label="翻译设置" title="设置"><Settings2 /></Button>
      </div></div>
      {layoutMode === 'single-operator' && <SoloDirectionControls controller={t} direction={soloDirection} selfSide={selfSide} otherSide={otherSide} onDirection={value => { setSoloDirection(value); try { localStorage.setItem('lucky-solo-direction', value); } catch {} }} onBeforeRecord={stopSpeech} />}
      {status && <output className={`status-line ${t.error ? 'has-error' : ''}`} aria-live="polite">{t.pending > 0 && !t.error && <LoaderCircle className="spinning" />}<span>{status}</span></output>}
      {t.failed && <Button variant="outline" className="retry-button" disabled={locked} onClick={t.retry}>重试上一句</Button>}
    </section>
    <footer className="app-footer"><Button variant="ghost" className="mode-return" onClick={() => { void t.stop(); stopSpeech(); setAppMode(null); }}><ArrowLeft />模式</Button><span className="connection-label"><i data-ready={t.canTranslate} />DeepSeek 已连接</span><div>
      {!installed && <Button variant="ghost" onClick={() => void install()} className="install-action"><Download />添加到桌面</Button>}
      <Button variant="ghost" aria-label="使用帮助" onClick={() => open('help')}><CircleHelp /></Button>
    </div></footer>
    {copied && <output className="copy-toast"><Check />已复制</output>}
    {speaking && <Button variant="secondary" className="speech-stop" onClick={stopSpeech}><Square />停止朗读</Button>}
  </div>
  <Dialog open={visibleDialog !== null} onOpenChange={value => { if (!value) { if (visibleDialog === 'name') saveName(ownName); else closeDialog(); t.setNeedsSettings(false); } }}>
    <DialogContent className={`app-dialog ${visibleDialog === 'history' ? 'conversation-dialog' : ''} ${visibleDialog === 'edit' ? 'edit-dialog' : ''} ${visibleDialog === 'ielts' ? 'ielts-dialog' : ''} ${layoutMode === 'face-to-face' && dialogSide === 0 && !t.needsSettings && !['history', 'edit', 'usage', 'ielts'].includes(visibleDialog || '') ? 'upside-down' : ''}`} showCloseButton={false}>
      <DialogHeader><DialogTitle>{visibleDialog === 'name' ? '怎么称呼你？' : visibleDialog === 'ielts' ? '设定雅思成绩' : visibleDialog === 'password' ? '安全密码' : visibleDialog === 'settings' ? '账户与设置' : visibleDialog === 'history' ? '完整对话' : visibleDialog === 'edit' ? '修改当前这句' : visibleDialog === 'text' ? '输入文字' : visibleDialog === 'usage' ? '使用明细' : '随时打开，面对面聊'}</DialogTitle><DialogDescription>
        {visibleDialog === 'name' ? 'What should we call you?' : visibleDialog === 'ielts' ? '选择最接近你当前水平的一档。它会帮助 English Coach 调整对话难度和纠错尺度；这不是官方测评。' : visibleDialog === 'password' ? '使用至少 8 位的新密码，保障你的云端学习记录。' : visibleDialog === 'settings' ? '个人偏好会保存在这个账户和当前设备。' : visibleDialog === 'history' ? (locked ? '正在整理最后的对话…' : `${t.history.length} 句 · 已同步到个人云存档`) : visibleDialog === 'edit' ? `按${language(t.pair[dialogSide])?.label}修改，保存后更新双方译文。` : visibleDialog === 'text' ? '任意语言都可以，会同时转换成双方的语言。' : visibleDialog === 'usage' ? '费用、Token 和会员计费时间均来自云端账户。' : '添加到手机主屏幕，像应用一样打开。'}
      </DialogDescription></DialogHeader>
      <DialogClose render={<Button variant="ghost" className="dialog-close" aria-label="关闭" />}><X /></DialogClose>
      {visibleDialog === 'name' && <form onSubmit={event => { event.preventDefault(); saveName(draftName); }}><label htmlFor="display-name" className="field-label">你的名字 / Your name</label><Input id="display-name" className="app-input" value={draftName} onChange={event => setDraftName(event.target.value)} placeholder="Me" maxLength={24} autoComplete="nickname" /><p className="field-note">只保存在这台设备，下次自动使用。</p><Button type="submit" className="form-submit">{draftName.trim() ? '记住名字，开始对话' : '使用 Me，开始对话'}</Button></form>}
      {visibleDialog === 'ielts' && <section className="ielts-picker" aria-label="雅思成绩参考">
        {IELTS_BANDS.map(band => <button key={band.score} type="button" className={ieltsScore === band.score ? 'selected' : ''} aria-pressed={ieltsScore === band.score} onClick={() => saveIeltsScore(band.score)}>
          <strong><span>IELTS {band.score}</span>{ieltsScore === band.score && <Check aria-label="当前选择" />}</strong><span>{band.cn}</span><small lang="en">{band.en}</small>
        </button>)}
      </section>}
      {visibleDialog === 'password' && <form onSubmit={event => { event.preventDefault(); void changePassword(); }}><fieldset disabled={passwordBusy} className="admin-editor-fields"><PasswordFields id="account-change" current={currentPassword} onCurrent={setCurrentPassword} next={nextPassword} onNext={setNextPassword} confirmation={confirmPassword} onConfirmation={setConfirmPassword} />{formError && <p role="alert" className="form-error">{formError}</p>}<Button type="submit" className="form-submit" disabled={passwordBusy || !currentPassword || nextPassword.length < 8 || !confirmPassword}>{passwordBusy && <LoaderCircle className="spinning" />}保存新密码</Button></fieldset></form>}
      {visibleDialog === 'settings' && <div className="settings-form">
        <div className="profile-setting"><span>{ownName}</span><Button type="button" variant="ghost" onClick={() => open('name')}>修改名字</Button></div>
        <div className="profile-setting profile-score"><span><GraduationCap />{ieltsScore ? `雅思 ${ieltsScore} 分` : '未设定雅思成绩'}</span><Button type="button" variant="ghost" onClick={() => open('ielts')}>设定雅思成绩</Button></div>
        <div className="profile-setting"><span>{account.username} · {account.level.toUpperCase()}</span><strong>剩余 {formatPoints(remaining)}</strong></div><Button variant="outline" onClick={() => open('usage')}>Points breakdown · 积分明细</Button>
        <label className="field-label" htmlFor="layout-mode">页面布局</label>
        <Select value={layoutMode} onValueChange={value => { if (!value) return; const layout = value as LayoutMode; setLayoutMode(layout); try { localStorage.setItem('lucky-layout', layout); } catch {} }}><SelectTrigger id="layout-mode" className="app-input"><SelectValue>{layoutMode === 'face-to-face' ? '面对面 · 双方操作' : '单人 · Listening / Speaking'}</SelectValue></SelectTrigger><SelectContent><SelectItem value="face-to-face">面对面 · 双方操作</SelectItem><SelectItem value="single-operator">单人 · Listening / Speaking</SelectItem></SelectContent></Select>
        <label className="field-label" htmlFor="speech-speed">朗读语速</label>
        <Select value={String(speechSpeed)} onValueChange={value => { if (!value) return; const speed = Number(value); setSpeechSpeed(speed); try { localStorage.setItem('lucky-speech-speed', value); } catch {} }}><SelectTrigger id="speech-speed" className="app-input"><SelectValue>{speechSpeed}×</SelectValue></SelectTrigger><SelectContent>{[.75, 1, 1.5, 2].map(speed => <SelectItem key={speed} value={String(speed)}>{speed}×</SelectItem>)}</SelectContent></Select>
        <details className="inline-help"><summary>Points 使用规则<ChevronDown /></summary><p>翻译和 English Coach 按本次对话的文字量扣除 Points；总结按对应对话的 10% 计算。空闲、等待和失败回复不扣 Points，播放倍速不影响扣费。语音互动的 Token 额度按 2 倍计入；导出不额外扣 Points。</p></details>
        <div className="account-storage"><span>个人云空间</span><strong>{(account.storage.bytes / 1024 / 1024).toFixed(1)} / {(account.storage.limitBytes / 1024 / 1024).toFixed(0)} MB</strong></div>
        <Button type="button" variant="ghost" className="clear-key" onClick={() => void logout()}><LogOut />退出账户</Button>
      </div>}
      {visibleDialog === 'text' && <form onSubmit={event => { event.preventDefault(); if (!draftText.trim()) { setFormError('请输入想说的话'); return; } if (t.submitText(draftText.trim(), dialogSide)) setDialog(null); }}>
        <label className="field-label" htmlFor="typed-text">想说的话</label><Textarea id="typed-text" className="app-input text-input" value={draftText} maxLength={2000} onChange={event => setDraftText(event.target.value)} placeholder="在这里输入…" />
        {formError && <p role="alert" className="form-error">{formError}</p>}<Button type="submit" className="form-submit" disabled={t.pending > 0}>翻译</Button>
      </form>}
      {visibleDialog === 'usage' && <div className="usage-details">{usageRows.map(item => <article key={item.label}><span>{item.label}</span><strong>${(item.cost * account.costMultiplier).toFixed(2)}</strong><small>{item.tokens.toLocaleString()} tokens · 已用 {formatPoints(item.seconds)} · 实际 ${item.cost.toFixed(4)}</small></article>)}<p>显示倍率 <strong>×{account.costMultiplier.toFixed(1)}</strong>。翻译和训练按双方本次对话的文字量扣除 Points；总结按 10% 计算；不受播放倍速影响。语音互动的 Token 额度按 2 倍计入。</p>{formError && <p role="alert">{formError}</p>}{timeLoading ? <p role="status">Loading points breakdown…</p> : <TimeLedger entries={timeEntries} unit="points" />}</div>}
      {visibleDialog === 'edit' && <form className="edit-form" onSubmit={event => { event.preventDefault(); if (!draftText.trim() || editingId === undefined) { setFormError('这句话不能为空'); return; } if (t.retranslate(editingId, draftText.trim())) { setDialog(null); setEditingId(undefined); } }}>
        <label className="field-label" htmlFor="edited-text">当前这句话</label><Textarea id="edited-text" className="app-input edit-input" value={draftText} maxLength={2000} onChange={event => setDraftText(event.target.value)} dir="auto" lang={t.pair[dialogSide]} />
        {formError && <p role="alert" className="form-error">{formError}</p>}<Button type="submit" className="form-submit" disabled={t.pending > 0}>保存并重新翻译</Button>
      </form>}
      {visibleDialog === 'history' && <>{formError && <p role="alert" className="form-error">{formError}</p>}<div className="history-list">{t.history.length ? t.history.map((item, index) => <article className="history-item" key={item.id}><span className={`history-speaker ${item.speaker}`}>{String(index + 1).padStart(2, '0')} · {item.speaker === 'self' ? ownName : 'other speaks'}</span><p lang={item.pair[0]} dir="auto"><small>{language(item.pair[0])?.label}</small>{item.upper}</p><p lang={item.pair[1]} dir="auto"><small>{language(item.pair[1])?.label}</small>{item.lower}</p><details><summary>原文</summary><p dir="auto">{item.original}</p></details></article>) : <p className="history-empty">说出第一句话，对话就从这里开始。</p>}</div>{t.history.length > 0 && <div className="conversation-actions"><Button variant="secondary" onClick={() => void copyConversation()} disabled={locked}><Copy />{copied ? '已复制' : '复制全部'}</Button><Button variant="secondary" onClick={exportConversation} disabled={locked}><Download />导出 TXT</Button><Button variant="ghost" onClick={() => { t.clear(); setDialog(null); }}>清空对话</Button></div>}</>}
      {visibleDialog === 'help' && <div className="help-content">
        <div className="help-row"><ArrowUpFromLine /><div><strong>iPhone / iPad</strong><p>在 Safari 中打开，点“分享”，选择“添加到主屏幕”。</p></div></div>
        <div className="help-row"><Download /><div><strong>安卓手机 / 电脑</strong><p>在 Chrome 中打开，点浏览器菜单，选择“安装应用”或“添加到主屏幕”。</p></div></div>
        {installEvent && <Button className="form-submit" onClick={() => void install()}>添加 Lucky 到桌面</Button>}
        <details className="inline-help"><summary>录音怎么用<ChevronDown /></summary>{layoutMode === 'face-to-face' ? <p>谁说话就长按谁那一侧的按钮，松手后译文会出现在双方完整对话中，并自动用另一侧语言朗读。快速双击开启持续录音，再点一次停止。</p> : <p>在底部选择 Listening 接收对方说话，或选择 Speaking 表达自己的话；再按住圆形按钮录音。快速双击可持续录音，再点一次停止。</p>}<p>识别出的原话会先显示，译文完成后自动播放目标语言。翻译需要联网；切到后台或锁屏会停止录音。播放声音由 AI 生成。</p></details>
      </div>}
    </DialogContent>
  </Dialog>
  </main>;
}

