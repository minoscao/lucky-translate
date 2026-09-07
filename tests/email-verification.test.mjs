import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const strip = text => text.replace(/^import .*;\r?\n/gm,'').replace(/^export \{ PLAN_DEFAULTS \}.*;\r?\n/gm,'');
const url = text => 'data:text/javascript;base64,'+Buffer.from(ts.transpile(text,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext})).toString('base64');
const stub='const getDb=()=>globalThis.__emailDb;';
const securityUrl=url(stub+strip(await read('../lib/server/auth-security.ts')));
const authUrl=url(stub+await read('../lib/membership-plans.ts')+strip(await read('../lib/server/auth.ts')));
const verificationUrl=url(`import {hashPassword,verifyPassword,PLAN_DEFAULTS} from '${authUrl}';import {authError,ensureAuthTables,validateNewPassword} from '${securityUrl}';const getEmailSender=()=>globalThis.__emailSender;`+stub+await read('../lib/auth-inputs.ts')+strip(await read('../lib/server/email-verification.ts')));
const verification=await import(verificationUrl),auth=await import(authUrl);
const schema=await read('../drizzle/0000_noisy_anthem.sql');
function fixture(){
  const db=new DatabaseSync(':memory:');db.exec(schema);
  const prepare=sql=>{let args=[];const params=()=>sql.includes('?1')?[Object.fromEntries(args.map((v,i)=>[String(i+1),v]))]:args;return {bind(...v){args=v;return this;},async first(){return db.prepare(sql).get(...params())||null;},async run(){return {meta:db.prepare(sql).run(...params())};}};};
  globalThis.__emailDb={prepare,async batch(statements){db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
  const sent=[];globalThis.__emailSender={send:async m=>sent.push(m)};process.env.EMAIL_FROM='noreply@example.test';
  return {db,sent,code:()=>sent.at(-1).text.match(/code is: (\d{6})/)[1],close(){db.close();delete globalThis.__emailDb;delete globalThis.__emailSender;delete process.env.EMAIL_FROM;}};
}
const body={email:'trial@example.test',username:'Trial',password:'TestFixture123',confirmPassword:'TestFixture123',level:'lv3',dailySeconds:99999};

test('email verification creates only Lv1 after proof, hashes secrets and consumes code once',async()=>{
  const f=fixture();try{
    await verification.beginRegistration(body);
    assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,0);
    const row=f.db.prepare('SELECT * FROM pending_registrations').get();
    assert.notEqual(row.password_hash,body.password);assert.notEqual(row.code_hash,f.code());
    const outcomes=await Promise.allSettled([verification.completeRegistration(body.email,f.code()),verification.completeRegistration(body.email,f.code())]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    const account=f.db.prepare('SELECT * FROM users').get();assert.equal(account.level,'lv1');assert.equal(account.status,'active');assert.equal(account.daily_seconds_limit,600);
    assert.equal(await auth.verifyPassword(body.password,account.password_hash),true);
    assert.equal(f.db.prepare('SELECT count(*) n FROM pending_registrations').get().n,0);
    await assert.rejects(verification.completeRegistration(body.email,f.code()));
  }finally{f.close();}
});
test('codes expire, attempts stop at five, resend has cooldown and delivery failure cannot activate',async()=>{
  const f=fixture();try{
    await verification.beginRegistration(body);const old=f.code();
    await assert.rejects(verification.beginRegistration(body),{status:429});
    await verification.resendVerification(body.email);assert.equal(f.sent.length,1);
    const wrong=old==='000000'?'111111':'000000';
    for(let i=0;i<5;i++)await assert.rejects(verification.completeRegistration(body.email,wrong));
    await assert.rejects(verification.completeRegistration(body.email,old));
    f.db.exec('UPDATE pending_registrations SET sent_at=0');await verification.resendVerification(body.email);assert.equal(f.sent.length,2);
    f.db.exec('UPDATE pending_registrations SET expires_at=0');await assert.rejects(verification.completeRegistration(body.email,f.code()));
    globalThis.__emailSender.send=async()=>{throw new Error('simulated delivery failure');};
    f.db.exec('UPDATE pending_registrations SET sent_at=0');await assert.rejects(verification.resendVerification(body.email),{status:502});
    assert.equal(f.db.prepare('SELECT expires_at FROM pending_registrations').get().expires_at,0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM users').get().n,0);
    await verification.resendVerification('unknown@example.test');
  }finally{f.close();}
});
test('registration cannot alter an existing account or password',async()=>{
  const f=fixture();try{
    await verification.beginRegistration(body);await verification.completeRegistration(body.email,f.code());
    const before=f.db.prepare('SELECT * FROM users').get();
    await assert.rejects(verification.beginRegistration({...body,password:'DifferentTest123',confirmPassword:'DifferentTest123'}),{status:409});
    assert.deepEqual(f.db.prepare('SELECT * FROM users').get(),before);
  }finally{f.close();}
});
