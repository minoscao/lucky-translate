type Listener = (chunk: Uint8Array) => void;
type Entry = { controller: AbortController; promise: Promise<Blob>; bytes: number; chunks: Uint8Array[]; listeners: Set<Listener> };
export type SpeechResource = { audio: Promise<Blob>; subscribe: (listener: Listener) => () => void };

/** One account workspace owns one bounded, memory-only cache. */
export class SpeechCache {
  private entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(private maxBytes = 16 * 1024 * 1024, private maxEntries = 24) {}
  get(key: string, load: (signal: AbortSignal, publish: Listener) => Promise<Blob>): SpeechResource {
    const cached = this.entries.get(key);
    if (cached) { this.entries.delete(key); this.entries.set(key, cached); return this.resource(cached); }
    const controller = new AbortController();
    const entry: Entry = { controller, bytes: 0, chunks: [], listeners: new Set(), promise: Promise.resolve().then(() => load(controller.signal, chunk => {
      if (controller.signal.aborted) return;
      entry.chunks.push(chunk); for (const listener of entry.listeners) listener(chunk);
    })).then(blob => {
      if (controller.signal.aborted) throw new DOMException('Playback cancelled', 'AbortError');
      if (this.entries.get(key) === entry) { entry.bytes = blob.size; this.bytes += blob.size; this.trim(); }
      entry.chunks = []; entry.listeners.clear();
      return blob;
    }).catch(error => { if (this.entries.get(key) === entry) this.remove(key); throw error; }) };
    this.entries.set(key, entry); this.trim();
    // A prefetched resource may fail before playback reaches it.
    void entry.promise.catch(() => {});
    return this.resource(entry);
  }
  private resource(entry: Entry): SpeechResource { return { audio: entry.promise, subscribe: listener => { for (const chunk of entry.chunks) listener(chunk); entry.listeners.add(listener); return () => entry.listeners.delete(listener); } }; }
  private remove(key: string) { const entry = this.entries.get(key); if (!entry) return; this.bytes -= entry.bytes; entry.controller.abort(); entry.chunks = []; entry.listeners.clear(); this.entries.delete(key); }
  private trim() { while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) { const key = this.entries.keys().next().value; if (key === undefined) break; this.remove(key); } }
  clear() { for (const key of this.entries.keys()) this.remove(key); }
}
