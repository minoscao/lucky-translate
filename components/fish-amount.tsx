import { FishSymbol } from 'lucide-react';
import { pointsForSeconds } from '@/lib/points';

export function FishAmount({ seconds, label }: { seconds: number; label?: string }) {
  const value = pointsForSeconds(seconds).toLocaleString('en-US', { maximumFractionDigits: 2 });
  return <span className="fish-amount">
    {label && <span className="fish-amount-label">{label}</span>}
    <span>{value}</span><FishSymbol role="img" aria-label="dried fish" aria-hidden={false} />
  </span>;
}
