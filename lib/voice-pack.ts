import manifest from '../public/local-voice/v1/manifest.json';

export const VOICE_PACK_BASE = '/local-voice/v1/';
export const VOICE_PACK_CACHE = 'lucky-local-voice-v1';
export const VOICE_PACK_BYTES = manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0);
export type VoiceDownload = { progress: number; downloadedBytes: number; totalBytes: number };

async function openCache() {
  try { return await globalThis.caches?.open(VOICE_PACK_CACHE); } catch { return undefined; }
}

export async function isVoicePackCached() {
  const cache = await openCache();
  if (!cache) return false;
  try {
    const hits = await Promise.all(manifest.assets.map(asset => cache.match(VOICE_PACK_BASE + asset.name)));
    return hits.every(Boolean);
  } catch { return false; }
}

export async function loadVoicePack(notify: (state: VoiceDownload) => void) {
  const cache = await openCache(), blobs = new Map<string, Blob>(), loaded = new Map<string, number>();
  const progress = () => {
    const downloadedBytes = [...loaded.values()].reduce((a, b) => a + b, 0);
    notify({ progress: Math.floor(downloadedBytes / VOICE_PACK_BYTES * 100), downloadedBytes, totalBytes: VOICE_PACK_BYTES });
  };
  const valid = async (blob: Blob, asset: typeof manifest.assets[number]) => {
    if (blob.size !== asset.bytes) return false;
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
    return digest === asset.sha256;
  };
  progress();
  // Limit simultaneous downloads to reduce temporary memory use on phones.
  let cursor = 0;
  const download = async () => {
    while (cursor < manifest.assets.length) {
      const asset = manifest.assets[cursor++], url = VOICE_PACK_BASE + asset.name;
      const hit = await cache?.match(url);
      let blob = hit ? await hit.blob() : undefined;
      if (blob && !await valid(blob, asset)) { await cache?.delete(url); blob = undefined; }
      if (!blob) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 180_000);
        try {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok || !response.body) throw new Error('Voice download interrupted. Check your connection and retry.');
          const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
          let bytes = 0;
          try {
            while (true) {
              const { value, done } = await reader.read(); if (done) break;
              chunks.push(value); bytes += value.length;
              if (bytes > asset.bytes) throw new Error('The voice file has changed. Refresh the page and try again.');
              loaded.set(asset.name, bytes); progress();
            }
          } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
          blob = new Blob(chunks);
          if (!await valid(blob, asset)) throw new Error('Voice download was incomplete or damaged. Please retry.');
          await cache?.put(url, new Response(blob)).catch(() => {});
        } finally { clearTimeout(timer); }
      }
      blobs.set(asset.name, blob); loaded.set(asset.name, asset.bytes); progress();
    }
  };
  await Promise.all([download(), download()]);
  return { blobs, parts: manifest.parts };
}
