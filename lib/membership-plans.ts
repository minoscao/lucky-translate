export const PLAN_DEFAULTS = {
  lv1: { dailySeconds: 600, monthlySeconds: 0, dailyTokens: 10_000, priceCents: 0 },
  lv2: { dailySeconds: 7_200, monthlySeconds: 0, dailyTokens: 100_000, priceCents: 1_990 },
  lv3: { dailySeconds: 0, monthlySeconds: 360_000, dailyTokens: 200_000, priceCents: 3_990 },
} as const;

export const defaultClientPassword = (email: string) => email.trim() ? `lucklucky${email.trim().split('@')[0].slice(0, 2).toLowerCase()}` : '';
