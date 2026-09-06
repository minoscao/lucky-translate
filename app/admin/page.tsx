'use client';
/* oxlint-disable jsx-a11y/label-has-associated-control, jsx-a11y/prefer-tag-over-role -- Base UI fields retain their visible accessible labels. */

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CreditCard, KeyRound, LoaderCircle, LogOut, RefreshCw, Settings2, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { AccountSnapshot, accountRequest } from '@/lib/account';

type AdminUser = AccountSnapshot & { adminNote: string; createdAt: number; lastLoginAt: number | null };
type Payment = { id: string; user_id: string; username: string; amount_cents: number; currency: string; status: string; note: string; paid_at: number; created_at: number };
type Usage = { id: string; username: string; feature: string; model: string; input_tokens: number; cached_tokens: number; output_tokens: number; total_tokens: number; cost_micros: number; price_snapshot: string; created_at: number };
type AdminData = {
  authenticated: boolean; deepseekConfigured: boolean; costMultiplier: number; users: AdminUser[]; payments: Payment[]; history: Usage[];
  businessUnlocked: boolean; coachSkill: string;
  prices: Array<{ provider: string; model: string; period: string; cache_hit_micros_per_million: number; input_micros_per_million: number; output_micros_per_million: number; effective_at: number }>;
};
type Tab = 'business' | 'clients' | 'payment';

const duration = (seconds: number) => seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} 小时` : `${Math.round(seconds / 60)} 分钟`;
const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`;
const money = (value: number) => `$${value.toFixed(2)}`;
const stateLabel = (status: string) => status === 'pending' ? '待激活' : status === 'active' ? '已激活' : status === 'expired' ? '已到期' : '已暂停';

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
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); } finally { setSaving(false); }
  };
  return <article className="admin-user-card">
    <header><div><strong>{user.username}</strong><span>{user.email || '用户名登录'} · 最近登录 {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString('zh-CN') : '尚未登录'}</span></div><span className={`member-state ${user.status}`}>{stateLabel(user.status)} · {user.level.toUpperCase()}</span></header>
    <div className="admin-user-metrics"><span>今日计费 <b>{duration(user.usage.todaySeconds)}</b></span><span>训练 / 翻译 <b>{duration(user.usage.todayTrainingSeconds)} / {duration(user.usage.todayTranslationSeconds)}</b></span><span>今日 Token <b>{user.usage.todayTokens.toLocaleString()}</b></span><span>今日成本 <b>{money(user.usage.todayCost)}</b></span><span>云空间 <b>{bytes(user.storage.bytes)} / {bytes(user.storage.limitBytes)}</b></span></div>
    <div className="admin-user-fields">
      <label>会员等级<Select value={level} onValueChange={value => value && applyPlan(value)}><SelectTrigger><SelectValue>{level.toUpperCase()}</SelectValue></SelectTrigger><SelectContent><SelectItem value="lv1">Lv1 · 每日 10 分钟</SelectItem><SelectItem value="lv2">Lv2 · 每日 2 小时</SelectItem><SelectItem value="lv3">Lv3 · 每月 100 小时</SelectItem></SelectContent></Select></label>
      <label>账户状态<Select value={status} onValueChange={value => value && setStatus(value)}><SelectTrigger><SelectValue>{status}</SelectValue></SelectTrigger><SelectContent><SelectItem value="pending">待激活</SelectItem><SelectItem value="active">已激活</SelectItem><SelectItem value="suspended">暂停</SelectItem></SelectContent></Select></label>
      <label>每日分钟<Input inputMode="numeric" value={dailyMinutes} onChange={event => setDailyMinutes(event.target.value)} /></label>
      <label>每月小时<Input inputMode="decimal" value={monthlyHours} onChange={event => setMonthlyHours(event.target.value)} /></label>
      <label>每日 Token<Input inputMode="numeric" value={dailyTokens} onChange={event => setDailyTokens(event.target.value)} /></label>
      <label>月费（美元）<Input inputMode="decimal" value={price} onChange={event => setPrice(event.target.value)} /></label>
      <label>会员到期日<Input type="date" value={expires} onChange={event => setExpires(event.target.value)} /></label>
    </div>
    <label className="admin-note">备注<Input value={note} onChange={event => setNote(event.target.value)} maxLength={500} /></label>
    <footer><span>{message}</span><Button onClick={() => void save()} disabled={saving}>{saving ? <LoaderCircle className="spinning" /> : <CheckCircle2 />}保存客户</Button></footer>
  </article>;
}

