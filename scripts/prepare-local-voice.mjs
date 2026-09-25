// Run with the configured HTTPS_PROXY and NODE_USE_ENV_PROXY=1 when a proxy is enabled.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const target = new URL('../public/local-voice/v1/', import.meta.url);
const revision = 'c10ece1aade47bb51c153c893d14e5bf8e5b7117';
const origin = `https://huggingface.co/rhasspy/piper-voices/resolve/${revision}`;
const voice = 'en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx';
await mkdir(target, { recursive: true });
const download = async path => {
  const response = await fetch(`${origin}/${path}`, { signal: AbortSignal.timeout(240_000) });
  if (!response.ok) throw new Error(`Voice download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};
const model = await download(voice), parts = [];
for (let offset = 0; offset < model.length; offset += 20 * 1024 * 1024) {
  const name = `voice-${parts.length}.bin`;
  await writeFile(new URL(name, target), model.subarray(offset, offset + 20 * 1024 * 1024)); parts.push(name);
}
await writeFile(new URL('voice.json', target), await download(`${voice}.json`));
await writeFile(new URL('MODEL_CARD', target), await download('en/en_US/ljspeech/medium/MODEL_CARD'));
const piper = new URL('../node_modules/@diffusionstudio/piper-wasm/build/', import.meta.url);
for (const name of ['piper_phonemize.wasm', 'piper_phonemize.data']) await copyFile(new URL(name, piper), new URL(name, target));
await writeFile(new URL('phonemizer.js', target), (await readFile(new URL('piper_phonemize.js', piper), 'utf8')) + '\nexport default createPiperPhonemize;\n');
const ort = new URL('../node_modules/onnxruntime-web/dist/', import.meta.url);
for (const name of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) await copyFile(new URL(name, ort), new URL(name, target));
const files = [...parts, 'voice.json', 'phonemizer.js', 'piper_phonemize.wasm', 'piper_phonemize.data', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];
const assets = await Promise.all(files.map(async name => { const data = await readFile(new URL(name, target)); return { name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }; }));
await writeFile(new URL('manifest.json', target), JSON.stringify({ revision, voice: 'en_US-ljspeech-medium', parts, assets }, null, 2) + '\n');
console.log(`Prepared ${assets.length} local voice assets (${(assets.reduce((sum, file) => sum + file.bytes, 0) / 1048576).toFixed(1)} MiB).`);
