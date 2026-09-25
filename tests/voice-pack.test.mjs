import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const files = { 'a.bin': 'abcdefgh', 'b.bin': '12345678' };
const manifest = { parts: ['a.bin'], assets: Object.entries(files).map(([name, content]) => ({ name, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') })) };
const source = (await readFile(new URL('../lib/voice-pack.ts', import.meta.url), 'utf8')).replace("import manifest from '../public/local-voice/v1/manifest.json';", `const manifest = ${JSON.stringify(manifest)};`);
const { loadVoicePack, isVoicePackCached } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64'));

test('real bytes, interrupted retry, partial cache, damaged cache, and unavailable storage', async () => {
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
  const stored = new Map(), requests = [], events = [];
  let fail = false;
  globalThis.caches = { async open() { return { async match(url) { return stored.get(url)?.clone(); }, async put(url, response) { stored.set(url, response); }, async delete(url) { return stored.delete(url); } }; } };
  globalThis.fetch = async url => {
    requests.push(url);
    const content = files[url.split('/').at(-1)];
    let cursor = 0;
    return new Response(new ReadableStream({ pull(controller) {
      if (fail && url.endsWith('b.bin')) { controller.error(new Error('Interrupted')); return; }
      if (cursor === content.length) { controller.close(); return; }
      controller.enqueue(new TextEncoder().encode(content.slice(cursor, cursor + 2))); cursor += 2;
    } }));
  };
  try {
    assert.equal(await isVoicePackCached(), false);
    fail = true;
    await assert.rejects(loadVoicePack(event => events.push(event)), /Interrupted/);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(events.some(event => event.progress === 100), false);
    assert.equal(stored.size, 1);
    fail = false; requests.length = 0; events.length = 0;
    const result = await loadVoicePack(event => events.push(event));
    assert.equal(result.blobs.size, 2); assert.equal(requests.length, 1);
    assert.ok(events.some(event => event.downloadedBytes > 0 && event.downloadedBytes < 16));
    for (const event of events) assert.equal(event.progress, Math.floor(event.downloadedBytes / 16 * 100));
    assert.deepEqual(events.at(-1), { progress: 100, downloadedBytes: 16, totalBytes: 16 });
    assert.equal(await isVoicePackCached(), true);
    requests.length = 0;
    await loadVoicePack(() => {}); assert.equal(requests.length, 0);
    stored.set('/local-voice/v1/a.bin', new Response('corrupt!'));
    await loadVoicePack(() => {}); assert.equal(requests.length, 1);
    globalThis.caches = { async open() { throw new Error('Storage blocked'); } };
    assert.equal(await isVoicePackCached(), false);
    assert.equal((await loadVoicePack(() => {})).blobs.size, 2);
  } finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
});
