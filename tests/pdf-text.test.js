import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfItemsToText} from '../src/pdf-text.js';
import {parsePortalText} from '../src/portal.js';
import {readFile} from 'node:fs/promises';
const items=JSON.parse(await readFile(new URL('cpp-pdf-items.json',import.meta.url)));
test('actual CPP PDF table extracts all 14 options with offset seat baselines',()=>{const text='CSE2001 - Object Oriented Programming with C++ - Lecture\n'+pdfItemsToText(items);const r=parsePortalText(text);assert.equal(r.sections.length,14);assert.equal(r.sections[1].faculty,'ANKUR JAIN');assert.equal(r.sections[1].seats,'96');assert.equal(r.sections.at(-1).faculty,'GARIMA JAIN');assert.equal(r.sections.at(-1).seats,'92');});
test('baseline grouping merges nearby cells without merging separate rows',()=>{const item=(str,x,y)=>({str,height:10.5,transform:[1,0,0,1,x,y]});assert.equal(pdfItemsToText([item('A11',0,450),item('75',300,447.75),item('B11',0,419.25),item('70',300,417)]),'A11 75\nB11 70\n');});
