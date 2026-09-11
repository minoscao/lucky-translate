'use client';

import { SyntheticEvent, useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpenText, Check, Download, GraduationCap, KeyRound, LoaderCircle, MessageCircleHeart, RotateCcw, Send, Settings2, Sparkles, Target, UserRound, Volume2, WandSparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCoach } from '@/hooks/use-coach';
import { CoachDailySummary, CoachWeeklySummary } from '@/lib/coach';
import { RecordButton } from '@/components/record-button';
import { CoachPet } from '@/components/coach-pet';
import { HighlightedText } from '@/components/highlighted-text';
import { grammarHighlights } from '@/lib/text-highlights';

type CoachController = ReturnType<typeof useCoach>;
type Props = { coach: CoachController; speaking: boolean; ieltsScore?: number; initialStage?: 'chat' | 'dashboard'; onBack: () => void; onSettings: () => void; onIelts: () => void; onSecurity: () => void; onLogout: () => void; onHowItWorks: () => void; onStopSpeech: () => void; onSpeak: (text: string) => void };
type Stage = 'chat' | 'paused' | 'summarizing' | 'summary' | 'dashboard' | 'practice' | 'done';

function RecallTables({ report }: { report: CoachDailySummary | CoachWeeklySummary }) {
  const daily = 'mainFocus' in report ? report : undefined, weekly = 'progress' in report ? report : undefined, confirmedMistakes = daily?.likelyMistakes.filter(item => item.confidence === 'confirmed') || [];
  return <div className="recall-content">
    <section className="recall-intro"><h3><Sparkles/>Your session at a glance</h3><p className="recall-overview">{report.overview}</p></section>
    {(daily?.mainFocus.length || weekly?.progress.length) ? <section><h3><Target/>{daily ? 'What you worked on' : 'What is improving'}</h3><ul>{(daily?.mainFocus || weekly?.progress || []).map(item => <li key={item}>{item}</li>)}</ul></section> : null}
    {weekly?.nextFocus.length ? <section><h3><WandSparkles/>Your next step</h3><ul>{weekly.nextFocus.map(item => <li key={item}>{item}</li>)}</ul></section> : null}
    {confirmedMistakes.length ? <section className="recall-refinements"><h3><MessageCircleHeart/>One thing to refine</h3><p>Only clear language patterns are shown here. Possible recording glitches are left out.</p><div className="recall-mistakes">{confirmedMistakes.map(item => <article key={`${item.original}-${item.better}`}><span>{item.original}</span><strong>{item.better}</strong><small>{item.reason}</small></article>)}</div></section> : null}
    {report.vocabulary.length ? <section><h3><BookOpenText/>Words to take with you</h3><div className="recall-table">{report.vocabulary.map(item => <div key={item.word}><strong>{item.word}</strong><span>{item.definition}</span></div>)}</div></section> : null}
    {report.grammar.length ? <section><h3><GraduationCap/>Grammar in use</h3><div className="recall-table grammar">{report.grammar.map(item => <div key={item.point}><strong>{item.point}</strong><span><HighlightedText text={item.example} highlights={grammarHighlights(item)} variant="study" /></span></div>)}</div></section> : null}
  </div>;
}

