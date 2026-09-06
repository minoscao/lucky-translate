import { getDb } from '@/db';
import { Account } from './auth';

const chinaParts = (date = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
}).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
export const periodKeys = () => { const parts = chinaParts(); const day = `${parts.year}-${parts.month}-${parts.day}`; return { day, month: `${parts.year}-${parts.month}`, hour: Number(parts.hour) }; };

export async function accountSnapshot(account: Account) {
  const db = getDb(), { day, month } = periodKeys();
  const [today, monthUsage, totalUsage, storage, multiplierRow] = await Promise.all([
    db.prepare('SELECT tokens, cost_micros, active_seconds, training_seconds, translation_seconds FROM usage_daily WHERE user_id = ?1 AND day = ?2').bind(account.id, day).first<{ tokens: number; cost_micros: number; active_seconds: number; training_seconds: number; translation_seconds: number }>(),
    db.prepare("SELECT COALESCE(SUM(tokens), 0) tokens, COALESCE(SUM(cost_micros), 0) cost_micros, COALESCE(SUM(active_seconds), 0) active_seconds, COALESCE(SUM(training_seconds), 0) training_seconds, COALESCE(SUM(translation_seconds), 0) translation_seconds FROM usage_daily WHERE user_id = ?1 AND substr(day, 1, 7) = ?2").bind(account.id, month).first<{ tokens: number; cost_micros: number; active_seconds: number; training_seconds: number; translation_seconds: number }>(),
    db.prepare('SELECT COALESCE(SUM(tokens), 0) tokens, COALESCE(SUM(cost_micros), 0) cost_micros, COALESCE(SUM(active_seconds), 0) active_seconds FROM usage_daily WHERE user_id = ?1').bind(account.id).first<{ tokens: number; cost_micros: number; active_seconds: number }>(),
    db.prepare('SELECT COALESCE(SUM(bytes), 0) bytes FROM cloud_records WHERE user_id = ?1').bind(account.id).first<{ bytes: number }>(),
    db.prepare("SELECT value FROM app_config WHERE key = 'cost_multiplier'").first<{ value: string }>(),
  ]);
  const expired = account.membership_expires_at !== null && account.membership_expires_at < Date.now();
  const storageBytes = storage?.bytes || 0, storageRatio = storageBytes / Math.max(1, account.storage_limit_bytes);
  return {
    id: account.id, username: account.username, email: account.email, status: expired ? 'expired' : account.status, level: account.level,
    membershipExpiresAt: account.membership_expires_at, monthlyPrice: account.monthly_price_cents / 100, costMultiplier: Math.max(.1, Math.min(100, Number(multiplierRow?.value) || 1)),
    limits: { dailySeconds: account.daily_seconds_limit, monthlySeconds: account.monthly_seconds_limit, dailyTokens: account.daily_token_limit },
    usage: { todayTokens: today?.tokens || 0, todayCost: (today?.cost_micros || 0) / 1_000_000, todaySeconds: today?.active_seconds || 0, todayTrainingSeconds: today?.training_seconds || 0, todayTranslationSeconds: today?.translation_seconds || 0, monthTokens: monthUsage?.tokens || 0, monthCost: (monthUsage?.cost_micros || 0) / 1_000_000, monthSeconds: monthUsage?.active_seconds || 0, monthTrainingSeconds: monthUsage?.training_seconds || 0, monthTranslationSeconds: monthUsage?.translation_seconds || 0, totalTokens: totalUsage?.tokens || 0, totalCost: (totalUsage?.cost_micros || 0) / 1_000_000, totalSeconds: totalUsage?.active_seconds || 0 },
    storage: { bytes: storageBytes, limitBytes: account.storage_limit_bytes, warning: storageRatio >= .85, ratio: storageRatio },
  };
}

export async function enforceLimits(account: Account) {
  const snapshot = await accountSnapshot(account);
  if (snapshot.limits.dailyTokens > 0 && snapshot.usage.todayTokens >= snapshot.limits.dailyTokens) throw Object.assign(new Error('今天的 Token 额度已用完，明天可以继续使用'), { status: 429 });
  if (snapshot.limits.dailySeconds > 0 && snapshot.usage.todaySeconds >= snapshot.limits.dailySeconds) throw Object.assign(new Error('今天的使用时间已用完，明天可以继续使用'), { status: 429 });
  if (snapshot.limits.monthlySeconds > 0 && snapshot.usage.monthSeconds >= snapshot.limits.monthlySeconds) throw Object.assign(new Error('本月的使用时间已用完，下月可以继续使用'), { status: 429 });
  return snapshot;
}

