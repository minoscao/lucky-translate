'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, ArrowUpFromLine, Check, ChevronDown, ChevronUp, CircleHelp, Copy, Download, History, Keyboard, LoaderCircle, LockKeyhole, Mic, Settings2, ShieldCheck, Square, Volume2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { INTERFACE_COPY } from '@/lib/interface-copy';
import { useTranslator } from '@/hooks/use-translator';
import { LANGUAGES, LanguageCode, Pair, conversationText, language, selectLanguage, transcriptForLanguage } from '@/lib/translation';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
function RecordButton({ controller: t, side }: { controller: ReturnType<typeof useTranslator>; side: 0 | 1 }) {
  const [pressed, setPressed] = useState(false);
  const keyHeld = useRef(false), pointerHeld = useRef(false);
  const isRecording = t.mode !== 'idle';
  const stopTouch = () => { pointerHeld.current = false; setPressed(false); void t.stop(); };
  const state = t.phase === 'permission' ? 'permission' : t.mode;
  const primary = INTERFACE_COPY[t.pair[side]][state];
  const secondary = INTERFACE_COPY[t.pair[1 - side]][state];
  return <div className="record-area">
        <Button className="record-button" data-mode={t.mode} data-pressed={pressed} aria-pressed={isRecording} aria-label={primary} disabled={t.phase === 'stopping'}
          onContextMenu={event => event.preventDefault()}
          onPointerDown={event => { if (t.pointerDown(event)) { pointerHeld.current = true; setPressed(true); } }}
          onPointerUp={event => { pointerHeld.current = false; setPressed(false); t.pointerUp(event); }}
          onPointerCancel={() => { if (pointerHeld.current) stopTouch(); }}
          onLostPointerCapture={() => { if (pointerHeld.current) stopTouch(); }}
          onPointerMove={event => { if (!pressed) return; const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left - 28 || event.clientX > rect.right + 28 || event.clientY < rect.top - 28 || event.clientY > rect.bottom + 28) stopTouch(); }}
          onClick={event => { if (event.detail === 0) t.toggle(); }}
          onKeyDown={event => { if (event.key === ' ') { event.preventDefault(); if (!event.repeat && !keyHeld.current) { keyHeld.current = true; setPressed(true); t.toggle(); } } else if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) t.toggle(); } else if (event.key === 'Escape') stopTouch(); }}
          onKeyUp={event => { if (event.key === ' ') { event.preventDefault(); keyHeld.current = false; stopTouch(); } }}
          onBlur={() => { if (keyHeld.current) { keyHeld.current = false; stopTouch(); } }}>
          {t.phase === 'permission' ? <LoaderCircle className="spinning" /> : t.mode === 'continuous' ? <Square fill="currentColor" /> : <Mic />}
          <span className="button-copy"><span lang={t.pair[side]} dir="auto">{primary}</span><small lang={t.pair[1 - side]} dir="auto">{secondary}</small></span>
          {t.mode === 'continuous' && <LockKeyhole className="lock-icon" />}
        </Button>
        <div className="meter" aria-hidden="true">{Array.from({ length: 25 }, (_, index) => <i key={index} style={{ height: `${3 + t.level * (4 + Math.abs(Math.sin(index * 1.8)) * 14)}px` }} />)}</div>
      </div>;
}

