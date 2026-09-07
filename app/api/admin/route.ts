import { getDb } from '@/db';
import { accountSnapshot } from '@/lib/server/account';
import { Account, checkAdminPassword, checkSuperAdminPassword, clearAdminCookie, ensureBootstrap, hashPassword, isAdmin, isSuperAdmin, PLAN_DEFAULTS, requireAdmin } from '@/lib/server/auth';
import { deepSeekConfigured, getCoachSkill, setCoachSkill, setDeepSeekKey } from '@/lib/server/config';
import { json, readJson, sameOrigin } from '@/lib/server/http';
import { getTextTimeRules, refundLegacyTime, setTextTimeRules, timeLedger } from '@/lib/server/text-time';

async function dashboard(request?: Request, businessUnlocked?: boolean) {
  await ensureBootstrap();
  const rows = await getDb().prepare('SELECT * FROM users ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, created_at DESC').all<Account>();
  const users = await Promise.all(rows.results.map(async account => ({ ...await accountSnapshot(account), timeLedger: await timeLedger(account.id), adminNote: account.admin_note, createdAt: account.created_at, lastLoginAt: account.last_login_at })));
  const prices = await getDb().prepare('SELECT provider, model, period, cache_hit_micros_per_million, input_micros_per_million, output_micros_per_million, effective_at FROM price_history WHERE retired_at IS NULL ORDER BY effective_at DESC, period').all();
  const history = await getDb().prepare(`SELECT e.id, e.feature, e.model, e.input_tokens, e.cached_tokens, e.output_tokens, e.total_tokens, e.cost_micros, e.price_snapshot, e.created_at, u.username
    FROM usage_events e JOIN users u ON u.id = e.user_id WHERE e.provider != 'membership' ORDER BY e.created_at DESC LIMIT 200`).all();
  const payments = await getDb().prepare(`SELECT p.id, p.user_id, p.amount_cents, p.currency, p.status, p.note, p.paid_at, p.created_at, u.username
    FROM payments p JOIN users u ON u.id = p.user_id ORDER BY p.paid_at DESC`).all();
  const multiplier = await getDb().prepare("SELECT value FROM app_config WHERE key = 'cost_multiplier'").first<{ value: string }>();
  return {
    users, prices: prices.results, history: history.results, payments: payments.results,
    deepseekConfigured: await deepSeekConfigured(), costMultiplier: Math.max(.1, Math.min(100, Number(multiplier?.value) || 1)),
    coachSkill: await getCoachSkill(), timeRules: await getTextTimeRules(), businessUnlocked: businessUnlocked ?? (request ? await isSuperAdmin(request) : false),
  };
}

