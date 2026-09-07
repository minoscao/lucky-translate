import { getDb } from '@/db';
import { hashPassword, PLAN_DEFAULTS } from '@/lib/server/auth';

type Membership = { level: keyof typeof PLAN_DEFAULTS; status: 'pending' | 'active' | 'suspended' };
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };

// Both registration and administrator creation use the same identity rules.
export async function createAccount(body: Record<string, unknown>, membership?: Membership) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail('请输入有效的邮箱地址');
  if (!/^[\p{L}\p{N}_.-]{2,24}$/u.test(username)) fail('用户名需为 2–24 个文字、数字、点、横线或下划线');
  if (password.length < 8 || password.length > 128) fail('密码需要 8–128 位');
  const db = getDb();
  if (await db.prepare('SELECT 1 ok FROM users WHERE lower(email) = ?1').bind(email).first()) fail('这个邮箱已经注册', 409);
  if (await db.prepare('SELECT 1 ok FROM users WHERE lower(username) = lower(?1)').bind(username).first()) fail('这个用户名已经被使用', 409);
  const plan = membership ? PLAN_DEFAULTS[membership.level] : { dailySeconds: 0, monthlySeconds: 0, dailyTokens: 0, priceCents: 0 };
  const id = crypto.randomUUID(), now = Date.now();
  const note = membership && typeof body.adminNote === 'string' ? body.adminNote.trim().slice(0, 500) : '';
  try {
    const result = await db.prepare(`INSERT INTO users (id, username, email, password_hash, status, level, daily_seconds_limit, monthly_seconds_limit, daily_token_limit, monthly_price_cents, storage_limit_bytes, membership_expires_at, admin_note, created_at, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 104857600, NULL, ?11, ?12, ?12
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE lower(email) = ?3 OR lower(username) = lower(?2))`)
      .bind(id, username, email, await hashPassword(password), membership?.status || 'pending', membership?.level || 'pending', plan.dailySeconds, plan.monthlySeconds, plan.dailyTokens, plan.priceCents, note, now).run();
    if (!result.meta.changes) fail('邮箱或用户名已被使用，请检查后重试', 409);
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) fail('邮箱或用户名已被使用，请检查后重试', 409);
    throw error;
  }
  return id;
}
