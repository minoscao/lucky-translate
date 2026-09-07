import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const source = await readFile(new URL('../lib/text-time.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64');
const { estimateTextTime, DEFAULT_TEXT_TIME_RULES: rates, validTextTimeRules, coachTimeBasis, parseCoachContent } = await import(moduleUrl);

test('billing uses spoken words and CJK characters, excluding punctuation and playback speed', () => {
  assert.equal(estimateTextTime(['word '.repeat(150)], rates).chargedSeconds, 60);
  assert.equal(estimateTextTime(['你'.repeat(240)], rates, 'translation').chargedSeconds, 60);
  assert.equal(estimateTextTime(['word '.repeat(9000)], rates, 'summary').chargedSeconds, 360);
  const mixed = estimateTextTime(["Hello, 你好! I’m well."], rates);
  assert.equal(mixed.words, 3); assert.equal(mixed.characters, 2); assert.equal(mixed.estimatedSeconds, 1.7);
  assert.equal(estimateTextTime(['…!? 😀'], rates).chargedSeconds, 0);
  for (const speed of [.75, 1, 1.5, 2]) assert.equal(estimateTextTime(['word '.repeat(150)], { ...rates, speechSpeed: speed }).chargedSeconds, 60);
  assert.equal(estimateTextTime(['word '.repeat(150)], { ...rates, secondsPerWord: .6 }).chargedSeconds, 90);
  assert.equal(validTextTimeRules({ secondsPerWord: NaN, secondsPerCharacter: .25 }), false);
  assert.equal(validTextTimeRules({ secondsPerWord: 0, secondsPerCharacter: .25 }), false);
});

test('one coach turn counts only the latest learner message and visible reply', () => {
  const messages = [{ role: 'system', content: 'private rules '.repeat(1000) }, { role: 'user', content: 'old history '.repeat(500) }, { role: 'assistant', content: 'old answer' }, { role: 'user', content: 'Hello Lucky' }, { role: 'user', content: 'Private learner memory: hidden' }];
  const basis = coachTimeBasis(messages, { reply: 'Hello friend', tip: 'hidden tip', memory: {} });
  assert.deepEqual(basis.texts, ['Hello Lucky', 'Hello friend']);
  assert.equal(estimateTextTime(basis.texts, rates).words, 4);
  assert.throws(() => coachTimeBasis(messages, { reply: '' }));
  assert.throws(() => parseCoachContent('incomplete {"reply":'));
  assert.equal(parseCoachContent('```json\n{"reply":"Hi"}\n```').reply, 'Hi');
});

test('summary uses transcript content at ten percent, excluding labels and instructions', () => {
  const messages = [{ role: 'system', content: 'You make evidence-based daily English learning recalls.' }, { role: 'user', content: 'Private instructions and memory\nConversation:\nLearner: ' + 'word '.repeat(75) + '\nCoach: ' + 'word '.repeat(75) }];
  const basis = coachTimeBasis(messages, { overview: 'Summary', vocabulary: [], grammar: [] });
  const charge = estimateTextTime(basis.texts, rates, basis.category);
  assert.equal(charge.words, 150); assert.equal(charge.chargedSeconds, 6);
});

test('coach endpoint charges validated content only; empty, malformed and failed replies never charge time', async () => {
  let route = await readFile(new URL('../app/api/coach/route.ts', import.meta.url), 'utf8');
  route = route.replace(/^import .*;\r?\n/gm, '');
  globalThis.__coachBillingTest = { content: JSON.stringify({ reply: 'Hello friend', tip: '', memory: {} }), calls: [], fail: false };
  const mocks = `import {coachTimeBasis,parseCoachContent} from '${moduleUrl}';
    const state=globalThis.__coachBillingTest;
    const sameOrigin=()=>true, requireAccount=async()=>({id:'test'}), readJson=request=>request.json(), getCoachSkill=async()=>'';
    const json=(body,status=200)=>Response.json(body,{status});
    const deepSeekJson=async()=>{if(state.fail)throw new Error('Provider unavailable');return {content:state.content,usage:{eventId:'event',tokens:20,cost:0}}};
    const chargeTextTime=async(account,category,texts)=>{state.calls.push({category,texts});return {chargedSeconds:2}};`;
  const { POST } = await import('data:text/javascript;base64,' + Buffer.from(mocks + ts.transpile(route, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64'));
  const request = () => new Request('https://example.test/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{role:'system',content:'Coach'}, {role:'user',content:'Hello Lucky'}, {role:'user',content:'Private memory'}] }) });
  try {
    assert.equal((await POST(request())).status,200);
    assert.deepEqual(globalThis.__coachBillingTest.calls,[{category:'training',texts:['Hello Lucky','Hello friend']}]);
    for(const content of ['{"reply":', '{}', '{"reply":""}']) {
      globalThis.__coachBillingTest.content=content;
      assert.equal((await POST(request())).status,502);
    }
    globalThis.__coachBillingTest.fail=true;
    assert.equal((await POST(request())).status,500);
    assert.equal(globalThis.__coachBillingTest.calls.length,1);
  } finally { delete globalThis.__coachBillingTest; }
});

test('ledger and daily total commit once, with rate snapshots preserved after a settings change', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE app_config(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER); CREATE TABLE usage_events(id TEXT PRIMARY KEY,user_id TEXT,feature TEXT,provider TEXT,model TEXT,input_tokens INTEGER,cached_tokens INTEGER,output_tokens INTEGER,total_tokens INTEGER,cost_micros INTEGER,price_snapshot TEXT,created_at INTEGER); CREATE TABLE usage_daily(user_id TEXT,day TEXT,tokens INTEGER,cost_micros INTEGER,active_seconds INTEGER,training_seconds INTEGER,translation_seconds INTEGER,updated_at INTEGER,PRIMARY KEY(user_id,day));');
  const prepare = sql => {
    let args = [];
    const params = () => sql.includes('?1') ? [Object.fromEntries(args.map((arg, i) => [String(i + 1), arg]))] : args;
    return { bind(...values) { args = values; return this; }, async first() { return sqlite.prepare(sql).get(...params()) ?? null; }, async all() { return { results: sqlite.prepare(sql).all(...params()) }; }, async run() { return sqlite.prepare(sql).run(...params()); } };
  };
  globalThis.__timeTestDb = { prepare, async batch(statements) { sqlite.exec('BEGIN'); try { const out = []; for (const statement of statements) out.push(await statement.run()); sqlite.exec('COMMIT'); return out; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  let server = await readFile(new URL('../lib/server/text-time.ts', import.meta.url), 'utf8');
  server = server.replace(/^import .*;\r?\n/gm, '');
  const serverJs = `import { DEFAULT_TEXT_TIME_RULES,estimateTextTime,validTextTimeRules } from '${moduleUrl}'; const getDb=()=>globalThis.__timeTestDb; const periodKeys=()=>({day:'2026-09-07'});\n` + ts.transpile(server, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
  const { chargeTextTime, setTextTimeRules, refundLegacyTime } = await import('data:text/javascript;base64,' + Buffer.from(serverJs).toString('base64'));
  try {
    const account = { id: 'test-user' }, words = ['word '.repeat(150)];
    await chargeTextTime(account, 'training', words, 'Test', 'turn-1');
    await chargeTextTime(account, 'training', words, 'Test', 'turn-1');
    assert.equal(sqlite.prepare('SELECT active_seconds FROM usage_daily').get().active_seconds, 60);
    await setTextTimeRules({ ...rates, secondsPerWord: .8 });
    await chargeTextTime(account, 'translation', words, 'Test', 'turn-2');
    const totals = sqlite.prepare('SELECT * FROM usage_daily').get();
    assert.equal(totals.active_seconds, 180); assert.equal(totals.training_seconds, 60); assert.equal(totals.translation_seconds, 120);
    const rows = sqlite.prepare('SELECT price_snapshot FROM usage_events ORDER BY id').all();
    assert.equal(JSON.parse(rows[0].price_snapshot).rules.secondsPerWord, .4);
    assert.equal(JSON.parse(rows[1].price_snapshot).rules.secondsPerWord, .8);
    sqlite.exec('UPDATE usage_daily SET active_seconds=active_seconds+4904,training_seconds=training_seconds+4860,translation_seconds=translation_seconds+30');
    await refundLegacyTime(account,'2026-09-07');
    await refundLegacyTime(account,'2026-09-07');
    const refunded = sqlite.prepare('SELECT * FROM usage_daily').get();
    assert.equal(refunded.active_seconds,180); assert.equal(refunded.training_seconds,60); assert.equal(refunded.translation_seconds,120);
    const credit = sqlite.prepare("SELECT price_snapshot FROM usage_events WHERE model='legacy-time-refund'").get();
    assert.equal(JSON.parse(credit.price_snapshot).chargedSeconds,-4904);
  } finally { sqlite.close(); delete globalThis.__timeTestDb; }
});
