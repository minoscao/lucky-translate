import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import ts from 'typescript';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const strip = text => text.replace(/^import .*;\r?\n/gm,'').replace(/^export \{ PLAN_DEFAULTS \}.*;\r?\n/gm,'');
const moduleUrl = text => 'data:text/javascript;base64,'+Buffer.from(ts.transpile(text,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext})).toString('base64');
const scope = await import(moduleUrl(strip(await read('../lib/account-scope.ts'))));
const retention = await read('../lib/retention.ts');
const rules = await import(moduleUrl(retention));
const access = await import(moduleUrl((await read('../lib/server/cloudflare-access.ts')).replace("from 'jose'",`from '${import.meta.resolve('jose')}'`)));
const stub = 'const getDb=()=>globalThis.__isolationDb; const authError=(message,status=400)=>Object.assign(new Error(message),{status}); const accessIdentity=async()=>null;';
const authUrl = moduleUrl(stub+strip(await read('../lib/server/auth.ts')));
const auth = await import(authUrl);
const cloudUrl = moduleUrl(`import {requireAccount} from '${authUrl}'; ${stub} ${retention}
const getRetentionRules=async()=>DEFAULT_RETENTION;
const accountSnapshot=async a=>({id:a.id,storage:{warning:false}});
${strip(await read('../lib/server/http.ts'))}
${strip(await read('../app/api/cloud/route.ts'))}`);
const cloud = await import(cloudUrl);

test('browser caches and late responses are bound to their original account', async () => {
  const values = new Map([['lucky-coach-state','legacy-owner-unknown']]);
  globalThis.localStorage = { getItem:k=>values.get(k)||null, setItem:(k,v)=>values.set(k,v), removeItem:k=>values.delete(k) };
  const originalFetch = globalThis.fetch;
  try {
    const a=scope.createAccountScope('A'), b=scope.createAccountScope('B');
    assert.equal(a.storage.getItem('lucky-coach-state'),null);
    a.storage.setItem('lucky-coach-state','only-A');
    assert.equal(b.storage.getItem('lucky-coach-state'),null);
    b.storage.setItem('lucky-coach-state','only-B');
    assert.equal(a.storage.getItem('lucky-coach-state'),'only-A');
    let complete, sent;
    globalThis.fetch = async (_url,init) => {sent=init;return new Promise(resolve=>{complete=resolve;});};
    const pending=a.request('/api/cloud'); a.dispose();
    complete(Response.json({records:['A-secret']}));
    await assert.rejects(pending,{name:'AbortError'});
    assert.equal(sent.headers.get('X-Lucky-Account'),'A');
    await assert.rejects(a.save('state','coach-state',{history:['late-A']}),{name:'AbortError'});
    a.storage.setItem('lucky-coach-state','late');
    assert.equal(values.get(scope.cacheKey('A','lucky-coach-state')),'only-A');
    assert.equal(values.get('lucky-coach-state'),'legacy-owner-unknown');
    assert.equal(b.storage.getItem('lucky-coach-state'),'only-B');
  } finally {globalThis.fetch=originalFetch; delete globalThis.localStorage;}
});

