'use client';

import { PointerEvent, SyntheticEvent, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpenText, Check, Download, GraduationCap, LoaderCircle, MessageCircleHeart, Mic, RotateCcw, Send, Settings2, Sparkles, Square, Target, UserRound, Volume2, WandSparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCoach } from '@/hooks/use-coach';
import { CoachDailySummary, CoachWeeklySummary } from '@/lib/coach';
import { CoachPet } from '@/components/coach-pet';

type CoachController = ReturnType<typeof useCoach>;
type Props = { coach: CoachController; speaking: boolean; initialStage?: 'chat' | 'dashboard'; onBack: () => void; onSettings: () => void; onSpeak: (text: string) => void };
type Stage = 'chat' | 'summarizing' | 'summary' | 'dashboard' | 'practice' | 'done';

function CoachRecordButton({ coach }: { coach: CoachController }) {
  const press = useRef<{ id: number; started: number } | undefined>(undefined);
  const down = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    if (coach.recording) { press.current = undefined; void coach.stopRecording(); return; }
    press.current = { id: event.pointerId, started: performance.now() }; void coach.startRecording();
  };
  const up = (event: PointerEvent<HTMLButtonElement>) => {
    const current = press.current; press.current = undefined;
    if (current?.id === event.pointerId && performance.now() - current.started >= 350) void coach.stopRecording();
  };
  return <Button type="button" className="coach-mic" data-active={coach.recording} disabled={coach.busy} aria-label={coach.recording ? 'Stop recording' : 'Tap to record, or hold to talk'} onPointerDown={down} onPointerUp={up} onPointerCancel={() => { if (press.current) void coach.stopRecording(); press.current = undefined; }} onContextMenu={event => event.preventDefault()}>
    {coach.busy ? <LoaderCircle className="spinning" /> : coach.recording ? <Square fill="currentColor" /> : <Mic />}<span>{coach.recording ? 'Listening…' : 'Speak'}</span>
  </Button>;
}

function RecallTables({ report }: { report: CoachDailySummary | CoachWeeklySummary }) {
  const daily = 'mainFocus' in report ? report : undefined, weekly = 'progress' in report ? report : undefined;
  return <div className="recall-content">
    <section className="recall-intro"><h3><Sparkles/>Your session at a glance</h3><p className="recall-overview">{report.overview}</p></section>
    {(daily?.mainFocus.length || weekly?.progress.length) ? <section><h3><Target/>{daily ? 'What you worked on' : 'What is improving'}</h3><ul>{(daily?.mainFocus || weekly?.progress || []).map(item => <li key={item}>{item}</li>)}</ul></section> : null}
    {weekly?.nextFocus.length ? <section><h3><WandSparkles/>Your next step</h3><ul>{weekly.nextFocus.map(item => <li key={item}>{item}</li>)}</ul></section> : null}
    {daily?.likelyMistakes.length ? <section className="recall-refinements"><h3><MessageCircleHeart/>One thing to refine</h3><p>Only clear language patterns are shown here. Possible recording glitches are left out.</p><div className="recall-mistakes">{daily.likelyMistakes.map(item => <article key={`${item.original}-${item.better}`}><span>{item.original}</span><strong>{item.better}</strong><small>{item.reason}</small></article>)}</div></section> : null}
    {report.vocabulary.length ? <section><h3><BookOpenText/>Words to take with you</h3><div className="recall-table">{report.vocabulary.map(item => <div key={item.word}><strong>{item.word}</strong><span>{item.definition}</span></div>)}</div></section> : null}
    {report.grammar.length ? <section><h3><GraduationCap/>Grammar in use</h3><div className="recall-table grammar">{report.grammar.map(item => <div key={item.point}><strong>{item.point}</strong><span>{item.example}</span></div>)}</div></section> : null}
  </div>;
}

