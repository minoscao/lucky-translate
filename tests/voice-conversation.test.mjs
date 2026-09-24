import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=await fs.readFile(new URL('../public/voice-processor.js',import.meta.url),'utf8');
function recorder(rate=48000,conversation=true){
 const events=[];let Voice;const context={sampleRate:rate,AudioWorkletProcessor:class{port={postMessage:event=>events.push(event)};},registerProcessor:(_name,Class)=>{Voice=Class;}};
 vm.runInNewContext(source,context);const node=new Voice();node.port.onmessage({data:{type:'config',mode:'continuous',detectSpeaker:false,conversation}});let offset=0;
 return {events,node,feed(seconds,kind='voice',amplitude=.06){for(let n=0;n<rate*seconds;n+=128){const input=new Float32Array(Math.min(128,Math.ceil(rate*seconds-n)));for(let i=0;i<input.length;i++){const t=offset++/rate;input[i]=kind==='silence'?0:kind==='noise'?amplitude*(i%2?1:-1):amplitude*Math.sin(2*Math.PI*180*t)*(1+.3*Math.sin(2*Math.PI*4*t));}node.process([[input]]);}}};
}
test('continuous listening ignores silence, low background noise, clicks and high-frequency noise',()=>{
 const r=recorder();r.feed(2,'silence');r.feed(2,'voice',.003);r.feed(.06);r.feed(1,'silence');r.feed(1,'noise');r.feed(1,'silence');assert.equal(r.events.filter(e=>['speech-start','sentence'].includes(e.type)).length,0);
});
test('speech interrupts before silence, preserves its beginning, sends once, then keeps listening at 44.1/48 kHz',()=>{
 for(const rate of [44100,48000]){
 const r=recorder(rate);r.node.port.onmessage({data:{type:'playback',active:true}});r.feed(.15);assert.equal(r.events.some(e=>e.type==='speech-start'),false);r.feed(.45);assert.equal(r.events.filter(e=>e.type==='speech-start').length,1);assert.equal(r.events.some(e=>e.type==='sentence'),false);
 r.feed(1.1,'silence');const sentence=r.events.find(e=>e.type==='sentence');assert.ok(sentence);assert.ok(new DataView(sentence.wav).getUint32(40,true)>32000*.6);r.feed(2,'silence');assert.equal(r.events.filter(e=>e.type==='sentence').length,1);r.feed(.6);r.feed(1.1,'silence');assert.equal(r.events.filter(e=>e.type==='sentence').length,2);
 }
});
test('translator retains its five-second pause instead of Coach automatic turn-taking',()=>{const r=recorder(48000,false);r.feed(.6);r.feed(1.2,'silence');assert.equal(r.events.some(e=>e.type==='sentence'),false);r.feed(4,'silence');assert.equal(r.events.filter(e=>e.type==='sentence').length,1);});
const url=code=>'data:text/javascript;base64,'+Buffer.from(ts.transpile(code,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022})).toString('base64');
const {correctionDiff,validCorrection}=await import(url(await fs.readFile(new URL('../lib/coach-corrections.ts',import.meta.url),'utf8')));
test('missing s colors only the addition green and retains the original walk in red',()=>{const result=correctionDiff('he walk','he walks');assert.deepEqual([...result.added],[7]);assert.equal([...result.removed].map(i=>'he walk'[i]).join(''),'walk');assert.deepEqual(validCorrection({original:'he walk',corrected:'he walks'},'I think he walk to work.','Oh, you mean **he walks**?'),{original:'he walk',corrected:'he walks'});assert.equal(validCorrection({original:'she walk',corrected:'she walks'},'he walk','she walks'),undefined);});

test('minimal verb correction preserves the whole bold phrase and colors only the missing suffix',async()=>{
 const React=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
 const helpers=url(await fs.readFile(new URL('../lib/coach-corrections.ts',import.meta.url),'utf8'));
 const highlights=url(await fs.readFile(new URL('../lib/text-highlights.ts',import.meta.url),'utf8'));
 const component=(await fs.readFile(new URL('../components/corrected-text.tsx',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
 const code=`import React from '${import.meta.resolve('react')}';import {correctionDiff} from '${helpers}';import {textHighlights} from '${highlights}';const HighlightedText=({text})=>text;`+ts.transpile(component,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React});
 const {CorrectedText}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const correction={original:'walk',corrected:'walks'};
 const reply=renderToStaticMarkup(React.createElement(CorrectedText,{text:'Oh, you mean **he walks**?',correction}));
 assert.match(reply,/<strong>he walk<mark class="correction-fixed">s<\/mark><\/strong>/);
 const learner=renderToStaticMarkup(React.createElement(CorrectedText,{text:'My brother walk to work.',learner:true,correction}));
 assert.match(learner,/My brother /);assert.equal((learner.match(/correction-original/g)||[]).length,4);
});
