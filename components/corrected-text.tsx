import { CoachCorrection, correctionDiff } from '@/lib/coach-corrections';
import { HighlightedText } from '@/components/highlighted-text';
import { textHighlights } from '@/lib/text-highlights';

export function CorrectedText({ text, correction, learner = false }: { text: string; correction?: CoachCorrection; learner?: boolean }) {
  if (!correction || typeof correction.original !== 'string' || typeof correction.corrected !== 'string' || !correction.original || !correction.corrected || correction.original.length > 160 || correction.corrected.length > 160) return <HighlightedText text={text} />;
  const parts = learner ? [{ text, highlighted: false }] : textHighlights(text);
  const clean = parts.map(part => part.text).join(''), phrase = learner ? correction.original : correction.corrected;
  const start = clean.indexOf(phrase);
  if (start < 0) return <HighlightedText text={text} />;
  const diff = correctionDiff(correction.original, correction.corrected), changes = learner ? diff.removed : diff.added;
  let offset = 0;
  return parts.map((part, index) => {
    const from = Math.max(0, start - offset), to = Math.min(part.text.length, start + phrase.length - offset), base = offset;
    offset += part.text.length;
    const marked = part.text.slice(from, to).split('').map((character, local) => changes.has(base + from + local - start)
      ? <mark key={local} className={learner ? 'correction-original' : 'correction-fixed'}>{character}</mark> : character);
    const content = from < to ? <>{part.text.slice(0, from)}{!learner && !part.highlighted ? <strong>{marked}</strong> : marked}{part.text.slice(to)}</> : part.text;
    return part.highlighted ? <strong key={index}>{content}</strong> : <span key={index}>{content}</span>;
  });
}
