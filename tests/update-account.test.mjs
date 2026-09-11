import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
const read = file => readFile(new URL(file, import.meta.url), 'utf8');
const source = (await read('../lib/server/update-account.ts')).replace(/^import .*;\r?\n/gm, '');
const { updateAccount } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(`${await read('../lib/auth-inputs.ts')} ${await read('../lib/membership-plans.ts')}
const getDb=()=>globalThis.__updateDb,ensureAuthTables=async()=>{},authError=(message,status=400)=>Object.assign(new Error(message),{status}); ${source}`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64'));

test('identity updates preserve account ownership and reject duplicates without changing membership or sessions', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(await read('../drizzle/0000_noisy_anthem.sql') + await read('../drizzle/0003_monthly_token_limit.sql'));
  db.exec(`CREATE TABLE password_resets(token_hash TEXT,user_id TEXT,expires_at INTEGER);
    INSERT INTO users(id,username,email,password_hash,status,level,monthly_price_cents,membership_expires_at,created_at,updated_at) VALUES('A','Alice','alice@example.test','hash','active','lv2',2000,100,0,0),('B','Bob','bob@example.test','hash','active','lv1',0,NULL,0,0);
    INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES('session-A','A',9999999999999,0),('session-B','B',9999999999999,0);
    INSERT INTO password_resets VALUES('reset-A','A',9999999999999);
    INSERT INTO cloud_records(id,user_id,type,data,bytes,created_at,updated_at) VALUES('history','A','coach-state','{}',2,0,0);
    INSERT INTO usage_daily(user_id,day,tokens,active_seconds,updated_at) VALUES('A','2026-09-12',12345,600,0);`);
  globalThis.__updateDb = {
    prepare(sql) { let args = {}; return { bind(...values) { args = Object.fromEntries(values.map((value, index) => [String(index+1), value])); return this; }, async first() { return db.prepare(sql).get(args); }, async run() { return { meta: db.prepare(sql).run(args) }; } }; },
    async batch(statements) { db.exec('BEGIN'); try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec('COMMIT'); return results; } catch (error) { db.exec('ROLLBACK'); throw error; } },
  };
  const account = () => db.prepare("SELECT * FROM users WHERE id='A'").get();
  try {
    const before = account();
    await updateAccount({ id: 'A', username: 'Alice.New' });
    assert.equal(account().username, 'Alice.New');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id='A'").get().n, 1);
    for (const changes of [{ email: 'BOB@example.test', monthlyPriceCents: 99 }, { username: 'bOB', email: 'new@example.test' }]) {
      await assert.rejects(updateAccount({ id: 'A', ...changes }), { status: 409 });
      assert.equal(account().email, 'alice@example.test');
      assert.equal(account().monthly_price_cents, 2000);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id='A'").get().n, 1);
    }
    for (const changes of [{ email: 'bad@' }, { username: 'a b' }]) await assert.rejects(updateAccount({ id: 'A', ...changes }), { status: 400 });
    await updateAccount({ id: 'A', username: 'Alice.Final', email: ' New@example.test ' });
    assert.equal(account().email, 'new@example.test');
    for (const key of ['id','password_hash','status','level','membership_expires_at','monthly_price_cents']) assert.equal(account()[key], before[key]);
    assert.equal(db.prepare("SELECT tokens FROM usage_daily WHERE user_id='A'").get().tokens, 12345);
    assert.equal(db.prepare("SELECT user_id FROM cloud_records WHERE id='history'").get().user_id, 'A');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM password_resets WHERE user_id='A'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id='A'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id='B'").get().n, 1);
  } finally { db.close(); delete globalThis.__updateDb; }
});
