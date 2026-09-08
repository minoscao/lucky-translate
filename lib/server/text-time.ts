import { getDb } from '@/db';
import { DEFAULT_TEXT_TIME_RULES, estimateTextTime, TextTimeRules, TimeCategory, validTextTimeRules } from '@/lib/text-time';
import { Account } from './auth';
import { periodKeys } from './account';

export async function getTextTimeRules(): Promise<TextTimeRules> {
  const row = await getDb().prepare("SELECT value FROM app_config WHERE key = 'text_time_rules'").first<{ value: string }>();
  try { const value = JSON.parse(row?.value || 'null'); if (validTextTimeRules(value)) return value; } catch {}
  return { ...DEFAULT_TEXT_TIME_RULES };
}

export async function setTextTimeRules(value: unknown) {
  if (!validTextTimeRules(value)) throw new Error('每词、每字的秒数需在 0.05 到 5 之间');
  await getDb().prepare("INSERT INTO app_config (key,value,updated_at) VALUES ('text_time_rules',?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .bind(JSON.stringify({ secondsPerWord: value.secondsPerWord, secondsPerCharacter: value.secondsPerCharacter }), Date.now()).run();
}

export async function chargeTextTime(account: Account, category: TimeCategory, texts: string[], label: string, requestId: string) {
  const rules = await getTextTimeRules(), calculation = estimateTextTime(texts, rules, category);
  const { day } = periodKeys(), now = Date.now(), db = getDb();
  const id = `text-time:${account.id}:${requestId}`, seconds = calculation.chargedSeconds;
  const snapshot = { version: 1, category, day, ...calculation, preview: texts.join(' ').slice(0, 160) };
  // Both statements run in one transaction; changes() makes a repeated request ID a no-op.
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO usage_events (id,user_id,feature,provider,model,input_tokens,cached_tokens,output_tokens,total_tokens,cost_micros,price_snapshot,created_at)
      VALUES (?1,?2,?3,'membership','text-duration-v1',0,0,0,0,0,?4,?5)`).bind(id,account.id,label,JSON.stringify(snapshot),now),
    db.prepare(`INSERT INTO usage_daily (user_id,day,tokens,cost_micros,active_seconds,training_seconds,translation_seconds,updated_at)
      SELECT ?1,?2,0,0,?3,?4,?5,?6 WHERE changes() > 0
      ON CONFLICT(user_id,day) DO UPDATE SET active_seconds=active_seconds+excluded.active_seconds,training_seconds=training_seconds+excluded.training_seconds,translation_seconds=translation_seconds+excluded.translation_seconds,updated_at=excluded.updated_at`)
      .bind(account.id,day,seconds,category === 'training' ? seconds : 0,category === 'translation' ? seconds : 0,now),
  ]);
  const totals = await db.prepare("SELECT COALESCE(SUM(CASE WHEN day=?2 THEN training_seconds ELSE 0 END),0) today, COALESCE(SUM(training_seconds),0) total FROM usage_daily WHERE user_id=?1")
    .bind(account.id,day).first<{ today: number; total: number }>();
  return { ...calculation, trainingTodaySeconds: totals?.today || 0, trainingTotalSeconds: totals?.total || 0 };
}

export async function timeLedger(userId: string) {
  const records = await getDb().prepare("SELECT id,feature,price_snapshot,created_at FROM usage_events WHERE user_id=?1 AND provider='membership' AND model IN ('text-duration-v1','legacy-time-refund') ORDER BY created_at DESC LIMIT 100").bind(userId).all<{ id: string; feature: string; price_snapshot: string; created_at: number }>();
  return records.results.map(record => ({ id: record.id, label: record.feature, createdAt: record.created_at, ...JSON.parse(record.price_snapshot) }));
}

export async function refundLegacyTime(account: Account, day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('日期无效');
  const db = getDb(), id = `legacy-time-refund:${account.id}:${day}`;
  const current = await db.prepare('SELECT active_seconds,training_seconds,translation_seconds FROM usage_daily WHERE user_id=?1 AND day=?2').bind(account.id,day).first<{ active_seconds: number; training_seconds: number; translation_seconds: number }>();
  if (!current) return;
  const recorded = await db.prepare(`SELECT COALESCE(SUM(json_extract(price_snapshot,'$.chargedSeconds')),0) active,
    COALESCE(SUM(CASE WHEN json_extract(price_snapshot,'$.category')='training' THEN json_extract(price_snapshot,'$.chargedSeconds') ELSE 0 END),0) training,
    COALESCE(SUM(CASE WHEN json_extract(price_snapshot,'$.category')='translation' THEN json_extract(price_snapshot,'$.chargedSeconds') ELSE 0 END),0) translation
    FROM usage_events WHERE user_id=?1 AND provider='membership' AND model='text-duration-v1' AND json_extract(price_snapshot,'$.day')=?2`).bind(account.id,day).first<{active: number; training: number; translation: number}>();
  const active = Math.max(0,current.active_seconds-(recorded?.active || 0)), training = Math.max(0,current.training_seconds-(recorded?.training || 0)), translation = Math.max(0,current.translation_seconds-(recorded?.translation || 0));
  const snapshot = { category: 'adjustment', day, chargedSeconds: -active, refundTrainingSeconds: training, refundTranslationSeconds: translation, previousDaily: current, note: '旧版按页面停留时间扣费，无法还原真实对话时长；本次退回旧计时额度。模型成本记录保留。' };
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO usage_events(id,user_id,feature,provider,model,input_tokens,cached_tokens,output_tokens,total_tokens,cost_micros,price_snapshot,created_at)
      VALUES(?1,?2,'退回旧版误扣时长','membership','legacy-time-refund',0,0,0,0,0,?3,?4)`).bind(id,account.id,JSON.stringify(snapshot),Date.now()),
    db.prepare(`UPDATE usage_daily SET active_seconds=MAX(0,active_seconds-?3),training_seconds=MAX(0,training_seconds-?4),translation_seconds=MAX(0,translation_seconds-?5),updated_at=?6 WHERE user_id=?1 AND day=?2 AND changes()>0`).bind(account.id,day,active,training,translation,Date.now()),
  ]);
}
