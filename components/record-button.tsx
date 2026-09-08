'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { ArrowUp, LoaderCircle, Mic, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = {
  recording: boolean;
  busy?: boolean;
  disabled?: boolean;
  onStart: () => Promise<boolean>;
  onStop: (commit?: boolean) => Promise<void>;
  holdMs?: number;
  cancelDistance?: number;
};

export function RecordButton({ recording, busy = false, disabled = false, onStart, onStop, holdMs = 350, cancelDistance = 64 }: Props) {
  const press = useRef<{ id: number; y: number; started: number; cancel: boolean } | undefined>(undefined);
  const [gesture, setGesture] = useState<'idle' | 'holding' | 'cancel'>('idle');
  const stop = (commit: boolean) => { press.current = undefined; setGesture('idle'); void onStop(commit); };
  const down = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || event.isPrimary === false || press.current || busy || disabled) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    if (recording) { stop(true); return; }
    const current = { id: event.pointerId, y: event.clientY, started: performance.now(), cancel: false };
    press.current = current; setGesture('holding');
    void onStart().then(started => { if (!started && press.current === current) { press.current = undefined; setGesture('idle'); } });
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = press.current; if (current?.id !== event.pointerId) return;
    current.cancel = current.y - event.clientY >= cancelDistance;
    setGesture(current.cancel ? 'cancel' : 'holding');
  };
  const up = (event: PointerEvent<HTMLButtonElement>) => {
    const current = press.current; if (current?.id !== event.pointerId) return;
    const cancel = current.y - event.clientY >= cancelDistance;
    if (cancel || performance.now() - current.started >= holdMs) stop(!cancel);
    else { press.current = undefined; setGesture('idle'); }
  };
  const cancelPointer = (event: PointerEvent<HTMLButtonElement>) => { if (press.current?.id === event.pointerId) stop(false); };
  const feedback = gesture === 'cancel' ? '松开取消发送' : gesture === 'holding' ? '松开发送 · 上滑取消' : '正在录音 · 点击发送';
  return <div className="record-control" data-cancel={gesture === 'cancel'}>
    {(gesture !== 'idle' || recording) && <div className="record-feedback"><output aria-live="polite">{gesture === 'cancel' ? <X /> : <ArrowUp />}{feedback}</output><Button type="button" variant="ghost" className="record-cancel" onClick={() => stop(false)} aria-label="取消录音"><X /></Button></div>}
    <Button type="button" className="coach-mic" data-active={recording || gesture !== 'idle'} data-cancel={gesture === 'cancel'} disabled={busy || disabled} aria-label={recording ? '点击发送，或取消录音' : '按住说话，上滑取消；也可点击开始录音'} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelPointer} onLostPointerCapture={cancelPointer} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); stop(false); } }} onClick={event => { if (event.detail !== 0) return; if (recording) stop(true); else void onStart(); }} onContextMenu={event => event.preventDefault()}>
      {busy ? <LoaderCircle className="spinning" /> : gesture === 'cancel' ? <X /> : recording ? <Square fill="currentColor" /> : <Mic />}<span>{gesture === 'cancel' ? '松开取消' : recording ? '正在聆听…' : '按住说话'}</span>
    </Button>
  </div>;
}
