import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const strip = text => text.replace(/^import .*;\r?\n/gm,'').replace(/^export \{ PLAN_DEFAULTS \}.*;\r?\n/gm,'');
const url = text => 'data:text/javascript;base64,'+Buffer.from(ts.transpile(text,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext})).toString('base64');
const dbStub='const getDb=()=>globalThis.__securityDb;';
const securityUrl=url(dbStub+strip(await read('../lib/server/auth-security.ts')));
const authUrl=url(`import {digestToken,randomToken,ensureAuthTables,authError,validateNewPassword} from '${securityUrl}';`+'const accessIdentity=async()=>null;'+dbStub+await read('../lib/membership-plans.ts')+strip(await read('../lib/server/auth.ts')));
const recoveryUrl=url(`import {hashPassword} from '${authUrl}'; import {authError,digestToken,ensureAuthTables,randomToken,validateNewPassword} from '${securityUrl}'; const getEmailSender=()=>globalThis.__securityEmail;`+dbStub+strip(await read('../lib/server/password-recovery.ts')));
const security=await import(securityUrl), auth=await import(authUrl), recovery=await import(recoveryUrl);
function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE app_config(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER); CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,password_hash TEXT,updated_at INTEGER); CREATE TABLE sessions(token_hash TEXT,user_id TEXT,expires_at INTEGER,created_at INTEGER)');
  const prepare=sql=>{let args=[];const params=()=>sql.includes('?1')?[Object.fromEntries(args.map((value,index)=>[String(index+1),value]))]:args;return {bind(...values){args=values;return this;},async first(){return sqlite.prepare(sql).get(...params())||null;},async run(){return {meta:sqlite.prepare(sql).run(...params())};}};};
  globalThis.__securityDb={prepare,async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  return sqlite;
}
const request=(cookie='',ip='127.0.0.1')=>new Request('https://example.test/api/admin',{headers:{cookie,'cf-connecting-ip':ip}});

test('password resets expire, consume once, preserve unrelated users and revoke previous sessions',async()=>{
  const db=database();process.env.EMAIL_FROM='noreply@example.test';process.env.PUBLIC_APP_URL='https://example.test';
  const delivered=[];globalThis.__securityEmail={send:async message=>delivered.push(message)};
  try {
    const original=await auth.hashPassword('OriginalTest123');
    db.prepare('INSERT INTO users VALUES (?,?,?,0)').run('one','one@example.test',original);
    db.prepare('INSERT INTO users VALUES (?,?,?,0)').run('two','two@example.test',original);
    db.exec("INSERT INTO sessions VALUES ('old-session','one',9999999999999,0)");
    await recovery.requestPasswordReset('one@example.test');
    const token=new URL(delivered[0].text.match(/https:\/\/[^\s]+/)[0]).hash.slice(1);
    const row=db.prepare('SELECT * FROM password_resets').get();assert.notEqual(row.token_hash,token);
    await assert.rejects(recovery.resetPassword({token,nextPassword:'ChangedTest123',confirmPassword:'Mismatch123'}),{status:400});
    assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,1);
    await recovery.resetPassword({token,nextPassword:'ChangedTest123',confirmPassword:'ChangedTest123'});
    assert.equal(await auth.verifyPassword('ChangedTest123',db.prepare("SELECT password_hash FROM users WHERE id='one'").get().password_hash),true);
    assert.equal(db.prepare("SELECT password_hash FROM users WHERE id='two'").get().password_hash,original);
    assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,0);
    await assert.rejects(recovery.resetPassword({token,nextPassword:'AnotherTest123',confirmPassword:'AnotherTest123'}),{status:400});
    await recovery.requestPasswordReset('one@example.test');
    const expired=new URL(delivered[1].text.match(/https:\/\/[^\s]+/)[0]).hash.slice(1);
    db.exec('UPDATE password_resets SET expires_at=0');
    await assert.rejects(recovery.resetPassword({token:expired,nextPassword:'AnotherTest123',confirmPassword:'AnotherTest123'}),{status:400});
    await recovery.requestPasswordReset('missing@example.test');assert.equal(delivered.length,2);
  } finally {db.close();delete globalThis.__securityEmail;delete process.env.EMAIL_FROM;delete process.env.PUBLIC_APP_URL;}
});

test('legacy admin cookies no longer authenticate',async()=>{
  const db=database();
  try {
    assert.equal(await auth.isAdmin(request('lucky-admin=old-secret-derived-token')),false);
    assert.equal(await auth.isSuperAdmin(request('lucky-super-admin=old-token')),false);
    await assert.rejects(auth.requireAdmin(request('lucky-admin=old-token')),{status:401});
  } finally {db.close();}
});

test('authentication attempts are limited across requests and password confirmation is mandatory',async()=>{
  const db=database();
  try {
    for(let n=0;n<3;n++)await security.limitAuth(request(),'login','same@example.test',3);
    await assert.rejects(security.limitAuth(request(),'login','same@example.test',3),{status:429});
    await assert.rejects(security.limitAuth(request('','other-ip'),'login','same@example.test',3),{status:429});
    db.exec('UPDATE auth_limits SET expires_at=0');await security.limitAuth(request(),'login','same@example.test',3);
    assert.throws(()=>security.validateNewPassword('NewPassword123',undefined),{status:400});
  } finally {db.close();delete globalThis.__securityDb;}
});
