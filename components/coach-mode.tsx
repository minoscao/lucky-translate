'use client';

import { PointerEvent, SyntheticEvent, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, LoaderCircle, Mic, RotateCcw, Send, Settings2, Square, Volume2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCoach } from '@/hooks/use-coach';

type CoachController = ReturnType<typeof useCoach>;
type Props = { coach: CoachController; onBack: () => void; onSettings: () => void; onSpeak: (text: string) => void };

function CoachRecordButton({ coach }: { coach: CoachController }) {
  const press = useRef<{ id: number; started: number } | undefined>(undefined);
  const down = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    if (coach.recording) { press.current = undefined; void coach.stopRecording(); return; }
    press.current = { id: event.pointerId, started: performance.now() };
    void coach.startRecording();
  };
  const up = (event: PointerEvent<HTMLButtonElement>) => {
    const current = press.current; press.current = undefined;
    if (!current || current.id !== event.pointerId) return;
    if (performance.now() - current.started >= 350) void coach.stopRecording();
  };
  return <Button type="button" className="coach-mic" data-active={coach.recording} disabled={coach.busy} aria-label={coach.recording ? 'Stop recording' : 'Tap to record, or hold to talk'} onPointerDown={down} onPointerUp={up} onPointerCancel={() => { if (press.current) void coach.stopRecording(); press.current = undefined; }} onContextMenu={event => event.preventDefault()}>
    {coach.busy ? <LoaderCircle className="spinning" /> : coach.recording ? <Square fill="currentColor" /> : <Mic />}
    <span>{coach.recording ? 'Listening…' : 'Speak'}</span>
  </Button>;
}

export function CoachMode({ coach, onBack, onSettings, onSpeak }: Props) {
  const [draft, setDraft] = useState(''), [stage, setStage] = useState<'chat' | 'offer' | 'practice' | 'done'>('chat');
  const [question, setQuestion] = useState(0), [answer, setAnswer] = useState(''), [checked, setChecked] = useState(false), [score, setScore] = useState(0);
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => { view.current?.scrollTo({ top: view.current.scrollHeight, behavior: 'smooth' }); }, [coach.history, coach.busy]);
  const submit = (event: SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); const text = draft.trim(); if (!text) return; setDraft(''); void coach.sendText(text); };
  const startPractice = async () => { if (await coach.createPractice()) { setQuestion(0); setAnswer(''); setChecked(false); setScore(0); setStage('practice'); } };
  const exercise = coach.practice?.exercises[question];
  const normalize = (value: string) => value.trim().toLocaleLowerCase().replace(/[.!?]+$/, '');
  const correct = Boolean(exercise && normalize(answer) === normalize(exercise.answer));
  const check = () => { if (!exercise || !answer || checked) return; setChecked(true); if (correct) setScore(value => value + 1); };
  const next = () => {
    if (!coach.practice || question + 1 >= coach.practice.exercises.length) { setStage('done'); return; }
    setQuestion(value => value + 1); setAnswer(''); setChecked(false);
  };

  return <main className="coach-page">
    <section className="coach-shell">
      <header className="coach-header"><Button variant="ghost" onClick={onBack} aria-label="Back to mode menu"><ArrowLeft /></Button><div><strong>LUCKY</strong><span>English Coach</span></div><Button variant="ghost" onClick={onSettings} aria-label="Settings"><Settings2 /></Button></header>
      {stage === 'chat' && <>
        <div className="coach-chat" ref={view} aria-live="polite">
          {coach.history.map(message => <article key={message.id} className={`coach-message ${message.role}`}><span>{message.role === 'coach' ? 'Coach' : 'You'}</span><p>{message.text}</p>{message.role === 'coach' && <Button variant="ghost" className="coach-speak" onClick={() => onSpeak(message.text)} aria-label="Read this reply"><Volume2 /></Button>}</article>)}
          {coach.busy && <div className="coach-thinking"><LoaderCircle className="spinning" /> Thinking…</div>}
        </div>
        {coach.tip && <p className="coach-tip"><strong>Quick tip</strong> {coach.tip}</p>}
        {coach.error && <p className="coach-error" role="alert">{coach.error}</p>}
        <form className="coach-compose" onSubmit={submit}><Input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Say something in English…" maxLength={2000} disabled={coach.busy || coach.recording} aria-label="Your English reply"/><Button type="submit" variant="secondary" disabled={!draft.trim() || coach.busy || coach.recording} aria-label="Send"><Send /></Button></form>
        <div className="coach-actions"><CoachRecordButton coach={coach}/><Button variant="outline" className="coach-end" disabled={coach.busy || coach.recording || coach.history.length < 2} onClick={() => setStage('offer')}>End conversation</Button></div>
        <p className="coach-record-hint">Tap to keep recording · Hold and release to send</p>
      </>}
      {stage === 'offer' && <section className="coach-offer"><span className="practice-mark"><Check /></span><h1>Nice conversation.</h1><p>Would you like to practise vocabulary and grammar from this conversation?</p>{coach.error && <p className="coach-error" role="alert">{coach.error}</p>}<Button onClick={() => void startPractice()} disabled={coach.busy}>{coach.busy ? <><LoaderCircle className="spinning"/>Creating your practice…</> : 'Start practice'}</Button><Button variant="ghost" onClick={onBack}>Not now</Button></section>}
      {stage === 'practice' && exercise && <section className="practice-card"><header><span>{question + 1} / {coach.practice?.exercises.length}</span><small>{exercise.type === 'cloze' ? 'Vocabulary · Fill in the blank' : exercise.type === 'meaning' ? 'Vocabulary · Meaning' : 'Grammar'}</small></header><h1>{exercise.prompt}</h1>{exercise.type === 'cloze' && <p className="word-clue"><strong>Starts with “{exercise.initial}”</strong>{exercise.definition}</p>}{exercise.options.length > 0 ? <div className="practice-options">{exercise.options.map(option => <Button key={option} type="button" variant="outline" data-selected={answer === option} disabled={checked} onClick={() => setAnswer(option)}>{option}</Button>)}</div> : <Input value={answer} onChange={event => setAnswer(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); check(); } }} placeholder={`${exercise.initial}…`} autoCapitalize="none"/>}{checked && <div className={`practice-feedback ${correct ? 'correct' : 'wrong'}`}><strong>{correct ? 'Correct!' : `Answer: ${exercise.answer}`}</strong><p>{exercise.explanation}</p></div>}<div className="practice-actions"><Button variant="ghost" onClick={() => setStage('offer')}><X/>Exit</Button>{checked ? <Button onClick={next}>{question + 1 >= (coach.practice?.exercises.length || 0) ? 'See result' : 'Next'}</Button> : <Button onClick={check} disabled={!answer}>Check answer</Button>}</div></section>}
      {stage === 'done' && <section className="coach-offer"><span className="practice-mark"><Check /></span><h1>{score} / {coach.practice?.exercises.length}</h1><p>You practised words and grammar from your own conversation.</p><Button onClick={() => { coach.clearSession(); setStage('chat'); void coach.beginSession(); }}><RotateCcw/>New conversation</Button><Button variant="ghost" onClick={onBack}>Back to menu</Button></section>}
    </section>
  </main>;
}