test('older mobile browsers support requests and cancellation without newer AbortSignal APIs', async () => {
  const originalFetch = globalThis.fetch;
  const any = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
  const throwIfAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'throwIfAborted');
  Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
  Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', { configurable: true, value: undefined });
  const account = scope.createAccountScope('mobile');
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.headers.get('X-Lucky-Account'), 'mobile');
      assert.equal(init.signal.aborted, false);
      return Response.json({ records: ['saved'] });
    };
    assert.deepEqual(await account.request('/api/cloud', { signal: new AbortController().signal }), { records: ['saved'] });

    const cancelled = new AbortController();
    const reason = new DOMException('User cancelled', 'AbortError');
    cancelled.abort(reason);
    globalThis.fetch = () => assert.fail('Already cancelled requests must not be sent');
    await assert.rejects(account.request('/api/cloud', { signal: cancelled.signal }), error => error === reason);

    for (const source of ['caller', 'account']) {
      const caller = new AbortController();
      let sent;
      globalThis.fetch = (_url, init) => {
        sent = init.signal;
        return new Promise((_resolve, reject) => sent.addEventListener('abort', () => reject(sent.reason), { once: true }));
      };
      const pending = account.request('/api/cloud', { signal: caller.signal });
      if (source === 'caller') caller.abort(reason); else account.dispose();
      assert.equal(sent.aborted, true);
      await assert.rejects(pending, { name: 'AbortError' });
      account.activate();
    }

    // Headers can arrive before the body. Neither caller cancellation nor a
    // closed account may allow that late body into a reactivated workspace.
    for (const source of ['caller', 'account']) {
      const caller = new AbortController();
      let finishBody, signal, bodyStarted;
      const reading = new Promise(resolve => { bodyStarted = resolve; });
      globalThis.fetch = async (_url, init) => {
        signal = init.signal;
        return { ok: true, status: 200, json: () => { bodyStarted(); return new Promise(resolve => { finishBody = resolve; }); } };
      };
      const pending = account.request('/api/cloud', { signal: caller.signal });
      await reading;
      if (source === 'caller') caller.abort(reason); else { account.dispose(); account.activate(); }
      assert.equal(signal.aborted, true);
      finishBody({ records: ['late private data'] });
      await assert.rejects(pending, { name: 'AbortError' });
    }
  } finally {
    account.dispose();
    globalThis.fetch = originalFetch;
    Object.defineProperty(AbortSignal, 'any', any);
    Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', throwIfAborted);
  }
});

function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,status TEXT,level TEXT,membership_expires_at INTEGER,storage_limit_bytes INTEGER);
    CREATE TABLE sessions(token_hash TEXT,user_id TEXT,expires_at INTEGER);
    CREATE TABLE cloud_records(id TEXT,user_id TEXT,type TEXT,data TEXT,bytes INTEGER,created_at INTEGER,updated_at INTEGER,PRIMARY KEY(user_id,id));`);
  const prepare=sql=>{let args=[];const params=()=>sql.includes('?1')?[Object.fromEntries(args.map((v,i)=>[String(i+1),v]))]:args;return {
    bind(...v){args=v;return this;}, async first(){return sqlite.prepare(sql).get(...params())||null;},
    async all(){return {results:sqlite.prepare(sql).all(...params())};}, async run(){return {meta:sqlite.prepare(sql).run(...params())};},
  };};
  globalThis.__isolationDb={prepare,async batch(statements){sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  return sqlite;
}
const digest=async text=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))).toString('hex');
test('cloud reads/writes/deletes reject a switched cookie; identical record ids remain isolated', async () => {
  const db=database(), now=Date.now();
  try {
    for(const id of ['A','B']) {
      db.prepare("INSERT INTO users VALUES (?,'active','lv1',NULL,104857600)").run(id);
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(await digest(id),id,now+60000);
      db.prepare('INSERT INTO cloud_records VALUES (?,?,?,?,?,?,?)').run('profile',id,'profile',JSON.stringify({name:id}),12,now,now);
    }
    const req=(owner,cookie,method='GET',body)=>new Request('https://example.test/api/cloud?id=profile',{method,headers:{'X-Lucky-Account':owner,cookie:`lucky-session=${cookie}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    assert.deepEqual((await (await cloud.GET(req('A','A'))).json()).records.map(x=>x.data),[{name:'A'}]);
    assert.deepEqual((await (await cloud.GET(req('B','B'))).json()).records.map(x=>x.data),[{name:'B'}]);
    for(const method of ['GET','PUT','DELETE']) assert.equal((await cloud[method](req('A','B',method,method==='PUT'?{id:'profile',type:'profile',data:{name:'wrong'}}:undefined))).status,409);
    assert.equal((await cloud.GET(req('','A'))).status,409);
    assert.equal((await cloud.PUT(req('B','B','PUT',{id:'profile',type:'profile',userId:'A',data:{name:'B-updated'}}))).status,200);
    assert.equal(JSON.parse(db.prepare("SELECT data FROM cloud_records WHERE user_id='A'").get().data).name,'A');
    assert.equal((await cloud.DELETE(req('B','B','DELETE'))).status,200);
    assert.equal(db.prepare("SELECT count(*) n FROM cloud_records WHERE user_id='A'").get().n,1);
    assert.equal(db.prepare("SELECT count(*) n FROM cloud_records WHERE user_id='B'").get().n,0);
    const message={id:now*1000,createdAt:now,role:'learner',text:'B original message'};
    assert.equal((await cloud.PUT(req('B','B','PUT',{id:'coach-state',type:'coach-state',data:{history:[message]}}))).status,200);
    assert.equal(JSON.parse(db.prepare("SELECT data FROM cloud_records WHERE user_id='B' AND type='coach-message'").get().data).text,message.text);
    await cloud.PUT(req('B','B','PUT',{id:'coach-state',type:'coach-state',data:{history:[]}}));
    assert.equal(db.prepare("SELECT count(*) n FROM cloud_records WHERE user_id='B' AND type='coach-message'").get().n,1);
    db.prepare('INSERT INTO cloud_records VALUES (?,?,?,?,?,?,?)').run('quarantine','B','quarantined-coach-state','{"history":["wrong account"]}',30,now,now);
    assert.equal((await (await cloud.GET(req('B','B'))).json()).records.some(row=>row.type==='quarantined-coach-state'),false);
  } finally {db.close();delete globalThis.__isolationDb;}
});

