import { limitAuth, validateNewPassword, ensureAuthTables } from '@/lib/server/auth-security';
import { requestPasswordReset, resetPassword } from '@/lib/server/password-recovery';
import { createAccount } from '@/lib/server/create-account';
import { getDb } from '@/db';
import { accountSnapshot } from '@/lib/server/account';
import { createSession, destroySession, ensureBootstrap, findAccountByLogin, getAccount, hashPassword, verifyPassword } from '@/lib/server/auth';
import { json, readJson, sameOrigin } from '@/lib/server/http';

const fail = (error: unknown) => json({ error: error instanceof Error ? error.message : '暂时无法完成操作' }, (error as { status?: number })?.status || 500);

export async function GET(request: Request) {
  try { await ensureBootstrap(); const account = await getAccount(request); return json(account ? { account: await accountSnapshot(account) } : { account: null }); }
  catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: '请从当前页面操作' }, 403);
  try {
    await ensureBootstrap();
    const body = await readJson<Record<string, unknown>>(request);
    const action = body.action, email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '', password = typeof body.password === 'string' ? body.password : '';
    if (action === 'forgot-password') {
      await limitAuth(request, 'recovery', email, 5, 30);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254) return json({error:'请输入有效的邮箱地址'},400);
      await requestPasswordReset(email);
      return json({ sent: true, message: '如果该邮箱已注册，你会收到重设密码的邮件，请同时检查垃圾邮件。' });
    }
    if (action === 'reset-password') {
      await limitAuth(request, 'reset', '', 10);
      await resetPassword(body);
      return json({ saved: true });
    }
    if (action === 'login') {
      await limitAuth(request, 'login', email, 20);
      if (!email || email.length > 254 || !password || password.length > 128) return json({ error: '请输入邮箱或用户名和密码' }, 400);
      const account = await findAccountByLogin(email);
      if (!account || !await verifyPassword(password, await getDb().prepare('SELECT password_hash FROM users WHERE id = ?1').bind(account.id).first<{ password_hash: string }>().then(row => row?.password_hash || ''))) return json({ error: '账号或密码不正确' }, 401);
      const cookie = await createSession(request, account);
      return json({ account: await accountSnapshot(account) }, 200, { 'Set-Cookie': cookie });
    }
    if (action === 'register') {
      await limitAuth(request, 'register', email, 5, 60);
      validateNewPassword(body.password, body.confirmPassword);
      await createAccount(body, { level: 'lv1', status: 'active' });
      const account = await findAccountByLogin(email); if (!account) throw new Error('账户创建失败');
      return json({ account: await accountSnapshot(account) }, 201, { 'Set-Cookie': await createSession(request, account) });
    }
    if (action === 'change-password') {
      const account = await getAccount(request), currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '', nextPassword = typeof body.nextPassword === 'string' ? body.nextPassword : '';
      if (!account) return json({ error: '请先登录' }, 401);
      await limitAuth(request, 'change-password', account.id);
      validateNewPassword(nextPassword, body.confirmPassword);
      const row = await getDb().prepare('SELECT password_hash FROM users WHERE id = ?1').bind(account.id).first<{ password_hash: string }>();
      if (!row || !await verifyPassword(currentPassword, row.password_hash)) return json({ error: '当前密码不正确' }, 401);
      await ensureAuthTables();
      await getDb().batch([
        getDb().prepare('UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3').bind(await hashPassword(nextPassword), Date.now(), account.id),
        getDb().prepare('DELETE FROM sessions WHERE user_id=?1').bind(account.id),
        getDb().prepare('DELETE FROM password_resets WHERE user_id=?1').bind(account.id),
      ]);
      return json({ account: await accountSnapshot(account) }, 200, {'Set-Cookie':await createSession(request,account)});
    }
    return json({ error: '操作无效' }, 400);
  } catch (error) { return fail(error); }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({error:'请从当前页面操作'},403);
  try { return json({ account: null }, 200, { 'Set-Cookie': await destroySession(request) }); }
  catch (error) { return fail(error); }
}
