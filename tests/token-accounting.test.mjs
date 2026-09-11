import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const read = file => readFile(new URL(file, import.meta.url), 'utf8');
const source = (await read('../lib/server/account.ts')).replace(/^import .*;\r?\n/gm, '');
const moduleSource = `const getDb=()=>globalThis.__tokenDb, getRetentionRules=async()=>({}), retentionMonths=()=>1;\n${source}`;
const { recordDeepSeekUsage, enforceLimits, periodKeys } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(moduleSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64'));
const dashboardSource = (await read('../lib/server/usage-dashboard.ts')).replace(/^import .*;\r?\n/gm, '');
const sharedUsage = await read('../lib/usage-dashboard.ts');
const { usageDashboard, usageDirectory } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(`const getDb=()=>globalThis.__tokenDb; const periodKeys=()=>globalThis.__dashboardPeriod; ${sharedUsage} ${dashboardSource}`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64'));
const schema = await read('../drizzle/0000_noisy_anthem.sql') + await read('../drizzle/0003_monthly_token_limit.sql');
const planSource = await read('../lib/membership-plans.ts');
const pointSource = (await read('../lib/points.ts')).replace(/^import .*;\r?\n/gm, '');
const { PLAN_DEFAULTS, pointsForSeconds, formatPoints } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(planSource + pointSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64'));

test('all membership allowances use the same fish conversion without rounding stored usage', () => {
  assert.equal(pointsForSeconds(PLAN_DEFAULTS.lv1.dailySeconds), 10);
  assert.equal(pointsForSeconds(PLAN_DEFAULTS.lv2.dailySeconds), 100);
  assert.equal(pointsForSeconds(PLAN_DEFAULTS.lv3.monthlySeconds), 5000);
  assert.equal(PLAN_DEFAULTS.lv1.dailyTokens, 36000);
  assert.equal(PLAN_DEFAULTS.lv2.dailyTokens, 360000);
  assert.equal(PLAN_DEFAULTS.lv3.monthlyTokens, 18000000);
  assert.equal(PLAN_DEFAULTS.lv3.dailyTokens, 0);
  assert.ok(Math.abs(pointsForSeconds(79) - 79 / 72) < 1e-12);
  assert.equal(formatPoints(PLAN_DEFAULTS.lv1.dailySeconds), '10 条小鱼干');
});

function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);
  sqlite.exec("INSERT INTO users(id,username,password_hash,created_at,updated_at) VALUES('test','test','disabled',0,0)");
  globalThis.__tokenDb = {
    prepare(sql) {
      let args = {};
      return {
        bind(...values) { args = Object.fromEntries(values.map((v, i) => [String(i + 1), v])); return this; },
        async first() { return sqlite.prepare(sql).get(args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(args) }; },
        async run() { return { meta: sqlite.prepare(sql).run(args) }; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, close() { sqlite.close(); delete globalThis.__tokenDb; } };
}

test('customer quota records actual provider tokens once and preserves failed-output costs', async () => {
  const db = setup();
  try {
    const result = await recordDeepSeekUsage({ id: 'test' }, 'coach', { prompt_tokens: 876, prompt_cache_hit_tokens: 512, completion_tokens: 40, total_tokens: 916 });
    assert.equal(result.tokens, 916);
    assert.equal(result.actualTokens, 916);
    assert.equal(db.sqlite.prepare('SELECT tokens FROM usage_daily').get().tokens, 916);
    await recordDeepSeekUsage({ id: 'test' }, 'translation', { prompt_tokens: 80, completion_tokens: 20 });
    const failed = await recordDeepSeekUsage({ id: 'test' }, 'coach', { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 }, false);
    assert.equal(failed.tokens, 0);
    assert.ok(failed.cost > 0);
    assert.equal(db.sqlite.prepare('SELECT tokens FROM usage_daily').get().tokens, 1016);
    assert.equal(db.sqlite.prepare('SELECT SUM(total_tokens) total FROM usage_events').get().total, 1016);
  } finally { db.close(); }
});

test('dashboard totals use complete isolated history and real tokens including failed attempts', async () => {
  const db = setup();
  globalThis.__dashboardPeriod = { day: '2026-09-11', month: '2026-09' };
  try {
    db.sqlite.exec("INSERT INTO users(id,username,password_hash,created_at,updated_at) VALUES('other','other','disabled',0,0)");
    const daily = db.sqlite.prepare('INSERT INTO usage_daily(user_id,day,tokens,active_seconds,training_seconds,translation_seconds,updated_at) VALUES(?,?,999999,?,?,?,0)');
    daily.run('test', '2026-09-11', 660, 360, 240);
    daily.run('test', '2026-09-01', 120, 60, 60);
    daily.run('test', '2026-08-31', 60, 60, 0);
    daily.run('other', '2026-09-11', 9999, 9999, 0);
    const event = db.sqlite.prepare("INSERT INTO usage_events(id,user_id,feature,provider,model,input_tokens,cached_tokens,output_tokens,total_tokens,cost_micros,price_snapshot,created_at) VALUES(?,?,'coach','deepseek','model',?,?,?,0,1,?,?)");
    // 205 rows ensure totals do not depend on the recent 100/200-row UI lists.
    for (let i = 0; i < 205; i++) event.run(String(i), 'test', 10, 4, 2, JSON.stringify({ actualTokens: 12, billable: false }), Date.parse('2026-09-11T00:00:00+08:00'));
    event.run('month', 'test', 20, 0, 5, '{}', Date.parse('2026-09-10T23:59:59+08:00'));
    event.run('older', 'test', 30, 0, 5, '{}', Date.parse('2026-08-31T23:59:59+08:00'));
    event.run('other', 'other', 9000, 0, 999, '{}', Date.parse('2026-09-11T00:00:00+08:00'));
    event.run('missing', 'test', 0, 0, 0, JSON.stringify({ usageReported: false }), Date.parse('2026-09-11T00:00:00+08:00'));
    const { periods } = await usageDashboard('test');
    assert.deepEqual(periods.today, { conversationSeconds: 360, translationSeconds: 240, recapSeconds: 60, totalSeconds: 660, actualTokens: 2460, inputTokens: 2050, cachedTokens: 820, outputTokens: 410, unreportedRequests: 1, costMicros: 206 });
    assert.equal(periods.month.actualTokens, 2485);
    assert.equal(periods.total.actualTokens, 2520);
    assert.equal(periods.month.totalSeconds, 780);
    assert.equal(periods.total.totalSeconds, 840);
    assert.equal((await usageDashboard('empty')).periods.total.actualTokens, 0);
    event.run('new', 'test', 5, 2, 3, JSON.stringify({ actualTokens: 8, usageReported: true }), Date.parse('2026-09-11T01:00:00+08:00'));
    assert.equal((await usageDashboard('test')).periods.total.actualTokens, 2528);
    db.sqlite.exec("INSERT INTO usage_events(id,user_id,feature,provider,model,cost_micros,price_snapshot,created_at) VALUES('audio','test','speech','cloudflare','whisper',370,'{}',1789092000000)");
    const directory = await usageDirectory();
    const individual = await usageDashboard('test');
    assert.deepEqual(directory.clients.test.periods, individual.periods);
    assert.equal(directory.clients.test.periods.total.costMicros, 579);
    assert.equal(directory.dashboard.periods.total.costMicros, 580);
    assert.equal(directory.dashboard.periods.total.actualTokens, 12527);
    assert.equal(directory.dashboard.periods.total.totalSeconds, 10839);
    assert.equal(directory.clients.test.periods.total.actualTokens, 2528);

  } finally { db.close(); delete globalThis.__dashboardPeriod; }
});

test('lv3 uses the calendar month total across days and ignores previous months', async () => {
  const db = setup();
  const { day, month } = periodKeys();
  const anotherDay = `${month}-${day.endsWith('-01') ? '02' : '01'}`;
  const account = { id: 'test', level: 'lv3', daily_seconds_limit: 0, monthly_seconds_limit: 360000, daily_token_limit: 0, monthly_token_limit: 18000000, storage_limit_bytes: 104857600, membership_expires_at: null };
  try {
    db.sqlite.prepare('INSERT INTO usage_daily(user_id,day,tokens,updated_at) VALUES(?,?,?,0)').run('test', '2000-01-01', 99000000);
    db.sqlite.prepare('INSERT INTO usage_daily(user_id,day,tokens,updated_at) VALUES(?,?,?,0)').run('test', anotherDay, 17999990);
    db.sqlite.prepare('INSERT INTO usage_daily(user_id,day,tokens,updated_at) VALUES(?,?,?,0)').run('test', day, 9);
    assert.equal((await enforceLimits(account)).usage.monthTokens, 17999999);
    db.sqlite.prepare('UPDATE usage_daily SET tokens=10 WHERE day=?').run(day);
    await assert.rejects(enforceLimits(account), error => error.status === 429 && error.message.includes('18,000,000'));
  } finally { db.close(); }
});

test('daily trial allowance resets each day independently of monthly usage', async () => {
  const db = setup();
  const { day, month } = periodKeys();
  const anotherDay = `${month}-${day.endsWith('-01') ? '02' : '01'}`;
  const account = { id: 'test', level: 'lv1', daily_seconds_limit: 720, monthly_seconds_limit: 0, daily_token_limit: 36000, monthly_token_limit: 0, storage_limit_bytes: 104857600, membership_expires_at: null };
  try {
    db.sqlite.prepare('INSERT INTO usage_daily(user_id,day,tokens,updated_at) VALUES(?,?,?,0)').run('test', anotherDay, 36000);
    assert.equal((await enforceLimits(account)).usage.todayTokens, 0);
    db.sqlite.prepare('INSERT INTO usage_daily(user_id,day,tokens,updated_at) VALUES(?,?,?,0)').run('test', day, 36000);
    await assert.rejects(enforceLimits(account), { status: 429 });
  } finally { db.close(); }
});
