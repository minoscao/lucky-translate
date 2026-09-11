import { getDb } from '@/db';
import { periodKeys } from './account';
import type { UsageDashboardData, UsageMetrics, UsagePeriod } from '@/lib/usage-dashboard';

export async function usageDashboard(userId: string): Promise<UsageDashboardData> {
  const db = getDb(), { day, month } = periodKeys();
  const dayStart = Date.parse(`${day}T00:00:00+08:00`), monthStart = Date.parse(`${month}-01T00:00:00+08:00`);
  // Full account history, independent of the recent-event list and quota resets.
  const periods = await Promise.all((['today', 'month', 'total'] as UsagePeriod[]).map(async period => {
    const fromDay = period === 'today' ? day : period === 'month' ? `${month}-01` : '';
    const fromTime = period === 'today' ? dayStart : period === 'month' ? monthStart : 0;
    const [time, tokens] = await Promise.all([
      db.prepare(`SELECT COALESCE(SUM(training_seconds),0) conversationSeconds,
        COALESCE(SUM(translation_seconds),0) translationSeconds,
        COALESCE(SUM(active_seconds),0) totalSeconds
        FROM usage_daily WHERE user_id=?1 AND day>=?2 AND day<=?3`).bind(userId, fromDay, day).first<Pick<UsageMetrics, 'conversationSeconds' | 'translationSeconds' | 'totalSeconds'>>(),
      db.prepare(`SELECT COALESCE(SUM(COALESCE(json_extract(price_snapshot,'$.actualTokens'), input_tokens+output_tokens)),0) actualTokens,
        COALESCE(SUM(input_tokens),0) inputTokens, COALESCE(SUM(output_tokens),0) outputTokens,
        COALESCE(SUM(cached_tokens),0) cachedTokens,
        COALESCE(SUM(CASE WHEN json_extract(price_snapshot,'$.usageReported')=0 OR
          (json_extract(price_snapshot,'$.usageReported') IS NULL AND input_tokens+output_tokens=0 AND COALESCE(json_extract(price_snapshot,'$.actualTokens'),0)=0)
          THEN 1 ELSE 0 END),0) unreportedRequests
        FROM usage_events WHERE user_id=?1 AND provider='deepseek' AND created_at>=?2`).bind(userId, fromTime).first<Pick<UsageMetrics, 'actualTokens' | 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'unreportedRequests'>>(),
    ]);
    const conversationSeconds = time?.conversationSeconds || 0, translationSeconds = time?.translationSeconds || 0, totalSeconds = time?.totalSeconds || 0;
    return [period, { conversationSeconds, translationSeconds, totalSeconds, recapSeconds: Math.max(0, totalSeconds - conversationSeconds - translationSeconds), actualTokens: tokens?.actualTokens || 0, inputTokens: tokens?.inputTokens || 0, outputTokens: tokens?.outputTokens || 0, cachedTokens: tokens?.cachedTokens || 0, unreportedRequests: tokens?.unreportedRequests || 0 }] as const;
  }));
  return { updatedAt: Date.now(), periods: Object.fromEntries(periods) as UsageDashboardData['periods'] };
}
