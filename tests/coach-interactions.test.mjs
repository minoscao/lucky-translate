import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { create, act } from 'react-test-renderer';
import ts from 'typescript';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const strip = source => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '');
const compile = source => ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React });
const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const imports = `import React,{useRef,useState,useEffect,useCallback} from '${import.meta.resolve('react')}';
import {ArrowUp,ArrowLeft,BookOpenText,Check,Download,GraduationCap,KeyRound,LoaderCircle,MessageCircleHeart,Mic,RotateCcw,Send,Settings2,Sparkles,Square,Target,UserRound,Volume2,WandSparkles,X} from '${import.meta.resolve('lucide-react')}';
const Button=props=>React.createElement('button',props),Input=props=>React.createElement('input',props);`;
const recordUrl = url(imports + strip(compile(await read('../components/record-button.tsx'))));
const { RecordButton } = await import(recordUrl);
const textUrl = url(compile(await read('../lib/text-highlights.ts')));
const highlightUrl = url(imports + `import {textHighlights} from '${textUrl}';` + strip(compile(await read('../components/highlighted-text.tsx'))));
const { CoachMode } = await import(url(imports + `import {RecordButton} from '${recordUrl}';import {HighlightedText} from '${highlightUrl}';import {grammarHighlights} from '${textUrl}';const CoachPet=()=>null;` + strip(compile(await read('../components/coach-mode.tsx')))));
const event = (y = 200, id = 1) => ({ pointerId: id, clientY: y, button: 0, isPrimary: true, preventDefault() {}, currentTarget: { setPointerCapture() {} } });

test('hold-to-talk supports sliding up to cancel, sliding back to send, and pointer interruption', async t => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let now = 0, renderer;
  t.mock.method(performance, 'now', () => now);
  const stops = [], starts = [];
  const props = { recording: false, onStart: async () => { starts.push(true); return true; }, onStop: async commit => { stops.push(commit); } };
  const button = () => renderer.root.findByProps({ className: 'coach-mic' });
  try {
    await act(async () => { renderer = create(React.createElement(RecordButton, props)); });
    await act(async () => button().props.onPointerDown(event()));
    assert.match(JSON.stringify(renderer.toJSON()), /Release to send · Slide up to cancel/);
    await act(async () => button().props.onPointerMove(event(100)));
    assert.equal(button().props['data-cancel'], true);
    now = 500;
    await act(async () => button().props.onPointerUp(event(100)));
    await act(async () => button().props.onLostPointerCapture(event(100)));
    assert.deepEqual(stops, [false]);

    await act(async () => button().props.onPointerDown(event()));
    await act(async () => button().props.onPointerMove(event(100)));
    await act(async () => button().props.onPointerMove(event(195)));
    assert.equal(button().props['data-cancel'], false);
    now = 1000;
    await act(async () => button().props.onPointerUp(event(195)));
    assert.deepEqual(stops, [false, true]);

    await act(async () => button().props.onPointerDown(event()));
    await act(async () => button().props.onPointerCancel(event()));
    await act(async () => button().props.onPointerUp(event()));
    assert.deepEqual(stops, [false, true, false]);
    assert.equal(starts.length, 3);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('tap recording stays active until a second tap; keyboard can start and cancel', async t => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let now = 0, renderer, starts = 0;
  t.mock.method(performance, 'now', () => now);
  const stops = [], props = { recording: false, onStart: async () => { starts++; return true; }, onStop: async commit => { stops.push(commit); } };
  const button = () => renderer.root.findByProps({ className: 'coach-mic' });
  try {
    await act(async () => { renderer = create(React.createElement(RecordButton, props)); });
    await act(async () => button().props.onPointerDown(event()));
    now = 100;
    await act(async () => button().props.onPointerUp(event()));
    assert.deepEqual(stops, []);
    await act(async () => renderer.update(React.createElement(RecordButton, { ...props, recording: true })));
    await act(async () => button().props.onPointerDown(event()));
    await act(async () => button().props.onPointerUp(event()));
    assert.deepEqual(stops, [true]);
    await act(async () => renderer.update(React.createElement(RecordButton, props)));
    await act(async () => button().props.onClick({ detail: 0 }));
    await act(async () => button().props.onKeyDown({ key: 'Escape', preventDefault() {} }));
    assert.equal(starts, 2); assert.deepEqual(stops, [true, false]);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('ending a session pauses immediately without generating a recap or changing history', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer, summaries = 0, cancellations = 0, speechStops = 0;
  const history = [{ id: 1, role: 'learner', text: 'I work on AI tools.' }, { id: 2, role: 'coach', text: 'What have you built?' }];
  const coach = { ready: true, busy: false, recording: false, history, error: '今日服务额度已达上限', dailySummaries: [], weeklySummaries: [], cancel() { cancellations++; }, setError() {}, summarizeToday() { summaries++; throw new Error('quota exceeded'); }, startRecording: async () => true, stopRecording: async () => {}, eligibleForAssessment: false };
  try {
    await act(async () => { renderer = create(React.createElement(CoachMode, { coach, speaking: false, onStopSpeech() { speechStops++; } })); });
    await act(async () => renderer.root.findByProps({ className: 'coach-end' }).props.onClick());
    assert.equal(summaries, 0); assert.equal(cancellations, 1); assert.equal(speechStops, 1);
    assert.equal(renderer.root.findByType('h1').children.join(''), 'That’s enough for now');
    const resume = renderer.root.findAllByType('button').find(node => node.children.join('') === 'Continue chatting');
    await act(async () => resume.props.onClick());
    assert.equal(renderer.root.findAllByProps({ className: 'coach-message learner' }).length, 1);
    assert.equal(summaries, 0); assert.equal(coach.history, history);
  } finally { if (renderer) await act(async () => renderer.unmount()); }
});

test('cancelling while microphone permission is pending ignores its late completion', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const hookSource = strip(compile(await read('../hooks/use-coach.ts')));
  const { useCoach } = await import(url(imports + `
const EMPTY_COACH_MEMORY={level:'discovering',topics:[],strengths:[],focus:[],phrases:[]};
class VoiceRecorder {start(){return new Promise(resolve=>{globalThis.__grantRecording=resolve;});}async stop(commit){globalThis.__recordingStops.push(commit);}}
` + hookSource));
  let renderer, current, pending;
  globalThis.__recordingStops = [];
  const scope = { owner: 'test', active: true, storage: { getItem() { return null; }, setItem() {} }, save: async () => {}, request: async () => ({ records: [], account: { usage: { todayTrainingSeconds: 0, totalTrainingSeconds: 0 } } }) };
  function Harness() { const value = useCoach(scope, () => {}); React.useEffect(() => { current = value; }); return null; }
  try {
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => { pending = current.startRecording(); });
    assert.equal(current.recording, true);
    await act(async () => { await current.stopRecording(false); });
    await act(async () => { globalThis.__grantRecording(true); await pending; });
    assert.equal(current.recording, false); assert.deepEqual(globalThis.__recordingStops, [false]);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    delete globalThis.__recordingStops; delete globalThis.__grantRecording;
  }
});
