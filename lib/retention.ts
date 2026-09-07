export type RetentionRules = { lv1: number; lv2: number; lv3: number };
export const DEFAULT_RETENTION: RetentionRules = { lv1: 1, lv2: 6, lv3: 6 };
export function retentionMonths(level: string, rules = DEFAULT_RETENTION) {
  return rules[level as keyof RetentionRules] || rules.lv1;
}
export function monthsAgo(months: number, now = Date.now()) {
  const date = new Date(now), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - months);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, end)); return date.getTime();
}
export function validateRetention(value: unknown): RetentionRules {
  const rules = value as RetentionRules;
  if (!rules || !(['lv1', 'lv2', 'lv3'] as const).every(key => Number.isInteger(rules[key]) && rules[key] >= 1 && rules[key] <= 24)) throw new Error('保留期请选择 1 到 24 个月');
  return { lv1: rules.lv1, lv2: rules.lv2, lv3: rules.lv3 };
}
export function retainedContent(type: string, data: unknown, cutoff: number): unknown {
  if (!data || typeof data !== 'object') return data;
  const value = data as Record<string, unknown>;
  if (type === 'coach-state' && Array.isArray(value.history)) return { ...value, history: value.history.filter(item => !item.createdAt || item.createdAt >= cutoff) };
  if (type === 'coach-journal') return {
    ...value,
    daily: Array.isArray(value.daily) ? value.daily.filter(item => Date.parse(item.date + 'T23:59:59Z') >= cutoff) : [],
    weekly: Array.isArray(value.weekly) ? value.weekly.filter(item => Date.parse(item.endDate + 'T23:59:59Z') >= cutoff) : [],
  };
  return data;
}
