import type { TextTimeRules } from '@/lib/text-time';

export type TimeEntry = { id: string; label: string; createdAt: number; category: string; words?: number; characters?: number; chargedSeconds: number; estimatedSeconds?: number; rules?: TextTimeRules; multiplier?: number; preview?: string; note?: string };

export function TimeLedger({ entries }: { entries: TimeEntry[] }) {
  return <section className="time-ledger"><h3>Time breakdown <small>扣时明细</small></h3>{entries.length === 0 ? <p>No text-based charges yet. 尚无文字折算记录。</p> : <ol>{entries.map(entry => <li key={entry.id}>
    <details><summary><span><strong>{entry.label}</strong><small>{new Date(entry.createdAt).toLocaleString()}</small></span><b>{entry.chargedSeconds < 0 ? '+' : '−'}{Math.abs(entry.chargedSeconds)}s</b></summary>
      {entry.rules && <p>{entry.words || 0} words × {entry.rules.secondsPerWord}s + {entry.characters || 0} 字 × {entry.rules.secondsPerCharacter}s{entry.multiplier === .1 ? '，总结 × 10%' : ''} → {entry.chargedSeconds}s（不足一秒向上取整）</p>}
      {(entry.preview || entry.note) && <blockquote>{entry.note || entry.preview}</blockquote>}
    </details>
  </li>)}</ol>}</section>;
}
