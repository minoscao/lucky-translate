import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64');
const read = file => readFile(new URL(file, import.meta.url), 'utf8');
const languageUrl = moduleUrl(await read('../lib/coach-language.ts'));
const coachUrl = moduleUrl(await read('../lib/coach.ts'));
const { coachReplyDirect, COACH_RESPONSE_CONTRACT } = await import(coachUrl);
const configSource = (await read('../lib/server/config.ts')).replace(/^import .*;\r?\n/gm, '');
const configUrl = moduleUrl(`import {COACH_LANGUAGE_POLICY} from '${languageUrl}'; import {COACH_RESPONSE_CONTRACT,DEFAULT_COACH_SKILL} from '${coachUrl}'; const getDb=()=>({prepare:()=>({first:async()=>globalThis.__contractSkill})});\n${configSource}`);
const routeSource = (await read('../app/api/coach/route.ts')).replace(/^import .*;\r?\n/gm, '');
const timeUrl = moduleUrl(await read('../lib/text-time.ts'));
const routeUrl = moduleUrl(`import {COACH_LANGUAGE_POLICY,assertCoachEnglish} from '${languageUrl}'; import {getCoachSkill} from '${configUrl}'; import {coachTimeBasis,parseCoachContent} from '${timeUrl}';
const sameOrigin=()=>true,requireAccount=async()=>({id:'contract-test'}),readJson=request=>request.json(),json=(body,status=200)=>Response.json(body,{status});
const chargeTextTime=async()=>({chargedSeconds:1});
const deepSeekJson=async(account,feature,messages,signal,maxTokens,validate,retry)=>{
  globalThis.__contractRequest={messages,retry};
  const content=JSON.stringify({reply:'Yes, I can hear you!'});validate(content);return {content,usage:{eventId:'contract-test',tokens:1,cost:0}};
};\n${routeSource}`);
const { POST } = await import(routeUrl);
const { assertCoachEnglish, COACH_LANGUAGE_POLICY } = await import(languageUrl);

test('generated fields allow English, emoji and diagrams but block non-Latin text at every depth', () => {
  assert.doesNotThrow(() => assertCoachEnglish({ reply: "I don't understand that language. Please try again in English. 🙂", tip: 'home --> school', memory: { topics: ['work'] } }));
  for (const text of ['你好', 'こんにちは', 'مرحبا', 'Привет']) {
    assert.throws(() => assertCoachEnglish({ memory: { topics: [text] } }), /non_english_output/);
  }
});

test('the final provider prompt preserves the reply contract with default and custom coach rules', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (_url, init) => POST(new Request('https://example.test/api/coach', init));
  try {
    for (const skill of [null, { value: 'Keep the learner comfortable. Use a single brief question.' }]) {
      globalThis.__contractSkill = skill;
      const result = await coachReplyDirect({ key: 'contract-test', history: [{ id: 1, role: 'coach', text: 'Hello there!' }, { id: 2, role: 'learner', text: 'Hello, hello, testing, testing, can you hear me?' }], memory: { level: 'discovering', topics: [], strengths: [], focus: [], phrases: [] }, turnStatus: 'brief greeting', signal: new AbortController().signal });
      const { messages, retry } = globalThis.__contractRequest;
      assert.ok(messages[0].content.includes(COACH_RESPONSE_CONTRACT));
      assert.ok(messages[0].content.endsWith(COACH_LANGUAGE_POLICY));
      if (skill) assert.ok(messages[0].content.includes(skill.value));
      assert.deepEqual(JSON.parse(messages[1].content), { reply: 'Hello there!' });
      assert.equal(messages[2].content, 'Hello, hello, testing, testing, can you hear me?');
      assert.equal(retry, true);
      assert.equal(result.data.reply, 'Yes, I can hear you!');
    }
  } finally {
    globalThis.fetch = previous;
    delete globalThis.__contractSkill;
    delete globalThis.__contractRequest;
  }
});
