import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { create, act } from 'react-test-renderer';
import ts from 'typescript';
import { discoverAudioDevices, namedAudioDevices, audioDeviceName, audioDeviceOptions } from '../lib/audio-devices.ts';

test('system discovery lists named microphones and speakers together and releases the permission microphone', async () => {
  let stops = 0;
  const result = await discoverAudioDevices({
    getUserMedia: async constraints => { assert.deepEqual(constraints, { audio: true, video: false }); return { getTracks: () => [{ stop: () => stops++ }] }; },
    enumerateDevices: async () => [
      { kind: 'audioinput', deviceId: 'mic-a', label: 'USB microphone' },
      { kind: 'audioinput', deviceId: 'mic-b', label: 'Bluetooth microphone' },
      { kind: 'audiooutput', deviceId: 'speaker-a', label: 'Amplifier' },
      { kind: 'audiooutput', deviceId: 'speaker-b', label: 'Bluetooth headphones' },
      { kind: 'audiooutput', deviceId: 'default' }, { kind: 'videoinput', deviceId: 'camera' },
    ],
  }, true);
  assert.deepEqual(result.map(device => device.deviceId), ['mic-a', 'mic-b', 'speaker-a', 'speaker-b', 'default']);
  assert.equal(stops, 1);
});

test('device names preserve reported headset models and do not count system aliases as extra speakers', () => {
  const devices = [
    { kind: 'audiooutput', deviceId: 'default', label: 'Default — F910 Bluetooth' },
    { kind: 'audiooutput', deviceId: 'communications', label: 'F910 Bluetooth' },
    { kind: 'audiooutput', deviceId: 'headset', label: 'F910 Bluetooth' },
    { kind: 'audiooutput', deviceId: 'amp', label: '' },
  ];
  assert.deepEqual(namedAudioDevices(devices, 'audiooutput').map(item => item.deviceId), ['headset', 'amp']);
  assert.match(audioDeviceName(devices, 'audiooutput'), /F910 Bluetooth/);
  assert.equal(audioDeviceName(devices, 'audiooutput', 'headset'), 'F910 Bluetooth');
  assert.match(audioDeviceName(devices, 'audiooutput', 'amp'), /model not reported/);
  assert.match(audioDeviceOptions(devices, 'audiooutput', 'removed').at(-1).label, /unavailable/);
});

test('failed enumeration still releases its microphone; hotplug discovery never requests permission again', async () => {
  let stops = 0;
  await assert.rejects(discoverAudioDevices({ getUserMedia: async () => ({ getTracks: () => [{ stop: () => stops++ }] }), enumerateDevices: async () => { throw new Error('enumeration failed'); } }, true), /enumeration failed/);
  assert.equal(stops, 1);
  assert.deepEqual(await discoverAudioDevices({ getUserMedia: () => assert.fail('must not reopen microphone'), enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'new-mic' }] }), [{ kind: 'audioinput', deviceId: 'new-mic' }]);
});

const compile = source => ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const { VoiceRecorder } = await import(moduleUrl(compile(await read('../lib/voice-recorder.ts'))));

test('actual recorder requires the chosen microphone and does not retry with a default on failure', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), oldWindow = globalThis.window, oldContext = globalThis.AudioContext;
  const calls = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async constraints => { calls.push(constraints); throw new DOMException('Disconnected', 'OverconstrainedError'); } } } });
  globalThis.window = { AudioWorkletNode: class {} };
  globalThis.AudioContext = class { state = 'running'; resume() { return Promise.resolve(); } close() { return Promise.resolve(); } };
  const recorder = new VoiceRecorder({ onSentence() {}, onLevel() {}, onError() {} });
  try {
    await assert.rejects(recorder.start('hold', false, 'mic-b'), { name: 'OverconstrainedError' });
    assert.equal(calls.length, 1); assert.deepEqual(calls[0].audio.deviceId, { exact: 'mic-b' });
  } finally { await recorder.stop(false); Object.defineProperty(globalThis, 'navigator', previous); globalThis.window = oldWindow; globalThis.AudioContext = oldContext; }
});

const strip = source => source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '');
const { useTranslator } = await import(moduleUrl(`
import {useState,useEffect,useRef,useCallback,useSyncExternalStore} from '${import.meta.resolve('react')}';
import {createConversationStore,language,RecordGesture} from '${new URL('../lib/translation.ts', import.meta.url).href}';
class VoiceRecorder {constructor(callbacks){globalThis.__inputCallbacks=callbacks;} prepare(){} async stop(){} async start(...args){globalThis.__inputStarts.push(args);return true;}}
const translateDirect = async () => ({empty:false,upper:'Hello',lower:'你好',original:'Hello',usage:{tokens:1,cost:0}});
${strip(compile(await read('../hooks/use-translator.ts')))}`));

test('each translation channel records its own selected input and sends the translation to the opposite language', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), oldWindow = globalThis.window, oldDocument = globalThis.document;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  globalThis.__inputStarts = [];
  const scope = { owner: 'test', active: true, storage: { getItem: () => null, setItem() {} }, request: async () => ({ records: [] }), save: async () => ({ account: { storage: {} } }) };
  let current, renderer;
  const routes = { en: { inputDeviceId: 'mic-a', deviceId: 'headset-a', channel: 'both' }, 'zh-CN': { inputDeviceId: 'mic-b', deviceId: 'speaker-b', channel: 'both' } };
  function Harness() { current = useTranslator(scope, routes); return null; }
  try {
    await act(async () => { renderer = create(React.createElement(Harness)); });
    assert.equal(current.ready, true);
    await act(async () => { current.toggle(0, 1); });
    assert.deepEqual(globalThis.__inputStarts[0], ['continuous', false, 'mic-a']);
    await act(async () => { globalThis.__inputCallbacks.onSentence(new Blob(['first'])); });
    assert.equal(current.autoSpeech.lang, 'zh-CN');
    await act(async () => { await current.stop(); });
    await act(async () => { current.toggle(1, 0); });
    assert.deepEqual(globalThis.__inputStarts[1], ['continuous', false, 'mic-b']);
    await act(async () => { globalThis.__inputCallbacks.onSentence(new Blob(['second'])); });
    assert.equal(current.autoSpeech.lang, 'en');
  } finally {
    await act(async () => { renderer?.unmount(); });
    Object.defineProperty(globalThis, 'navigator', previous); globalThis.window = oldWindow; globalThis.document = oldDocument;
    delete globalThis.__inputStarts; delete globalThis.__inputCallbacks;
  }
});
