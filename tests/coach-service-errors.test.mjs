import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const stripImports = source => source.replace(/^import .*;\r?\n/gm, '');
const account = await read('../lib/server/account.ts');
const limits = account.slice(account.indexOf('export async function enforceLimits'), account.indexOf('export type TokenUsage'));
const mocks = `
const accountSnapshot = async () => globalThis.__coachSnapshot;
const requireAccount = async () => ({}), getDeepSeekKey = async () => 'fixture';
const sameOrigin = () => true, readJson = request => request.json();
const json = (body, status = 200) => Response.json(body, {status});
const COACH_LANGUAGE_POLICY = 'English only';
const recordDeepSeekUsage = async () => { throw new Error('Rejected requests must not be charged'); };
`;
const source = mocks + limits + stripImports(await read('../lib/server/deepseek.ts'))
  + await read('../lib/server/coach-error.ts') + stripImports(await read('../app/api/coach/route.ts'));
const { POST } = await import('data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext })).toString('base64'));

test('JSON recaps and streamed replies distinguish each account limit from a busy provider', async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    ['dailyTokens', 'todayTokens', 'daily_token_limit', /daily AI service allowance/],
    ['monthlyTokens', 'monthTokens', 'monthly_token_limit', /monthly AI service allowance/],
    ['dailySeconds', 'todaySeconds', 'daily_time_limit', /today’s fish allowance/],
    ['monthlySeconds', 'monthSeconds', 'monthly_time_limit', /this month’s fish allowance/],
    [null, null, 'provider_busy', /temporarily busy/],
  ];
  try {
    for (const stream of [false, true]) for (const [limit, usage, code, message] of cases) {
      let calls = 0;
      globalThis.fetch = async () => { calls++; return new Response(null, { status: 429 }); };
      globalThis.__coachSnapshot = { limits: {}, usage: {} };
      if (limit) {
        globalThis.__coachSnapshot.limits[limit] = 100;
        globalThis.__coachSnapshot.usage[usage] = 100;
      }
      const response = await POST(new Request('https://example.test/api/coach', {
        method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'Review today' }], stream }),
      }));
      const result = stream ? JSON.parse((await response.text()).trim().slice(6)) : await response.json();
      assert.equal(response.status, stream ? 200 : 429);
      assert.equal(result.code, code);
      assert.match(result.error, message);
      assert.doesNotMatch(result.error, /limit has been reached or/);
      assert.equal(calls, limit ? 0 : 1, 'Exhausted accounts never call the provider');
      if (stream) assert.equal(result.type, 'error');
    }
  } finally { globalThis.fetch = originalFetch; delete globalThis.__coachSnapshot; }
});
