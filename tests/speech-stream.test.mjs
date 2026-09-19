import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { channelWav } from '../lib/audio-routing.ts';
const compile = text => ts.transpile(text, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
const load = async path => import('data:text/javascript;base64,' + Buffer.from(compile(await readFile(new URL(path, import.meta.url), 'utf8'))).toString('base64'));
const { SpeechCache } = await load('../lib/speech-cache.ts');
const { WavStream, StreamingSpeechPlayer } = await load('../lib/streaming-speech.ts');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('replay and repeated clicks share synthesis, while failures retry and account disposal blocks late data', async () => {
  let loads = 0; const cache = new SpeechCache(), wait = deferred(), blob = new Blob(['speech']);
  const loader = async () => { loads++; return wait.promise; };
  const first = cache.get('account-a/en/hello', loader), repeat = cache.get('account-a/en/hello', loader);
  await tick(); assert.equal(loads, 1);
  wait.resolve(blob); assert.equal(await first.audio, blob); assert.equal(await repeat.audio, blob);
  assert.equal(await cache.get('account-a/en/hello', loader).audio, blob); assert.equal(loads, 1);
  const other = new SpeechCache(); await other.get('account-b/en/hello', loader).audio; assert.equal(loads, 2);
  await assert.rejects(cache.get('fail', async () => { throw new Error('temporary failure'); }).audio, /temporary/);
  assert.equal(await cache.get('fail', async () => blob).audio, blob);
  const late = deferred(); let signal;
  const pending = cache.get('late', async value => { signal = value; return late.promise; }); await tick(); cache.clear();
  assert.equal(signal.aborted, true); late.resolve(blob); await assert.rejects(pending.audio, { name: 'AbortError' }); other.clear();
});

test('cache evicts least recently used audio to respect its memory budget', async () => {
  const cache = new SpeechCache(6, 2); let loads = 0;
  const loader = async () => { loads++; return new Blob(['123']); };
  await cache.get('one', loader).audio; await cache.get('two', loader).audio; await cache.get('one', loader).audio;
  await cache.get('three', loader).audio; await cache.get('two', loader).audio;
  assert.equal(loads, 4); cache.clear();
});

test('WAV parser emits audio before full download and preserves sample values across arbitrary network boundaries', async () => {
  const source = new Float32Array(24000).map((_, index) => Math.sin(index / 15) * .5);
  const bytes = new Uint8Array(await channelWav(source, 24000, 'both').arrayBuffer()), frames = [];
  const parser = new WavStream((channels, rate) => { assert.equal(rate, 24000); assert.equal(channels.length, 2); frames.push(...channels[0]); });
  let early = false;
  for (let at = 0; at < bytes.length; at += 997) { parser.push(bytes.slice(at, at + 997)); if (at < bytes.length / 2 && frames.length) early = true; }
  parser.finish(); assert.equal(early, true); assert.equal(frames.length, source.length);
  for (let i = 0; i < source.length; i++) assert.ok(Math.abs(frames[i] - source[i]) < .00005);
  const truncated = new WavStream(() => {}); truncated.push(bytes.slice(0, -100)); assert.throws(() => truncated.finish(), /incomplete/);
  const other = new WavStream(() => assert.fail('unknown formats must not emit guessed samples')); other.push(new Uint8Array(100)); assert.equal(other.unsupported, true);
});

test('cloud streaming WAV with an unknown length ends cleanly but rejects partial sample frames', async () => {
  const bytes = new Uint8Array(await channelWav(new Float32Array(4800).fill(.2), 24000, 'both').arrayBuffer());
  const view = new DataView(bytes.buffer); view.setUint32(40, 0x7fff0000, true);
  let frames = 0;
  const parser = new WavStream(channels => { frames += channels[0].length; });
  for (let i = 0; i < bytes.length; i += 193) parser.push(bytes.slice(i, i + 193));
  parser.finish(); assert.equal(frames, 4800);
  const broken = new WavStream(() => {}); broken.push(bytes.slice(0, -1)); assert.throws(() => broken.finish(), /incomplete/);
});

test('streaming accepts float32 WAV with extension bytes and a fact chunk', () => {
  const buffer = Buffer.alloc(58 + 8000 * 4); buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12); buffer.writeUInt32LE(18, 16);
  buffer.writeUInt16LE(3, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(32, 34);
  buffer.write('fact', 38); buffer.writeUInt32LE(4, 42); buffer.writeUInt32LE(8000, 46); buffer.write('data', 50); buffer.writeUInt32LE(32000, 54);
  for (let i = 58; i < buffer.length; i += 4) buffer.writeFloatLE(.25, i);
  let count = 0; const parser = new WavStream((channels, rate) => { assert.equal(rate, 8000); count += channels[0].length; assert.equal(channels[0][0], .25); });
  for (let at = 0; at < buffer.length; at += 333) parser.push(new Uint8Array(buffer.subarray(at, at + 333)));
  parser.finish(); assert.equal(count, 8000);
});

function fakeContext() {
  const previous = globalThis.AudioContext, contexts = [];
  globalThis.AudioContext = class {
    currentTime = 0; sources = []; decoded = 0; closed = false;
    constructor() { contexts.push(this); }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    createBuffer(channels, length, rate) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { duration: length / rate, getChannelData: index => data[index] }; }
    createBufferSource() { const source = { playbackRate: { value: 1 }, buffer: null, connect() {}, disconnect() {}, stop() {}, start(time) { this.startedAt = time; }, onended: null }; this.sources.push(source); return source; }
    async decodeAudioData() { this.decoded++; return { duration: 1 }; }
  };
  return { contexts, restore: () => { globalThis.AudioContext = previous; } };
}