const recallText = (report: CoachDailySummary | CoachWeeklySummary) => {
  const title = 'date' in report ? `${report.date} · Daily Recall` : `${report.startDate} — ${report.endDate} · Weekly Recall`;
  const lines = [title, `${report.minutes} minutes`, '', report.overview];
  if ('mainFocus' in report) {
    lines.push('', 'MAIN FOCUS', ...report.mainFocus.map(item => `• ${item}`));
    const confirmed = report.likelyMistakes.filter(item => item.confidence === 'confirmed');
    if (confirmed.length) lines.push('', 'ONE THING TO REFINE', ...confirmed.map(item => `• ${item.original} → ${item.better}\n  ${item.reason}`));
  } else lines.push('', 'PROGRESS', ...report.progress.map(item => `• ${item}`), '', 'NEXT FOCUS', ...report.nextFocus.map(item => `• ${item}`));
  lines.push('', 'KEY VOCABULARY', ...report.vocabulary.map(item => `${item.word}\t${item.definition}`), '', 'GRAMMAR', ...report.grammar.map(item => `${item.point}\t${item.example}`));
  return lines.join('\n');
};
const exportRecall = (report: CoachDailySummary | CoachWeeklySummary) => {
  const blob = new Blob([recallText(report)], { type: 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = `${report.id}.txt`; anchor.click(); URL.revokeObjectURL(url);
};
const highlightedText = (text: string) => <HighlightedText text={text} />;

export function CoachMode({ coach, speaking, ieltsScore, initialStage = 'chat', onBack, onSettings, onIelts, onSecurity, onLogout, onHowItWorks, onStopSpeech, onSpeak }: Props) {
  const [draft, setDraft] = useState(''), [stage, setStage] = useState<Stage>(initialStage), [selectedSummary, setSelectedSummary] = useState<CoachDailySummary>();
  const [question, setQuestion] = useState(0), [answer, setAnswer] = useState(''), [checked, setChecked] = useState(false), [score, setScore] = useState(0);
  const view = useRef<HTMLDivElement>(null);
  const assessmentRequested = useRef(false);
  useEffect(() => { view.current?.scrollTo({ top: view.current.scrollHeight, behavior: 'smooth' }); }, [coach.history, coach.busy]);
  const submit = (event: SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); const text = draft.trim(); if (!text) return; setDraft(''); void coach.sendText(text); };
  const startPractice = async () => { if (await coach.createPractice()) { setQuestion(0); setAnswer(''); setChecked(false); setScore(0); setStage('practice'); } };
  const summarize = async () => { setStage('summarizing'); const report = await coach.summarizeToday(); if (report) { setSelectedSummary(report); setStage('summary'); } else setStage('chat'); };
  const pause = () => { onStopSpeech(); coach.cancel(); coach.setError(''); setStage('paused'); };
  const exercise = coach.practice?.exercises[question];
  const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[.!?]+$/, '');
  const correct = Boolean(exercise && normalize(answer) === normalize(exercise.answer));
  const check = () => { if (!exercise || !answer || checked) return; setChecked(true); if (correct) setScore(value => value + 1); };
  const next = () => { if (!coach.practice || question + 1 >= coach.practice.exercises.length) { setStage('done'); return; } setQuestion(value => value + 1); setAnswer(''); setChecked(false); };
  const now = new Date(), today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, latestToday = coach.dailySummaries.find(item => item.date === today);
  useEffect(() => { if (stage === 'dashboard' && coach.eligibleForAssessment && !coach.latestAssessment && !coach.busy && !assessmentRequested.current) { assessmentRequested.current = true; void coach.evaluateLevel(); } }, [stage, coach]);

  return <main className="coach-page"><section className="coach-shell">
    <header className="coach-header"><Button variant="ghost" onClick={stage === 'chat' ? onBack : () => setStage('chat')} aria-label="Back"><ArrowLeft /></Button><div><strong>LUCKY</strong><span>English Coach</span></div><Button variant="ghost" onClick={() => setStage('dashboard')} aria-label="Personal learning dashboard"><UserRound /></Button></header>
    {stage === 'chat' && <>
      <div className="coach-main"><CoachPet busy={coach.busy} speaking={speaking} recording={coach.recording} activity={coach.history.length}/><div className="coach-chat" ref={view} aria-live="polite">
        {coach.history.map(message => <article key={message.id} className={`coach-message ${message.role}`}><span>{message.role === 'coach' ? 'Coach' : 'You'}</span><p>{message.role === 'coach' ? highlightedText(message.text) : message.text}</p>{message.role === 'coach' && <Button variant="ghost" className="coach-speak" onClick={() => onSpeak(message.text.replaceAll('**', ''))} aria-label="Read this reply"><Volume2 /></Button>}</article>)}
        {coach.busy && <div className="coach-thinking"><LoaderCircle className="spinning" /> Thinking…</div>}
      </div></div>
      {coach.tip && <p className="coach-tip"><strong>Quick tip</strong> {coach.tip}</p>}{coach.error && <p className="coach-error" role="alert">{coach.error}</p>}
      <form className="coach-compose" onSubmit={submit}><Input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Say something in English…" maxLength={2000} disabled={coach.busy || coach.recording} aria-label="Your English reply"/><Button type="submit" variant="secondary" disabled={!draft.trim() || coach.busy || coach.recording} aria-label="Send"><Send /></Button></form>
      <Button variant="ghost" className="coach-summary-button" disabled={coach.busy || coach.recording || coach.history.length < 2} onClick={() => void summarize()}>Review this conversation</Button>
      <div className="coach-actions"><RecordButton recording={coach.recording} busy={coach.busy} disabled={!coach.ready} onStart={() => { onStopSpeech(); return coach.startRecording(); }} onStop={coach.stopRecording}/><Button variant="outline" className="coach-end" disabled={!coach.ready || coach.busy} onClick={pause}>That’s enough for now</Button></div>
      <p className="coach-record-hint">Hold to speak, release to send, slide up to cancel · Tap for hands-free recording</p>
    </>}
    {stage === 'paused' && <section className="coach-offer"><h1>That’s enough for now</h1><p>Come back whenever you like. We can pick up where we left off.</p><Button onClick={() => setStage('chat')}>Continue chatting</Button><Button variant="outline" disabled={coach.history.length < 2} onClick={() => void summarize()}>Review this conversation</Button><Button variant="ghost" onClick={onBack}>Back to home</Button></section>}
    {stage === 'summarizing' && <section className="coach-offer"><LoaderCircle className="summary-spinner spinning"/><h1>Preparing your recap…</h1><p>Lucky is finding your key vocabulary, grammar and next focus.</p></section>}
    {stage === 'summary' && selectedSummary && <section className="coach-summary"><header><div><small>DAILY RECALL · {selectedSummary.date}</small><h1><Sparkles/>Your conversation, in focus</h1><span>{selectedSummary.minutes} min</span></div><Button variant="ghost" onClick={() => exportRecall(selectedSummary)} aria-label="Export today’s recall"><Download/>Export</Button></header><RecallTables report={selectedSummary}/><div className="summary-actions"><Button onClick={() => void startPractice()} disabled={coach.busy}>{coach.busy ? <LoaderCircle className="spinning"/> : 'Practise this conversation'}</Button><Button variant="outline" onClick={() => { coach.clearSession(); setStage('chat'); void coach.beginSession(); }}>New conversation</Button></div></section>}
    {stage === 'dashboard' && <section className="coach-dashboard"><header><div><small>PERSONAL CENTER</small><h1>Your learning</h1></div><Button variant="ghost" onClick={onSettings}><Settings2/>Settings</Button></header>
      <section className="learning-levels" aria-label="English level"><article><span>Your chosen level</span><strong>{ieltsScore ? `IELTS ${ieltsScore}` : 'Not set'}</strong><Button variant="ghost" onClick={onIelts}>Set IELTS level</Button></article><article><span>Latest assessment</span>{coach.latestAssessment ? <><strong>IELTS {coach.latestAssessment.score}</strong><p>{coach.latestAssessment.conclusion}</p><small>Grammar · {coach.latestAssessment.grammar}<br/>Vocabulary · {coach.latestAssessment.vocabulary}<br/>Fluency · {coach.latestAssessment.fluency}</small></> : <><strong>Not assessed yet</strong><p>After 2 hours of practice, Lucky will assess your grammar, vocabulary and fluency using IELTS criteria.</p><small>{Math.floor(coach.totalPracticeSeconds / 60)} / 120 min</small></>}</article></section>
      <section className="learning-history"><h2>History</h2><div className="coach-stats"><article><strong>{Math.max(0, Math.round(coach.todaySeconds / 60))}</strong><span>minutes today</span></article><article><strong>{coach.dailySummaries.length}</strong><span>daily recalls</span></article><article><strong>{coach.weeklySummaries.length}</strong><span>weekly recalls</span></article></div>{coach.dailySummaries.slice(0, 3).map(item => <button key={item.id} type="button" className="history-summary" onClick={() => { setSelectedSummary(item); setStage('summary'); }}><span>{item.date} · Daily summary</span><strong>{item.minutes} min</strong></button>)}</section>
      <section className="summary-shortcuts"><h2>Summary</h2><button type="button" onClick={() => { if (latestToday) { setSelectedSummary(latestToday); setStage('summary'); } else void summarize(); }} disabled={!latestToday && (coach.history.length < 2 || coach.busy)}><Sparkles/><span><strong>Today’s recap</strong><small>{latestToday ? `${latestToday.minutes} min · Review today’s highlights` : 'Available after a conversation'}</small></span></button><button type="button" disabled={!coach.weeklySummaries[0]} onClick={() => { const report = coach.weeklySummaries[0]; if (report) exportRecall(report); }}><BookOpenText/><span><strong>Last week’s recap</strong><small>{coach.weeklySummaries[0] ? `${coach.weeklySummaries[0].startDate} — ${coach.weeklySummaries[0].endDate}` : 'No weekly recap yet'}</small></span></button></section>
      <section className="center-options"><h2>Account</h2><Button variant="ghost" onClick={onHowItWorks}><BookOpenText/>How it works</Button><Button variant="ghost" onClick={onSettings}><GraduationCap/>Membership & profile</Button><Button variant="ghost" onClick={onSecurity}><KeyRound/>Change password</Button><Button variant="ghost" onClick={onLogout}><ArrowLeft/>Log out</Button></section>
    </section>}
    {stage === 'practice' && exercise && <section className="practice-card"><header><span>{question + 1} / {coach.practice?.exercises.length}</span><small>{exercise.type === 'cloze' ? 'Vocabulary · Fill in the blank' : exercise.type === 'meaning' ? 'Vocabulary · Meaning' : 'Grammar'}</small></header><h1>{exercise.prompt}</h1>{exercise.type === 'cloze' && <p className="word-clue"><strong>Starts with “{exercise.initial}”</strong>{exercise.definition}</p>}{exercise.options.length > 0 ? <div className="practice-options">{exercise.options.map(option => <Button key={option} type="button" variant="outline" data-selected={answer === option} disabled={checked} onClick={() => setAnswer(option)}>{option}</Button>)}</div> : <Input value={answer} onChange={event => setAnswer(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); check(); } }} placeholder={`${exercise.initial}…`} autoCapitalize="none"/>}{checked && <div className={`practice-feedback ${correct ? 'correct' : 'wrong'}`}><strong>{correct ? 'Correct!' : `Answer: ${exercise.answer}`}</strong><p>{exercise.explanation}</p></div>}<div className="practice-actions"><Button variant="ghost" onClick={() => setStage('summary')}><X/>Exit</Button>{checked ? <Button onClick={next}>{question + 1 >= (coach.practice?.exercises.length || 0) ? 'See result' : 'Next'}</Button> : <Button onClick={check} disabled={!answer}>Check answer</Button>}</div></section>}
    {stage === 'done' && <section className="coach-offer"><span className="practice-mark"><Check /></span><h1>{score} / {coach.practice?.exercises.length}</h1><p>You practised words and grammar from your own conversation.</p><Button onClick={() => { coach.clearSession(); setStage('chat'); void coach.beginSession(); }}><RotateCcw/>New conversation</Button><Button variant="ghost" onClick={() => setStage('dashboard')}>View learning history</Button></section>}
  </section></main>;
}
