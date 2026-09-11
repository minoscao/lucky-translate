import type { TextTimeRules } from '@/lib/text-time';
import { FishAmount } from '@/components/fish-amount';

export type TimeEntry = { id: string; label: string; createdAt: number; category: string; words?: number; characters?: number; chargedSeconds: number; estimatedSeconds?: number; rules?: TextTimeRules; multiplier?: number; preview?: string; note?: string };

export function TimeLedger({ entries, unit = 'seconds' }: { entries: TimeEntry[]; unit?: 'seconds' | 'points' }) {
  const labels: Record<string, string> = { training: 'English Coach', translation: 'Translator', summary: 'Conversation recap', adjustment: 'Usage adjustment' };
  return <section className="time-ledger"><h3>{unit === 'points' ? 'Fish usage' : 'Time usage'}</h3>{entries.length === 0 ? <p>No usage recorded yet.</p> : <ol>{entries.map(entry => <li key={entry.id}>
    <details><summary><span><strong>{labels[entry.category] || entry.label}</strong><small>{new Date(entry.createdAt).toLocaleString('en-US')}</small></span><b>{entry.chargedSeconds < 0 ? '+' : '−'}{unit === 'points' ? <FishAmount seconds={Math.abs(entry.chargedSeconds)} /> : `${Math.abs(entry.chargedSeconds)}s`}</b></summary>
      {entry.rules && (unit === 'points' ? <p>{entry.words || 0} words + {entry.characters || 0} characters{entry.multiplier === .1 ? ', recap × 10%' : ''} → <FishAmount seconds={Math.abs(entry.chargedSeconds)} /></p> : <p>{entry.words || 0} words × {entry.rules.secondsPerWord}s + {entry.characters || 0} characters × {entry.rules.secondsPerCharacter}s{entry.multiplier === .1 ? ', recap × 10%' : ''} → {entry.chargedSeconds}s (rounded up)</p>)}
      {(entry.preview || entry.note) && <blockquote>{entry.category === 'adjustment' && entry.note ? 'Previous usage was adjusted. Model cost records are unchanged.' : entry.note || entry.preview}</blockquote>}
    </details>
  </li>)}</ol>}</section>;
}
