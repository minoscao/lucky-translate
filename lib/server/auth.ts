import { digestToken, randomToken, ensureAuthTables, authError, validateNewPassword } from '@/lib/server/auth-security';
import { PLAN_DEFAULTS } from '@/lib/membership-plans';
import { getDb } from '@/db';

const SESSION_COOKIE = 'lucky-session';
const ADMIN_COOKIE = 'lucky-admin';
const SUPER_ADMIN_COOKIE = 'lucky-super-admin';
const ADMIN_PASSWORD = () => { const value = process.env.ADMIN_PASSWORD; if (!value) throw authError('管理员登录尚未配置', 503); return value; };
const SUPER_ADMIN_PASSWORD = () => { const value = process.env.SUPER_ADMIN_PASSWORD; if (!value) throw authError('管理员登录尚未配置', 503); return value; };
const encoder = new TextEncoder();

export type Account = {
  id: string; username: string; email: string | null; status: string; level: string;
  daily_seconds_limit: number; monthly_seconds_limit: number; daily_token_limit: number;
  monthly_price_cents: number; storage_limit_bytes: number; membership_expires_at: number | null;
  created_at: number; updated_at: number; last_login_at: number | null; admin_note: string;
};

const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

async function sha256(value: string) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0; for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

export async function hashPassword(password: string) {
  const iterations = 100_000, salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256);
  return `pbkdf2_sha256$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(derived))}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [name, rawIterations, rawSalt, expected] = encoded.split('$');
  if (name !== 'pbkdf2_sha256' || !rawIterations || !rawSalt || !expected) return false;
  const iterations = Number(rawIterations); if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 100_000) return false;
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(rawSalt), iterations }, material, 256);
  return safeEqual(bytesToBase64(new Uint8Array(derived)), expected);
}

function cookie(request: Request, name: string) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [key, ...rest] = part.trim().split('='); if (key === name) return rest.join('=');
  }
  return '';
}

function sessionCookie(request: Request, token: string, maxAge = 30 * 86400) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${maxAge}`;
}

function adminCookie(request: Request, token: string, maxAge = 8 * 3600) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${maxAge}`;
}

function superAdminCookie(request: Request, token: string, maxAge = 30 * 60) {
  const secure = new URL(request.url).protocol === 'https:' ? ' Secure;' : '';
  return `${SUPER_ADMIN_COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${maxAge}`;
}

export { PLAN_DEFAULTS } from '@/lib/membership-plans';

export async function ensureBootstrap() {
  const db = getDb(), now = Date.now();
  const prices = [
    ['deepseek-v4-flash-offpeak-20260816', 'off_peak', 7000, 220000, 660000],
    ['deepseek-v4-flash-peak-20260816', 'peak', 14000, 440000, 1320000],
  ] as const;
  for (const [id, period, cached, input, output] of prices) {
    await db.prepare(`INSERT OR IGNORE INTO price_history (id, provider, model, period, cache_hit_micros_per_million, input_micros_per_million, output_micros_per_million, effective_at, retired_at)
      VALUES (?1, 'deepseek', 'deepseek-v4-flash', ?2, ?3, ?4, ?5, 1786838400000, NULL)`).bind(id, period, cached, input, output).run();
  }
  await db.prepare("INSERT OR IGNORE INTO app_config (key, value, updated_at) VALUES ('cost_multiplier', '1.0', ?1)").bind(now).run();
}

export async function findAccountByLogin(identifier: string) {
  await ensureBootstrap();
  return getDb().prepare(`SELECT * FROM users WHERE lower(username) = ?1 OR lower(email) = ?1 LIMIT 1`).bind(identifier.trim().toLowerCase()).first<Account>();
}

export async function getAccount(request: Request) {
  const raw = cookie(request, SESSION_COOKIE); if (!raw) return null;
  const tokenHash = await sha256(raw), now = Date.now();
  const account = await getDb().prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1 AND s.expires_at > ?2 LIMIT 1`).bind(tokenHash, now).first<Account>();
  return account || null;
}