function BusinessSettings({ data, update, error }: { data: AdminData; update: (data: AdminData) => void; error: (value: string) => void }) {
  const [apiKey, setApiKey] = useState(''), [multiplier, setMultiplier] = useState(String(data.costMultiplier)), [skill, setSkill] = useState(data.coachSkill), [superPassword, setSuperPassword] = useState('');
  const [saving, setSaving] = useState(false), [message, setMessage] = useState('');
  const request = async (body: Record<string, unknown>) => {
    setSaving(true); setMessage(''); error('');
    try { const next = await accountRequest<AdminData>('/api/admin', { method: 'POST', body: JSON.stringify(body) }); update(next); setMessage('已保存'); }
    catch (cause) { error(cause instanceof Error ? cause.message : '保存失败'); } finally { setSaving(false); }
  };
  return <div className="admin-tab-content">
    <section className="admin-key-card"><div><h2>DeepSeek 服务密钥</h2><p>仅在服务端加密保存，客户页面不会显示。</p></div><Input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={data.deepseekConfigured ? '输入新密钥即可替换' : '输入 DeepSeek API Key'} autoComplete="off" /><Button type="button" onClick={() => void request({ action: 'set_deepseek_key', key: apiKey }).then(() => setApiKey(''))} disabled={!apiKey || saving}>{saving ? <LoaderCircle className="spinning" /> : '保存密钥'}</Button></section>
    <section className="admin-key-card"><div><h2>客户费用显示倍率</h2><p>实际 $1.00，倍率 2.0 时客户看到 $2.00。</p></div><Input type="number" min="0.1" max="100" step="0.1" value={multiplier} onChange={event => setMultiplier(event.target.value)} /><Button type="button" onClick={() => void request({ action: 'set_cost_multiplier', multiplier: Number(multiplier) })} disabled={saving}>保存倍率</Button></section>
    <section className="admin-section skill-section"><header><div><p className="admin-eyebrow">COACH</p><h2>Current coach skill</h2><span>当前使用的完整规则。未解锁时只能阅读。</span></div>{data.businessUnlocked && <span className="member-state active">可编辑</span>}</header>
      {data.businessUnlocked ? <Textarea className="admin-skill" value={skill} maxLength={20_000} onChange={event => setSkill(event.target.value)} /> : <pre className="admin-skill admin-skill-readonly">{data.coachSkill}</pre>}
      {data.businessUnlocked ? <footer className="admin-action-footer"><span>{message}</span><Button type="button" onClick={() => void request({ action: 'update_coach_skill', skill })} disabled={saving}>{saving ? <LoaderCircle className="spinning" /> : <CheckCircle2 />}保存 Coach skill</Button></footer> : <form className="super-admin-unlock" onSubmit={event => { event.preventDefault(); void request({ action: 'unlock_business', password: superPassword }).then(() => setSuperPassword('')); }}><Input type="password" value={superPassword} onChange={event => setSuperPassword(event.target.value)} placeholder="输入超级管理员密码以启用编辑" autoComplete="current-password" /><Button type="submit" disabled={!superPassword || saving}><KeyRound />启用编辑</Button></form>}
    </section>
    <section className="admin-section"><header><h2>DeepSeek 当前价格</h2><span>美元 / 100 万 Token，按请求发生时的峰时或非峰时价格存档。</span></header><div className="price-grid">{data.prices.map(price => <article key={`${price.model}-${price.period}`}><strong>{price.period === 'peak' ? '峰时' : '非峰时'}</strong><span>缓存命中 ${(price.cache_hit_micros_per_million / 1_000_000).toFixed(4)}</span><span>输入 ${(price.input_micros_per_million / 1_000_000).toFixed(3)}</span><span>输出 ${(price.output_micros_per_million / 1_000_000).toFixed(3)}</span></article>)}</div></section>
  </div>;
}

