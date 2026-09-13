/** Play complete audio segments in order, preparing one segment ahead. */
export async function playAudioSegments<T>({ segments, prepare, audio, signal, speed = 1, beforePlay }: {
  segments: T[]; prepare: (segment: T) => Promise<Blob>; audio: HTMLAudioElement; signal: AbortSignal; speed?: number; beforePlay?: () => Promise<void>;
}) {
  if (signal.aborted || !segments.length) return;
  const load = (segment: T) => prepare(segment).then(blob => ({ blob })).catch((error: unknown) => ({ error }));
  let next = load(segments[0]), url = '';
  try {
    for (let index = 0; index < segments.length; index++) {
      const result = await next;
      if (signal.aborted) return;
      if ('error' in result) throw result.error;
      if (index + 1 < segments.length) next = load(segments[index + 1]);
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(result.blob); audio.src = url; audio.playbackRate = speed;
      await beforePlay?.();
      if (signal.aborted) return;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { audio.onended = null; audio.onerror = null; signal.removeEventListener('abort', cancelled); };
        const cancelled = () => { audio.pause(); cleanup(); resolve(); };
        audio.onended = () => { cleanup(); resolve(); };
        audio.onerror = () => { cleanup(); reject(new Error('Audio playback failed. Please try again.')); };
        signal.addEventListener('abort', cancelled, { once: true });
        void audio.play().catch(error => { cleanup(); reject(error); });
      });
    }
  } finally {
    audio.pause(); audio.removeAttribute('src'); audio.load();
    if (url) URL.revokeObjectURL(url);
  }
}
