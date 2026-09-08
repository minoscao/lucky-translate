// Quota headroom for frequent short turns; usage itself always records actual tokens.
export const TOKEN_BUDGET_PER_HOUR = 180_000;
export const SECONDS_PER_FISH = 72;
const tokenBudget = (seconds: number) => Math.ceil(seconds / 3600 * TOKEN_BUDGET_PER_HOUR);

export const PLAN_DEFAULTS = {
  lv1: { dailySeconds: 10 * SECONDS_PER_FISH, monthlySeconds: 0, dailyTokens: tokenBudget(10 * SECONDS_PER_FISH), monthlyTokens: 0, priceCents: 0 },
  lv2: { dailySeconds: 100 * SECONDS_PER_FISH, monthlySeconds: 0, dailyTokens: tokenBudget(100 * SECONDS_PER_FISH), monthlyTokens: 0, priceCents: 1_990 },
  lv3: { dailySeconds: 0, monthlySeconds: 5_000 * SECONDS_PER_FISH, dailyTokens: 0, monthlyTokens: tokenBudget(5_000 * SECONDS_PER_FISH), priceCents: 3_990 },
} as const;

export const defaultClientPassword = (email: string) => email.trim() ? `lucklucky${email.trim().split('@')[0].slice(0, 2).toLowerCase()}` : '';
