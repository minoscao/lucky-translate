import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/audio-probe.ts', import.meta.url), 'utf8');
const compiled = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })
  .replace("'./audio-routing'", JSON.stringify(new URL('../lib/audio-routing.ts', import.meta.url).href));
const { AudioProbe, demoMusic } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const config = id => ({ id, blob: new Blob(['music']), deviceId: id === 'a' ? 'headset' : 'amp', volume: .4, engine: 'web-audio' });
function harness() {
  const outputs = [], statuses = [];
  const probe = new AudioProbe((id, status) => statuses.push({ id, ...status }), (configuration, signal) => {
    const ready = deferred();
    const output = { configuration, signal, ready: ready.promise, resolve: ready.resolve, reject: ready.reject, plays: 0, stops: 0, volumes: [],
      async play() { this.plays++; }, stop() { this.stops++; }, sink() { return configuration.deviceId; }, volume(value) { this.volumes.push(value); } };
    outputs.push(output); return output;
  });
  return { outputs, statuses, probe };
}

test('two independent players both prepare before either starts, with separate requested outputs', async () => {
  const { outputs, statuses, probe } = harness();
  const run = probe.start([config('a'), config('b')]);
  assert.equal(outputs.length, 2);
  outputs[0].resolve(); await tick(); assert.equal(outputs[0].plays, 0);
  outputs[1].resolve(); await run;
  assert.deepEqual(outputs.map(item => item.plays), [1, 1]);
  assert.deepEqual(statuses.filter(item => item.state === 'playing').map(item => item.browserSink), ['headset', 'amp']);
  probe.volume('a', .7); assert.deepEqual(outputs.map(item => item.volumes), [[.7], []]);
  probe.stop('a'); assert.equal(outputs[1].stops, 0);
  probe.stopAll(); assert.equal(outputs[1].stops, 1);
});

test('starting one channel independently leaves the other channel playing', async () => {
  const { outputs, probe } = harness();
  const first = probe.start([config('b')]); outputs[0].resolve(); await first;
  const second = probe.start([config('a')]); outputs[1].resolve(); await second;
  assert.equal(outputs[0].plays, 1); assert.equal(outputs[0].stops, 0);
  probe.stopAll();
});

test('cancelling while the pair prepares prevents late sound and releases its peer', async () => {
  const { outputs, probe } = harness();
  const run = probe.start([config('a'), config('b')]); probe.stop('a');
  outputs.forEach(item => item.resolve()); await run;
  assert.deepEqual(outputs.map(item => item.plays), [0, 0]);
  assert.deepEqual(outputs.map(item => item.stops), [1, 1]);
});

test('an old cancelled pair cannot stop a newly started replacement channel', async () => {
  const { outputs, probe } = harness();
  const old = probe.start([config('a'), config('b')]);
  const replacement = probe.start([config('a')]); outputs[2].resolve(); await replacement;
  outputs[0].resolve(); outputs[1].resolve(); await old;
  assert.equal(outputs[2].plays, 1); assert.equal(outputs[2].stops, 0);
  assert.equal(outputs[1].stops, 1); probe.stopAll();
});

test('a failed output blocks both tracks instead of silently falling back', async () => {
  const { outputs, statuses, probe } = harness();
  const run = probe.start([config('a'), config('b')]);
  outputs[0].resolve(); outputs[1].reject(new Error('amp disconnected')); await run;
  assert.deepEqual(outputs.map(item => item.plays), [0, 0]);
  assert.deepEqual(outputs.map(item => item.stops), [1, 1]);
  assert.equal(statuses.filter(item => item.state === 'error' && item.message === 'amp disconnected').length, 2);
});

test('Web Audio creates two contexts, selects each output, and starts two looping sources', async () => {
  const previous = globalThis.AudioContext, contexts = [];
  globalThis.AudioContext = class {
    sinkId = ''; started = 0; closed = 0;
    constructor() { contexts.push(this); }
    createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
    resume() { return Promise.resolve(); }
    close() { this.closed++; return Promise.resolve(); }
    async setSinkId(id) { this.sinkId = id; }
    async decodeAudioData() { return {}; }
    createBufferSource() { const context = this; return { loop: false, connect() {}, disconnect() {}, start() { assert.equal(this.loop, true); context.started++; }, stop() {} }; }
  };
  const probe = new AudioProbe(() => {});
  try {
    await probe.start([config('a'), config('b')]);
    assert.deepEqual(contexts.map(item => item.sinkId), ['headset', 'amp']);
    assert.deepEqual(contexts.map(item => item.started), [1, 1]);
    probe.stopAll(); assert.deepEqual(contexts.map(item => item.closed), [1, 1]);
  } finally { probe.stopAll(); globalThis.AudioContext = previous; }
});

test('two local demo melodies are distinct valid WAV files with bounded amplitude', async () => {
  const buffers = await Promise.all(['a', 'b'].map(async id => Buffer.from(await demoMusic(id).arrayBuffer())));
  assert.notDeepEqual(buffers[0], buffers[1]);
  for (const buffer of buffers) {
    assert.equal(buffer.toString('ascii', 0, 4), 'RIFF'); assert.equal(buffer.toString('ascii', 8, 12), 'WAVE');
    assert.equal(buffer.readUInt32LE(40), buffer.length - 44);
    for (let at = 44; at < buffer.length; at += 2) assert.ok(Math.abs(buffer.readInt16LE(at)) < 8000);
  }
});
