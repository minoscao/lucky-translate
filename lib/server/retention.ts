import { getDb } from '@/db';
import { DEFAULT_RETENTION, RetentionRules, validateRetention } from '@/lib/retention';
export async function getRetentionRules(): Promise<RetentionRules> {
  const row = await getDb().prepare("SELECT value FROM app_config WHERE key='retention_months'").first<{ value: string }>();
  try { return row ? validateRetention(JSON.parse(row.value)) : DEFAULT_RETENTION; } catch { return DEFAULT_RETENTION; }
}
export async function setRetentionRules(value: unknown) {
  const rules = validateRetention(value);
  await getDb().prepare("INSERT INTO app_config(key,value,updated_at) VALUES ('retention_months',?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(JSON.stringify(rules), Date.now()).run();
}
