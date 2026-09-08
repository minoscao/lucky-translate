export type TextPart = { text: string; highlighted: boolean };

export function textHighlights(text: string, phrases: readonly string[] = []): TextPart[] {
  const marked: string[] = [];
  const plain = text.replace(/\*\*([^*]+)\*\*/g, (_match, phrase: string) => { marked.push(phrase); return phrase; });
  const ranges: Array<[number, number]> = [];
  for (const phrase of [...phrases, ...marked]) {
    if (typeof phrase !== 'string' || !phrase.trim()) continue;
    const needle = phrase.trim().toLocaleLowerCase('en-US'), haystack = plain.toLocaleLowerCase('en-US');
    let start = haystack.indexOf(needle);
    while (start !== -1) {
      const end = start + needle.length;
      if ((!start || !/[\p{L}\p{N}]/u.test(plain[start - 1])) && (end === plain.length || !/[\p{L}\p{N}]/u.test(plain[end]))) ranges.push([start, end]);
      start = haystack.indexOf(needle, end);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const parts: TextPart[] = []; let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: plain.slice(cursor, start), highlighted: false });
    parts.push({ text: plain.slice(start, end), highlighted: true }); cursor = end;
  }
  if (cursor < plain.length) parts.push({ text: plain.slice(cursor), highlighted: false });
  return parts;
}

// Earlier saved recalls predate explicit highlight spans. Only infer clear patterns.
export function grammarHighlights(item: { point: string; example: string; highlights?: string[] }): string[] {
  if (Array.isArray(item.highlights) && item.highlights.length) return item.highlights;
  const phrases = Array.from(item.point.matchAll(/['‘“"]([^'’”"]+)['’”"]/g), match => match[1]);
  if (/frequency|adverbs/i.test(item.point)) phrases.push(...item.example.match(/\b(?:always|usually|often|sometimes|rarely|seldom|never|normally)\b/gi) || []);
  if (/present simple/i.test(item.point)) {
    for (const match of item.example.matchAll(/\b(?:I|you|we|they|he|she|it)\s+(?:(?:always|usually|often|sometimes|rarely|seldom|never|normally)\s+)?([a-z]+)\b/gi)) phrases.push(match[1]);
    for (const match of item.example.matchAll(/\b(?:and|but)\s+(?:(?:always|usually|often|sometimes|rarely|seldom|never|normally)\s+)?([a-z]+)\b/gi)) phrases.push(match[1]);
  }
  if (/gerund/i.test(item.point)) {
    for (const match of item.example.matchAll(/\b(?:enjoy|avoid|finish|keep|consider|practice|practise|without|after|before|by)\s+([a-z]+ing)\b/gi)) phrases.push(match[1]);
  }
  return phrases;
}
