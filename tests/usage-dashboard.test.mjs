import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { create, act } from 'react-test-renderer';
import ts from 'typescript';

const compile = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React })).toString('base64');
const strip = source => source.replace(/^import .*;\r?\n/gm, '');
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const sharedUsage = await read('../lib/usage-dashboard.ts');
const dashboardModule = compile(`import React,{useCallback,useEffect,useRef,useState} from '${import.meta.resolve('react')}';
const Button=props=>React.createElement('button',props),RefreshCw=()=>null,accountRequest=()=>{};
${sharedUsage}
const number=usageNumber;
${strip(await read('../components/usage-dashboard.tsx'))}`);
const { UsageDashboard } = await import(dashboardModule);
const data = tokens => ({ dashboard: { updatedAt: 1, periods: Object.fromEntries(['today', 'month', 'total'].map(key => [key, { conversationSeconds: 60, translationSeconds: 120, recapSeconds: 30, totalSeconds: 210, actualTokens: tokens, inputTokens: tokens - 2, outputTokens: 2, cachedTokens: 1, unreportedRequests: 0, costMicros: 4321 }])) } });

test('dashboard refreshes reported data, preserves stale data on failure and ignores a closed client response', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const oldDocument = globalThis.document;
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  let renderer, pending, activeSignal;
  const request = (_url, init) => { activeSignal = init.signal; return new Promise((resolve, reject) => { pending = { resolve, reject }; }); };
  const shown = () => JSON.stringify(renderer.toJSON());
  try {
    await act(async () => { renderer = create(React.createElement(UsageDashboard, { url: '/A', request })); });
    await act(async () => pending.resolve(data(1234)));
    assert.ok(shown().includes('1,234'));
    assert.ok(shown().includes('3.5 min'));
    assert.ok(shown().includes('$0.004321'));
    const refresh = () => renderer.root.findAllByType('button').find(button => button.props['aria-label'] === 'Refresh usage').props.onClick();
    await act(async () => refresh());
    await act(async () => pending.resolve(data(2345)));
    assert.ok(shown().includes('2,345'));
    await act(async () => refresh());
    await act(async () => pending.reject(new Error('offline')));
    assert.ok(shown().includes('2,345'));
    assert.ok(shown().includes('Could not refresh usage'));
    await act(async () => refresh());
    const previous = pending, previousSignal = activeSignal;
    await act(async () => renderer.update(React.createElement(UsageDashboard, { url: '/B', request })));
    assert.equal(previousSignal.aborted, true);
    await act(async () => previous.resolve(data(9999)));
    assert.ok(!shown().includes('9,999'));
    await act(async () => pending.resolve(data(12)));
    assert.ok(!shown().includes('2,345'));
  } finally { if (renderer) await act(async () => renderer.unmount()); globalThis.document = oldDocument; }
});

test('directory period selection changes the overview and every client row together', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const adminSource = await read('../app/admin/page.tsx');
  const grid = adminSource.slice(adminSource.indexOf('function ClientGrid('), adminSource.indexOf('function Payments('));
  const { ClientGrid } = await import(compile(`import React,{useState} from '${import.meta.resolve('react')}'; import {UsageDashboardView} from '${dashboardModule}';
    ${sharedUsage}
    const Button=props=>React.createElement('button',props),UserPlus=()=>null,bytes=()=>'',formatPoints=()=>'',stateLabel=value=>value;
    const useUsageDashboard=()=>({data:globalThis.__directoryData,loading:false,error:'',reload:()=>{}});
    export ${grid}`));
  const a = data(1234).dashboard;
  a.periods.today = { ...a.periods.today, actualTokens: 42, totalSeconds: 60, costMicros: 23 };
  globalThis.__directoryData = { dashboard: a, clients: { A: a } };
  const user = id => ({ id, username: id, email: `${id}@example.test`, level:'lv1', status:'active', storage:{bytes:0,limitBytes:100}, usage:{} });
  let renderer;
  try {
    await act(async () => { renderer = create(React.createElement(ClientGrid, { users: [user('A'),user('B')], select() {}, create() {} })); });
    const rows = () => renderer.root.findAllByProps({className:'client-list-row'});
    const rowText = row => row.findAllByType('strong').map(node=>node.children.join('')).join(' ');
    assert.ok(rowText(rows()[0]).includes('1,234 tokens'));
    assert.ok(rowText(rows()[1]).includes('0 tokens'));
    await act(async () => renderer.root.findAllByType('button').find(button=>button.children.join('')==='Today').props.onClick());
    assert.ok(rowText(rows()[0]).includes('42 tokens'));
    assert.ok(rowText(rows()[0]).includes('1 min'));
    assert.ok(JSON.stringify(renderer.toJSON()).includes('$0.000023'));
    assert.equal(renderer.root.findAllByType('button').filter(button=>button.props['aria-pressed']===true).length,1);
  } finally { if(renderer) await act(async()=>renderer.unmount()); delete globalThis.__directoryData; }
});

test('admin usage requires authorization and customer usage ignores another client id', async () => {
  let requestedId;
  globalThis.__usageReader = async id => { requestedId = id; return data(12).dashboard; };
  globalThis.__usageAdmin = false;
  const helpers = `const json=(body,status=200)=>Response.json(body,{status});const usageDashboard=id=>globalThis.__usageReader(id);const usageDirectory=async()=>({dashboard:await globalThis.__usageReader('all'),clients:{}});`;
  const admin = await import(compile(`${helpers} const requireAdmin=async()=>{if(!globalThis.__usageAdmin)throw Object.assign(new Error('Forbidden'),{status:403});}; const getDb=()=>({prepare:()=>({bind:()=>({first:async()=>({id:'A'})})})}); ${strip(await read('../app/api/admin/usage/route.ts'))}`));
  const customer = await import(compile(`${helpers} const requireAccount=async()=>({id:'owner'}); ${strip(await read('../app/api/account/route.ts'))}`));
  try {
    assert.equal((await admin.GET(new Request('https://example.test/api/admin/usage?id=A'))).status, 403);
    assert.equal(requestedId, undefined);
    globalThis.__usageAdmin = true;
    assert.equal((await admin.GET(new Request('https://example.test/api/admin/usage?id=A'))).status, 200);
    assert.equal(requestedId, 'A');
    assert.equal((await admin.GET(new Request('https://example.test/api/admin/usage'))).status, 200);
    assert.equal(requestedId, 'all');
    assert.equal((await customer.GET(new Request('https://example.test/api/account?dashboard=1&id=A'))).status, 200);
    assert.equal(requestedId, 'owner');
  } finally { delete globalThis.__usageReader; delete globalThis.__usageAdmin; }
});
