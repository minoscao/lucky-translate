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
  }finally{
    if(renderer)await act(async()=>renderer.unmount());globalThis.fetch=oldFetch;delete globalThis.localStorage;delete globalThis.__coachReply;
  }
});
