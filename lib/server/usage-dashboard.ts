import { getDb } from '@/db';
import { periodKeys } from './account';
import { emptyUsage } from '@/lib/usage-dashboard';
import type { UsageDashboardData, UsageDashboardResponse, UsageMetrics, UsagePeriod } from '@/lib/usage-dashboard';

const blankDashboard = (updatedAt: number): UsageDashboardData => ({ updatedAt, periods: { today: emptyUsage(), month: emptyUsage(), total: emptyUsage() } });

// Six grouped queries regardless of client count. All views use the same records.
async function readUsage(userId: string | null): Promise<UsageDashboardResponse> {
  const db = getDb(), { day, month } = periodKeys(), updatedAt = Date.now();
  const clients: Record<string, UsageDashboardData> = {};
  const results = await Promise.all((['today', 'month', 'total'] as UsagePeriod[]).map(async period => {
    const fromDay = period === 'today' ? day : period === 'month' ? `${month}-01` : '';
    const fromTime = period === 'total' ? 0 : Date.parse(`${fromDay}T00:00:00+08:00`);
    const [time, events] = await Promise.all([
      db.prepare(`SELECT user_id, SUM(training_seconds) conversationSeconds, SUM(translation_seconds) translationSeconds,
        SUM(active_seconds) totalSeconds FROM usage_daily
        WHERE (?1 IS NULL OR user_id=?1) AND day>=?2 AND day<=?3 GROUP BY user_id`).bind(userId, fromDay, day).all<{ user_id: string; conversationSeconds: number; translationSeconds: number; totalSeconds: number }>(),
      db.prepare(`SELECT user_id,
        SUM(CASE WHEN provider='deepseek' THEN COALESCE(json_extract(price_snapshot,'$.actualTokens'), input_tokens+output_tokens) ELSE 0 END) actualTokens,
        SUM(input_tokens) inputTokens, SUM(output_tokens) outputTokens, SUM(cached_tokens) cachedTokens,
        SUM(cost_micros) costMicros,
        SUM(CASE WHEN provider='deepseek' AND (json_extract(price_snapshot,'$.usageReported')=0 OR
          (json_extract(price_snapshot,'$.usageReported') IS NULL AND input_tokens+output_tokens=0 AND COALESCE(json_extract(price_snapshot,'$.actualTokens'),0)=0))
          THEN 1 ELSE 0 END) unreportedRequests
        FROM usage_events WHERE (?1 IS NULL OR user_id=?1) AND provider!='membership' AND created_at>=?2 AND created_at<=?3 GROUP BY user_id`)
        .bind(userId, fromTime, updatedAt).all<{ user_id: string } & Pick<UsageMetrics, 'actualTokens' | 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'unreportedRequests' | 'costMicros'>>(),
    ]);
    return { period, time: time.results, events: events.results };
  }));
  for (const { period, time, events } of results) {
    for (const { user_id, ...values } of [...time, ...events]) {
      clients[user_id] ??= blankDashboard(updatedAt);
      Object.assign(clients[user_id].periods[period], values);
    }
    for (const client of Object.values(clients)) {
      const usage = client.periods[period];
      usage.recapSeconds = Math.max(0, usage.totalSeconds - usage.conversationSeconds - usage.translationSeconds);
    }
  }
  const dashboard = blankDashboard(updatedAt);
  for (const client of Object.values(clients)) for (const period of ['today', 'month', 'total'] as UsagePeriod[]) {
    for (const key of Object.keys(client.periods[period]) as (keyof UsageMetrics)[]) dashboard.periods[period][key] += client.periods[period][key];
  }
  return { dashboard, clients };
}

export async function usageDashboard(userId: string): Promise<UsageDashboardData> {
  return (await readUsage(userId)).dashboard;
}
export async function usageDirectory(): Promise<UsageDashboardResponse> {
  return readUsage(null);
}
