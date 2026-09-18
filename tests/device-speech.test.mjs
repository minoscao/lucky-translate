import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../lib/device-speech.ts', import.meta.url), 'utf8');
const { speakOnDevice, SpeechFallback } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64'));

test('cloud outage uses device speech, skips repeated failures for one minute and then retries cloud', async () => {
  let now = 1000, clouds = 0, starts = 0;
  const spoken = [], signal = new AbortController().signal;
  const fallback = new SpeechFallback(async (text, passedSignal, rate, started) => { assert.equal(passedSignal, signal); assert.equal(rate, 1.2); spoken.push(text); started(); }, () => now);
  const fail = async () => { clouds++; throw new Error('Speech service unavailable'); };
  const started = () => starts++;
  await fallback.play('First sentence.', signal, 1.2, fail, started);
  await fallback.play('Remaining sentence.', signal, 1.2, fail, started);
  assert.equal(clouds, 1); assert.deepEqual(spoken, ['First sentence.', 'Remaining sentence.']); assert.equal(starts, 2);
  now += 60000;
  await fallback.play('Recovered.', signal, 1.2, async start => { clouds++; start(); }, started);
  assert.equal(clouds, 2); assert.equal(spoken.length, 2); assert.equal(starts, 3);
});

test('Stop, account restrictions and already audible segments never trigger fallback', async () => {
  for (const kind of ['unauthorized', 'forbidden', 'limit', 'AbortError', 'NotAllowedError', 'started']) {
    const controller = new AbortController(); let calls = 0;
    const fallback = new SpeechFallback(async () => calls++);
    const error = Object.assign(new Error(kind), { kind, name: kind });
    await assert.rejects(fallback.play('Hello', controller.signal, 1, async start => { if (kind === 'started') start(); throw error; }, () => {}), e => e === error);
    assert.equal(calls, 0);
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(new SpeechFallback(async () => assert.fail()).play('Hello', controller.signal, 1, async () => assert.fail(), () => {}), { name: 'AbortError' });
});

function device(voices) {
  const oldSynth = globalThis.speechSynthesis, oldUtterance = globalThis.SpeechSynthesisUtterance;
  const synth = Object.assign(new EventTarget(), { voices, spoken: [], cancelled: 0, getVoices() { return this.voices; }, speak(utterance) { this.spoken.push(utterance); }, cancel() { this.cancelled++; } });
  globalThis.speechSynthesis = synth;
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  return { synth, restore() { globalThis.speechSynthesis = oldSynth; globalThis.SpeechSynthesisUtterance = oldUtterance; } };
}

test('device speech selects an English voice, reflects actual start and cleans up when finished', async () => {
  const local = { lang: 'en-GB', localService: true }, fake = device([{ lang: 'zh-CN', default: true }, { lang: 'en-US' }, local]);
  let starts = 0;
  try {
    const operation = speakOnDevice('Hello!', new AbortController().signal, 1.2, () => starts++);
    const utterance = fake.synth.spoken[0];
    assert.equal(utterance.voice, local); assert.equal(utterance.lang, 'en-GB'); assert.equal(utterance.rate, 1.2); assert.equal(starts, 0);
    utterance.onstart(); assert.equal(starts, 1); utterance.onend(); await operation;
    assert.equal(utterance.onerror, null); assert.equal(fake.synth.cancelled, 0);
  } finally { fake.restore(); }
});

test('delayed mobile voice discovery starts once; cancellation prevents late playback', async () => {
  const fake = device([]), controller = new AbortController();
  try {
    const operation = speakOnDevice('Hello!', controller.signal, 1, () => {});
    fake.synth.voices = [{ lang: 'en-US' }]; fake.synth.dispatchEvent(new Event('voiceschanged')); fake.synth.dispatchEvent(new Event('voiceschanged'));
    assert.equal(fake.synth.spoken.length, 1);
    controller.abort(); await assert.rejects(operation, { name: 'AbortError' }); assert.equal(fake.synth.cancelled, 1);
    fake.synth.voices = [];
    const second = new AbortController(), pending = speakOnDevice('Cancelled', second.signal, 1, () => assert.fail()); second.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    fake.synth.voices = [{ lang: 'en-US' }]; fake.synth.dispatchEvent(new Event('voiceschanged')); assert.equal(fake.synth.spoken.length, 1);
  } finally { fake.restore(); }
});

test('missing English voice and blocked playback give actionable errors', async () => {
  const fake = device([{ lang: 'zh-CN' }]);
  try {
    await assert.rejects(speakOnDevice('Hello', new AbortController().signal, 1, () => {}), /enable an English voice/);
    assert.equal(fake.synth.spoken.length, 0);
    fake.synth.voices = [{ lang: 'en-US' }];
    const operation = speakOnDevice('Hello', new AbortController().signal, 1, () => {});
    fake.synth.spoken[0].onerror({ error: 'not-allowed' }); await assert.rejects(operation, /Tap the speaker/);
  } finally { fake.restore(); }
});

test('a device that never starts does not leave playback preparing forever', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = device([{ lang: 'en-US' }]);
  try {
    const operation = speakOnDevice('Hello', new AbortController().signal, 1, () => assert.fail());
    const rejected = assert.rejects(operation, /Tap the speaker/);
    context.mock.timers.tick(8000); await rejected;
    assert.equal(fake.synth.cancelled, 1); assert.equal(fake.synth.spoken[0].onstart, null);
  } finally { fake.restore(); }
});
