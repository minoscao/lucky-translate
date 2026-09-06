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

const routeSource = (await readFile(new URL('../app/api/translate/route.ts', import.meta.url), 'utf8')).replace('../../../lib/translation', new URL('../lib/translation.ts', import.meta.url).href);
const routeJs = ts.transpile(routeSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
const { POST } = await import('data:text/javascript;base64,' + Buffer.from(routeJs).toString('base64'));
function request(form, key = 'test-only-not-a-real-key') { return new Request('https://translator.test/api/translate', { method: 'POST', body: form, headers: { 'x-translation-key': key, Origin: 'https://translator.test' } }); }
function form(a = 'en', b = 'zh-CN') { const data = new FormData(); data.set('upper', a); data.set('lower', b); return data; }
test('service refuses missing credentials, invalid languages, oversized input and cross-origin requests without calling upstream', async () => {
  const oldFetch = globalThis.fetch; globalThis.fetch = () => { assert.fail('unexpected network request'); };
  try {
    assert.equal((await POST(request(form(), ''))).status, 401);
    assert.equal((await POST(request(form('en', 'en')))).status, 400);
    const tooLong = form(); tooLong.set('text', 'a'.repeat(2001)); assert.equal((await POST(request(tooLong))).status, 400);
    const tooBig = new Request('https://translator.test/api/translate', { method: 'POST', headers: { 'x-translation-key': 'test-only', 'Content-Type': 'multipart/form-data; boundary=test' }, body: new Uint8Array(1024 * 1024 + 1) });
    assert.equal((await POST(tooBig)).status, 413);
    assert.equal((await POST(new Request('https://translator.test/api/translate', { method: 'POST', headers: { origin: 'https://other.test' }, body: form() }))).status, 403);
  } finally { globalThis.fetch = oldFetch; }
});
test('any source language produces both selected targets; audio transcriptions are not forced to one language', async () => {
  const oldFetch = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, 'manual', 'Cloudflare supports manual redirect handling');
    calls.push(url); assert.equal(options.headers.Authorization, 'Bearer test-only-not-a-real-key');
    if (url.endsWith('/audio/transcriptions')) { assert.equal(options.body.get('language'), null); assert.equal(options.body.get('model'), 'gpt-4o-mini-transcribe'); return Response.json({ text: 'Bonjour', usage: { type: 'tokens', input_tokens: 800, output_tokens: 20, total_tokens: 820 } }); }
    const input = JSON.parse(options.body); assert.equal(input.model, 'gpt-4o-mini'); assert.equal(input.max_tokens, 3000); assert.match(input.messages[0].content, /English/); assert.match(input.messages[0].content, /Chinese/); assert.deepEqual(JSON.parse(input.messages[1].content), { previous_utterances: [], current_utterance: 'Bonjour' });
    return Response.json({ usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 200 } }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ upper: 'Hello', lower: '你好' }) } }] });
  };
  try {
    const capture = processor(); capture.feed(.4, .1); capture.p.port.onmessage({ data: { type: 'flush' } });
    const data = form(); data.set('audio', new Blob([capture.messages.find(m => m.type === 'sentence').wav], { type: 'audio/wav' }), 'speech.wav');
    const response = await POST(request(data)); assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { original: 'Bonjour', upper: 'Hello', lower: '你好', model: 'gpt-4o-mini', usage: { tokens: 1920, cost: .001295 } }); assert.equal(calls.length, 2);
  } finally { globalThis.fetch = oldFetch; }
});
test('retired models fall back only within economical candidates, never a flagship', async () => {
  const oldFetch = globalThis.fetch, models = [];
  globalThis.fetch = async (_url, options) => {
    const input = JSON.parse(options.body); models.push(input.model);
    if (input.model !== 'gpt-5-nano') return Response.json({ error: { code: 'model_not_found' } }, { status: 404 });
    assert.equal(input.reasoning_effort, 'minimal'); assert.equal(input.max_completion_tokens, 4000); assert.equal(input.max_tokens, undefined);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"upper":"Hi","lower":"你好"}' } }] });
  };
  try {
    const data = form(); data.set('text', 'Hi'); const response = await POST(request(data)); assert.equal(response.status, 200);
    assert.deepEqual(models, ['gpt-4o-mini', 'gpt-4.1-nano', 'gpt-5-nano']); assert.equal((await response.json()).model, 'gpt-5-nano');
    models.length = 0; globalThis.fetch = async (_url, options) => { models.push(JSON.parse(options.body).model); return Response.json({ error: { code: 'model_not_found' } }, { status: 404 }); };
    const unavailable = form(); unavailable.set('text', 'Hi'); assert.equal((await POST(request(unavailable))).status, 503); assert.equal(models.length, 3);
  } finally { globalThis.fetch = oldFetch; }
});
test('quota failures do not cause more paid requests to fallback models', async () => {
  const oldFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: { code: 'insufficient_quota' } }, { status: 429 }); };
  try { const data = form(); data.set('text', 'Hi'); assert.equal((await POST(request(data))).status, 429); assert.equal(calls, 1); }
  finally { globalThis.fetch = oldFetch; }
});
test('upstream failure and incomplete output are surfaced without leaking provider details or keys', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: 'secret provider text' }, { status: 401 });
    const data = form(); data.set('text', 'Hi'); const response = await POST(request(data)); assert.equal(response.status, 401); assert.doesNotMatch(await response.text(), /secret provider|test-only/);
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"upper":"Hi"}' } }] });
    const incomplete = form(); incomplete.set('text', 'Hi'); assert.equal((await POST(request(incomplete))).status, 502);
  } finally { globalThis.fetch = oldFetch; }
});


