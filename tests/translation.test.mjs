import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { CONTEXT_LIMITS, createConversationStore, conversationText, RecordGesture, selectLanguage, transcriptForLanguage } from '../lib/translation.ts';

test('double tap locks recording; a later tap stops it; long press releases', () => {
  const g = new RecordGesture();
  g.down(0); assert.equal(g.up(70), undefined); assert.equal(g.mode, 'idle');
  g.down(190); assert.equal(g.up(260), 'start'); assert.equal(g.mode, 'continuous');
  g.down(1800); assert.equal(g.up(1870), 'stop'); assert.equal(g.mode, 'idle');
  g.down(2200); assert.equal(g.hold(2499), undefined); assert.equal(g.hold(2505), 'start');
  assert.equal(g.mode, 'hold'); assert.equal(g.up(3100), 'stop'); assert.equal(g.mode, 'idle');
});
test('cancellation and stale gestures never reopen the microphone', () => {
  const g = new RecordGesture(); g.down(0); g.cancel(); assert.equal(g.hold(400), undefined);
  assert.equal(g.up(450), undefined); g.down(1000); g.up(1050); g.down(1700); assert.equal(g.up(1750), undefined);
  g.down(2000); assert.equal(g.up(2400), undefined); assert.equal(g.mode, 'idle');
  assert.equal(g.toggle(), 'start'); assert.equal(g.cancel(), 'stop'); assert.equal(g.toggle(), 'start');
});
test('choosing the other language swaps the pair; all panels share one pair', () => {
  const original = ['en', 'zh-CN'];
  assert.deepEqual(selectLanguage(original, 0, 'zh-CN'), ['zh-CN', 'en']);
  assert.deepEqual(original, ['en', 'zh-CN']);
  assert.deepEqual(selectLanguage(original, 1, 'ja'), ['en', 'ja']);
});
test('inline conversation retains older turns and follows its language when sides swap', () => {
  const history = [
    { id: 1, original: '你好', upper: 'Hello', lower: '你好', pair: ['en', 'zh-CN'], speaker: 'other' },
    { id: 2, original: '下一句', upper: '下一句', lower: 'Next sentence', pair: ['zh-CN', 'en'], speaker: 'self' },
    { id: 3, original: 'Bonjour', upper: 'Bonjour', lower: 'Hello again', pair: ['fr', 'en'], speaker: 'other' },
  ];
  assert.deepEqual(transcriptForLanguage(history, 'en').map(item => item.text), ['Hello', 'Next sentence', 'Hello again']);
  assert.deepEqual(transcriptForLanguage(history, 'zh-CN').map(item => item.text), ['你好', '下一句']);
  assert.deepEqual(transcriptForLanguage(history, 'en').map(item => item.speaker), ['other', 'self', 'other']);
  assert.deepEqual(transcriptForLanguage(history, 'ja'), []);
});
const processorSource = await readFile(new URL('../public/voice-processor.js', import.meta.url), 'utf8');
function processor(rate = 48000) {
  let Processor; const messages = [];
  class Worklet { constructor() { this.port = { postMessage: data => messages.push(data) }; } }
  vm.runInNewContext(processorSource, { sampleRate: rate, AudioWorkletProcessor: Worklet, registerProcessor: (_, value) => { Processor = value; } });
  return { p: new Processor(), messages, phase: 0,
    feed(seconds, amplitude) { for (let n = 0; n < Math.ceil(seconds * rate / 128); n++) this.p.process([[new Float32Array(128).fill(amplitude)]]); },
    tone(seconds, hz, amplitude = .08) { for (let n = 0; n < Math.ceil(seconds * rate / 128); n++) { const chunk = new Float32Array(128); for (let i = 0; i < chunk.length; i++) chunk[i] = Math.sin(this.phase++ * Math.PI * 2 * hz / rate) * amplitude; this.p.process([[chunk]]); } },
  };
}
test('silence sends no audio; stopping sends the final sentence with valid WAV header', () => {
  const capture = processor(); capture.feed(2, 0); assert.equal(capture.messages.filter(m => m.type === 'sentence').length, 0);
  capture.feed(.4, .1); capture.p.port.onmessage({ data: { type: 'flush' } });
  const speech = capture.messages.find(m => m.type === 'sentence'); assert.ok(speech);
  const wav = new DataView(speech.wav); assert.equal(wav.getUint32(24, true), 16000); assert.equal(wav.getUint32(40, true), speech.wav.byteLength - 44);
  assert.ok(capture.messages.some(m => m.type === 'flushed'));
  capture.feed(1, .2); assert.equal(capture.messages.filter(m => m.type === 'sentence').length, 1);
});
test('hold mode keeps one sentence until release; continuous mode waits for five seconds of silence', () => {
  for (const rate of [44100, 48000]) {
    const hold = processor(rate); hold.p.port.onmessage({ data: { type: 'config', mode: 'hold' } }); hold.feed(.5, .08); hold.feed(6, 0);
    assert.equal(hold.messages.filter(m => m.type === 'sentence').length, 0); hold.p.port.onmessage({ data: { type: 'flush' } }); assert.equal(hold.messages.filter(m => m.type === 'sentence').length, 1);
    const continuous = processor(rate); continuous.p.port.onmessage({ data: { type: 'config', mode: 'continuous' } }); continuous.feed(.5, .08); continuous.feed(4.8, 0);
    assert.equal(continuous.messages.filter(m => m.type === 'sentence').length, 0); continuous.feed(.3, 0); assert.equal(continuous.messages.filter(m => m.type === 'sentence').length, 1);
  }
});
test('continuous mode detects a clear speaker pitch change', () => {
  const capture = processor(); capture.p.port.onmessage({ data: { type: 'config', mode: 'continuous' } });
  capture.tone(1.6, 110); capture.tone(1.6, 240);
  const speech = capture.messages.filter(m => m.type === 'sentence'); assert.ok(speech.length >= 1); assert.match(speech[0].boundary, /^speaker-/);
});
test('single-operator continuous mode keeps a fixed translation direction', () => {
  const capture = processor(); capture.p.port.onmessage({ data: { type: 'config', mode: 'continuous', detectSpeaker: false } });
  capture.tone(1.6, 110); capture.tone(1.6, 240);
  assert.equal(capture.messages.filter(m => m.type === 'sentence').length, 0);
  capture.feed(5.1, 0); const speech = capture.messages.filter(m => m.type === 'sentence'); assert.equal(speech.length, 1); assert.equal(speech[0].boundary, 'silence');
});
test('microphone permission arriving after release cannot start recording', async () => {
  let grant; let stopped = 0;
  const source = await readFile(new URL('../lib/voice-recorder.ts', import.meta.url), 'utf8');
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
  const { VoiceRecorder } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousWindow = globalThis.window; const previousAudioContext = globalThis.AudioContext;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } } });
  globalThis.window = { AudioWorkletNode: class {} };
  globalThis.AudioContext = class { state = 'running'; resume() { return Promise.resolve(); } close() { return Promise.resolve(); } };
  try {
    const recorder = new VoiceRecorder({ onSentence() { assert.fail('must not emit'); }, onLevel() {}, onError() {} });
    const starting = recorder.start(); await Promise.resolve(); await recorder.stop(false);
    grant({ getTracks: () => [{ stop() { stopped++; } }] }); assert.equal(await starting, false); assert.equal(stopped, 1);
  } finally {
    Object.defineProperty(globalThis, 'navigator', previousNavigator); globalThis.window = previousWindow; globalThis.AudioContext = previousAudioContext;
  }
});