test('speech actually schedules before download completes; replay uses cached bytes with no new synthesis', async () => {
  const fake = fakeContext(), cache = new SpeechCache(), finished = deferred(), controller = new AbortController();
  let publish, loads = 0, starts = 0;
  const blob = channelWav(new Float32Array(24000).fill(.1), 24000, 'both'), bytes = new Uint8Array(await blob.arrayBuffer());
  const loader = async (_, listener) => { loads++; publish = listener; return finished.promise; };
  const player = new StreamingSpeechPlayer(controller.signal);
  try {
    const resource = cache.get('hello', loader), operation = player.play(resource, () => starts++); await tick();
    publish(bytes.slice(0, 20000)); await tick(); assert.equal(starts, 1); assert.ok(fake.contexts[0].sources.length > 0);
    publish(bytes.slice(20000)); finished.resolve(blob); await tick();
    const sources = fake.contexts[0].sources;
    for (let i = 1; i < sources.length; i++) assert.ok(sources[i].startedAt >= sources[i - 1].startedAt + sources[i - 1].buffer.duration);
    sources.forEach(source => source.onended()); await operation;
    const replay = player.play(cache.get('hello', loader), () => starts++); await tick(); fake.contexts[0].sources.at(-1).onended(); await replay;
    assert.equal(loads, 1); assert.equal(starts, 2); assert.equal(fake.contexts[0].decoded, 1);
  } finally { player.stop(); cache.clear(); fake.restore(); }
});

test('cancellation stops scheduled speech and no late download can make another sound', async () => {
  const fake = fakeContext(), cache = new SpeechCache(), finished = deferred(), controller = new AbortController();
  let publish; const blob = channelWav(new Float32Array(24000).fill(.1), 24000, 'both'), bytes = new Uint8Array(await blob.arrayBuffer());
  const resource = cache.get('hello', async (_, listener) => { publish = listener; return finished.promise; });
  const player = new StreamingSpeechPlayer(controller.signal);
  try {
    const operation = player.play(resource, () => {}); await tick(); publish(bytes.slice(0, 20000));
    const count = fake.contexts[0].sources.length; controller.abort(); await assert.rejects(operation, { name: 'AbortError' });
    publish(bytes.slice(20000)); finished.resolve(blob); await tick();
    assert.equal(fake.contexts[0].sources.length, count); assert.equal(fake.contexts[0].closed, true);
  } finally { player.stop(); cache.clear(); fake.restore(); }
});

test('suspended mobile audio still reports cloud errors and responds to Stop', async () => {
  const fake = fakeContext(), Original = globalThis.AudioContext;
  globalThis.AudioContext = class extends Original { resume() { return new Promise(() => {}); } };
  try {
    const controller = new AbortController(), player = new StreamingSpeechPlayer(controller.signal);
    const error = new Error('Cloud unavailable');
    await assert.rejects(player.play({ audio: Promise.reject(error), subscribe: () => () => {} }, () => assert.fail()), e => e === error);
    assert.equal(fake.contexts[0].closed, true);
    const second = new AbortController(), waiting = new StreamingSpeechPlayer(second.signal);
    const operation = waiting.play({ audio: new Promise(() => {}), subscribe: () => () => {} }, () => assert.fail());
    second.abort(); await assert.rejects(operation, { name: 'AbortError' });
    assert.equal(fake.contexts[1].closed, true);
  } finally { fake.restore(); }
});

test('blocked mobile autoplay asks for a tap instead of preparing forever', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const fake = fakeContext(), Original = globalThis.AudioContext;
  globalThis.AudioContext = class extends Original { resume() { return new Promise(() => {}); } };
  try {
    const player = new StreamingSpeechPlayer(new AbortController().signal);
    const operation = player.play({ audio: new Promise(() => {}), subscribe: () => () => {} }, () => assert.fail());
    const rejected = assert.rejects(operation, { name: 'NotAllowedError' });
    context.mock.timers.tick(1500); await rejected; assert.equal(fake.contexts[0].closed, true);
  } finally { fake.restore(); }
});