export async function GET(request: Request) {
  try { if (!await isAdmin(request)) return json({ authenticated: false }, 401); return json({ authenticated: true, ...(await dashboard(request)) }); }
  catch (error) { return json({ error: error instanceof Error ? error.message : '无法打开管理后台' }, (error as { status?: number }).status || 500); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: '请从管理后台操作' }, 403);
  try {
    const body = await readJson<Record<string, unknown>>(request);
    if (body.action === 'login') {
      const cookie = await checkAdminPassword(request, typeof body.password === 'string' ? body.password : '');
      if (!cookie) return json({ error: '管理密码不正确' }, 401);
      return json({ authenticated: true, ...(await dashboard(request)) }, 200, { 'Set-Cookie': cookie });
    }
    await requireAdmin(request);
    if (body.action === 'refund_legacy_time') {
      const account = await getDb().prepare('SELECT * FROM users WHERE id=?1').bind(typeof body.userId === 'string' ? body.userId : '').first<Account>();
      if (!account) return json({ error: '没有找到客户' }, 404);
      await refundLegacyTime(account, typeof body.day === 'string' ? body.day : '');
      return json({ authenticated: true, saved: true, ...(await dashboard(request)) });
    }
    if (body.action === 'set_text_time_rules') {
      await setTextTimeRules(body.rules);
      return json({ authenticated: true, saved: true, ...(await dashboard(request)) });
    }
    if (body.action === 'set_deepseek_key') {
      await setDeepSeekKey(typeof body.key === 'string' ? body.key : '');
      return json({ authenticated: true, saved: true, ...(await dashboard(request)) });
    }
    if (body.action === 'set_cost_multiplier') {
      const multiplier = Number(body.multiplier);
      if (!Number.isFinite(multiplier) || multiplier < .1 || multiplier > 100) return json({ error: '费用倍率需在 0.1 到 100 之间' }, 400);
      await getDb().prepare("INSERT INTO app_config (key, value, updated_at) VALUES ('cost_multiplier', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(multiplier.toFixed(2), Date.now()).run();
      return json({ authenticated: true, saved: true, ...(await dashboard(request)) });
    }
    if (body.action === 'update_user') {
      const id = typeof body.id === 'string' ? body.id : '', level = body.level === 'lv1' || body.level === 'lv2' || body.level === 'lv3' ? body.level : null;
      const current = await getDb().prepare('SELECT * FROM users WHERE id = ?1').bind(id).first<Account>(); if (!current) return json({ error: '没有找到这个用户' }, 404);
      const defaults = level ? PLAN_DEFAULTS[level] : { dailySeconds: 0, monthlySeconds: 0, dailyTokens: 0, priceCents: 0 };
      const number = (value: unknown, fallback: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : fallback;
      const status = body.status === 'active' || body.status === 'pending' || body.status === 'suspended' ? body.status : current.status;
      const dailySeconds = number(body.dailySeconds, level ? defaults.dailySeconds : current.daily_seconds_limit, 86400), monthlySeconds = number(body.monthlySeconds, level ? defaults.monthlySeconds : current.monthly_seconds_limit, 744 * 3600);
      const dailyTokens = number(body.dailyTokens, level ? defaults.dailyTokens : current.daily_token_limit, 100_000_000), priceCents = number(body.monthlyPriceCents, level ? defaults.priceCents : current.monthly_price_cents, 1_000_000);
      const expires = body.membershipExpiresAt === null ? null : typeof body.membershipExpiresAt === 'number' && Number.isFinite(body.membershipExpiresAt) ? Math.max(Date.now(), Math.round(body.membershipExpiresAt)) : current.membership_expires_at;
      const note = typeof body.adminNote === 'string' ? body.adminNote.trim().slice(0, 500) : current.admin_note, now = Date.now();
      await getDb().prepare(`UPDATE users SET status = ?1, level = ?2, daily_seconds_limit = ?3, monthly_seconds_limit = ?4, daily_token_limit = ?5, monthly_price_cents = ?6, membership_expires_at = ?7, admin_note = ?8, updated_at = ?9 WHERE id = ?10`)
        .bind(status, level || current.level, dailySeconds, monthlySeconds, dailyTokens, priceCents, expires, note, now, id).run();
      return json({ authenticated: true, saved: true, ...(await dashboard(request)) });
    }
    if (body.action === 'reset_password') {
      const id = typeof body.id === 'string' ? body.id : '', password = typeof body.password === 'string' ? body.password : '';
      if (password.length < 7 || password.length > 128) return json({ error: '新密码至少需要 7 位' }, 400);
      await getDb().prepare('UPDATE users SET password_hash = ?1, updated_at = ?2 WHERE id = ?3').bind(await hashPassword(password), Date.now(), id).run();
      return json({ authenticated: true, saved: true, ...(await dashboard(request)) });
    }
    if (body.action === 'unlock_business') {
      const cookie = await checkSuperAdminPassword(request, typeof body.password === 'string' ? body.password : '');
      if (!cookie) return json({ error: '超级管理员密码不正确' }, 403);
      return json({ authenticated: true, ...(await dashboard(request, true)) }, 200, { 'Set-Cookie': cookie });
    }
    if (body.action === 'update_coach_skill') {
      if (!await isSuperAdmin(request)) return json({ error: '请先验证超级管理员密码' }, 403);
      await setCoachSkill(typeof body.skill === 'string' ? body.skill : '');
      return json({ authenticated: true, saved: true, ...(await dashboard(request, true)) });
    }
    if (body.action === 'record_payment') {
      const userId = typeof body.userId === 'string' ? body.userId : '';
      const account = await getDb().prepare('SELECT id FROM users WHERE id = ?1').bind(userId).first<{ id: string }>();
      if (!account) return json({ error: '请选择有效客户' }, 400);
      const amountCents = Number(body.amountCents);
      if (!Number.isInteger(amountCents) || amountCents < 1 || amountCents > 10_000_000) return json({ error: '收款金额不正确' }, 400);
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
      const now = Date.now();
      await getDb().prepare(`INSERT INTO payments (id, user_id, amount_cents, currency, status, note, paid_at, created_at)
        VALUES (?1, ?2, ?3, 'USD', 'paid', ?4, ?5, ?5)`).bind(crypto.randomUUID(), userId, amountCents, note, now).run();
      return json({ authenticated: true, saved: true, ...(await dashboard(request)) });
    }
    return json({ error: '操作无效' }, 400);
  } catch (error) { return json({ error: error instanceof Error ? error.message : '管理操作失败' }, (error as { status?: number }).status || 500); }
}

export async function DELETE(request: Request) { return json({ authenticated: false }, 200, { 'Set-Cookie': clearAdminCookie(request) }); }
