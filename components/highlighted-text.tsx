import { textHighlights } from '@/lib/text-highlights';

export function HighlightedText({ text, highlights, variant = 'emphasis' }: { text: string; highlights?: string[]; variant?: 'emphasis' | 'study' }) {
  return textHighlights(text, highlights).map((part, index) => !part.highlighted ? part.text : variant === 'study'
    ? <mark className="study-highlight" key={index}>{part.text}</mark>
    : <strong key={index}>{part.text}</strong>);
}