export async function addActiveSeconds(account: Account, seconds: number, category: 'training' | 'translation') {
  const safe = Math.max(0, Math.min(60, Math.round(seconds))); if (!safe) return accountSnapshot(account);
  await enforceLimits(account); const { day } = periodKeys(), now = Date.now();
  const charged = category === 'translation' ? Math.ceil(safe * .1) : safe;
  const training = category === 'training' ? safe : 0, translation = category === 'translation' ? safe : 0;
  await getDb().prepare(`INSERT INTO usage_daily (user_id, day, tokens, cost_micros, active_seconds, training_seconds, translation_seconds, updated_at) VALUES (?1, ?2, 0, 0, ?3, ?4, ?5, ?6)
    ON CONFLICT(user_id, day) DO UPDATE SET active_seconds = active_seconds + excluded.active_seconds, training_seconds = training_seconds + excluded.training_seconds, translation_seconds = translation_seconds + excluded.translation_seconds, updated_at = excluded.updated_at`).bind(account.id, day, charged, training, translation, now).run();
  return accountSnapshot(account);
}

export type TokenUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_cache_hit_tokens?: number };
export async function recordDeepSeekUsage(account: Account, feature: string, usage?: TokenUsage) {
  const { day, hour } = periodKeys(), peak = (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
  const input = Math.max(0, usage?.prompt_tokens || 0), output = Math.max(0, usage?.completion_tokens || 0), cached = Math.min(input, Math.max(0, usage?.prompt_cache_hit_tokens || 0));
  const rates = peak ? { period: 'peak', cached: .014, input: .44, output: 1.32 } : { period: 'off_peak', cached: .007, input: .22, output: .66 };
  const tokens = usage?.total_tokens || input + output, cost = ((input - cached) * rates.input + cached * rates.cached + output * rates.output) / 1_000_000;
  const costMicros = Math.max(0, Math.round(cost * 1_000_000)), now = Date.now();
  await getDb().batch([
    getDb().prepare(`INSERT INTO usage_events (id, user_id, feature, provider, model, input_tokens, cached_tokens, output_tokens, total_tokens, cost_micros, price_snapshot, created_at)
      VALUES (?1, ?2, ?3, 'deepseek', 'deepseek-v4-flash', ?4, ?5, ?6, ?7, ?8, ?9, ?10)`).bind(crypto.randomUUID(), account.id, feature, input, cached, output, tokens, costMicros, JSON.stringify(rates), now),
    getDb().prepare(`INSERT INTO usage_daily (user_id, day, tokens, cost_micros, active_seconds, training_seconds, translation_seconds, updated_at) VALUES (?1, ?2, ?3, ?4, 0, 0, 0, ?5)
      ON CONFLICT(user_id, day) DO UPDATE SET tokens = tokens + excluded.tokens, cost_micros = cost_micros + excluded.cost_micros, updated_at = excluded.updated_at`).bind(account.id, day, tokens, costMicros, now),
  ]);
  return { tokens, cost, inputTokens: input, cachedTokens: cached, outputTokens: output, period: rates.period };
}

export async function recordServiceCost(account: Account, feature: string, provider: string, model: string, cost: number, priceSnapshot: object) {
  const { day } = periodKeys(), costMicros = Math.max(0, Math.round(cost * 1_000_000)), now = Date.now();
  await getDb().batch([
    getDb().prepare(`INSERT INTO usage_events (id, user_id, feature, provider, model, input_tokens, cached_tokens, output_tokens, total_tokens, cost_micros, price_snapshot, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, 0, 0, ?6, ?7, ?8)`).bind(crypto.randomUUID(), account.id, feature, provider, model, costMicros, JSON.stringify(priceSnapshot), now),
    getDb().prepare(`INSERT INTO usage_daily (user_id, day, tokens, cost_micros, active_seconds, training_seconds, translation_seconds, updated_at) VALUES (?1, ?2, 0, ?3, 0, 0, 0, ?4)
      ON CONFLICT(user_id, day) DO UPDATE SET cost_micros = cost_micros + excluded.cost_micros, updated_at = excluded.updated_at`).bind(account.id, day, costMicros, now),
  ]);
  return { tokens: 0, cost };
}
