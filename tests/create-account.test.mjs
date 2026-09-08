import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const compile = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64');
const strip = source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export \{ PLAN_DEFAULTS \}.*;\r?\n/gm, '');
const planSource = await read('../lib/membership-plans.ts');
const authUrl = compile(planSource + '\nconst getDb=()=>globalThis.__accountsDb;\n' + strip(await read('../lib/server/auth.ts')));
const { verifyPassword } = await import(authUrl);
const createUrl = compile(`import { hashPassword, PLAN_DEFAULTS } from '${authUrl}'; const getDb=()=>globalThis.__accountsDb;\n` + strip(await read('../lib/server/create-account.ts')));
const { createAccount } = await import(createUrl);

test('shared account creation hashes passwords, applies plans, preserves pending registration and prevents duplicates', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE,email TEXT UNIQUE,password_hash TEXT,status TEXT,level TEXT,daily_seconds_limit INTEGER,monthly_seconds_limit INTEGER,daily_token_limit INTEGER,monthly_token_limit INTEGER,monthly_price_cents INTEGER,storage_limit_bytes INTEGER,membership_expires_at INTEGER,admin_note TEXT,created_at INTEGER,updated_at INTEGER)');
  globalThis.__accountsDb = { prepare(sql) { let args; return { bind(...values) { args=Object.fromEntries(values.map((v,i)=>[String(i+1),v]));return this; }, async first() { return sqlite.prepare(sql).get(args); }, async run() { return { meta: sqlite.prepare(sql).run(args) }; } }; } };
  const identity = { email: ' Trial@Example.test ', username: 'Trial', password: 'LocalTestOnly123' };
  try {
    const id = await createAccount(identity, { level:'lv1', status:'active' });
    const row = sqlite.prepare('SELECT * FROM users WHERE id=?').get(id);
    assert.equal(row.email,'trial@example.test'); assert.equal(row.status,'active'); assert.equal(row.daily_seconds_limit,720); assert.equal(row.storage_limit_bytes,104857600);
    assert.notEqual(row.password_hash,identity.password); assert.equal(await verifyPassword(identity.password,row.password_hash),true);
    await assert.rejects(createAccount(identity), {status:409});
    await assert.rejects(createAccount({...identity,email:'other@example.test',username:'TRIAL'}), {status:409});
    await assert.rejects(createAccount({...identity,email:'invalid'}), {status:400});
    await assert.rejects(createAccount({...identity,password:'short'}), {status:400});
    const pending = await createAccount({...identity,email:'pending@example.test',username:'Pending',status:'active',level:'lv3'});
    assert.equal(sqlite.prepare('SELECT status FROM users WHERE id=?').get(pending).status,'pending');
    assert.equal(sqlite.prepare('SELECT daily_seconds_limit FROM users WHERE id=?').get(pending).daily_seconds_limit,0);
    for (const [level,daily,monthly] of [['lv2',7200,0],['lv3',0,360000]]) {
      const planId=await createAccount({...identity,email:`${level}@example.test`,username:level},{level,status:'active'});
      const plan=sqlite.prepare('SELECT * FROM users WHERE id=?').get(planId);
      assert.equal(plan.daily_seconds_limit,daily);assert.equal(plan.monthly_seconds_limit,monthly);
      assert.equal(plan.daily_token_limit,level==='lv2'?360000:0);assert.equal(plan.monthly_token_limit,level==='lv3'?18000000:0);
    }
  } finally { sqlite.close(); delete globalThis.__accountsDb; }
});

test('admin creation requires same origin and administrator access without issuing a customer session', async () => {
  const source = strip(await read('../app/api/admin/route.ts'));
  globalThis.__adminCreate = { authorized:false, calls:0 };
  const mocks = `const state=globalThis.__adminCreate;
    const sameOrigin=r=>r.headers.get('origin')===new URL(r.url).origin;
    const readJson=r=>r.json(),json=(body,status=200,headers={})=>Response.json(body,{status,headers});
    const requireAdmin=async()=>{if(!state.authorized)throw Object.assign(new Error('请先登录管理后台'),{status:401})};
    const createAccount=async()=>{state.calls++;return 'created-id'};
    const getRetentionRules=async()=>({lv1:1,lv2:6,lv3:6}); const recoveryConfigured=()=>false; const ensureBootstrap=async()=>{},accountSnapshot=async()=>({}),timeLedger=async()=>[],deepSeekConfigured=async()=>true,getCoachSkill=async()=>'',getTextTimeRules=async()=>({}),isSuperAdmin=async()=>false;
    const getDb=()=>({prepare:()=>({all:async()=>({results:[]}),first:async()=>null})});`;
  const { POST } = await import(compile(mocks+source));
  const req=(origin='https://example.test')=>new Request('https://example.test/api/admin',{method:'POST',headers:{origin},body:JSON.stringify({action:'create_user',level:'lv1',status:'active'})});
  try {
    assert.equal((await POST(req('https://elsewhere.test'))).status,403);
    assert.equal((await POST(req())).status,401);assert.equal(globalThis.__adminCreate.calls,0);
    globalThis.__adminCreate.authorized=true;
    const response=await POST(req());assert.equal(response.status,201);assert.equal(response.headers.get('set-cookie'),null);
    assert.equal((await response.json()).createdUserId,'created-id');assert.equal(globalThis.__adminCreate.calls,1);
  } finally { delete globalThis.__adminCreate; }
});

test('public registration requires verification and rejects username login', async () => {
  const source=strip(await read('../app/api/auth/route.ts'));
  const inputs=await read('../lib/auth-inputs.ts');
  const mocks=`const sameOrigin=()=>true,ensureBootstrap=async()=>{},limitAuth=async()=>{};
    const readJson=r=>r.json(),json=(body,status=200,headers={})=>Response.json(body,{status,headers});
    const beginRegistration=async()=>({verificationRequired:true}),createSession=async()=>{throw new Error('must not issue session');};`;
  const {POST}=await import(compile(inputs+mocks+source));
  const req=body=>new Request('https://example.test/api/auth',{method:'POST',body:JSON.stringify(body)});
  const response=await POST(req({action:'register',email:'new@example.test',username:'New',password:'LocalTest123',confirmPassword:'LocalTest123',level:'lv3'}));
  assert.equal(response.status,202);assert.equal(response.headers.get('set-cookie'),null);assert.equal((await response.json()).verificationRequired,true);
  for(const email of ['username','bad@','a b@example.com','a@-example.com','a..b@example.com'])assert.equal((await POST(req({action:'login',email,password:'LocalTest123'}))).status,400);
});
