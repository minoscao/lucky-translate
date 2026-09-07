import { getDb, getEmailSender } from '@/db';
import { hashPassword } from '@/lib/server/auth';
import { authError, digestToken, ensureAuthTables, randomToken, validateNewPassword } from '@/lib/server/auth-security';

export function recoveryConfigured() { return Boolean(getEmailSender() && process.env.EMAIL_FROM && process.env.PUBLIC_APP_URL); }
export async function sendEmailTest(email: string) {
  if (!recoveryConfigured()) throw authError('邮件服务尚未配置', 503);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw authError('请输入有效的收件邮箱');
  try {
    await getEmailSender()!.send({ from: process.env.EMAIL_FROM!, to: email, subject: 'Lucky email delivery test', text: 'Lucky 邮件发送测试成功。此邮件仅用于验证邮件服务，没有重设或更改任何账户密码。\n\nThis is a Lucky email delivery test. No account password has been changed.' });
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    throw authError(code === 'E_SENDER_NOT_VERIFIED' ? '请先在 Cloudflare 验证发信域名' : '测试邮件发送失败，请检查 Cloudflare 发信域名和发送权限', 502);
  }
}
export async function requestPasswordReset(email: string) {
  if (!recoveryConfigured()) throw authError('密码找回邮件暂未开通，请联系管理员', 503);
  await ensureAuthTables();
  const db = getDb(), now = Date.now();
  const account = await db.prepare('SELECT id,email FROM users WHERE lower(email)=?1').bind(email.trim().toLowerCase()).first<{ id: string; email: string }>();
  const token = randomToken(), hashed = await digestToken(token);
  // The public response never reveals whether an email belongs to an account.
  if (!account) return;
  await db.batch([
    db.prepare('DELETE FROM password_resets WHERE expires_at<=?1').bind(now),
    db.prepare('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES (?1,?2,?3)').bind(hashed, account.id, now + 30 * 60000),
  ]);
  const link = new URL('/reset-password', process.env.PUBLIC_APP_URL);
  link.hash = token;
  try {
    await getEmailSender()!.send({
      from: process.env.EMAIL_FROM!, to: account.email, subject: 'Reset your Lucky password',
      text: `Reset your Lucky password using this link (valid for 30 minutes):\n\n${link}\n\nIf you did not request this, ignore this email. Your password has not changed.\n\n点击链接重设 Lucky 密码，30 分钟内有效。如果不是你本人申请，请忽略，原密码不会改变。`,
    });
  } catch {
    await db.prepare('DELETE FROM password_resets WHERE token_hash=?1').bind(hashed).run();
    // Do not disclose delivery/account existence through the unauthenticated response.
    console.error('Password recovery email delivery failed');
  }
}

export async function resetPassword(body: Record<string, unknown>) {
  const next = validateNewPassword(body.nextPassword, body.confirmPassword);
  if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) throw authError('重设链接无效或已过期，请重新申请');
  await ensureAuthTables();
  const db = getDb(), token = await digestToken(body.token), now = Date.now();
  // A single atomic batch consumes the reset and revokes all previous logins.
  const result = await db.batch([
    db.prepare('UPDATE users SET password_hash=?1,updated_at=?2 WHERE id=(SELECT user_id FROM password_resets WHERE token_hash=?3 AND expires_at>?2)').bind(await hashPassword(next), now, token),
    db.prepare('DELETE FROM sessions WHERE user_id=(SELECT user_id FROM password_resets WHERE token_hash=?1 AND expires_at>?2)').bind(token, now),
    db.prepare('DELETE FROM password_resets WHERE user_id=(SELECT user_id FROM password_resets WHERE token_hash=?1 AND expires_at>?2)').bind(token, now),
  ]);
  if (!result[0].meta.changes) throw authError('重设链接无效或已过期，请重新申请');
}
