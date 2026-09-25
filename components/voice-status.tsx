import { Button } from '@/components/ui/button';
import type { VoiceState } from '@/lib/local-speech';

export function VoiceStatus({ state, onRetry }: { state?: VoiceState; onRetry?: () => void }) {
  if (state?.state === 'loading') return <div className="coach-audio-status"><output>{state.phase === 'preparing' ? 'Preparing voice engine…' : `Downloading voice engine… ${state.progress}%`}</output></div>;
  if (state?.state === 'error') return <div className="coach-audio-status"><span role="alert">{state.error}</span><Button variant="ghost" onClick={onRetry}>Retry voice</Button></div>;
  return null;
}