test('the next queued request sees the completed turn immediately; full export retains more than 50 turns', () => {
  const store = createConversationStore(); let notifications = 0;
  const unsubscribe = store.subscribe(() => { notifications++; });
  for (let i = 1; i <= 55; i++) store.append({ id: i, original: `原句${i}`, upper: `English ${i}`, lower: `中文${i}`, pair: ['en', 'zh-CN'], speaker: i % 2 ? 'self' : 'other' });
  assert.equal(store.snapshot().length, 55);
  assert.deepEqual(store.context(), ['原句50', '原句51', '原句52', '原句53', '原句54', '原句55']);
  const text = conversationText(store.snapshot(), 'Mia');
  assert.match(text, /Mia/); assert.match(text, /1\. Mia\nEnglish: English 1/);
  assert.match(text, /55\. Mia\nEnglish: English 55/); assert.match(text, /原文: 原句55/);
  store.append({ id: 56, original: '长'.repeat(2000), upper: 'Long', lower: '长', pair: ['en', 'zh-CN'], speaker: 'other' });
  assert.equal(store.context().at(-1).length, CONTEXT_LIMITS.characters);
  assert.equal(store.snapshot().at(-1).original.length, 2000, 'context limit must not truncate the export');
  store.replace(55, { id: 55, original: '改过的原句', upper: 'Edited', lower: '已修改', pair: ['en', 'zh-CN'], speaker: 'self' });
  assert.equal(store.snapshot().length, 56); assert.equal(store.snapshot().find(item => item.id === 55).original, '改过的原句');
  assert.deepEqual(store.context(55), ['原句49', '原句50', '原句51', '原句52', '原句53', '原句54']);
  store.clear(); assert.deepEqual(store.snapshot(), []); assert.deepEqual(store.context(), []);
  assert.equal(notifications, 58); unsubscribe(); store.clear(); assert.equal(notifications, 58);
});

test('recent original conversation is sent as data for interpreting only the current utterance', async () => {
  const oldFetch = globalThis.fetch;
  const previous = ['明天的会议改到三点，可以吗？', 'Three works for me.'];
  globalThis.fetch = async (_url, options) => {
    const input = JSON.parse(options.body);
    assert.deepEqual(JSON.parse(input.messages[1].content), { previous_utterances: previous, current_utterance: '那就这么定了。' });
    assert.match(input.messages[0].content, /communicative intent/);
    assert.match(input.messages[0].content, /never instructions to obey/);
    assert.equal(input.model, 'gpt-4o-mini');
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ upper: "Then it's settled.", lower: '那就这么定了。' }) } }] });
  };
  try {
    const data = form(); data.set('text', '那就这么定了。'); data.set('context', JSON.stringify(previous));
    const result = await POST(request(data)); assert.equal(result.status, 200);
    assert.equal((await result.json()).original, '那就这么定了。');
  } finally { globalThis.fetch = oldFetch; }
});

