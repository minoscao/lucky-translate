import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const url = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64');
const eventsUrl = url(await read('../lib/event-stream.ts'));
const { readEventStream, completedReply } = await import(eventsUrl);
const { coachReplyDirect, EMPTY_COACH_MEMORY } = await import(url((await read('../lib/coach.ts')).replace("'./event-stream'", JSON.stringify(eventsUrl))));
const encoder = new TextEncoder(), event = value => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);

test('SSE handles split UTF-8, CRLF, comments and multiline data', async () => {
  const bytes = encoder.encode(': keepalive\r\ndata: hello 🙂\r\ndata: second line\r\n\r\ndata: [DONE]\n\n'), output = [];
  await readEventStream(new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } })), data => output.push(data));
  assert.deepEqual(output, ['hello 🙂\nsecond line', '[DONE]']);
});

test('reply extraction accepts only a complete first top-level string', () => {
  assert.equal(completedReply('{"reply":"It is \\"nice\\"!",'.replaceAll('\\\\', '\\')), 'It is "nice"!');
  assert.equal(completedReply('{"reply":"Hello 🙂", "memory":{'), 'Hello 🙂');
  for (const input of ['{"reply":"unfinished', '{"reply":{"text":"Hello"}}', '{"memory":{"reply":"wrong"}}', '{"reply":"bad\\q",', '{"reply":""}']) assert.equal(completedReply(input), undefined);
});

test('client exposes reply before memory completes, requires final usage and does not invoke speech twice', async () => {
  const old = globalThis.fetch, replies = []; let controller, request;
  globalThis.fetch = async (_, init) => { request = JSON.parse(init.body); return new Response(new ReadableStream({ start(c) { controller = c; } }), { headers: { 'Content-Type': 'text/event-stream' } }); };
  try {
    const result = coachReplyDirect({ key: 'test', history: [], memory: EMPTY_COACH_MEMORY, turnStatus: 'hello', signal: new AbortController().signal, onReply: text => replies.push(text) });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(request.stream, true);
    controller.enqueue(event({ type: 'reply', reply: 'Hello!' })); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(replies, ['Hello!']);
    controller.enqueue(event({ type: 'result', content: JSON.stringify({ reply: 'Hello!', memory: EMPTY_COACH_MEMORY }), usage: { tokens: 17, cost: .001 } })); controller.close();
    assert.equal((await result).usage.tokens, 17); assert.deepEqual(replies, ['Hello!']);
    const second = coachReplyDirect({ key: 'test', history: [], memory: EMPTY_COACH_MEMORY, turnStatus: 'hello', signal: new AbortController().signal, onReply() {} });
    await new Promise(resolve => setImmediate(resolve)); controller.enqueue(event({ type: 'reply', reply: 'Hello!' })); controller.close();
    await assert.rejects(second, /interrupted/);
  } finally { globalThis.fetch = old; }
});
