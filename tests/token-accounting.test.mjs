import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const read = file => readFile(new URL(file, import.meta.url), 'utf8');
const source = (await read('../lib/server/account.ts')).replace(/^import .*;\r?\n/gm, '');
const moduleSource = `const getDb=()=>globalThis.__tokenDb, getRetentionRules=async()=>({}), retentionMonths=()=>1;\n${source}`;
const { recordDeepSeekUsage, enforceLimits, periodKeys } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(moduleSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64'));
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