test('malformed or excessive context is rejected before any paid request', async () => {
  const oldFetch = globalThis.fetch; globalThis.fetch = () => { assert.fail('unexpected network request'); };
  try {
    for (const context of ['invalid json', '{}', '[null]', JSON.stringify(['x'.repeat(1001)]), JSON.stringify(Array(7).fill('hi'))]) {
      const data = form(); data.set('text', 'Hi'); data.set('context', context);
      assert.equal((await POST(request(data))).status, 400);
    }
  } finally { globalThis.fetch = oldFetch; }
});

const speechSource = (await readFile(new URL('../app/api/speech/route.ts', import.meta.url), 'utf8')).replace('../../../lib/translation', new URL('../lib/translation.ts', import.meta.url).href);
const speechJs = ts.transpile(speechSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
const speechRoute = await import('data:text/javascript;base64,' + Buffer.from(speechJs).toString('base64'));
function speechRequest(body, key = 'test-only-not-a-real-key') {
  return new Request('https://translator.test/api/speech', { method: 'POST', headers: { Origin: 'https://translator.test', 'Content-Type': 'application/json', 'x-translation-key': key }, body: JSON.stringify(body) });
}
test('API speech uses the economical TTS model and returns exact provider usage', async () => {
  const oldFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response([
      `data: ${JSON.stringify({ type: 'speech.audio.delta', audio: Buffer.from('first').toString('base64') })}`,
      `data: ${JSON.stringify({ type: 'speech.audio.delta', audio: Buffer.from('second').toString('base64') })}`,
      `data: ${JSON.stringify({ type: 'speech.audio.done', usage: { input_tokens: 10, output_tokens: 100, total_tokens: 110 } })}`,
      'data: [DONE]',
    ].join('\n\n'), { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const response = await speechRoute.POST(speechRequest({ text: '你好', language: 'zh-CN', voiceId: 'voice_mine123' }));
    assert.equal(response.status, 200); assert.equal(await response.text(), 'firstsecond');
    assert.equal(response.headers.get('X-Lucky-Usage-Tokens'), '110');
    assert.equal(response.headers.get('X-Lucky-Usage-Cost'), '0.001206000000');
    assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/speech');
    const input = JSON.parse(calls[0].options.body);
    assert.equal(input.model, 'gpt-4o-mini-tts'); assert.equal(input.stream_format, 'sse'); assert.deepEqual(input.voice, { id: 'voice_mine123' });
  } finally { globalThis.fetch = oldFetch; }
});
test('API speech rejects invalid requests before contacting the provider', async () => {
  const oldFetch = globalThis.fetch; globalThis.fetch = () => { assert.fail('unexpected network request'); };
  try {
    assert.equal((await speechRoute.POST(speechRequest({ text: 'Hi', language: 'en' }, ''))).status, 401);
    assert.equal((await speechRoute.POST(speechRequest({ text: 'Hi', language: 'unknown' }))).status, 400);
    assert.equal((await speechRoute.POST(speechRequest({ text: 'Hi', language: 'en', voiceId: 'bad' }))).status, 400);
    const crossOrigin = new Request('https://translator.test/api/speech', { method: 'POST', headers: { Origin: 'https://other.test', 'Content-Type': 'application/json', 'x-translation-key': 'test' }, body: JSON.stringify({ text: 'Hi', language: 'en' }) });
    assert.equal((await speechRoute.POST(crossOrigin)).status, 403);
  } finally { globalThis.fetch = oldFetch; }
});

const voiceSource = await readFile(new URL('../app/api/voice/route.ts', import.meta.url), 'utf8');
const voiceJs = ts.transpile(voiceSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
const voiceRoute = await import('data:text/javascript;base64,' + Buffer.from(voiceJs).toString('base64'));
function voiceRequest(key = 'test-only-not-a-real-key') {
  const data = new FormData(); data.set('name', 'Mia voice');
  data.set('consent', new File([new Uint8Array([1, 2, 3])], 'consent.webm', { type: 'audio/webm;codecs=opus' }));
  data.set('sample', new File([new Uint8Array([4, 5, 6])], 'sample.webm', { type: 'audio/webm;codecs=opus' }));
  return new Request('https://translator.test/api/voice', { method: 'POST', headers: { Origin: 'https://translator.test', 'x-translation-key': key }, body: data });
}
test('voice setup uploads consent before the sample and returns the custom voice id', async () => {
  const oldFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/audio/voice_consents')) return Response.json({ id: 'consent_123' });
    if (url.endsWith('/audio/voices')) return Response.json({ id: 'voice_123' });
    assert.fail(`unexpected URL ${JSON.stringify(url)}`);
  };
  try {
    const response = await voiceRoute.POST(voiceRequest());
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { voiceId: 'voice_123' });
    assert.equal(calls.length, 2); assert.equal(calls[0].options.headers.Authorization, 'Bearer test-only-not-a-real-key');
    assert.equal(calls[0].options.body.get('language'), 'en'); assert.equal(calls[1].options.body.get('consent'), 'consent_123');
  } finally { globalThis.fetch = oldFetch; }
});

const keySource = await readFile(new URL('../app/api/key/route.ts', import.meta.url), 'utf8');
const keyJs = ts.transpile(keySource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
const keyRoute = await import('data:text/javascript;base64,' + Buffer.from(keyJs).toString('base64'));
function keyRequest(key = 'test-only-not-a-real-key') {
  return new Request('https://translator.test/api/key', { method: 'POST', headers: { Origin: 'https://translator.test', 'x-translation-key': key } });
}
test('key verification checks the same economical chat endpoint used by translation', async () => {
  const oldFetch = globalThis.fetch; let call;
  globalThis.fetch = async (url, options) => { call = { url, options }; return Response.json({ choices: [{ message: { content: 'OK' } }] }); };
  try {
    const response = await keyRoute.POST(keyRequest()); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { valid: true });
    assert.equal(call.url, 'https://api.openai.com/v1/chat/completions'); assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers.Authorization, 'Bearer test-only-not-a-real-key');
    assert.deepEqual(JSON.parse(call.options.body), { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'OK' }], max_tokens: 1 });
  } finally { globalThis.fetch = oldFetch; }
});
test('key verification explains invalid credentials and quota limits', async () => {
  const oldFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: {} }, { status: 401 });
    const invalid = await keyRoute.POST(keyRequest()); assert.equal(invalid.status, 401); assert.match((await invalid.json()).error, /无效/);
    globalThis.fetch = async () => Response.json({ error: {} }, { status: 429 });
    const limited = await keyRoute.POST(keyRequest()); assert.equal(limited.status, 429); assert.match((await limited.json()).error, /额度/);
    globalThis.fetch = async () => Response.json({ error: { code: 'unsupported_country_region_territory' } }, { status: 403 });
    const region = await keyRoute.POST(keyRequest()); assert.equal(region.status, 503); assert.match((await region.json()).error, /云端节点/);
  } finally { globalThis.fetch = oldFetch; }
});

