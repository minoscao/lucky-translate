import { getDb, getEmailSender } from '@/db';
import { normalizeEmail, validEmail, validUsername, validVerificationCode } from '@/lib/auth-inputs';
import { hashPassword, verifyPassword, PLAN_DEFAULTS } from '@/lib/server/auth';
import { authError, ensureAuthTables, validateNewPassword } from '@/lib/server/auth-security';

const EXPIRY_MS = 10 * 60000;
const COOLDOWN_MS = 60000;
type PendingRegistration = { email: string; username: string; password_hash: string; code_hash: string; expires_at: number; attempts: number; sent_at: number };
const invalidCode = () => authError('验证码不正确、已过期或尝试次数过多，请重新获取');
function code() {
  const values = new Uint32Array(1);
  do { crypto.getRandomValues(values); } while (values[0] >= 4294000000);
  return String(values[0] % 1000000).padStart(6, '0');
}
async function deliver(email: string, value: string, hash: string) {
  try {
    await getEmailSender()!.send({ from: process.env.EMAIL_FROM!, to: email, subject: 'Verify your Lucky email', text: `Your Lucky verification code is: ${value}\n\nValid for 10 minutes. Do not share this code. If you did not sign up, ignore this email.\n\n你的 Lucky 邮箱验证码：${value}\n10 分钟内有效。请勿向他人提供。若非本人注册，请忽略。` });
  } catch {
    await getDb().prepare('UPDATE pending_registrations SET expires_at=0,sent_at=0 WHERE email=?1 AND code_hash=?2').bind(email, hash).run();
    throw authError('验证码发送失败，请稍后重试', 502);
  }
}
function requireMailer() { if (!getEmailSender() || !process.env.EMAIL_FROM) throw authError('邮箱验证暂不可用，请稍后注册', 503); }

// No user or session exists until the email code is consumed successfully.
export async function beginRegistration(body: Record<string, unknown>) {
  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '');
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  if (!validEmail(email)) throw authError('请输入有效的邮箱地址');
  if (!validUsername(username)) throw authError('昵称需为 2–24 个文字、数字、点、横线或下划线');
  const password = validateNewPassword(body.password, body.confirmPassword);
  requireMailer(); await ensureAuthTables();
  const db = getDb(), now = Date.now();
  if (await db.prepare('SELECT 1 ok FROM users WHERE lower(email)=?1 OR lower(username)=lower(?2)').bind(email, username).first()) throw authError('邮箱或昵称已被使用，请登录或更换后重试', 409);
  const value = code(), hash = await hashPassword(value);
  const result = await db.prepare(`INSERT INTO pending_registrations(email,username,password_hash,code_hash,expires_at,attempts,sent_at) VALUES (?1,?2,?3,?4,?5,0,?6)
    ON CONFLICT(email) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash,code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,sent_at=excluded.sent_at WHERE pending_registrations.sent_at<=?7`)
    .bind(email, username, await hashPassword(password), hash, now + EXPIRY_MS, now, now - COOLDOWN_MS).run();
  if (!result.meta.changes) throw authError('验证码刚刚发送，请 60 秒后再试', 429);
  await deliver(email, value, hash);
  await db.prepare('DELETE FROM pending_registrations WHERE sent_at<?1 AND email<>?2').bind(now - 86400000, email).run();
  return { verificationRequired: true, email, resendAfterSeconds: 60 };
}

export async function resendVerification(email: string) {
  requireMailer(); await ensureAuthTables();
  const now = Date.now(), value = code(), hash = await hashPassword(value);
  const row = await getDb().prepare(`UPDATE pending_registrations SET code_hash=?1,expires_at=?2,attempts=0,sent_at=?3 WHERE email=?4 AND sent_at<=?5 RETURNING email`)
    .bind(hash, now + EXPIRY_MS, now, email, now - COOLDOWN_MS).first<{ email: string }>();
  if (row) await deliver(row.email, value, hash);
  return { sent: true, resendAfterSeconds: 60, message: '若该邮箱正在注册，验证码将发送到邮箱，请检查收件箱和垃圾邮件。' };
}

export async function completeRegistration(email: string, value: unknown) {
  if (typeof value !== 'string' || !validVerificationCode(value)) throw authError('请输入 6 位数字验证码');
  await ensureAuthTables(); const db = getDb(), now = Date.now();
  // Reserve an attempt atomically before the expensive password-hash comparison.
  const row = await db.prepare('UPDATE pending_registrations SET attempts=attempts+1 WHERE email=?1 AND expires_at>?2 AND attempts<5 RETURNING *').bind(email, now).first<PendingRegistration>();
  if (!row || !await verifyPassword(value, row.code_hash)) throw invalidCode();
  const id = crypto.randomUUID(), plan = PLAN_DEFAULTS.lv1;
  try {
    const result = await db.batch([
      db.prepare(`INSERT INTO users(id,username,email,password_hash,status,level,daily_seconds_limit,monthly_seconds_limit,daily_token_limit,monthly_price_cents,storage_limit_bytes,membership_expires_at,admin_note,created_at,updated_at)
        SELECT ?1,username,email,password_hash,'active','lv1',?2,?3,?4,?5,104857600,NULL,'',?6,?6 FROM pending_registrations
        WHERE email=?7 AND code_hash=?8 AND expires_at>?6 AND attempts<=5
        AND NOT EXISTS(SELECT 1 FROM users WHERE lower(email)=?7 OR lower(username)=lower(pending_registrations.username))`)
        .bind(id, plan.dailySeconds, plan.monthlySeconds, plan.dailyTokens, plan.priceCents, Date.now(), email, row.code_hash),
      db.prepare('DELETE FROM pending_registrations WHERE email=?1 AND code_hash=?2 AND EXISTS(SELECT 1 FROM users WHERE id=?3)').bind(email, row.code_hash, id),
    ]);
    if (!result[0].meta.changes) throw authError('验证码已使用或昵称已被占用，请登录或重新注册', 409);
  } catch (error) {
    if (error instanceof Error && /unique constraint/i.test(error.message)) throw authError('邮箱或昵称已被使用，请登录或重新注册', 409);
    throw error;
  }
  return id;
}
