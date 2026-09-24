import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React, { useEffect } from 'react';
import { create, act } from 'react-test-renderer';
import ts from 'typescript';
const read = path => readFile(new URL(path,import.meta.url),'utf8');
const compile = source => ts.transpile(source,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext});
const url = source => 'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const strip = source => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm,'');
const scopeModule=await import(url(strip(compile(await read('../lib/account-scope.ts')))));
const coach=await import(url(`import {useEffect,useRef,useState,useCallback} from '${import.meta.resolve('react')}';
import {COACH_RECORDING} from '${new URL('../lib/recording-limits.ts', import.meta.url).href}';
const validCorrection=()=>undefined;
const coachDailySummaryDirect=input=>globalThis.__dailyReply(input);
const coachWeeklySummaryDirect=input=>globalThis.__weeklyReply(input);
const EMPTY_COACH_MEMORY={level:'discovering',topics:[],strengths:[],focus:[],phrases:[]};
class VoiceRecorder {async stop(){} async start(){return true;}}
const coachReplyDirect=input=>globalThis.__coachReply(input);
${strip(compile(await read('../hooks/use-coach.ts')))}`));

test('switching A to an empty B resets coach memory and ignores A reply completing afterwards',async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const storage=new Map([['lucky-coach-state',JSON.stringify({history:[{id:1,role:'learner',text:'unowned old text'}]})]]);
  globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
  const oldFetch=globalThis.fetch;const writes=[];
  globalThis.fetch=async(_url,init)=>{
    const owner=init.headers.get('X-Lucky-Account');
    if(init.method==='PUT'){writes.push({owner,...JSON.parse(init.body)});return Response.json({saved:true});}
    return Response.json({records:owner==='A'?[{id:'coach-state',data:{history:[{id:2,role:'learner',text:'Only A history'}],memory:{level:'A-level',topics:['A-topic']}}}]:[],account:{usage:{todayTrainingSeconds:0,totalTrainingSeconds:0}}});
  };
  let current, renderer, pending, resolveReply;
  globalThis.__coachReply=()=>new Promise(resolve=>{resolveReply=resolve;});
  function Harness({scope}){
    useEffect(()=>{scope.activate();return()=>scope.dispose();},[scope]);
    current=coach.useCoach(scope,()=>{});return null;
  }
  try{
    const a=scopeModule.createAccountScope('A'),b=scopeModule.createAccountScope('B');
    await act(async()=>{renderer=create(React.createElement(Harness,{key:'A',scope:a}));});
    assert.equal(current.ready,true);assert.equal(current.history[0].text,'Only A history');
    await act(async()=>{pending=current.sendText('A pending message');});
    await act(async()=>{renderer.update(React.createElement(Harness,{key:'B',scope:b}));});
    assert.equal(current.ready,true);assert.deepEqual(current.history,[]);assert.deepEqual(current.memory.topics,[]);
    await act(async()=>{resolveReply({data:{reply:'A late answer',tip:'',memory:{level:'A',topics:['private A']}},usage:{tokens:10,cost:1}});await pending;});
    assert.deepEqual(current.history,[]);assert.deepEqual(current.memory.topics,[]);
    assert.equal(writes.some(write=>write.owner==='B'),false);
    assert.equal(JSON.parse(storage.get(scopeModule.cacheKey('B','lucky-coach-state'))).history.length,0);
    assert.ok(storage.get('lucky-coach-state').includes('unowned old text'));
    globalThis.__coachReply=async()=>({data:{reply:'I am here.'},usage:{tokens:5,cost:0}});
    await act(async()=>{await current.sendText('Hello Lucky');});
    assert.equal(current.history.at(-1).text,'I am here.');
    assert.equal(current.error,'');
    assert.deepEqual(current.memory.topics,[]);
  }finally{
    if(renderer)await act(async()=>renderer.unmount());globalThis.fetch=oldFetch;delete globalThis.localStorage;delete globalThis.__coachReply;
  }
});

test('a streamed reply appears and speaks before final memory without a duplicate message or replay', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let current, renderer, resolveReply, preview, pending;
  const scope = { owner: 'stream-test', active: true, storage: { getItem: () => null, setItem() {} }, save: async () => {}, request: async () => ({ records: [], account: { usage: { todayTrainingSeconds: 0, totalTrainingSeconds: 0 } } }) };
  globalThis.__coachReply = input => { preview = input.onReply; return new Promise(resolve => { resolveReply = resolve; }); };
  function Harness() { current = coach.useCoach(scope, () => {}); return null; }
  try {
    await act(async () => { renderer = create(React.createElement(Harness)); });
    await act(async () => { pending = current.sendText('How are you?'); });
    await act(async () => preview('I am well!'));
    assert.equal(current.history.at(-1).text, 'I am well!'); assert.equal(current.busy, true);
    const speech = current.speechRequest, id = current.history.at(-1).id;
    await act(async () => { resolveReply({ data: { reply: 'I am well!', tip: '', memory: { level: 'learning', topics: ['work'] } }, usage: { tokens: 10, cost: 0 } }); await pending; });
    assert.equal(current.history.length, 2); assert.equal(current.history.at(-1).id, id); assert.equal(current.speechRequest, speech);
    assert.deepEqual(current.memory.topics, ['work']); assert.equal(current.busy, false);
  } finally { if (renderer) await act(async () => renderer.unmount()); delete globalThis.__coachReply; }
});

test('today recap is saved and returned even while old-week consolidation fails', async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;let current,renderer,rejectArchive;
 const old={id:'day-2020-01-01',date:'2020-01-01',minutes:3,overview:'Old practice',mainFocus:[],likelyMistakes:[],vocabulary:[],grammar:[]};
 const daily={overview:'Today practice',mainFocus:[],likelyMistakes:[],vocabulary:[],grammar:[]};const writes=[];
 const scope={owner:'recap-test',active:true,storage:{setItem(){},getItem(){return null;}},save:async(...args)=>writes.push(args),request:async()=>({records:[{id:'coach-state',data:{history:[{id:1,role:'learner',text:'I work here.'}]}},{id:'coach-journal',data:{todayDate:'2020-01-01',todaySeconds:0,daily:[old],weekly:[]}}],account:{usage:{todayTrainingSeconds:60,totalTrainingSeconds:240}}})};
 globalThis.__dailyReply=async()=>({data:daily,usage:{tokens:20,cost:0}});globalThis.__weeklyReply=()=>new Promise((_,reject)=>{rejectArchive=reject;});
 function Harness(){current=coach.useCoach(scope,()=>{});return null;}
 try{await act(async()=>{renderer=create(React.createElement(Harness));});let report;await act(async()=>{report=await current.summarizeToday();});assert.equal(report.overview,'Today practice');assert.equal(current.busy,false);assert.equal(current.dailySummaries.length,2);await act(async()=>{rejectArchive(new Error('archive failure'));});assert.equal(current.error,'');assert.equal(current.dailySummaries.length,2);assert.ok(writes.some(args=>args[0]==='coach-journal'&&args[2].daily.some(item=>item.overview==='Today practice')));}
 finally{if(renderer)await act(async()=>renderer.unmount());delete globalThis.__dailyReply;delete globalThis.__weeklyReply;}
});
