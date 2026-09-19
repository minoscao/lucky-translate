/** Consume SSE without assuming that network chunks align with lines or UTF-8 characters. */
export async function readEventStream(response: Response, onData: (data: string) => void) {
  if (!response.body) throw new Error('The response stream is unavailable.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', lines: string[] = [];
  const line = (value: string) => {
    value = value.replace(/\r$/, '');
    if (!value) { if (lines.length) onData(lines.join('\n')); lines = []; }
    else if (value.startsWith('data:')) lines.push(value.slice(5).replace(/^ /, ''));
  };
  try {
    while (true) {
      const chunk = await reader.read(); pending += decoder.decode(chunk.value, { stream: !chunk.done });
      if (pending.length > 1_000_000) throw new Error('The response is too large.');
      let at: number;
      while ((at = pending.indexOf('\n')) >= 0) { line(pending.slice(0, at)); pending = pending.slice(at + 1); }
      if (chunk.done) break;
    }
    if (pending) line(pending); line('');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Only a complete first top-level reply is safe to preview; never match nested memory fields. */
export function completedReply(content: string): string | undefined {
  const match = /^\s*\{\s*"reply"\s*:\s*("(?:[^"\\]|\\[\s\S])*")\s*[,}]/.exec(content);
  if (!match) return;
  try { const reply = JSON.parse(match[1]); return typeof reply === 'string' && reply.trim() ? reply.trim() : undefined; } catch { return; }
}
