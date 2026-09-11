'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { accountRequest } from '@/lib/account';
import type { UsageDashboardData, UsagePeriod } from '@/lib/usage-dashboard';

const periods: { key: UsagePeriod; label: string }[] = [{ key: 'today', label: 'Today' }, { key: 'month', label: 'This month' }, { key: 'total', label: 'All time' }];
const number = (value: number, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits });

export function UsageDashboard({ url, request = accountRequest }: { url: string; request?: typeof accountRequest }) {
  const [data, setData] = useState<UsageDashboardData>(), [period, setPeriod] = useState<UsagePeriod>('total');
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const refresh = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false, busy = false;
    let controller: AbortController | undefined;
    setData(undefined); setError(''); setLoading(true);
    const load = async () => {
      if (disposed || busy) return;
      busy = true; controller = new AbortController();
      const current = controller;
      const timeout = setTimeout(() => current.abort(), 15000);
      setLoading(true);
      try {
        const next = await request<{ dashboard: UsageDashboardData }>(url, { signal: current.signal, cache: 'no-store' });
        if (!disposed && !current.signal.aborted) { setData(next.dashboard); setError(''); }
      } catch { if (!disposed) setError('Could not refresh usage. Please try again.'); }
      finally { clearTimeout(timeout); busy = false; if (!disposed) setLoading(false); }
    };
    refresh.current = () => { void load(); };
    const onVisible = () => { if (!document.hidden) void load(); };
    const timer = setInterval(onVisible, 5000);
    document.addEventListener('visibilitychange', onVisible);
    void load();
    return () => { disposed = true; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [url, request]);
  const reload = useCallback(() => refresh.current(), []);
  const usage = data?.periods[period];
  const metrics = usage ? [
    { label: 'Conversation', value: `${number(usage.conversationSeconds / 60, 2)} min` },
    { label: 'Translation', value: `${number(usage.translationSeconds / 60, 2)} min` },
    { label: 'Recaps', value: `${number(usage.recapSeconds / 60, 2)} min` },
    { label: 'Total usage', value: `${number(usage.totalSeconds / 60, 2)} min` },
    { label: 'Actual tokens', value: number(usage.actualTokens) },
  ] : [];
  return <section className="usage-dashboard" aria-label="Usage dashboard" aria-busy={loading}>
    <header><h3>Usage dashboard</h3><Button type="button" variant="ghost" disabled={loading} onClick={reload} aria-label="Refresh usage"><RefreshCw className={loading ? 'spinning' : ''} /></Button></header>
    <div className="usage-periods" role="group" aria-label="Usage period">{periods.map(item => <Button key={item.key} type="button" variant={period === item.key ? 'secondary' : 'ghost'} aria-pressed={period === item.key} onClick={() => setPeriod(item.key)}>{item.label}</Button>)}</div>
    <div className="usage-metrics">{metrics.map(item => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong></article>)}</div>
    <p role="status">{data ? `Updated ${new Date(data.updatedAt).toLocaleTimeString('en-US')}` : loading ? 'Loading usage…' : 'Usage unavailable.'}</p>
    {error && <p role="alert">{error}</p>}
    {usage && <><p className="usage-token-breakdown">Input {number(usage.inputTokens)} · Output {number(usage.outputTokens)} · Cached input {number(usage.cachedTokens)}</p>
      {usage.unreportedRequests > 0 && <p role="status">Token total is incomplete: {number(usage.unreportedRequests)} requests have no reported usage.</p>}
      <details className="inline-help"><summary>How usage is measured</summary><p>Minutes are text-based billed usage, not elapsed call time. Conversation includes Coach practice and assessments. Total includes conversation, translation and recaps. Tokens are actual model-reported usage, including failed attempts, and are never converted from minutes. Cached input is already included in input tokens. Audio services billed by duration do not add text tokens. Refreshes every 5 seconds while open, after each request’s usage is recorded.</p></details></>}
  </section>;
}
