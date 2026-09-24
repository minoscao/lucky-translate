import { CoachCorrection, correctionDiff } from '@/lib/coach-corrections';
import { HighlightedText } from '@/components/highlighted-text';

export function CorrectedText({ text, correction, learner = false }: { text: string; correction?: CoachCorrection; learner?: boolean }) {
  if (!correction || typeof correction.original !== 'string' || typeof correction.corrected !== 'string' || !correction.original || !correction.corrected || correction.original.length > 160 || correction.corrected.length > 160) return <HighlightedText text={text} />;
  const clean = text.replaceAll('**', ''), phrase = learner ? correction.original : correction.corrected;
  const start = clean.indexOf(phrase);
  if (start < 0) return <HighlightedText text={text} />;
  const diff = correctionDiff(correction.original, correction.corrected), changes = learner ? diff.removed : diff.added;
  const marked = phrase.split('').map((character, index) => changes.has(index)
    ? <mark key={index} className={learner ? 'correction-original' : 'correction-fixed'}>{character}</mark> : character);
  return <>{clean.slice(0, start)}{learner ? <span aria-label={`Original: ${phrase}`}>{marked}</span> : <strong aria-label={`Correction: ${phrase}`}>{marked}</strong>}{clean.slice(start + phrase.length)}</>;
}
