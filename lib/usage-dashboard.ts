export type UsagePeriod = 'today' | 'month' | 'total';
export type UsageMetrics = {
  conversationSeconds: number; translationSeconds: number; recapSeconds: number; totalSeconds: number;
  actualTokens: number; inputTokens: number; outputTokens: number; cachedTokens: number; unreportedRequests: number;
};
export type UsageDashboardData = { updatedAt: number; periods: Record<UsagePeriod, UsageMetrics> };
