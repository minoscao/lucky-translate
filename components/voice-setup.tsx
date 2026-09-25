'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { VoiceState } from '@/lib/local-speech';
import { VOICE_PACK_BYTES } from '@/lib/voice-pack';

const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1);

export function VoiceSetup({ open, state, onDownload, onClose }: { open: boolean; state: VoiceState; onDownload: () => void; onClose: () => void }) {
  const loading = state.state === 'loading', ready = state.state === 'ready', failed = state.state === 'error';
  const preparing = loading && state.phase === 'preparing';
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="app-dialog voice-setup" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>{ready ? 'Voice engine ready' : failed ? 'Voice download interrupted' : preparing ? 'Preparing your voice engine' : loading ? 'Downloading voice engine' : 'Download Lucky’s voice'}</DialogTitle>
        <DialogDescription>{ready ? 'Download complete. Lucky can now speak on this device.' : 'Download the English voice pack once for this browser. Speech is generated on your device, with no cloud speech charge.'}</DialogDescription>
      </DialogHeader>
      {!loading && !ready && !failed && <p className="voice-download-size">{megabytes(VOICE_PACK_BYTES)} MB · Wi-Fi recommended</p>}
      {(loading || ready) && <div className="voice-download-progress">
        <div><strong>{ready || preparing ? 100 : state.progress}%</strong><span>{preparing ? 'Download complete · Preparing…' : ready ? 'Ready to use' : `${megabytes(state.downloadedBytes || 0)} / ${megabytes(state.totalBytes || VOICE_PACK_BYTES)} MB`}</span></div>
        <progress max={100} value={ready || preparing ? 100 : state.progress} aria-label="Voice engine download" />
        <p role="status">{preparing ? 'The files are downloaded. Starting the voice engine…' : ready ? 'Your English voice is ready.' : 'Keep this page open while the voice downloads.'}</p>
      </div>}
      {failed && <p className="coach-error" role="alert">{state.error || 'Check your connection and try again. Completed files will be reused.'}</p>}
      <div className="voice-download-actions">
        {ready ? <Button onClick={onClose}>Continue</Button> : !loading && <Button onClick={onDownload}>{failed ? 'Retry download' : 'Download voice engine'}</Button>}
        {!ready && <Button variant="ghost" onClick={onClose}>{loading ? 'Continue in text while downloading' : 'Use text for now'}</Button>}
      </div>
      <small>The voice pack is reused when available. Clearing browser storage may require another download.</small>
    </DialogContent>
  </Dialog>;
}
