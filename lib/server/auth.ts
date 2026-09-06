import { getDb } from '@/db';

const SESSION_COOKIE = 'lucky-session';
const ADMIN_COOKIE = 'lucky-admin';
const ADMIN_PASSWORD = () => process.env.ADMIN_PASSWORD || 'Minocolin1';
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
  const iterations = 150_000, salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256);
  return `pbkdf2_sha256$${iterations}$${bytesToBase64(salt)}$${bytesToBase64(new Uint8Array(derived))}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [name, rawIterations, rawSalt, expected] = encoded.split('$');
  if (name !== 'pbkdf2_sha256' || !rawIterations || !rawSalt || !expected) return false;
  const iterations = Number(rawIterations); if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 500_000) return false;
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

export const PLAN_DEFAULTS = {
  lv1: { dailySeconds: 600, monthlySeconds: 0, dailyTokens: 10_000, priceCents: 0 },
  lv2: { dailySeconds: 7_200, monthlySeconds: 0, dailyTokens: 100_000, priceCents: 1_990 },
  lv3: { dailySeconds: 0, monthlySeconds: 360_000, dailyTokens: 200_000, priceCents: 3_990 },
} as const;

export async function ensureBootstrap() {
  const db = getDb(), now = Date.now();
  const seeded = await db.prepare('SELECT id FROM users WHERE username = ?1 LIMIT 1').bind('miajin').first<{ id: string }>();
  if (!seeded) {
    const plan = PLAN_DEFAULTS.lv2, password = await hashPassword('Miamia1');
    await db.prepare(`INSERT INTO users (id, username, email, password_hash, status, level, daily_seconds_limit, monthly_seconds_limit, daily_token_limit, monthly_price_cents, storage_limit_bytes, membership_expires_at, admin_note, created_at, updated_at)
      VALUES (?1, ?2, NULL, ?3, 'active', 'lv2', ?4, ?5, ?6, ?7, 104857600, NULL, '初始 Lv2 测试账户', ?8, ?8)`)
      .bind(crypto.randomUUID(), 'miajin', password, plan.dailySeconds, plan.monthlySeconds, plan.dailyTokens, plan.priceCents, now).run();
  }
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

export async function adminToken() { return sha256(`lucky-admin\n${ADMIN_PASSWORD()}`); }
export async function isAdmin(request: Request) { const expected = await adminToken(); return safeEqual(cookie(request, ADMIN_COOKIE), expected); }
export async function requireAdmin(request: Request) { if (!await isAdmin(request)) throw Object.assign(new Error('请先登录管理后台'), { status: 401 }); }
export async function checkAdminPassword(request: Request, password: string) {
  if (!safeEqual(password, ADMIN_PASSWORD())) return null;
  return adminCookie(request, await adminToken());
}
export function clearAdminCookie(request: Request) { return adminCookie(request, '', 0); }