const recallText = (report: CoachDailySummary | CoachWeeklySummary) => {
  const title = 'date' in report ? `${report.date} · Daily Recall` : `${report.startDate} — ${report.endDate} · Weekly Recall`;
  const lines = [title, `${report.minutes} minutes`, '', report.overview];
  if ('mainFocus' in report) {
    lines.push('', 'MAIN FOCUS', ...report.mainFocus.map(item => `• ${item}`));
    if (report.likelyMistakes.length) lines.push('', 'LIKELY CORRECTIONS', ...report.likelyMistakes.map(item => `• ${item.original} → ${item.better}\n  ${item.reason}`));
  } else lines.push('', 'PROGRESS', ...report.progress.map(item => `• ${item}`), '', 'NEXT FOCUS', ...report.nextFocus.map(item => `• ${item}`));
  lines.push('', 'KEY VOCABULARY', ...report.vocabulary.map(item => `${item.word}\t${item.definition}`), '', 'GRAMMAR', ...report.grammar.map(item => `${item.point}\t${item.example}`));
  return lines.join('\n');
};
const exportRecall = (report: CoachDailySummary | CoachWeeklySummary) => {
  const blob = new Blob([recallText(report)], { type: 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `${report.id}.txt`; anchor.click(); URL.revokeObjectURL(url);
};
const highlightedText = (text: string) => text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part);

export function CoachMode({ coach, speaking, initialStage = 'chat', onBack, onSettings, onSpeak }: Props) {
  const [draft, setDraft] = useState(''), [stage, setStage] = useState<Stage>(initialStage), [selectedSummary, setSelectedSummary] = useState<CoachDailySummary>();
  const [question, setQuestion] = useState(0), [answer, setAnswer] = useState(''), [checked, setChecked] = useState(false), [score, setScore] = useState(0);
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => { view.current?.scrollTo({ top: view.current.scrollHeight, behavior: 'smooth' }); }, [coach.history, coach.busy]);
  const submit = (event: SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); const text = draft.trim(); if (!text) return; setDraft(''); void coach.sendText(text); };
  const startPractice = async () => { if (await coach.createPractice()) { setQuestion(0); setAnswer(''); setChecked(false); setScore(0); setStage('practice'); } };
  const summarize = async () => { setStage('summarizing'); const report = await coach.summarizeToday(); if (report) { setSelectedSummary(report); setStage('summary'); } else setStage('chat'); };
  const exercise = coach.practice?.exercises[question];
  const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[.!?]+$/, '');
  const correct = Boolean(exercise && normalize(answer) === normalize(exercise.answer));
  const check = () => { if (!exercise || !answer || checked) return; setChecked(true); if (correct) setScore(value => value + 1); };
  const next = () => { if (!coach.practice || question + 1 >= coach.practice.exercises.length) { setStage('done'); return; } setQuestion(value => value + 1); setAnswer(''); setChecked(false); };
  const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, latestToday = coach.dailySummaries.find(item => item.date === today);

  return <main className="coach-page"><section className="coach-shell">
    <header className="coach-header"><Button variant="ghost" onClick={stage === 'chat' ? onBack : () => setStage('chat')} aria-label="Back"><ArrowLeft /></Button><div><strong>LUCKY</strong><span>English Coach</span></div><Button variant="ghost" onClick={() => setStage('dashboard')} aria-label="Personal learning dashboard"><UserRound /></Button></header>
    {stage === 'chat' && <>
      <div className="coach-main"><CoachPet busy={coach.busy} speaking={speaking} recording={coach.recording} activity={coach.history.length}/><div className="coach-chat" ref={view} aria-live="polite">
        {coach.history.map(message => <article key={message.id} className={`coach-message ${message.role}`}><span>{message.role === 'coach' ? 'Coach' : 'You'}</span><p>{message.role === 'coach' ? highlightedText(message.text) : message.text}</p>{message.role === 'coach' && <Button variant="ghost" className="coach-speak" onClick={() => onSpeak(message.text.replaceAll('**', ''))} aria-label="Read this reply"><Volume2 /></Button>}</article>)}
        {coach.busy && <div className="coach-thinking"><LoaderCircle className="spinning" /> Thinking…</div>}
      </div></div>
      {coach.tip && <p className="coach-tip"><strong>Quick tip</strong> {coach.tip}</p>}{coach.error && <p className="coach-error" role="alert">{coach.error}</p>}
      <form className="coach-compose" onSubmit={submit}><Input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Say something in English…" maxLength={2000} disabled={coach.busy || coach.recording} aria-label="Your English reply"/><Button type="submit" variant="secondary" disabled={!draft.trim() || coach.busy || coach.recording} aria-label="Send"><Send /></Button></form>
      <Button variant="ghost" className="coach-summary-button" disabled={coach.busy || coach.recording || coach.history.length < 2} onClick={() => void summarize()}>总结今天的对话</Button>
      <div className="coach-actions"><CoachRecordButton coach={coach}/><Button variant="outline" className="coach-end" disabled={coach.busy || coach.recording || coach.history.length < 2} onClick={() => void summarize()}>End conversation</Button></div>
      <p className="coach-record-hint">Tap to keep recording · Hold and release to send</p>
    </>}
    {stage === 'summarizing' && <section className="coach-offer"><LoaderCircle className="summary-spinner spinning"/><h1>Creating today’s recall…</h1><p>Lucky is finding your key vocabulary, grammar and next focus.</p></section>}
    {stage === 'summary' && selectedSummary && <section className="coach-summary"><header><div><small>DAILY RECALL · {selectedSummary.date}</small><h1><Sparkles/>Your conversation, in focus</h1><span>{selectedSummary.minutes} min</span></div><Button variant="ghost" onClick={() => exportRecall(selectedSummary)} aria-label="Export today’s recall"><Download/>Export</Button></header><RecallTables report={selectedSummary}/><div className="summary-actions"><Button onClick={() => void startPractice()} disabled={coach.busy}>{coach.busy ? <LoaderCircle className="spinning"/> : 'Practise this conversation'}</Button><Button variant="outline" onClick={() => { coach.clearSession(); setStage('chat'); void coach.beginSession(); }}>New conversation</Button></div></section>}
    {stage === 'dashboard' && <section className="coach-dashboard"><header><div><small>PERSONAL CENTER</small><h1>Your learning</h1></div><Button variant="ghost" onClick={onSettings}><Settings2/>设置</Button></header><div className="coach-stats"><article><strong>{Math.max(0, Math.round(coach.todaySeconds / 60))}</strong><span>minutes today</span></article><article><strong>{coach.dailySummaries.length}</strong><span>daily recalls</span></article><article><strong>{coach.weeklySummaries.length}</strong><span>weekly recalls</span></article></div>
      {latestToday ? <details className="recall-record" open><summary><span>Today · {latestToday.date}</span><strong>{latestToday.minutes} min</strong></summary><RecallTables report={latestToday}/><Button variant="ghost" onClick={() => exportRecall(latestToday)}><Download/>Export TXT</Button></details> : <div className="empty-recall"><p>今天还没有总结。</p><Button disabled={coach.history.length < 2 || coach.busy} onClick={() => void summarize()}>总结今天的对话</Button></div>}
      {coach.dailySummaries.filter(item => item.id !== latestToday?.id).map(item => <details className="recall-record" key={item.id}><summary><span>{item.date} · Daily Recall</span><strong>{item.minutes} min</strong></summary><RecallTables report={item}/><Button variant="ghost" onClick={() => exportRecall(item)}><Download/>Export TXT</Button></details>)}
      {coach.weeklySummaries.map(item => <details className="recall-record weekly" key={item.id}><summary><span>{item.startDate} — {item.endDate} · Weekly Recall</span><strong>{item.minutes} min</strong></summary><RecallTables report={item}/><Button variant="ghost" onClick={() => exportRecall(item)}><Download/>Export TXT</Button></details>)}
    </section>}
    {stage === 'practice' && exercise && <section className="practice-card"><header><span>{question + 1} / {coach.practice?.exercises.length}</span><small>{exercise.type === 'cloze' ? 'Vocabulary · Fill in the blank' : exercise.type === 'meaning' ? 'Vocabulary · Meaning' : 'Grammar'}</small></header><h1>{exercise.prompt}</h1>{exercise.type === 'cloze' && <p className="word-clue"><strong>Starts with “{exercise.initial}”</strong>{exercise.definition}</p>}{exercise.options.length > 0 ? <div className="practice-options">{exercise.options.map(option => <Button key={option} type="button" variant="outline" data-selected={answer === option} disabled={checked} onClick={() => setAnswer(option)}>{option}</Button>)}</div> : <Input value={answer} onChange={event => setAnswer(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); check(); } }} placeholder={`${exercise.initial}…`} autoCapitalize="none"/>}{checked && <div className={`practice-feedback ${correct ? 'correct' : 'wrong'}`}><strong>{correct ? 'Correct!' : `Answer: ${exercise.answer}`}</strong><p>{exercise.explanation}</p></div>}<div className="practice-actions"><Button variant="ghost" onClick={() => setStage('summary')}><X/>Exit</Button>{checked ? <Button onClick={next}>{question + 1 >= (coach.practice?.exercises.length || 0) ? 'See result' : 'Next'}</Button> : <Button onClick={check} disabled={!answer}>Check answer</Button>}</div></section>}
    {stage === 'done' && <section className="coach-offer"><span className="practice-mark"><Check /></span><h1>{score} / {coach.practice?.exercises.length}</h1><p>You practised words and grammar from your own conversation.</p><Button onClick={() => { coach.clearSession(); setStage('chat'); void coach.beginSession(); }}><RotateCcw/>New conversation</Button><Button variant="ghost" onClick={() => setStage('dashboard')}>View learning history</Button></section>}
  </section></main>;
}
