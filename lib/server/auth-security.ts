import { getDb } from '@/db';

const encoder = new TextEncoder();
export const digestToken = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
export const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
export const authError = (message: string, status = 400) => Object.assign(new Error(message), { status });

export async function ensureAuthTables() {
  await getDb().batch([
    getDb().prepare('CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)'),
    getDb().prepare('CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL)'),
    getDb().prepare('CREATE TABLE IF NOT EXISTS pending_registrations (email TEXT PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL, sent_at INTEGER NOT NULL)'),
  ]);
}

export async function limitAuth(request: Request, action: string, identifier = '', maximum = 10, minutes = 15) {
  await ensureAuthTables();
  const now = Date.now(), db = getDb();
  // CF-Connecting-IP is supplied by Cloudflare; do not trust client forwarded headers.
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const keys = [await digestToken(`${action}:ip:${ip}`)];
  if (identifier) keys.push(await digestToken(`${action}:account:${identifier.trim().toLowerCase()}`));
  for (const key of keys) {
    const row = await db.prepare(`INSERT INTO auth_limits(key,attempts,expires_at) VALUES (?1,1,?2)
      ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=?3 THEN 1 ELSE attempts+1 END,
      expires_at=CASE WHEN expires_at<=?3 THEN excluded.expires_at ELSE expires_at END RETURNING attempts`)
      .bind(key, now + minutes * 60000, now).first<{ attempts: number }>();
    if (!row || row.attempts > maximum) throw authError('Too many attempts. Please try again later.', 429);
  }
  await db.prepare('DELETE FROM auth_limits WHERE expires_at < ?1').bind(now).run();
}

export function validateNewPassword(password: unknown, confirmation: unknown): string {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw authError('Your password must be 8–128 characters long.');
  if (password !== confirmation) throw authError('The new passwords do not match.');
  return password;
}
