'use client';
import { Input } from '@/components/ui/input';

export function PasswordFields({ id, current, onCurrent, next, onNext, confirmation, onConfirmation }: {
  id: string; current?: string; onCurrent?: (value: string) => void;
  next: string; onNext: (value: string) => void; confirmation: string; onConfirmation: (value: string) => void;
}) {
  const fields = [
    ...(onCurrent ? [{ key: 'current', label: '当前密码', value: current || '', change: onCurrent, complete: 'current-password', min: 1 }] : []),
    { key: 'next', label: '新密码', value: next, change: onNext, complete: 'new-password', min: 8 },
    { key: 'confirm', label: '再次输入新密码', value: confirmation, change: onConfirmation, complete: 'new-password', min: 8 },
  ];
  return <>{fields.map(field => <div key={field.key}><label className="field-label" htmlFor={`${id}-${field.key}`}>{field.label}</label><Input id={`${id}-${field.key}`} className="app-input" type="password" required minLength={field.min} maxLength={128} value={field.value} onChange={event => field.change(event.target.value)} autoComplete={field.complete} /></div>)}</>;
}
