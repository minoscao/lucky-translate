'use client';
import { useEffect, useRef, useState } from 'react';
import { KeyRound, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PasswordFields } from '@/components/password-fields';
import { accountRequest } from '@/lib/account';

export default function ResetPasswordPage() {
  const [token, setToken] = useState(''), [next, setNext] = useState(''), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const captured=useRef(false);
  useEffect(() => { if(captured.current)return;captured.current=true; setToken(location.hash.slice(1)); history.replaceState(null, '', location.pathname); }, []);
  const submit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; setError('');
    if (next !== confirmation) { setError('两次输入的新密码不一致'); return; }
    setBusy(true);
    try { await accountRequest('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'reset-password', token, nextPassword: next, confirmPassword: confirmation }) }); setSaved(true); setToken(''); setNext(''); setConfirmation(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法重设密码'); }
    finally { setBusy(false); }
  };
  return <main className="access-page"><section className="access-card"><div className="access-mark"><KeyRound /></div><h1>{saved ? '密码已更新' : '重设密码'}</h1>{saved ? <><p>请使用新密码重新登录。</p><a href="/">返回登录</a></> : <form onSubmit={submit}><fieldset disabled={busy} className="admin-editor-fields"><PasswordFields id="reset" next={next} onNext={setNext} confirmation={confirmation} onConfirmation={setConfirmation} />{error && <p role="alert" className="form-error">{error}</p>}<Button className="form-submit" type="submit" disabled={busy || !token || next.length < 8 || !confirmation}>{busy && <LoaderCircle className="spinning" />}保存新密码</Button><a href="/">返回登录</a></fieldset></form>}</section></main>;
}