function ClientGrid({ users, select }: { users: AdminUser[]; select: (user: AdminUser) => void }) {
  return <section className="admin-section clients-section"><header><div><p className="admin-eyebrow">CLIENT DIRECTORY</p><h2>客户</h2><span>按状态、套餐和今日使用情况快速扫描。点击任一行打开详情。</span></div><strong>{users.length} 位客户</strong></header><div className="client-list"><div className="client-list-head"><span>客户</span><span>会员</span><span>今日使用</span><span>Token / 成本</span><span>云空间</span><span /></div>{users.map(user => <button className="client-list-row" type="button" key={user.id} aria-label={`打开 ${user.username} 的客户详情`} onClick={() => select(user)}><span><strong>{user.username}</strong><small>{user.email || '用户名登录'}</small></span><span><b className={`member-state ${user.status}`}>{user.level.toUpperCase()}</b><small>{stateLabel(user.status)}</small></span><span><strong>{duration(user.usage.todaySeconds)}</strong><small>训练 {duration(user.usage.todayTrainingSeconds)} · 翻译 {duration(user.usage.todayTranslationSeconds)}</small></span><span><strong>{user.usage.todayTokens.toLocaleString()}</strong><small>{money(user.usage.todayCost)}</small></span><span><strong>{bytes(user.storage.bytes)}</strong><small>上限 {bytes(user.storage.limitBytes)}</small></span><span className="client-list-open">查看</span></button>)}</div></section>;
}

function Payments({ data, update, error }: { data: AdminData; update: (data: AdminData) => void; error: (value: string) => void }) {
  const [userId, setUserId] = useState(''), [amount, setAmount] = useState(''), [note, setNote] = useState(''), [saving, setSaving] = useState(false);
  const paid = data.payments.reduce((total, item) => total + item.amount_cents, 0) / 100;
  const monthlyExpected = data.users.filter(user => user.status === 'active').reduce((total, user) => total + user.monthlyPrice, 0);
  const apiCost = data.history.reduce((total, item) => total + item.cost_micros, 0) / 1_000_000;
  const save = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); error('');
    try { const next = await accountRequest<AdminData>('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'record_payment', userId, amountCents: Math.round(Number(amount) * 100), note }) }); update(next); setAmount(''); setNote(''); }
    catch (cause) { error(cause instanceof Error ? cause.message : '无法登记收款'); } finally { setSaving(false); }
  };
  return <div className="admin-tab-content"><section className="admin-overview payment-overview"><article><CreditCard /><div><strong>{money(paid)}</strong><span>累计已登记收款</span></div></article><article><Users /><div><strong>{money(monthlyExpected)}</strong><span>当前每月应收</span></div></article><article><Settings2 /><div><strong>{money(apiCost)}</strong><span>最近 200 次模型成本</span></div></article></section>
    <section className="admin-section"><header><div><h2>登记收款</h2><span>收到线下付款后在这里记一笔，方便和会员费、模型成本核对。</span></div></header><form className="payment-form" onSubmit={save}><Select value={userId} onValueChange={value => setUserId(value || '')}><SelectTrigger><SelectValue placeholder="选择客户" /></SelectTrigger><SelectContent>{data.users.map(user => <SelectItem key={user.id} value={user.id}>{user.username} · {user.level.toUpperCase()}</SelectItem>)}</SelectContent></Select><Input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="金额（美元）" /><Input value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="备注，例如 9 月会员费" /><Button type="submit" disabled={!userId || !amount || saving}>{saving ? <LoaderCircle className="spinning" /> : <CheckCircle2 />}登记收款</Button></form></section>
    <section className="admin-section"><header><h2>收款记录</h2><span>只显示已登记的实际收款。</span></header><div className="usage-table" role="table"><div className="payment-row usage-head" role="row"><span>客户</span><span>金额</span><span>状态</span><span>备注</span><span>时间</span></div>{data.payments.map(item => <div className="payment-row" role="row" key={item.id}><span>{item.username}</span><span>{money(item.amount_cents / 100)}</span><span>已收款</span><span>{item.note || '—'}</span><span>{new Date(item.paid_at).toLocaleString('zh-CN')}</span></div>)}{!data.payments.length && <p className="admin-empty">暂时没有登记收款。</p>}</div></section>
    <section className="admin-section"><header><h2>近期模型成本</h2><span>用于对照收款，成本与实际收款不会混在一起。</span></header><div className="usage-table" role="table"><div className="usage-row usage-head" role="row"><span>用户</span><span>功能</span><span>Token</span><span>费用</span><span>时间</span></div>{data.history.map(item => <div className="usage-row" role="row" key={item.id}><span>{item.username}</span><span>{item.feature}</span><span>{item.total_tokens.toLocaleString()}</span><span>{money(item.cost_micros / 1_000_000)}</span><span>{new Date(item.created_at).toLocaleString('zh-CN')}</span></div>)}</div></section>
  </div>;
}

