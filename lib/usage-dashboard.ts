export type UsagePeriod = 'today' | 'month' | 'total';
export type UsageMetrics = {
  conversationSeconds: number; translationSeconds: number; recapSeconds: number; totalSeconds: number;
  actualTokens: number; inputTokens: number; outputTokens: number; cachedTokens: number; unreportedRequests: number; costMicros: number;
};
export type UsageDashboardData = { updatedAt: number; periods: Record<UsagePeriod, UsageMetrics> };
export type UsageDashboardResponse = { dashboard: UsageDashboardData; clients?: Record<string, UsageDashboardData> };
export const emptyUsage = (): UsageMetrics => ({ conversationSeconds: 0, translationSeconds: 0, recapSeconds: 0, totalSeconds: 0, actualTokens: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unreportedRequests: 0, costMicros: 0 });
export const usageNumber = (value: number, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
export const usageMinutes = (seconds: number) => `${usageNumber(seconds / 60, 2)} min`;
export const usageCost = (micros: number) => (micros / 1_000_000).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 });