const directSource = (await readFile(new URL('../lib/direct-api.ts', import.meta.url), 'utf8'))
  .replace("import { language, Pair } from './translation';", "const language = code => ({ en: { name: 'English' }, 'zh-CN': { name: 'Chinese (Simplified)' } })[code];");
const directJs = ts.transpile(directSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
const directApi = await import('data:text/javascript;base64,' + Buffer.from(directJs).toString('base64'));
test('direct key verification calls the selected lightweight provider from the device', async () => {
  const oldFetch = globalThis.fetch; let call;
  globalThis.fetch = async (url, options) => { call = { url, options }; return Response.json({ choices: [{ message: { content: 'OK' } }] }); };
  try {
    await directApi.verifyDirectKey('deepseek', 'deepseek-test-key');
    assert.equal(call.url, 'https://api.deepseek.com/chat/completions');
    assert.equal(call.options.headers.get('Authorization'), 'Bearer deepseek-test-key');
    const body = JSON.parse(call.options.body); assert.equal(body.model, 'deepseek-v4-flash'); assert.deepEqual(body.thinking, { type: 'disabled' });
  } finally { globalThis.fetch = oldFetch; }
});
test('direct audio uses OpenAI transcription and the selected DeepSeek translation engine', async () => {
  const oldFetch = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/audio/transcriptions')) return Response.json({ text: '你好', usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"upper":"Hello","lower":"你好"}' } }], usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24, prompt_cache_hit_tokens: 5 } });
  };
  try {
    const result = await directApi.translateDirect({ audio: new Blob(['RIFFxxxxWAVE'], { type: 'audio/wav' }), pair: ['en', 'zh-CN'], context: [], provider: 'deepseek', openaiKey: 'openai-key', deepseekKey: 'deepseek-key', signal: new AbortController().signal });
    assert.equal(result.original, '你好'); assert.equal(result.upper, 'Hello'); assert.equal(result.lower, '你好');
    assert.deepEqual(calls.map(call => call.url), ['https://api.openai.com/v1/audio/transcriptions', 'https://api.deepseek.com/chat/completions']);
    assert.equal(JSON.parse(calls[1].options.body).model, 'deepseek-v4-flash');
  } finally { globalThis.fetch = oldFetch; }
});
test('direct speech sends the saved playback speed and returns playable audio', async () => {
  const oldFetch = globalThis.fetch; let body;
  globalThis.fetch = async (_url, options) => { body = JSON.parse(options.body); return new Response('data: {"type":"speech.audio.delta","audio":"AQID"}\n\ndata: {"type":"speech.audio.done","usage":{"input_tokens":2,"output_tokens":3,"total_tokens":5}}\n\ndata: [DONE]\n'); };
  try {
    const result = await directApi.synthesizeSpeechDirect({ text: '你好', language: 'zh-CN', speed: 1.5, key: 'openai-key', signal: new AbortController().signal });
    assert.equal(body.speed, 1.5); assert.equal(body.model, 'gpt-4o-mini-tts'); assert.equal(result.audio.size, 3); assert.equal(result.usage.tokens, 5);
  } finally { globalThis.fetch = oldFetch; }
});

