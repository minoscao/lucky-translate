import { env } from 'cloudflare:workers';

export function getDb(): D1Database {
  if (!env.DB) throw new Error('云端数据库尚未连接');
  return env.DB;
}

export function getAi(): Ai | undefined {
  return env.AI;
}

export function getEmailSender() { return env.EMAIL; }
