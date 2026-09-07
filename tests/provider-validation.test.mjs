import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source=(await readFile(new URL('../lib/server/deepseek.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const mocks="const enforceLimits=async()=>{},getDeepSeekKey=async()=> 'test-fixture-key';const recordDeepSeekUsage=async(a,f,u,m,b=true)=>{globalThis.__charges.push(b);return {eventId:'test',tokens:b?10:0};};";
const {deepSeekJson}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(mocks+source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext})).toString('base64'));
test('provider cost is recorded but unusable output never consumes customer tokens',async()=>{
  const old=globalThis.fetch;globalThis.__charges=[];
  try{
    for(const [content,finish] of [['{','stop'],['{}','stop'],['','stop'],['{"reply":"cut"}','length']]){
      globalThis.fetch=async()=>Response.json({choices:[{finish_reason:finish,message:{content}}],usage:{total_tokens:10}});
      await assert.rejects(deepSeekJson({},'test',[],new AbortController().signal,1800,2,c=>{if(!JSON.parse(c).reply)throw new Error('invalid');}),{status:502});
    }
    assert.deepEqual(globalThis.__charges,[false,false,false,false]);
    globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"reply":"Hello"}'}}],usage:{total_tokens:10}});
    await deepSeekJson({},'test',[],new AbortController().signal,1800,2,c=>JSON.parse(c));
    assert.equal(globalThis.__charges.at(-1),true);
  }finally{globalThis.fetch=old;delete globalThis.__charges;}
});