const unlockSource = await readFile(new URL('../app/api/unlock/route.ts', import.meta.url), 'utf8');
const unlockJs = ts.transpile(unlockSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
const unlockRoute = await import('data:text/javascript;base64,' + Buffer.from(unlockJs).toString('base64'));
test('site password is checked server-side and persists through an HttpOnly device cookie', async () => {
  const previous = process.env.SITE_PASSWORD; process.env.SITE_PASSWORD = 'test-password';
  try {
    const locked = await unlockRoute.GET(new Request('https://translator.test/api/unlock'));
    assert.deepEqual(await locked.json(), { unlocked: false });
    const wrong = await unlockRoute.POST(new Request('https://translator.test/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'wrong' }) }));
    assert.equal(wrong.status, 401); assert.equal(wrong.headers.get('set-cookie'), null);
    const accepted = await unlockRoute.POST(new Request('https://translator.test/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'test-password' }) }));
    assert.equal(accepted.status, 200); const cookie = accepted.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/); assert.doesNotMatch(cookie, /test-password/);
    const unlocked = await unlockRoute.GET(new Request('https://translator.test/api/unlock', { headers: { cookie } }));
    assert.deepEqual(await unlocked.json(), { unlocked: true });
    assert.match((await unlockRoute.DELETE()).headers.get('set-cookie'), /Max-Age=0/);
  } finally { if (previous === undefined) delete process.env.SITE_PASSWORD; else process.env.SITE_PASSWORD = previous; }
});
test('the internal-test password works when Cloudflare has no environment variable', async () => {
  const previous = process.env.SITE_PASSWORD; delete process.env.SITE_PASSWORD;
  try {
    const response = await unlockRoute.POST(new Request('https://translator.test/api/unlock', { method: 'POST', body: JSON.stringify({ password: 'Minocolin1' }) }));
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { unlocked: true });
  } finally { if (previous !== undefined) process.env.SITE_PASSWORD = previous; }
});