export default function AdminPage() {
  const [data, setData] = useState<AdminData>(), [password, setPassword] = useState(''), [tab, setTab] = useState<Tab>('business'), [selectedUser, setSelectedUser] = useState<AdminUser>();
  const legacyImportTried = useRef(false); const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const load = async () => { setLoading(true); try { const next = await accountRequest<AdminData>('/api/admin'); setData(next); setError(''); } catch { setData(undefined); } finally { setLoading(false); } };
  useEffect(() => { queueMicrotask(() => void load()); }, []);
  useEffect(() => {
    if (!data?.authenticated || data.deepseekConfigured || legacyImportTried.current) return;
    legacyImportTried.current = true;
    const legacyKey = localStorage.getItem('lucky-deepseek-key')?.trim();
    localStorage.removeItem('lucky-openai-key'); localStorage.removeItem('lucky-custom-voice'); localStorage.removeItem('lucky-voice-setup-dismissed');
    if (!legacyKey) return;
    void accountRequest<AdminData>('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'set_deepseek_key', key: legacyKey }) }).then(next => { localStorage.removeItem('lucky-deepseek-key'); localStorage.removeItem('lucky-translation-provider'); setData(next); }).catch(cause => setError(cause instanceof Error ? cause.message : '无法导入本设备原有密钥'));
  }, [data?.authenticated, data?.deepseekConfigured]);
  const login = async (event: React.SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); setLoading(true); setError(''); try { const next = await accountRequest<AdminData>('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'login', password }) }); setData(next); setPassword(''); } catch (cause) { setError(cause instanceof Error ? cause.message : '无法登录'); } finally { setLoading(false); } };
  if (loading && !data) return <main className="admin-page"><div className="admin-loading"><LoaderCircle className="spinning" />正在打开管理后台…</div></main>;
  if (!data?.authenticated) return <main className="admin-page"><form className="admin-login" onSubmit={login}><span><ShieldCheck /></span><h1>Lucky 管理后台</h1><label htmlFor="admin-password">管理密码</label><Input id="admin-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" />{error && <p role="alert">{error}</p>}<Button type="submit" disabled={!password || loading}>{loading ? <LoaderCircle className="spinning" /> : <KeyRound />}进入后台</Button></form></main>;
  const titles: Record<Tab, string> = { business: 'Business settings', clients: 'Clients', payment: 'Payment' };
  const nav = (id: Tab, Icon: typeof Settings2, label: string, badge?: string | number) => <button type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon /><span>{label}</span>{badge ? <b>{badge}</b> : null}</button>;
  return <main className="admin-page"><section className="admin-console"><aside className="admin-sidebar"><div className="admin-brand"><span>LUCKY</span><small>OPERATIONS</small></div><nav className="admin-sidebar-nav" aria-label="后台导航">{nav('business', Settings2, 'Business settings')}{nav('clients', Users, 'Clients', data.users.filter(user => user.status === 'pending').length || undefined)}{nav('payment', CreditCard, 'Payment')}</nav><div className="admin-sidebar-footer"><span>DeepSeek <b className={data.deepseekConfigured ? 'is-ready' : ''}>{data.deepseekConfigured ? '已连接' : '未配置'}</b></span><Button variant="ghost" onClick={() => void load()}><RefreshCw />刷新数据</Button><Button variant="ghost" onClick={() => void accountRequest('/api/admin', { method: 'DELETE' }).then(() => setData(undefined))}><LogOut />退出后台</Button></div></aside>
    <section className="admin-workspace"><header className="admin-workspace-header"><div><p className="admin-eyebrow">LUCKY / {titles[tab].toUpperCase()}</p><h1>{titles[tab]}</h1></div><span className="admin-sync-state">{loading ? <LoaderCircle className="spinning" /> : <CheckCircle2 />}已同步</span></header>{error && <p className="admin-error" role="alert">{error}</p>}
      {tab === 'business' && <BusinessSettings data={data} update={setData} error={setError} />}
      {tab === 'clients' && <ClientGrid users={data.users} select={setSelectedUser} />}
      {tab === 'payment' && <Payments data={data} update={setData} error={setError} />}
    </section></section>
    <Sheet open={Boolean(selectedUser)} onOpenChange={open => { if (!open) setSelectedUser(undefined); }}><SheetContent side="right" className="admin-client-sheet"><SheetHeader><p className="admin-eyebrow">CLIENT DETAIL</p><SheetTitle>客户详情</SheetTitle></SheetHeader><div className="admin-client-sheet-body">{selectedUser && <UserEditor key={selectedUser.id} user={selectedUser} refresh={next => { setData(next); const refreshed = next.users.find(user => user.id === selectedUser.id); if (refreshed) setSelectedUser(refreshed); }} />}</div></SheetContent></Sheet>
  </main>;
}