test('managed service architecture keeps API keys on the server and uses the configured lightweight models', async () => {
  const [deepseek, translate, speech] = await Promise.all([
    readFile(new URL('../lib/server/deepseek.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/translate/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/speech/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(deepseek, /model: 'deepseek-v4-flash'/);
  assert.doesNotMatch(deepseek, /gpt-6|openai\.com/);
  assert.match(translate, /@cf\/openai\/whisper-large-v3-turbo/);
  assert.match(speech, /@cf\/myshell-ai\/melotts/);
});

test('translation time is charged at ten percent while coaching time is charged in full', async () => {
  const account = await readFile(new URL('../lib/server/account.ts', import.meta.url), 'utf8');
  assert.match(account, /category === 'translation' \? Math\.ceil\(safe \* \.1\) : safe/);
  assert.match(account, /category === 'training' \? safe : 0/);
});
test('coach recalls do not turn possible speech-recognition noise into corrections', async () => {
  const coach = await readFile(new URL('../lib/coach.ts', import.meta.url), 'utf8');
  assert.match(coach, /IELTS 7 or 8, assume isolated awkward wording is a recording artefact/);
  assert.match(coach, /only add likelyMistakes for a confirmed language issue/);
  assert.match(coach, /Never label a possible recording artefact as a learner mistake/);
});
test('Coach pet web assets include both room themes and every desktop action state', async () => {
  const clips = ['belly-enter', 'belly-exit', 'belly-wake', 'belly', 'blink', 'groom', 'idle', 'paw-face', 'pet', 'slap', 'sleep-enter', 'sleep', 'tail', 'talk', 'wake'];
  for (const file of ['coach-room-day.webp', 'coach-room-night.webp', ...clips.map(name => `pet/${name}.webp`)]) {
    const bytes = await readFile(new URL(`../public/${file}`, import.meta.url)); assert.ok(bytes.length > 1000, `${file} should be a real image`); assert.ok(bytes.length < 400_000, `${file} should remain web-sized`);
  }
});
