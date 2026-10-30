import test from 'node:test';
import assert from 'node:assert/strict';
import {diverseTimetables,solve} from '../src/engine.js';
const candidate=(signature,score,slots)=>({signature,score,chosen:slots.map((s,i)=>({course:{code:'C'+i},section:{slots:s}}))});
test('shortlist prioritizes changes across multiple courses over near-identical high-score layouts',()=>{
 const base=candidate('base',0,['A11','B11','C11']);
 const tiny=candidate('tiny',1,['A12','B11','C11']);
 const different=candidate('different',50,['A21','B21','C21']);
 const selected=diverseTimetables([tiny,different,base],2);
 assert.deepEqual(selected.map(s=>s.signature),['base','different']);
});
test('each next option is distant from all previously selected layouts',()=>{
 const rows=[candidate('a',0,['A11','B11']),candidate('b',10,['A21','B21']),candidate('c',1,['A12','B11']),candidate('d',20,['A13','B13'])];
 assert.deepEqual(diverseTimetables(rows,3).map(s=>s.signature),['a','b','d']);
});
test('faculty-only permutations remain grouped even when requesting five options',()=>{
 const c={code:'CPP',name:'CPP',sections:Array.from({length:8},(_,i)=>({id:String(i),faculty:'Faculty '+i,venue:'AB-101',slots:i<4?'A11+A12+A13':'B11+B12+B13',seats:10}))};
 const r=solve([c],{lunch:false});
 assert.equal(r.results.length,2);
 assert.equal(new Set(r.results.map(s=>s.signature)).size,2);
 assert.ok(r.results.every(s=>s.chosen[0].alternatives.length===4));
});