type PanelProps = {
  controller: ReturnType<typeof useTranslator>; onHistory: () => void;
  usage: { tokens: number; cost: number }; multiplier: number;
  side: 0 | 1; isSelf: boolean; ownName: string; pair: Pair; entries: { id: number; text: string }[]; locked: boolean; canSpeak: boolean;
  onLanguage: (pair: Pair) => void; onType: () => void; onEdit: (id: number, text: string) => void; onSpeak: () => void; onCopy: () => void;
};
function LanguagePanel({ controller, onHistory, usage, multiplier, side, isSelf, ownName, pair, entries, locked, canSpeak, onLanguage, onType, onEdit, onSpeak, onCopy }: PanelProps) {
  const viewport = useRef<HTMLElement>(null), following = useRef(true), previousLanguage = useRef(pair[side]);
  const [bounds, setBounds] = useState({ top: true, bottom: true });
  const text = entries.at(-1)?.text;
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
  return <section className={`language-panel ${isSelf ? 'self' : 'partner'} ${side === 0 ? 'facing-away' : ''}`} style={{ gridRow: side === 0 ? 1 : 3 }} aria-label={isSelf ? '你的翻译区' : '对方的翻译区'}>
    <header className="panel-head">
      <span className="side-label"><span className="side-dot" />{isSelf ? ownName : 'other speaks'}{isSelf && <Button variant="ghost" className="history-entry" onClick={onHistory} aria-label="查看完整对话"><History /><span>完整对话</span></Button>}</span>
      {isSelf && <output className="usage-meter" aria-label={`本次使用 ${usage.tokens} tokens，显示金额 ${(usage.cost * multiplier).toFixed(2)} 美元，倍率 ${multiplier}`}><strong>${(usage.cost * multiplier).toFixed(2)}</strong><span>{usage.tokens.toLocaleString()} tokens · ×{multiplier.toFixed(1)}</span></output>}
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
          {entries.length ? entries.map((item, index) => <button type="button" key={item.id} className={`transcript-line ${index === entries.length - 1 ? 'current' : 'previous'}`} dir="auto" onClick={() => onEdit(item.id, item.text)} disabled={locked} aria-label="修改并重新翻译这句话">{item.text}</button>) : <p className="transcript-line current empty">{INTERFACE_COPY[pair[side]].ready}</p>}
        </div>
      </section>
      <nav className="transcript-nav" aria-label="翻阅对话"><Button variant="ghost" disabled={bounds.top} onClick={() => scroll(-1)} aria-label="向上查看较早对话" title="上一页"><ChevronUp /></Button><Button variant="ghost" disabled={bounds.bottom} onClick={() => scroll(1)} aria-label="向下查看后续对话" title="下一页"><ChevronDown /></Button></nav>
    </div>
    <RecordButton controller={controller} side={side} />
    <footer className="panel-foot">
      <Button variant="ghost" className="text-action" onClick={onType} disabled={locked}><Keyboard />{INTERFACE_COPY[pair[side]].type}</Button>
      <div className="panel-actions">
        <Button variant="ghost" onClick={onCopy} disabled={!text} aria-label="复制译文" title="复制译文"><Copy /></Button>
        <Button variant="ghost" onClick={onSpeak} disabled={!text || !canSpeak || locked} aria-label="朗读译文" title="朗读译文"><Volume2 /></Button>
      </div>
    </footer>
  </section>;
}

