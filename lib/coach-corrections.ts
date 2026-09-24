export type CoachCorrection = { original: string; corrected: string };

// Only annotate a literal phrase from this learner turn and the actual spoken reply.
export function validCorrection(value: unknown, original: string, reply: string): CoachCorrection | undefined {
  const item = value as CoachCorrection | null;
  if (!item || typeof item.original !== 'string' || typeof item.corrected !== 'string') return;
  if (!item.original.trim() || !item.corrected.trim() || item.original.length > 160 || item.corrected.length > 160 || item.original === item.corrected) return;
  if (!original.includes(item.original) || !reply.replaceAll('**', '').includes(item.corrected)) return;
  return { original: item.original, corrected: item.corrected };
}

export function correctionDiff(original: string, corrected: string) {
  const rows = Array.from({ length: original.length + 1 }, () => new Uint16Array(corrected.length + 1));
  for (let i = original.length - 1; i >= 0; i--) for (let j = corrected.length - 1; j >= 0; j--)
    rows[i][j] = original[i] === corrected[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const removed = new Set<number>(), added = new Set<number>();
  let i = 0, j = 0;
  while (i < original.length || j < corrected.length) {
    if (i < original.length && j < corrected.length && original[i] === corrected[j]) { i++; j++; }
    else if (j < corrected.length && (i === original.length || rows[i][j + 1] > rows[i + 1][j])) { added.add(j++); }
    else removed.add(i++);
  }
  // An omitted ending has no original character to color: mark its word instead.
  if (!removed.size && added.size) {
    let position = Math.min(original.length - 1, Math.min(...added) - 1);
    if (position < 0) position = 0;
    let start = position, end = position + 1;
    while (start > 0 && /[A-Za-z']/u.test(original[start - 1])) start--;
    while (end < original.length && /[A-Za-z']/u.test(original[end])) end++;
    for (let k = start; k < end; k++) removed.add(k);
  }
  if (!added.size && removed.size) {
    const position = Math.max(0, Math.min(corrected.length - 1, Math.min(...removed) - 1));
    let start = position, end = position + 1;
    while (start > 0 && /[A-Za-z']/u.test(corrected[start - 1])) start--;
    while (end < corrected.length && /[A-Za-z']/u.test(corrected[end])) end++;
    for (let k = start; k < end; k++) added.add(k);
  }
  return { removed, added };
}
