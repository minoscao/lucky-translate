'use client';
/* oxlint-disable jsx-a11y/label-has-associated-control, jsx-a11y/prefer-tag-over-role -- Base UI Select fields and the compact responsive data grid keep their own accessible names. */

import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, LoaderCircle, LogOut, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AccountSnapshot, accountRequest } from '@/lib/account';

type AdminUser = AccountSnapshot & { adminNote: string; createdAt: number; lastLoginAt: number | null };
type AdminData = {
  authenticated: boolean; deepseekConfigured: boolean; costMultiplier: number; users: AdminUser[];
  prices: Array<{ provider: string; model: string; period: string; cache_hit_micros_per_million: number; input_micros_per_million: number; output_micros_per_million: number; effective_at: number }>;
  history: Array<{ id: string; username: string; feature: string; model: string; input_tokens: number; cached_tokens: number; output_tokens: number; total_tokens: number; cost_micros: number; price_snapshot: string; created_at: number }>;
};

const duration = (seconds: number) => seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} 小时` : `${Math.round(seconds / 60)} 分钟`;
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`;
const money = (value: number) => `$${value.toFixed(4)}`;

function UserEditor({ user, refresh }: { user: AdminUser; refresh: (data: AdminData) => void }) {
  const [level, setLevel] = useState(user.level), [status, setStatus] = useState(user.status);
  const [dailyMinutes, setDailyMinutes] = useState(String(Math.round(user.limits.dailySeconds / 60))), [monthlyHours, setMonthlyHours] = useState(String(user.limits.monthlySeconds / 3600));
  const [dailyTokens, setDailyTokens] = useState(String(user.limits.dailyTokens)), [price, setPrice] = useState(String(user.monthlyPrice)), [note, setNote] = useState(user.adminNote);
  const [expires, setExpires] = useState(user.membershipExpiresAt ? new Date(user.membershipExpiresAt).toISOString().slice(0, 10) : '');
  const [saving, setSaving] = useState(false), [message, setMessage] = useState('');
  const applyPlan = (value: string) => {
    setLevel(value); setStatus('active');
    const defaults = value === 'lv1' ? [10, 0, 10000, 0] : value === 'lv2' ? [120, 0, 100000, 19.9] : [0, 100, 200000, 39.9];
    setDailyMinutes(String(defaults[0])); setMonthlyHours(String(defaults[1])); setDailyTokens(String(defaults[2])); setPrice(String(defaults[3]));
  };
  const save = async () => {
    setSaving(true); setMessage('');
    try {
      const membershipExpiresAt = expires ? new Date(`${expires}T23:59:59+08:00`).getTime() : null;
      const data = await accountRequest<AdminData>('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'update_user', id: user.id, level, status, dailySeconds: Number(dailyMinutes) * 60, monthlySeconds: Number(monthlyHours) * 3600, dailyTokens: Number(dailyTokens), monthlyPriceCents: Number(price) * 100, membershipExpiresAt, adminNote: note }) });
      refresh(data); setMessage('已保存');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  };
  return <article className="admin-user-card">
    <header><div><strong>{user.username}</strong><span>{user.email || '用户名登录'}</span></div><span className={`member-state ${user.status}`}>{user.status === 'pending' ? '待激活' : user.status === 'active' ? user.level.toUpperCase() : user.status === 'expired' ? '已到期' : '已暂停'}</span></header>
    <div className="admin-user-metrics"><span>今日计费时间 <b>{duration(user.usage.todaySeconds)}</b></span><span>训练 / 翻译 <b>{duration(user.usage.todayTrainingSeconds)} / {duration(user.usage.todayTranslationSeconds)}</b></span><span>今日 Token <b>{user.usage.todayTokens.toLocaleString()}</b></span><span>今日费用 <b>{money(user.usage.todayCost)}</b></span><span>云空间 <b>{bytes(user.storage.bytes)} / {bytes(user.storage.limitBytes)}</b></span></div>
    <div className="admin-user-fields">
      <label>会员等级<Select value={level} onValueChange={value => value && applyPlan(value)}><SelectTrigger><SelectValue>{level.toUpperCase()}</SelectValue></SelectTrigger><SelectContent><SelectItem value="lv1">Lv1 · 每日 10 分钟</SelectItem><SelectItem value="lv2">Lv2 · 每日 2 小时</SelectItem><SelectItem value="lv3">Lv3 · 每月 100 小时</SelectItem></SelectContent></Select></label>
      <label>账户状态<Select value={status} onValueChange={value => value && setStatus(value)}><SelectTrigger><SelectValue>{status}</SelectValue></SelectTrigger><SelectContent><SelectItem value="pending">待激活</SelectItem><SelectItem value="active">已激活</SelectItem><SelectItem value="suspended">暂停</SelectItem></SelectContent></Select></label>
      <label>每日分钟<Input inputMode="numeric" value={dailyMinutes} onChange={event => setDailyMinutes(event.target.value)}/></label>
      <label>每月小时<Input inputMode="decimal" value={monthlyHours} onChange={event => setMonthlyHours(event.target.value)}/></label>
      <label>每日 Token<Input inputMode="numeric" value={dailyTokens} onChange={event => setDailyTokens(event.target.value)}/></label>
      <label>月费（美元）<Input inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)}/></label>
      <label>会员到期日<Input type="date" value={expires} onChange={event => setExpires(event.target.value)}/></label>
    </div>
    <label className="admin-note">备注<Input value={note} onChange={event => setNote(event.target.value)} maxLength={500}/></label>
    <footer><span>{message}</span><Button onClick={() => void save()} disabled={saving}>{saving ? <LoaderCircle className="spinning"/> : <CheckCircle2/>}保存用户</Button></footer>
  </article>;
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData>(), [password, setPassword] = useState(''), [apiKey, setApiKey] = useState('');
  const [multiplier, setMultiplier] = useState('1.0');
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [savingKey, setSavingKey] = useState(false);
  const load = async () => { setLoading(true); try { const next = await accountRequest<AdminData>('/api/admin'); setData(next); setMultiplier(String(next.costMultiplier)); setError(''); } catch { setData(undefined); } finally { setLoading(false); } };
  useEffect(() => { queueMicrotask(() => void load()); }, []);
  const login = async (event: React.SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); setLoading(true); setError(''); try { const next = await accountRequest<AdminData>('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'login', password }) }); setData(next); setMultiplier(String(next.costMultiplier)); setPassword(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法登录'); } finally { setLoading(false); } };
  const saveKey = async (event: React.SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); setSavingKey(true); setError(''); try { const next = await accountRequest<AdminData>('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'set_deepseek_key', key: apiKey }) }); setData(next); setApiKey(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存'); } finally { setSavingKey(false); } };
  const saveMultiplier = async () => { try { const next = await accountRequest<AdminData>('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'set_cost_multiplier', multiplier: Number(multiplier) }) }); setData(next); setMultiplier(String(next.costMultiplier)); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存'); } };
  if (loading && !data) return <main className="admin-page"><div className="admin-loading"><LoaderCircle className="spinning"/>正在打开管理后台…</div></main>;
  if (!data?.authenticated) return <main className="admin-page"><form className="admin-login" onSubmit={login}><span><ShieldCheck/></span><h1>Lucky 管理后台</h1><label htmlFor="admin-password">管理密码</label><Input id="admin-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password"/>{error && <p role="alert">{error}</p>}<Button type="submit" disabled={!password || loading}>{loading ? <LoaderCircle className="spinning"/> : <KeyRound/>}进入后台</Button></form></main>;
  return <main className="admin-page"><section className="admin-shell">
    <header className="admin-header"><div><small>LUCKY CONTROL</small><h1>会员与用量</h1></div><div><Button variant="ghost" onClick={() => void load()}><RefreshCw/>刷新</Button><Button variant="outline" onClick={() => void accountRequest('/api/admin', { method: 'DELETE' }).then(() => setData(undefined))}><LogOut/>退出</Button></div></header>
    <section className="admin-overview"><article><Users/><div><strong>{data.users.length}</strong><span>注册用户</span></div></article><article><span className="pending-dot"/><div><strong>{data.users.filter(user => user.status === 'pending').length}</strong><span>待激活</span></div></article><article><KeyRound/><div><strong>{data.deepseekConfigured ? '已连接' : '未配置'}</strong><span>DeepSeek</span></div></article></section>
    <form className="admin-key-card" onSubmit={saveKey}><div><h2>DeepSeek 服务密钥</h2><p>密钥只在服务端加密保存，客户页面不会看到。</p></div><Input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={data.deepseekConfigured ? '输入新密钥即可替换' : '输入 DeepSeek API Key'} autoComplete="off"/><Button type="submit" disabled={!apiKey || savingKey}>{savingKey ? <LoaderCircle className="spinning"/> : '保存密钥'}</Button></form>
    <section className="admin-key-card"><div><h2>客户费用显示倍率</h2><p>实际 $1.00，倍率 2.0 时客户看到 $2.00。当前默认 1.0。</p></div><Input type="number" min="0.1" max="100" step="0.1" value={multiplier} onChange={event => setMultiplier(event.target.value)}/><Button type="button" onClick={() => void saveMultiplier()}>保存倍率</Button></section>
    {error && <p className="admin-error" role="alert">{error}</p>}
    <section className="admin-section"><header><h2>用户</h2><span>翻译时间按 10% 计入额度，训练时间按 100% 计入。</span></header><div className="admin-users">{data.users.map(user => <UserEditor key={user.id} user={user} refresh={setData}/>)}</div></section>
    <section className="admin-section"><header><h2>DeepSeek 当前价格</h2><span>美元 / 100 万 Token，按请求发生时的峰时或非峰时价格存档。</span></header><div className="price-grid">{data.prices.map(price => <article key={`${price.model}-${price.period}`}><strong>{price.period === 'peak' ? '峰时' : '非峰时'}</strong><span>缓存命中 ${(price.cache_hit_micros_per_million / 1_000_000).toFixed(4)}</span><span>输入 ${(price.input_micros_per_million / 1_000_000).toFixed(3)}</span><span>输出 ${(price.output_micros_per_million / 1_000_000).toFixed(3)}</span></article>)}</div></section>
    <section className="admin-section"><header><h2>最近 Token 记录</h2><span>最多显示最近 200 次。</span></header><div className="usage-table" role="table"><div className="usage-row usage-head" role="row"><span>用户</span><span>功能</span><span>Token</span><span>费用</span><span>时间</span></div>{data.history.map(item => <div className="usage-row" role="row" key={item.id}><span>{item.username}</span><span>{item.feature}</span><span>{item.total_tokens.toLocaleString()}</span><span>{money(item.cost_micros / 1_000_000)}</span><span>{new Date(item.created_at).toLocaleString('zh-CN')}</span></div>)}</div></section>
  </section></main>;
}