test('Cloudflare verification requires signed, unexpired tokens with the right issuer, audience and email',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);jwk.kid='test';
  const keys=createLocalJWKSet({keys:[jwk]});
  const config={issuer:'https://example.cloudflareaccess.com',audience:'admin-app',adminEmails:['owner@example.test','staff@example.test'],superEmails:['owner@example.test']};
  const token=(email,issuer=config.issuer,audience=config.audience,expiration='10m')=>new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(issuer).setAudience(audience).setSubject('test-subject').setIssuedAt().setExpirationTime(expiration).sign(privateKey);
  assert.deepEqual(await access.verifyAccessToken(await token('owner@example.test'),config,keys),{email:'owner@example.test',superAdmin:true});
  assert.equal((await access.verifyAccessToken(await token('staff@example.test'),config,keys)).superAdmin,false);
  assert.equal(await access.verifyAccessToken(await token('outsider@example.test'),config,keys),null);
  await assert.rejects(access.verifyAccessToken(await token('owner@example.test',config.issuer,'other-app'),config,keys));
  await assert.rejects(access.verifyAccessToken(await token('owner@example.test','https://other.cloudflareaccess.com'),config,keys));
  await assert.rejects(access.verifyAccessToken(await token('owner@example.test',config.issuer,config.audience,'-1m'),config,keys));
  const valid=await token('owner@example.test');
  await assert.rejects(access.verifyAccessToken(valid.slice(0,-10)+'tampered',config,keys));
  assert.equal(await auth.isAdmin(new Request('https://example.test/api/admin',{headers:{'Cf-Access-Authenticated-User-Email':'owner@example.test',cookie:'lucky-admin=old'}})),false);
});

test('retention uses calendar months, distinguishes tiers and trims dated summaries',()=>{
  assert.equal(rules.retentionMonths('lv1'),1);assert.equal(rules.retentionMonths('lv2'),6);assert.equal(rules.retentionMonths('lv3'),6);
  assert.equal(new Date(rules.monthsAgo(1,Date.parse('2026-03-31T12:00:00Z'))).toISOString(),'2026-02-28T12:00:00.000Z');
  const cutoff=Date.parse('2026-08-07T00:00:00Z');
  assert.equal(rules.retainedContent('coach-journal',{daily:[{date:'2026-08-01'},{date:'2026-09-01'}],weekly:[]},cutoff).daily.length,1);
  assert.throws(()=>rules.validateRetention({lv1:0,lv2:6,lv3:6}));
});
