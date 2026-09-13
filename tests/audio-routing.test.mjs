import test from 'node:test';
import assert from 'node:assert/strict';
import { channelWav, DEFAULT_AUDIO_ROUTE, routeAudio, selectSink, speechSegments } from '../lib/audio-routing.ts';
import { playAudioSegments } from '../lib/audio-playback.ts';

test('split headset audio has silence in the opposite ear and preserves sample timing', async () => {
  for (const side of ['left', 'right', 'both']) {
    const view = new DataView(await channelWav(new Float32Array([.5, -.5, 0]), 24000, side).arrayBuffer());
    assert.equal(view.getUint16(22, true), 2);
    assert.equal(view.getUint32(24, true), 24000);
    assert.equal(view.getInt16(44, true), side === 'right' ? 0 : 16384);
    assert.equal(view.getInt16(46, true), side === 'left' ? 0 : 16384);
    assert.equal(view.getInt16(48, true), side === 'right' ? 0 : -16383);
    assert.equal(view.getInt16(50, true), side === 'left' ? 0 : -16383);
    assert.equal(view.byteLength, 56);
  }
  const original = new Blob(['audio']);
  assert.equal(await routeAudio(original, DEFAULT_AUDIO_ROUTE.channel), original);
});

test('unavailable or forbidden output never falls back to system speakers', async () => {
  const calls = [];
  const output = { sinkId: '', async setSinkId(id) { calls.push(id); this.sinkId = id; } };
  await selectSink(output, 'headset-a');
  assert.deepEqual(calls, ['headset-a']);
  await selectSink(output, '');
  assert.equal(output.sinkId, '');
  assert.deepEqual(calls, ['headset-a', '']);
  await assert.rejects(selectSink({ sinkId: 'wrong-device', setSinkId: async () => {} }, 'headset-a'), /did not switch/);
  await selectSink({}, '');
  await assert.rejects(selectSink({}, 'headset-a'), /cannot choose/);
  await assert.rejects(selectSink({ setSinkId: async () => { throw new Error('device disconnected'); } }, 'headset-a'), /disconnected/);
});

test('splitting coach speech keeps every character and only splits at sentence ends', () => {
  const text = 'That sounds like a wonderful way to spend your afternoon! What did you enjoy most?';
  const segments = speechSegments(text);
  assert.equal(segments.length, 2); assert.equal(segments.join(''), text);
  assert.match(segments[0], /!\s$/);
  assert.deepEqual(speechSegments('Could you tell me a little more?'), ['Could you tell me a little more?']);
  assert.deepEqual(speechSegments('That sounds exciting! Tell me how it started.'), ['That sounds exciting! ', 'Tell me how it started.']);
  assert.deepEqual(speechSegments('One long thought without a sentence boundary even when the message continues'), ['One long thought without a sentence boundary even when the message continues']);
});

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const fakeAudio = () => ({ played: [], src: '', play() { this.played.push(this.src); return Promise.resolve(); }, pause() {}, removeAttribute() {}, load() {}, onended: null, onerror: null });

test('output verification runs after source assignment and blocks playback on a routing failure', async () => {
  const audio = fakeAudio();
  await assert.rejects(playAudioSegments({ segments: ['hello'], audio, signal: new AbortController().signal,
    prepare: async () => new Blob(['audio']), beforePlay: async () => { assert.match(audio.src, /^blob:/); throw new Error('wrong output'); } }), /wrong output/);
  assert.equal(audio.played.length, 0);
});

test('first sentence plays before remaining synthesis completes; rest plays once and in order', async () => {
  const first = deferred(), second = deferred(), calls = [], audio = fakeAudio();
  const operation = playAudioSegments({ segments: ['first', 'rest'], audio, signal: new AbortController().signal,
    prepare: segment => { calls.push(segment); return (segment === 'first' ? first : second).promise; } });
  assert.deepEqual(calls, ['first']);
  first.resolve(new Blob(['first'])); await tick();
  assert.equal(audio.played.length, 1); assert.deepEqual(calls, ['first', 'rest']);
  second.resolve(new Blob(['rest'])); await tick();
  assert.equal(audio.played.length, 1);
  audio.onended(); await tick(); assert.equal(audio.played.length, 2);
  audio.onended(); await operation;
});

test('cancelled speech cannot start a late segment or play after an account switch', async () => {
  const first = deferred(), second = deferred(), audio = fakeAudio(), controller = new AbortController();
  const operation = playAudioSegments({ segments: [0, 1], audio, signal: controller.signal, prepare: index => (index ? second : first).promise });
  first.resolve(new Blob(['first'])); await tick(); assert.equal(audio.played.length, 1);
  controller.abort(); second.resolve(new Blob(['second'])); await operation;
  assert.equal(audio.played.length, 1);
  const aborted = new AbortController(); aborted.abort();
  await playAudioSegments({ segments: [0], audio, signal: aborted.signal, prepare: () => { throw new Error('must not synthesize'); } });
});

test('prefetch failure is handled after the audible sentence, without replay or unhandled rejection', async () => {
  const audio = fakeAudio();
  const operation = playAudioSegments({ segments: [0, 1], audio, signal: new AbortController().signal, prepare: async index => { if (index) throw new Error('synthesis failed'); return new Blob(['first']); } });
  await tick(); assert.equal(audio.played.length, 1);
  audio.onended(); await assert.rejects(operation, /synthesis failed/);
});
