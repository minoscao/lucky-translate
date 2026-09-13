'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { accountRequest } from '@/lib/account';
import { usageCost, usageMinutes, usageServices, usageNumber as number } from '@/lib/usage-dashboard';
import type { UsageDashboardData, UsageDashboardResponse, UsagePeriod } from '@/lib/usage-dashboard';

const periods: { key: UsagePeriod; label: string }[] = [{ key: 'today', label: 'Today' }, { key: 'month', label: 'This month' }, { key: 'total', label: 'All time' }];
export function useUsageDashboard(url: string, request = accountRequest) {
  const [data, setData] = useState<UsageDashboardResponse>();
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
        const next = await request<UsageDashboardResponse>(url, { signal: current.signal, cache: 'no-store' });
        if (current.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
        if (!disposed) { setData(next); setError(''); }
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
  return { data, loading, error, reload };
}

export function UsageDashboard({ url, request = accountRequest }: { url: string; request?: typeof accountRequest }) {
  const { data, ...state } = useUsageDashboard(url, request);
  const [period, setPeriod] = useState<UsagePeriod>('total');
  return <UsageDashboardView data={data?.dashboard} {...state} period={period} onPeriodChange={setPeriod} />;
}

export function UsageDashboardView({ data, loading, error, reload, period, onPeriodChange, title = 'Usage dashboard' }: {
  data?: UsageDashboardData; loading: boolean; error: string; reload: () => void;
  period: UsagePeriod; onPeriodChange: (period: UsagePeriod) => void; title?: string;
}) {
  const usage = data?.periods[period];
  const metrics = usage ? [
    { label: 'Conversation', value: usageMinutes(usage.conversationSeconds) },
    { label: 'Translation', value: usageMinutes(usage.translationSeconds) },
    { label: 'Recaps', value: usageMinutes(usage.recapSeconds) },
    { label: 'Total usage', value: usageMinutes(usage.totalSeconds) },
    { label: 'Actual tokens', value: number(usage.actualTokens) },
    { label: 'Estimated cost · USD', value: usageCost(usage.costMicros) },
  ] : [];
  return <section className="usage-dashboard" aria-label="Usage dashboard" aria-busy={loading}>
    <header><h3>{title}</h3><Button type="button" variant="ghost" disabled={loading} onClick={reload} aria-label="Refresh usage"><RefreshCw className={loading ? 'spinning' : ''} /></Button></header>
    <div className="usage-periods" role="group" aria-label="Usage period">{periods.map(item => <Button key={item.key} type="button" variant={period === item.key ? 'secondary' : 'ghost'} aria-pressed={period === item.key} onClick={() => onPeriodChange(item.key)}>{item.label}</Button>)}</div>
    <div className="usage-metrics">{metrics.map(item => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong></article>)}</div>
    {usage && <div className="usage-services" aria-label="Cost by service">{usageServices(usage).map(service => <article key={service.key}>
      <div><strong>{service.label}</strong><small>{service.usage} · {number(service.requests)} requests</small>{service.note && <small>{service.note}</small>}</div>
      <strong>{usageCost(service.cost)}</strong>
    </article>)}</div>}
    <p role="status">{data ? `Updated ${new Date(data.updatedAt).toLocaleTimeString('en-US')}` : loading ? 'Loading usage…' : 'Usage unavailable.'}</p>
    {error && <p role="alert">{error}</p>}
    {usage && <><p className="usage-token-breakdown">Input {number(usage.inputTokens)} · Output {number(usage.outputTokens)} · Cached input {number(usage.cachedTokens)}</p>
      {usage.unreportedRequests > 0 && <p role="status">Token total is incomplete: {number(usage.unreportedRequests)} requests have no reported usage.</p>}
      <details className="inline-help"><summary>How usage is measured</summary><p>Conversation, translation and recap minutes are text-based billed usage, not elapsed call time. AI text includes these services and assessments. Tokens are model-reported usage, including recorded failed attempts, and are never converted from minutes. Cached input is already included in input tokens.</p><p>Speech recognition measures submitted audio. Speech generation measures generated audio; durations marked estimated are calculated from text length. Missing durations are excluded from minutes, but their recorded costs remain included. Audio minutes are separate from Total usage and do not add text tokens. Requests count cloud calls, so a reply split into two audio segments counts twice. Replaying cached audio makes no new cloud request.</p><p>Costs use each request’s saved rate and are estimates, not the provider’s final invoice. Free allowances, discounts, taxes and unrecorded provider charges are not included. All service costs are included in the total once, with no display multiplier. Refreshes every 5 seconds while open, after usage is recorded.</p></details></>}
  </section>;
}
