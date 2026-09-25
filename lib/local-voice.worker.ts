import * as ort from 'onnxruntime-web/wasm';
import { loadVoicePack } from './voice-pack';

type Config = { audio: { sample_rate: number }; espeak: { voice: string }; inference: { noise_scale: number; length_scale: number; noise_w: number } };
type Phonemizer = { callMain: (args: string[]) => void };
let session: ort.InferenceSession, config: Config, phonemizer: Phonemizer, phonemeIds: number[] | undefined;
let loading: Promise<void> | undefined;

async function prepare() {
  const { blobs, parts } = await loadVoicePack(state => postMessage({ type: 'progress', ...state }));
  postMessage({ type: 'preparing' });
  config = JSON.parse(await blobs.get('voice.json')!.text());
  const urls: string[] = [];
  const blobUrl = (name: string, type?: string) => { const url = URL.createObjectURL(type ? new Blob([blobs.get(name)!], { type }) : blobs.get(name)!); urls.push(url); return url; };
  // Runtime imports also use cached bytes, so preparation works after a reload offline.
  try {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = { wasm: blobUrl('ort-wasm-simd-threaded.wasm', 'application/wasm'), mjs: blobUrl('ort-wasm-simd-threaded.mjs', 'text/javascript') };
    const moduleUrl = blobUrl('phonemizer.js', 'text/javascript');
    const { default: createPhonemizer } = await import(/* @vite-ignore */ moduleUrl);
    const wasmUrl = blobUrl('piper_phonemize.wasm', 'application/wasm'), dataUrl = blobUrl('piper_phonemize.data');
    phonemizer = await createPhonemizer({
      locateFile: (name: string) => name.endsWith('.wasm') ? wasmUrl : dataUrl,
      print: (line: string) => { phonemeIds = JSON.parse(line).phoneme_ids; },
      printErr: () => {},
    });
    const bytes = await new Blob(parts.map(name => blobs.get(name)!)).arrayBuffer();
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    await synthesize('Hello.'); // Compile and warm the actual voice without playing it.
  } finally { urls.forEach(url => URL.revokeObjectURL(url)); }
  postMessage({ type: 'ready' });
}

async function synthesize(text: string) {
  phonemeIds = undefined;
  phonemizer.callMain(['-l', config.espeak.voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
  const ids = phonemeIds as number[] | undefined;
  if (!ids?.length) throw new Error('Could not read this text aloud. Please try again.');
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from([config.inference.noise_scale, config.inference.length_scale, config.inference.noise_w]), [3]),
  };
  const output = await session.run(feeds);
  const samples = new Float32Array(output.output.data as Float32Array);
  Object.values(feeds).forEach(tensor => tensor.dispose()); Object.values(output).forEach(tensor => tensor.dispose());
  return { samples, sampleRate: config.audio.sample_rate };
}

// Serialize inference: the reusable phonemizer and ONNX session are shared.
let queue = Promise.resolve();
self.onmessage = event => {
  const { id, text } = event.data as { id: number; text?: string };
  queue = queue.then(async () => {
    await (loading ??= prepare());
    if (text) { const result = await synthesize(text); postMessage({ type: 'audio', id, ...result }, { transfer: [result.samples.buffer] }); }
  }).catch(error => { postMessage({ type: 'error', id, message: error instanceof Error && error.name !== 'AbortError' ? error.message : 'Voice download timed out. Check your connection and retry.' }); });
};