export default function Home() {
  const t = useTranslator();
  const [access, setAccess] = useState<'checking' | 'locked' | 'unlocked'>('checking');
  const [accessPassword, setAccessPassword] = useState(''), [accessError, setAccessError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [dialog, setDialog] = useState<'settings' | 'help' | 'history' | 'text' | 'edit' | 'name' | null>(null);
  const [dialogSide, setDialogSide] = useState<0 | 1>(1);
  const [draftKey, setDraftKey] = useState(''), [draftText, setDraftText] = useState(''), [draftMultiplier, setDraftMultiplier] = useState('1.0');
  const [formError, setFormError] = useState(''), [copied, setCopied] = useState(false);
  const [installed, setInstalled] = useState(false), [installEvent, setInstallEvent] = useState<InstallEvent>();
  const [canSpeak, setCanSpeak] = useState(false), [speaking, setSpeaking] = useState(false);
  const [ownName, setOwnName] = useState('Me'), [draftName, setDraftName] = useState('');
  const [editingId, setEditingId] = useState<number>();
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const locked = t.mode !== 'idle' || t.phase !== 'ready' || t.pending > 0;
  const panelEntries = useMemo(() => [transcriptForLanguage(t.history, t.pair[0]), transcriptForLanguage(t.history, t.pair[1])], [t.history, t.pair]);
  const visibleDialog = t.needsSettings ? 'settings' : dialog;
  useEffect(() => {
    void fetch('/api/unlock', { credentials: 'same-origin' }).then(response => response.json()).then(data => setAccess((data as { unlocked?: boolean }).unlocked ? 'unlocked' : 'locked')).catch(() => { setAccess('locked'); setAccessError('无法检查访问状态，请刷新后重试'); });
    queueMicrotask(() => { setCanSpeak('speechSynthesis' in window); setInstalled(window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)); });
    queueMicrotask(() => { try { const profile = JSON.parse(localStorage.getItem('lucky-profile') || 'null'); if (typeof profile?.name === 'string') { setOwnName(profile.name.trim().slice(0, 24) || 'Me'); return; } } catch {} setDialog('name'); });
    const before = (event: Event) => { event.preventDefault(); setInstallEvent(event as InstallEvent); };
    const installedHandler = () => { setInstalled(true); setInstallEvent(undefined); };
    window.addEventListener('beforeinstallprompt', before); window.addEventListener('appinstalled', installedHandler);
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => { window.removeEventListener('beforeinstallprompt', before); window.removeEventListener('appinstalled', installedHandler); clearTimeout(copyTimer.current); };
  }, []);
  const open = (name: NonNullable<typeof dialog>, side: 0 | 1 = 1) => {
    void t.stop(); t.setNeedsSettings(false); setDialogSide(side); setFormError('');
    if (name === 'settings') { setDraftKey(t.credential); setDraftMultiplier(t.multiplier.toFixed(1)); }
    if (name === 'name') setDraftName(ownName === 'Me' ? '' : ownName);
    setDialog(name);
  };
  const saveName = (value: string) => { const name = value.trim().slice(0, 24) || 'Me'; setOwnName(name); try { localStorage.setItem('lucky-profile', JSON.stringify({ name })); } catch {} setDialog(null); };
  const editSentence = (side: 0 | 1, id: number, text: string) => { setEditingId(id); setDraftText(text); open('edit', side); };
  const speak = (side: 0 | 1) => {
    const text = panelEntries[side].at(-1)?.text; if (!text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = t.pair[side];
    const voices = window.speechSynthesis.getVoices();
    const match = voices.find(voice => voice.lang.toLowerCase().replace('_', '-') === t.pair[side].toLowerCase()) || voices.find(voice => voice.lang.split('-')[0] === t.pair[side].split('-')[0]);
    if (voices.length && !match) { t.setError('设备尚未安装这种语言的声音，请在系统语音设置中下载'); return; }
    if (match) utterance.voice = match;
    utterance.onstart = () => setSpeaking(true); utterance.onend = () => setSpeaking(false);
    utterance.onerror = event => { setSpeaking(false); if (event.error !== 'interrupted' && event.error !== 'canceled') t.setError('朗读失败，请检查设备的语音设置'); };
    window.speechSynthesis.speak(utterance);
  };
  const copy = async (side: 0 | 1) => {
    const text = panelEntries[side].at(-1)?.text; if (!text) return;
    try { await navigator.clipboard.writeText(text); setCopied(true); clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 1800); }
    catch { t.setError('复制失败，可以长按译文选择复制'); }
  };
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
  const unlock = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!accessPassword || unlocking) return;
    setUnlocking(true); setAccessError('');
    try {
      const response = await fetch('/api/unlock', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: accessPassword }) });
      const data = await response.json().catch(() => ({})) as { error?: string; unlocked?: boolean };
      if (!response.ok || !data.unlocked) throw new Error(data.error || '暂时无法进入，请稍后重试');
      setAccessPassword(''); setAccess('unlocked');
    } catch (cause) { setAccessError(cause instanceof Error ? cause.message : '暂时无法进入，请稍后重试'); }
    finally { setUnlocking(false); }
  };
  const install = async () => {
    if (!installEvent) { open('help'); return; }
    await t.stop(); await installEvent.prompt(); const result = await installEvent.userChoice;
    if (result.outcome === 'accepted') setInstallEvent(undefined);
  };
  const status = t.error || (t.phase === 'permission' ? '请允许使用麦克风…' : t.phase === 'listening' ? (t.pending ? '正在聆听 · 译文即将出现' : '正在聆听，双方都可以说话') : t.phase === 'stopping' ? '正在结束录音…' : t.pending ? `正在翻译${t.pending > 1 ? ` · ${t.pending} 句` : ''}` : t.notice || '理解上下文 · 双向翻译');
  if (access !== 'unlocked') return <main className="access-page"><section className="access-card" aria-busy={access === 'checking'}>
    <div className="access-mark"><ShieldCheck /></div><h1>Lucky 同声翻译</h1>
    {access === 'checking' ? <p><LoaderCircle className="spinning" />正在检查访问权限…</p> : <form onSubmit={unlock}>
      <label className="field-label" htmlFor="site-password">请输入访问密码</label>
      <Input id="site-password" type="password" className="app-input" value={accessPassword} onChange={event => setAccessPassword(event.target.value)} autoComplete="current-password" maxLength={128} />
      {accessError && <p role="alert" className="form-error">{accessError}</p>}
      <Button type="submit" className="form-submit" disabled={!accessPassword || unlocking}>{unlocking ? <><LoaderCircle className="spinning" />正在验证</> : '进入网站'}</Button>
    </form>}
  </section></main>;
  return <main className="translator"><div className="app-frame">
    {([0, 1] as const).map(side => <LanguagePanel key={side} controller={t} onHistory={() => open('history')} usage={t.usage} multiplier={t.multiplier} side={side} isSelf={t.selfOnTop ? side === 0 : side === 1} ownName={ownName} pair={t.pair} entries={panelEntries[side]} locked={locked} canSpeak={canSpeak} onLanguage={t.changePair} onType={() => { setDraftText(''); open('text', side); }} onEdit={(id, text) => editSentence(side, id, text)} onSpeak={() => speak(side)} onCopy={() => void copy(side)} />)}
    <section className="control-deck" aria-label="录音控制">
      <div className="deck-top"><Button variant="outline" className="side-swap" onClick={() => t.swapSides()} disabled={locked} aria-label="上下切换双方位置" title="上下切换"><ArrowDownUp /><span>切换</span></Button><h1 className="wordmark">LUCKY<span>同声翻译</span></h1><div className="deck-actions">
        <Button variant="ghost" onClick={() => open('history')} aria-label="对话记录" title="对话记录"><History /></Button>
        <Button variant="ghost" onClick={() => open('settings')} aria-label="翻译设置" title="设置"><Settings2 /></Button>
      </div></div>
      <output className={`status-line ${t.error ? 'has-error' : ''}`} aria-live="polite">{t.pending > 0 && !t.error && <LoaderCircle className="spinning" />}<span>{status}</span></output>
      {t.failed && <Button variant="outline" className="retry-button" disabled={locked} onClick={t.retry}>重试上一句</Button>}
    </section>
    <footer className="app-footer"><span className="connection-label"><i data-ready={Boolean(t.credential)} />{t.credential ? '服务已设置' : '尚未连接翻译服务'}</span><div>
      {!installed && <Button variant="ghost" onClick={() => void install()} className="install-action"><Download />添加到桌面</Button>}
      <Button variant="ghost" aria-label="使用帮助" onClick={() => open('help')}><CircleHelp /></Button>
    </div></footer>
    {copied && <output className="copy-toast"><Check />已复制</output>}
    {speaking && <Button variant="secondary" className="speech-stop" onClick={() => { window.speechSynthesis.cancel(); setSpeaking(false); }}><Square />停止朗读</Button>}
  </div>
  <Dialog open={visibleDialog !== null} onOpenChange={value => { if (!value) { if (visibleDialog === 'name') saveName(ownName); else setDialog(null); t.setNeedsSettings(false); } }}>
    <DialogContent className={`app-dialog ${visibleDialog === 'history' ? 'conversation-dialog' : ''} ${visibleDialog === 'edit' ? 'edit-dialog' : ''} ${dialogSide === 0 && !t.needsSettings && !['history', 'edit'].includes(visibleDialog || '') ? 'upside-down' : ''}`} showCloseButton={false}>
      <DialogHeader><DialogTitle>{visibleDialog === 'name' ? '怎么称呼你？' : visibleDialog === 'settings' ? '连接翻译服务' : visibleDialog === 'history' ? '完整对话' : visibleDialog === 'edit' ? '修改当前这句' : visibleDialog === 'text' ? '输入文字' : '随时打开，面对面聊'}</DialogTitle><DialogDescription>
        {visibleDialog === 'name' ? 'What should we call you?' : visibleDialog === 'settings' ? '使用你自己的服务密钥开启语音识别和翻译。' : visibleDialog === 'history' ? (locked ? '正在整理最后的对话…' : `${t.history.length} 句 · 仅保留在本次页面中`) : visibleDialog === 'edit' ? `按${language(t.pair[dialogSide])?.label}修改，保存后更新双方译文。` : visibleDialog === 'text' ? '任意语言都可以，会同时转换成双方的语言。' : '添加到手机主屏幕，像应用一样打开。'}
      </DialogDescription></DialogHeader>
      <DialogClose render={<Button variant="ghost" className="dialog-close" aria-label="关闭" />}><X /></DialogClose>
      {visibleDialog === 'name' && <form onSubmit={event => { event.preventDefault(); saveName(draftName); }}><label htmlFor="display-name" className="field-label">你的名字 / Your name</label><Input id="display-name" className="app-input" value={draftName} onChange={event => setDraftName(event.target.value)} placeholder="Me" maxLength={24} autoComplete="nickname" /><p className="field-note">只保存在这台设备，下次自动使用。</p><Button type="submit" className="form-submit">{draftName.trim() ? '记住名字，开始对话' : '使用 Me，开始对话'}</Button></form>}
      {visibleDialog === 'settings' && <form onSubmit={event => { event.preventDefault(); const nextMultiplier = Number(draftMultiplier); if (!draftKey.trim() || /[\r\n]/.test(draftKey) || draftKey.length > 512) { setFormError('请填写有效的服务密钥'); return; } if (!Number.isFinite(nextMultiplier) || nextMultiplier < .1 || nextMultiplier > 100) { setFormError('倍率请输入 0.1 到 100'); return; } t.setMultiplier(nextMultiplier); t.setCredential(draftKey); t.setNeedsSettings(false); setDialog(null); }}>
        <div className="profile-setting"><span>{ownName}</span><Button type="button" variant="ghost" onClick={() => open('name')}>修改名字</Button></div>
        <label className="field-label" htmlFor="service-key">OpenAI 服务密钥</label>
        <Input id="service-key" type="password" value={draftKey} onChange={event => setDraftKey(event.target.value)} autoComplete="off" placeholder="sk-…" className="app-input" />
        <p className="field-note">密钥保存在这台设备的浏览器中，下次打开会自动使用。录音发送至 OpenAI 进行识别和翻译。</p>
        <label className="field-label" htmlFor="price-multiplier">费用显示倍率</label>
        <Input id="price-multiplier" type="number" inputMode="decimal" min="0.1" max="100" step="0.1" value={draftMultiplier} onChange={event => setDraftMultiplier(event.target.value)} className="app-input" />
        <p className="field-note">当前为 ×{t.multiplier.toFixed(1)}。例如实际费用 $1.00，倍率 2.0 时显示 $2.00。</p>
        <details className="inline-help"><summary>轻量模型与费用<ChevronDown /></summary><p>优先使用 gpt-4o-mini；仅在模型停用或不可用时，依次尝试 gpt-4.1-nano、gpt-5-nano。不会调用 6.0 或自动升级到大型模型。</p><p>语音识别优先用 gpt-4o-mini-transcribe，不可用时用 whisper-1。需要有可用额度的 OpenAI API 密钥，费用由该账户承担。网页不保存录音和对话。</p></details>
        {formError && <p role="alert" className="form-error">{formError}</p>}
        <div className="credential-actions"><Button type="submit" className="form-submit">保存到本设备并开始</Button>{t.credential && <Button type="button" variant="ghost" className="clear-key" onClick={() => { t.clearCredential(); setDraftKey(''); }}>清除已保存密钥</Button>}<Button type="button" variant="ghost" className="clear-key" onClick={() => { void fetch('/api/unlock', { method: 'DELETE', credentials: 'same-origin' }); setDialog(null); setAccess('locked'); }}>锁定网站</Button></div>
      </form>}
      {visibleDialog === 'text' && <form onSubmit={event => { event.preventDefault(); if (!draftText.trim()) { setFormError('请输入想说的话'); return; } if (t.submitText(draftText.trim())) setDialog(null); }}>
        <label className="field-label" htmlFor="typed-text">想说的话</label><Textarea id="typed-text" className="app-input text-input" value={draftText} maxLength={2000} onChange={event => setDraftText(event.target.value)} placeholder="在这里输入…" />
        {formError && <p role="alert" className="form-error">{formError}</p>}<Button type="submit" className="form-submit" disabled={t.pending > 0}>翻译</Button>
      </form>}
      {visibleDialog === 'edit' && <form className="edit-form" onSubmit={event => { event.preventDefault(); if (!draftText.trim() || editingId === undefined) { setFormError('这句话不能为空'); return; } if (t.retranslate(editingId, draftText.trim())) { setDialog(null); setEditingId(undefined); } }}>
        <label className="field-label" htmlFor="edited-text">当前这句话</label><Textarea id="edited-text" className="app-input edit-input" value={draftText} maxLength={2000} onChange={event => setDraftText(event.target.value)} dir="auto" lang={t.pair[dialogSide]} />
        {formError && <p role="alert" className="form-error">{formError}</p>}<Button type="submit" className="form-submit" disabled={t.pending > 0}>保存并重新翻译</Button>
      </form>}
      {visibleDialog === 'history' && <>{formError && <p role="alert" className="form-error">{formError}</p>}<div className="history-list">{t.history.length ? t.history.map((item, index) => <article className="history-item" key={item.id}><span>{String(index + 1).padStart(2, '0')} · {language(item.pair[0])?.label} / {language(item.pair[1])?.label}</span><p lang={item.pair[0]} dir="auto">{item.upper}</p><p lang={item.pair[1]} dir="auto">{item.lower}</p><details><summary>原文</summary><p dir="auto">{item.original}</p></details></article>) : <p className="history-empty">说出第一句话，对话就从这里开始。</p>}</div>{t.history.length > 0 && <div className="conversation-actions"><Button variant="secondary" onClick={() => void copyConversation()} disabled={locked}><Copy />{copied ? '已复制' : '复制全部'}</Button><Button variant="secondary" onClick={exportConversation} disabled={locked}><Download />导出 TXT</Button><Button variant="ghost" onClick={() => { t.clear(); setDialog(null); }}>清空对话</Button></div>}</>}
      {visibleDialog === 'help' && <div className="help-content">
        <div className="help-row"><ArrowUpFromLine /><div><strong>iPhone / iPad</strong><p>在 Safari 中打开，点“分享”，选择“添加到主屏幕”。</p></div></div>
        <div className="help-row"><Download /><div><strong>安卓手机 / 电脑</strong><p>在 Chrome 中打开，点浏览器菜单，选择“安装应用”或“添加到主屏幕”。</p></div></div>
        {installEvent && <Button className="form-submit" onClick={() => void install()}>添加 Lucky 到桌面</Button>}
        <details className="inline-help"><summary>录音怎么用<ChevronDown /></summary><p>长按按钮，按住说话、松手停止；快速双击开启持续录音，再点一次停止。双方都能说话，停顿后逐句显示翻译。上半屏倒转，面对面就能阅读。</p><p>翻译需要联网。切到后台或锁屏会停止录音。朗读时请先停止录音，避免把译文再次收进去。</p></details>
      </div>}
    </DialogContent>
  </Dialog>
  </main>;
}

