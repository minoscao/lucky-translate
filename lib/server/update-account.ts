import { getDb } from '@/db';
import { normalizeEmail, validEmail, validUsername } from '@/lib/auth-inputs';
import { Account, PLAN_DEFAULTS } from './auth';
import { authError, ensureAuthTables } from './auth-security';

export async function updateAccount(body: Record<string, unknown>) {
  const db = getDb(), id = typeof body.id === 'string' ? body.id : '';
  const current = await db.prepare('SELECT * FROM users WHERE id=?1').bind(id).first<Account>();
  if (!current) throw authError('没有找到这个用户', 404);
  const username = body.username === undefined ? current.username : typeof body.username === 'string' ? body.username.trim() : '';
  const email = body.email === undefined ? current.email : typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  if (!validUsername(username)) throw authError('用户名需为 2–24 个文字、数字、点、横线或下划线');
  if (!(current.email === null && !email) && (!email || !validEmail(email))) throw authError('请输入有效的邮箱地址');
  const nextEmail = email || null;
  const level = body.level === 'lv1' || body.level === 'lv2' || body.level === 'lv3' ? body.level : null;
  const defaults = level ? PLAN_DEFAULTS[level] : { dailySeconds: 0, monthlySeconds: 0, dailyTokens: 0, monthlyTokens: 0, priceCents: 0 };
  const number = (value: unknown, fallback: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : fallback;
  const status = body.status === 'active' || body.status === 'pending' || body.status === 'suspended' ? body.status : current.status;
  const dailySeconds = number(body.dailySeconds, level ? defaults.dailySeconds : current.daily_seconds_limit, 86400), monthlySeconds = number(body.monthlySeconds, level ? defaults.monthlySeconds : current.monthly_seconds_limit, 744 * 3600);
  const dailyTokens = number(body.dailyTokens, level ? defaults.dailyTokens : current.daily_token_limit, 100_000_000), monthlyTokens = number(body.monthlyTokens, level ? defaults.monthlyTokens : current.monthly_token_limit, 1_000_000_000);
  const price = number(body.monthlyPriceCents, level ? defaults.priceCents : current.monthly_price_cents, 1_000_000);
  const expires = body.membershipExpiresAt === null ? null : typeof body.membershipExpiresAt === 'number' && Number.isFinite(body.membershipExpiresAt) ? Math.max(0, Math.round(body.membershipExpiresAt)) : current.membership_expires_at;
  const note = typeof body.adminNote === 'string' ? body.adminNote.trim().slice(0, 500) : current.admin_note;
  const emailChanged = nextEmail !== current.email;
  if (emailChanged) await ensureAuthTables();
  try {
    const update = db.prepare(`UPDATE users SET username=?2, email=?3, status=?4, level=?5, daily_seconds_limit=?6, monthly_seconds_limit=?7,
      daily_token_limit=?8, monthly_token_limit=?9, monthly_price_cents=?10, membership_expires_at=?11, admin_note=?12, updated_at=?13
      WHERE id=?1 AND NOT EXISTS (SELECT 1 FROM users WHERE id!=?1 AND (lower(username)=lower(?2) OR lower(email)=?3))`)
      .bind(id, username, nextEmail, status, level || current.level, dailySeconds, monthlySeconds, dailyTokens, monthlyTokens, price, expires, note, Date.now());
    // Only invalidate old login/reset links if the identity update succeeded.
    const results = await db.batch([update, ...(emailChanged ? [
      db.prepare('DELETE FROM password_resets WHERE user_id=?1 AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND email=?2)').bind(id, nextEmail),
      db.prepare('DELETE FROM sessions WHERE user_id=?1 AND EXISTS(SELECT 1 FROM users WHERE id=?1 AND email=?2)').bind(id, nextEmail),
    ] : [])]);
    if (!results[0].meta.changes) throw authError('邮箱或用户名已被使用，请检查后重试', 409);
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) throw authError('邮箱或用户名已被使用，请检查后重试', 409);
    throw error;
  }
}
