export type UsagePeriod = 'today' | 'month' | 'total';
export type UsageMetrics = {
  conversationSeconds: number; translationSeconds: number; recapSeconds: number; totalSeconds: number;
  actualTokens: number; inputTokens: number; outputTokens: number; cachedTokens: number; unreportedRequests: number; costMicros: number;
  modelCostMicros: number; modelRequests: number;
  recognitionCostMicros: number; recognitionSeconds: number; recognitionRequests: number; recognitionUnknownRequests: number;
  speechCostMicros: number; speechSeconds: number; speechRequests: number; speechEstimatedRequests: number; speechUnknownRequests: number;
  otherCostMicros: number; otherRequests: number;
};
export type UsageDashboardData = { updatedAt: number; periods: Record<UsagePeriod, UsageMetrics> };
export type UsageDashboardResponse = { dashboard: UsageDashboardData; clients?: Record<string, UsageDashboardData> };
export const emptyUsage = (): UsageMetrics => ({ conversationSeconds: 0, translationSeconds: 0, recapSeconds: 0, totalSeconds: 0, actualTokens: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unreportedRequests: 0, costMicros: 0,
  modelCostMicros: 0, modelRequests: 0, recognitionCostMicros: 0, recognitionSeconds: 0, recognitionRequests: 0, recognitionUnknownRequests: 0,
  speechCostMicros: 0, speechSeconds: 0, speechRequests: 0, speechEstimatedRequests: 0, speechUnknownRequests: 0, otherCostMicros: 0, otherRequests: 0 });
export const usageNumber = (value: number, digits = 0) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
export const usageMinutes = (seconds: number) => `${usageNumber(seconds / 60, 2)} min`;
export const usageCost = (micros: number) => (micros / 1_000_000).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6 });

export function usageServices(metrics: Partial<UsageMetrics>) {
  const u = { ...emptyUsage(), ...metrics };
  return [
    { key: 'model', label: 'AI text', usage: `${usageNumber(u.actualTokens)} tokens`, requests: u.modelRequests, cost: u.modelCostMicros, note: '' },
    { key: 'recognition', label: 'Speech recognition', usage: usageMinutes(u.recognitionSeconds), requests: u.recognitionRequests, cost: u.recognitionCostMicros,
      note: u.recognitionUnknownRequests ? `${usageNumber(u.recognitionUnknownRequests)} requests missing duration` : '' },
    { key: 'speech', label: 'Speech generation', usage: `${usageMinutes(u.speechSeconds)}${u.speechEstimatedRequests ? ' · estimated' : ''}`, requests: u.speechRequests, cost: u.speechCostMicros,
      note: u.speechUnknownRequests ? `${usageNumber(u.speechUnknownRequests)} requests missing duration` : '' },
    ...(u.otherRequests || u.otherCostMicros ? [{ key: 'other', label: 'Other services', usage: '—', requests: u.otherRequests, cost: u.otherCostMicros, note: '' }] : []),
  ];
}
