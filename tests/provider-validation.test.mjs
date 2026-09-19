import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source=(await readFile(new URL('../lib/server/deepseek.ts',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
const mocks="const enforceLimits=async()=>{},getDeepSeekKey=async()=> 'test-fixture-key';const recordDeepSeekUsage=async(a,f,u,b=true)=>{globalThis.__charges.push(b);return {eventId:'test',tokens:b?10:0};};";
const eventsSource=await readFile(new URL('../lib/event-stream.ts',import.meta.url),'utf8');
const {deepSeekJson,completedReply}=await import('data:text/javascript;base64,'+Buffer.from(ts.transpile(eventsSource+mocks+source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext})).toString('base64'));
test('provider cost is recorded but unusable output never consumes customer tokens',async()=>{
  const old=globalThis.fetch;globalThis.__charges=[];
  try{
    for(const [content,finish] of [['{','stop'],['{}','stop'],['','stop'],['{"reply":"cut"}','length']]){
      globalThis.fetch=async()=>Response.json({choices:[{finish_reason:finish,message:{content}}],usage:{total_tokens:10}});
      await assert.rejects(deepSeekJson({},'test',[],new AbortController().signal,1800,c=>{if(!JSON.parse(c).reply)throw new Error('invalid');}),{status:502});
    }
    assert.deepEqual(globalThis.__charges,[false,false,false,false]);
    globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"reply":"Hello"}'}}],usage:{total_tokens:10}});
    await deepSeekJson({},'test',[],new AbortController().signal,1800,c=>JSON.parse(c));
    assert.equal(globalThis.__charges.at(-1),true);
  }finally{globalThis.fetch=old;delete globalThis.__charges;}
});

test('coach retries unusable JSON once, charges only usable output and keeps one deadline',async()=>{
  const old=globalThis.fetch;globalThis.__charges=[];const requests=[];
  const messages=[{role:'system',content:'Return JSON with a string reply.'},{role:'user',content:'Hello, hello, testing, testing, can you hear me?'}];
  const validate=content=>{if(typeof JSON.parse(content).reply!=='string')throw new Error('invalid_fields');};
  try{
    globalThis.fetch=async(_url,init)=>{
      requests.push(init);
      return Response.json({choices:[{finish_reason:'stop',message:{content:requests.length===1?'{}':'{"reply":"Yes, I can hear you!"}'}}],usage:{total_tokens:10}});
    };
    const result=await deepSeekJson({},'coach',messages,new AbortController().signal,1800,validate,true);
    assert.equal(JSON.parse(result.content).reply,'Yes, I can hear you!');
    assert.deepEqual(globalThis.__charges,[false,true]);
    assert.equal(requests.length,2);
    assert.equal(requests[0].signal,requests[1].signal);
    assert.deepEqual(JSON.parse(requests[1].body).messages.slice(0,-1),messages);
    assert.equal(messages.length,2);

    requests.length=0;globalThis.__charges=[];
    globalThis.fetch=async(_url,init)=>{requests.push(init);return Response.json({choices:[{finish_reason:'stop',message:{content:'{}'}}],usage:{total_tokens:10}});};
    await assert.rejects(deepSeekJson({},'coach',messages,new AbortController().signal,1800,validate,true),{status:502});
    assert.equal(requests.length,2);
    assert.deepEqual(globalThis.__charges,[false,false]);

    requests.length=0;globalThis.__charges=[];
    const controller=new AbortController();
    globalThis.fetch=async(_url,init)=>{requests.push(init);controller.abort();return Response.json({choices:[{finish_reason:'stop',message:{content:'{}'}}],usage:{total_tokens:10}});};
    await assert.rejects(deepSeekJson({},'coach',messages,controller.signal,1800,validate,true),{name:'AbortError'});
    assert.equal(requests.length,1);
    assert.deepEqual(globalThis.__charges,[false]);
  }finally{globalThis.fetch=old;delete globalThis.__charges;}
});

test('streaming publishes the reply early but records usage only after the final usage event', async () => {
  const old = globalThis.fetch, encoder = new TextEncoder(); let controller, request, previews = [];
  globalThis.__charges = [];
  const send = value => controller.enqueue(encoder.encode(`data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`));
  globalThis.fetch = async (_, init) => { request = JSON.parse(init.body); return new Response(new ReadableStream({ start(c) { controller = c; } }), { headers: { 'Content-Type': 'text/event-stream' } }); };
  try {
    const operation = deepSeekJson({}, 'coach', [], new AbortController().signal, 1800, content => JSON.parse(content), true, content => { const reply = completedReply(content); if (!reply) return false; previews.push(reply); return true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(request.stream_options.include_usage, true);
    send({ choices: [{ delta: { content: '{"reply":"Hello!",' } }] }); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(previews, ['Hello!']); assert.deepEqual(globalThis.__charges, []);
    send({ choices: [{ delta: { content: '"memory":{}}' }, finish_reason: 'stop' }] }); send({ choices: [], usage: { total_tokens: 17 } }); send('[DONE]'); controller.close();
    await operation; assert.deepEqual(globalThis.__charges, [true]); assert.equal(previews.length, 1);
    previews = []; globalThis.__charges = [];
    const failed = deepSeekJson({}, 'coach', [], new AbortController().signal, 1800, content => JSON.parse(content), true, content => { if (!completedReply(content)) return false; previews.push(content); return true; });
    await new Promise(resolve => setImmediate(resolve)); send({ choices: [{ delta: { content: '{"reply":"Hello!",' } }] }); send({ usage: { total_tokens: 4 }, choices: [{ finish_reason: 'length' }] }); send('[DONE]'); controller.close();
    await assert.rejects(failed); assert.equal(previews.length, 1); assert.deepEqual(globalThis.__charges, [false]);
  } finally { globalThis.fetch = old; delete globalThis.__charges; }
});
