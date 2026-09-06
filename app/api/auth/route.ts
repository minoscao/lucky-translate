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
    const body = await readJson<{ action?: unknown; email?: unknown; username?: unknown; password?: unknown }>(request);
    const action = body.action, email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '', requestedUsername = typeof body.username === 'string' ? body.username.trim() : '', password = typeof body.password === 'string' ? body.password : '';
    if (action === 'login') {
      if (!email || email.length > 254 || !password || password.length > 128) return json({ error: '请输入邮箱或用户名和密码' }, 400);
      const account = await findAccountByLogin(email);
      if (!account || !await verifyPassword(password, await getDb().prepare('SELECT password_hash FROM users WHERE id = ?1').bind(account.id).first<{ password_hash: string }>().then(row => row?.password_hash || ''))) return json({ error: '账号或密码不正确' }, 401);
      const cookie = await createSession(request, account);
      return json({ account: await accountSnapshot(account) }, 200, { 'Set-Cookie': cookie });
    }
    if (action === 'register') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ error: '请输入有效的邮箱地址' }, 400);
      if (!/^[\p{L}\p{N}_.-]{2,24}$/u.test(requestedUsername)) return json({ error: '用户名需为 2–24 个文字、数字、点、横线或下划线' }, 400);
      if (password.length < 8 || password.length > 128) return json({ error: '密码至少需要 8 位' }, 400);
      if (await getDb().prepare('SELECT 1 ok FROM users WHERE lower(email) = ?1').bind(email).first()) return json({ error: '这个邮箱已经注册' }, 409);
      if (await getDb().prepare('SELECT 1 ok FROM users WHERE lower(username) = lower(?1)').bind(requestedUsername).first()) return json({ error: '这个用户名已经被使用' }, 409);
      const username = requestedUsername;
      const now = Date.now(), id = crypto.randomUUID(), passwordHash = await hashPassword(password);
      await getDb().prepare(`INSERT INTO users (id, username, email, password_hash, status, level, daily_seconds_limit, monthly_seconds_limit, daily_token_limit, monthly_price_cents, storage_limit_bytes, membership_expires_at, admin_note, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, 'pending', 'pending', 0, 0, 0, 0, 104857600, NULL, '', ?5, ?5)`).bind(id, username, email, passwordHash, now).run();
      const account = await findAccountByLogin(email); if (!account) throw new Error('账户创建失败');
      return json({ account: await accountSnapshot(account) }, 201, { 'Set-Cookie': await createSession(request, account) });
    }
    return json({ error: '操作无效' }, 400);
  } catch (error) { return fail(error); }
}

export async function DELETE(request: Request) {
  try { return json({ account: null }, 200, { 'Set-Cookie': await destroySession(request) }); }
  catch (error) { return fail(error); }
}
