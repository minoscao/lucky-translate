import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { COACH_RECORDING, MAX_COACH_AUDIO_BYTES } from '../lib/recording-limits.ts';
const compile = text => ts.transpile(text, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
const strip = text => text.replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '');
const moduleUrl = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const source = await readFile(new URL('../app/api/transcribe/route.ts', import.meta.url), 'utf8');
const calls = [], costs = [];
globalThis.__lengthAi = { run: async (model, data) => { calls.push(Buffer.from(data.audio, 'base64').length); return { text: 'The final sentence is included.' }; } };
globalThis.__lengthCosts = costs;
const { POST } = await import(moduleUrl(`
import {COACH_RECORDING,MAX_COACH_AUDIO_BYTES} from '${new URL('../lib/recording-limits.ts', import.meta.url).href}';
import {audioToBase64} from '${new URL('../lib/server/audio.ts', import.meta.url).href}';
import {json,sameOrigin} from '${new URL('../lib/server/http.ts', import.meta.url).href}';
const getAi=()=>globalThis.__lengthAi,requireAccount=async()=>({id:'test'}),recordServiceCost=async(...args)=>globalThis.__lengthCosts.push(args.at(-1));
${strip(compile(source))}`));
function wav(seconds) {
  const data = Buffer.alloc(44 + seconds * 32000); data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVE', 8); data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(data.length - 44, 40); return data;
}
test('transcription accepts 29, 30, 35, 60 and 120 seconds with and without Content-Length', async () => {
  for (const seconds of [29, 30, 35, 60, COACH_RECORDING.maxSeconds]) for (const header of [false, true]) {
    const body = wav(seconds);
    const response = await POST(new Request('https://lucky.test/api/transcribe', { method: 'POST', body, headers: header ? { 'Content-Length': String(body.length) } : {} }));
    assert.equal(response.status, 200); assert.equal((await response.json()).text, 'The final sentence is included.');
    assert.equal(calls.at(-1), body.length); assert.equal(costs.at(-1).seconds, seconds);
  }
});
test('oversized streamed or declared uploads return the same explicit time limit without inference', async () => {
  const before = calls.length;
  for (const header of [false, true]) {
    const response = await POST(new Request('https://lucky.test/api/transcribe', { method: 'POST', body: Buffer.alloc(MAX_COACH_AUDIO_BYTES + 1), headers: header ? { 'Content-Length': String(MAX_COACH_AUDIO_BYTES + 1) } : {} }));
    assert.equal(response.status, 413); assert.match((await response.json()).error, /120 seconds/);
  }
  assert.equal(calls.length, before);
});

test('a long latest learner message reaches Coach without losing its final sentence', async () => {
  const eventsUrl = moduleUrl(compile(await readFile(new URL('../lib/event-stream.ts', import.meta.url), 'utf8')));
  const oldFetch = globalThis.fetch, { coachReplyDirect, EMPTY_COACH_MEMORY } = await import(moduleUrl(compile((await readFile(new URL('../lib/coach.ts', import.meta.url), 'utf8')).replace("'./event-stream'", JSON.stringify(eventsUrl)))));
  const text = 'This is part of my longer story. '.repeat(90) + 'My final question is about tomorrow.';
  let request;
  globalThis.fetch = async (_, init) => { request = JSON.parse(init.body); return Response.json({ content: JSON.stringify({ reply: 'I heard your full story.', tip: '', memory: EMPTY_COACH_MEMORY }) }); };
  try {
    await coachReplyDirect({ key: 'test', history: [{ id: 1, role: 'learner', text }], memory: EMPTY_COACH_MEMORY, turnStatus: 'complete', signal: new AbortController().signal });
    assert.equal(request.messages.find(message => message.content.startsWith('This is part')).content, text);
  } finally { globalThis.fetch = oldFetch; }
});
