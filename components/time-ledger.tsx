import type { TextTimeRules } from '@/lib/text-time';
import { formatPoints } from '@/lib/points';

export type TimeEntry = { id: string; label: string; createdAt: number; category: string; words?: number; characters?: number; chargedSeconds: number; estimatedSeconds?: number; rules?: TextTimeRules; multiplier?: number; preview?: string; note?: string };

export function TimeLedger({ entries, unit = 'seconds' }: { entries: TimeEntry[]; unit?: 'seconds' | 'points' }) {
  return <section className="time-ledger"><h3>{unit === 'points' ? '小鱼干明细' : '扣时明细'}</h3>{entries.length === 0 ? <p>尚无扣费记录。</p> : <ol>{entries.map(entry => <li key={entry.id}>
    <details><summary><span><strong>{entry.label}</strong><small>{new Date(entry.createdAt).toLocaleString()}</small></span><b>{entry.chargedSeconds < 0 ? '+' : '−'}{unit === 'points' ? formatPoints(Math.abs(entry.chargedSeconds)) : `${Math.abs(entry.chargedSeconds)}s`}</b></summary>
      {entry.rules && (unit === 'points' ? <p>{entry.words || 0} words + {entry.characters || 0} 字{entry.multiplier === .1 ? '，总结 × 10%' : ''} → {formatPoints(Math.abs(entry.chargedSeconds))}</p> : <p>{entry.words || 0} words × {entry.rules.secondsPerWord}s + {entry.characters || 0} 字 × {entry.rules.secondsPerCharacter}s{entry.multiplier === .1 ? '，总结 × 10%' : ''} → {entry.chargedSeconds}s（不足一秒向上取整）</p>)}
      {(entry.preview || entry.note) && <blockquote>{entry.note || entry.preview}</blockquote>}
    </details>
  </li>)}</ol>}</section>;
}
