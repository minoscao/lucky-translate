import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = (await readFile(new URL('../lib/local-speech.ts', import.meta.url), 'utf8')).replace("import workerUrl from './local-voice.worker?worker&url';", "const workerUrl = '/test-worker.js';");
const { LocalSpeech } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64'));
const tick = () => new Promise(resolve => setImmediate(resolve));

test('100 percent download stays in preparing until the worker finishes warming up', async () => {
  const env = environment();
  try {
    let ready = false;
    const preparation = env.engine.prepare().then(() => { ready = true; });
    env.workers[0].emit({ type: 'progress', progress: 35, downloadedBytes: 35, totalBytes: 100 });
    assert.equal(env.states.at(-1).downloadedBytes, 35);
    env.workers[0].emit({ type: 'preparing' }); await tick();
    assert.equal(env.states.at(-1).phase, 'preparing');
    assert.equal(env.states.at(-1).progress, 100); assert.equal(ready, false);
    env.workers[0].emit({ type: 'ready' }); await preparation;
    assert.equal(env.states.at(-1).state, 'ready');
  } finally { env.restore(); }
});

function environment() {
  const old = globalThis.AudioContext, workers = [], sources = [], states = [];
  let resumes = 0, closes = 0;
  globalThis.AudioContext = class {
    state = 'suspended'; destination = {};
    resume() { resumes++; this.state = 'running'; return Promise.resolve(); }
    close() { closes++; this.state = 'closed'; return Promise.resolve(); }
    createBuffer() { return { copyToChannel() {} }; }
    createBufferSource() { const node = { playbackRate: {}, connect() {}, disconnect() {}, start() { node.started = true; }, stop() { node.stopped = true; } }; sources.push(node); return node; }
  };
  const factory = () => {
    const worker = { sent: [], terminated: false, postMessage(message) { this.sent.push(message); }, terminate() { this.terminated = true; }, emit(data) { this.onmessage({ data }); } };
    workers.push(worker); return worker;
  };
  const engine = new LocalSpeech(state => states.push(state), factory);
  return { engine, workers, sources, states, resumes: () => resumes, closes: () => closes, restore() { engine.dispose(); globalThis.AudioContext = old; } };
}

test('preloads only once, resumes inside the gesture, synthesizes locally and replays cached audio', async () => {
  const env = environment();
  try {
    const ready = env.engine.prepare(); assert.equal(env.engine.prepare(), ready);
    env.workers[0].emit({ type: 'ready' }); await ready;
    let started = 0;
    const signal = new AbortController().signal;
    const play = env.engine.play(['Hello.'], signal, 1.5, () => started++);
    assert.equal(env.resumes(), 1); await tick();
    assert.equal(env.workers[0].sent[1].text, 'Hello.');
    env.workers[0].emit({ type: 'audio', id: 1, samples: new Float32Array([.1, -.1]), sampleRate: 22050 }); await tick();
    assert.equal(started, 1); assert.equal(env.sources[0].playbackRate.value, 1.5);
    env.sources[0].onended(); await play;
    const replay = env.engine.play(['Hello.'], signal, .75, () => started++); await tick();
    assert.equal(env.workers[0].sent.length, 2); assert.equal(env.resumes(), 1);
    env.sources[1].onended(); await replay; assert.equal(started, 2);
  } finally { env.restore(); }
});

test('Stop during download or inference rejects promptly and cannot play late audio', async () => {
  const env = environment();
  try {
    const first = new AbortController();
    const loading = env.engine.play(['First.'], first.signal, 1, () => assert.fail()); await tick();
    first.abort(); await assert.rejects(loading, { name: 'AbortError' });
    env.workers[0].emit({ type: 'ready' }); await tick(); assert.equal(env.workers[0].sent.length, 1);
    const second = new AbortController();
    const generating = env.engine.play(['Second.'], second.signal, 1, () => assert.fail()); await tick();
    second.abort(); await assert.rejects(generating, { name: 'AbortError' });
    env.workers[0].emit({ type: 'audio', id: 1, samples: new Float32Array(10), sampleRate: 22050 }); await tick();
    assert.equal(env.sources.length, 0);
  } finally { env.restore(); }
});

test('Stop immediately silences sound; retry replaces a failed worker; logout releases the engine', async () => {
  const env = environment();
  try {
    const first = env.engine.prepare();
    env.workers[0].emit({ type: 'error', id: 0, message: 'Download interrupted' });
    await assert.rejects(first, /interrupted/); assert.equal(env.workers[0].terminated, true);
    const ready = env.engine.prepare(); env.workers[1].emit({ type: 'ready' }); await ready;
    const controller = new AbortController(), play = env.engine.play(['Hello'], controller.signal, 1, () => {}); await tick();
    env.workers[1].emit({ type: 'audio', id: 1, samples: new Float32Array(10), sampleRate: 22050 }); await tick();
    controller.abort(); await assert.rejects(play, { name: 'AbortError' }); assert.equal(env.sources[0].stopped, true);
    env.engine.dispose(); assert.equal(env.workers[1].terminated, true); assert.equal(env.closes(), 1);
    await assert.rejects(env.engine.prepare(), { name: 'AbortError' });
  } finally { env.restore(); }
});
