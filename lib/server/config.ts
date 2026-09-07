import { getDb } from '@/db';
import { COACH_RESPONSE_CONTRACT, DEFAULT_COACH_SKILL } from '@/lib/coach';

const encoder = new TextEncoder(), decoder = new TextDecoder();
const password = () => { const value = process.env.CONFIG_ENCRYPTION_SECRET || process.env.ADMIN_PASSWORD; if (!value) throw new Error('服务保密配置尚未完成'); return value; };
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) => Uint8Array.from(atob(value), character => character.charCodeAt(0));

async function key() {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`lucky-deepseek-config\n${password()}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function setDeepSeekKey(value: string) {
  const clean = value.trim(); if (!clean || clean.length > 512 || /[\r\n]/.test(clean)) throw new Error('请填写有效的 DeepSeek 密钥');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), encoder.encode(clean));
  const payload = `v1.${b64(iv)}.${b64(new Uint8Array(encrypted))}`, now = Date.now();
  await getDb().prepare(`INSERT INTO app_config (key, value, updated_at) VALUES ('deepseek_api_key', ?1, ?2)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(payload, now).run();
}

export async function getDeepSeekKey() {
  const row = await getDb().prepare("SELECT value FROM app_config WHERE key = 'deepseek_api_key'").first<{ value: string }>();
  if (!row?.value) throw Object.assign(new Error('管理员尚未配置 DeepSeek 服务'), { status: 503 });
  const [version, rawIv, rawData] = row.value.split('.'); if (version !== 'v1' || !rawIv || !rawData) throw new Error('DeepSeek 配置无效');
  try { return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rawIv) }, await key(), unb64(rawData))); }
  catch { throw Object.assign(new Error('DeepSeek 配置无法读取，请管理员重新保存密钥'), { status: 503 }); }
}

export async function deepSeekConfigured() {
  return Boolean(await getDb().prepare("SELECT 1 ok FROM app_config WHERE key = 'deepseek_api_key'").first());
}

export async function getCoachSkill() {
  const row = await getDb().prepare("SELECT value FROM app_config WHERE key = 'coach_skill'").first<{ value: string }>();
  const skill = row?.value?.trim().replace(/^You are Luna,/, 'You are Lucky,') || DEFAULT_COACH_SKILL;
  return skill.includes(COACH_RESPONSE_CONTRACT) ? skill : `${skill}\n\n${COACH_RESPONSE_CONTRACT}`;
}

export async function setCoachSkill(value: string) {
  const clean = value.trim();
  if (clean.length < 200 || clean.length > 20_000) throw new Error('Coach skill 需要在 200 到 20,000 个字符之间');
  await getDb().prepare(`INSERT INTO app_config (key, value, updated_at) VALUES ('coach_skill', ?1, ?2)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(clean, Date.now()).run();
}