export async function requireAccount(request: Request, active = true) {
  const account = await getAccount(request);
  if (!account) throw Object.assign(new Error('请先登录'), { status: 401 });
  const expired = account.membership_expires_at !== null && account.membership_expires_at < Date.now();
  if (active && (account.status !== 'active' || account.level === 'pending' || expired)) throw Object.assign(new Error(expired ? '会员已到期，请联系管理员续费' : '账户等待管理员激活'), { status: 403 });
  return account;
}

export async function createSession(request: Request, account: Account) {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = bytesToBase64(random).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const tokenHash = await sha256(token), now = Date.now(), expires = now + 30 * 86400_000;
  await getDb().batch([
    getDb().prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)').bind(tokenHash, account.id, expires, now),
    getDb().prepare('UPDATE users SET last_login_at = ?1, updated_at = ?1 WHERE id = ?2').bind(now, account.id),
    getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now),
  ]);
  return sessionCookie(request, token);
}

export async function destroySession(request: Request) {
  const raw = cookie(request, SESSION_COOKIE);
  if (raw) await getDb().prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256(raw)).run();
  return sessionCookie(request, '', 0);
}

type AdminRole = 'admin' | 'super';
async function credential(role: AdminRole) {
  const row = await getDb().prepare('SELECT value FROM app_config WHERE key = ?1').bind(`${role}_password_hash`).first<{ value: string }>();
  return row?.value || null;
}
async function verifyAdminPassword(role: AdminRole, password: string) {
  const stored = await credential(role);
  return stored ? verifyPassword(password, stored) : safeEqual(password, role === 'admin' ? ADMIN_PASSWORD() : SUPER_ADMIN_PASSWORD());
}
async function issueAdminSession(request: Request, role: AdminRole) {
  await ensureAuthTables();
  const token = randomToken(), expires = Date.now() + (role === 'admin' ? 8 * 3600_000 : 30 * 60_000);
  await getDb().prepare('INSERT INTO admin_sessions(token_hash,role,expires_at) VALUES (?1,?2,?3)').bind(await digestToken(token), role, expires).run();
  return role === 'admin' ? adminCookie(request, token) : superAdminCookie(request, token);
}
async function hasAdminSession(request: Request, role: AdminRole) {
  const token = cookie(request, role === 'admin' ? ADMIN_COOKIE : SUPER_ADMIN_COOKIE);
  if (!token) return false;
  await ensureAuthTables();
  return Boolean(await getDb().prepare('SELECT 1 ok FROM admin_sessions WHERE token_hash=?1 AND role=?2 AND expires_at>?3').bind(await digestToken(token), role, Date.now()).first());
}
export async function isAdmin(request: Request) { return hasAdminSession(request, 'admin'); }
export async function requireAdmin(request: Request) { if (!await isAdmin(request)) throw authError('请先登录管理后台', 401); }
export async function checkAdminPassword(request: Request, password: string) {
  if (!await verifyAdminPassword('admin', password)) return null;
  return issueAdminSession(request, 'admin');
}
export async function clearAdminCookie(request: Request) {
  await ensureAuthTables();
  await getDb().prepare('DELETE FROM admin_sessions WHERE token_hash IN (?1,?2)').bind(await digestToken(cookie(request,ADMIN_COOKIE)), await digestToken(cookie(request,SUPER_ADMIN_COOKIE))).run();
  return adminCookie(request, '', 0);
}
export async function isSuperAdmin(request: Request) { return hasAdminSession(request, 'super'); }
export async function checkSuperAdminPassword(request: Request, password: string) {
  if (!await verifyAdminPassword('super', password)) return null;
  return issueAdminSession(request, 'super');
}
export async function changeAdminPassword(request: Request, body: Record<string, unknown>) {
  const role: AdminRole = body.role === 'super' ? 'super' : 'admin';
  const next = validateNewPassword(body.nextPassword, body.confirmPassword);
  if (typeof body.currentPassword !== 'string' || !await verifyAdminPassword(role, body.currentPassword)) throw authError('当前密码不正确', 401);
  await ensureAuthTables();
  await getDb().batch([
    getDb().prepare('INSERT INTO app_config(key,value,updated_at) VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(`${role}_password_hash`, await hashPassword(next), Date.now()),
    getDb().prepare('DELETE FROM admin_sessions WHERE role=?1').bind(role),
  ]);
  return issueAdminSession(request, role);
}
