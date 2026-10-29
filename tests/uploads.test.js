import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePdfUpload} from '../src/uploads.js';
const file=(name,content)=>new File([content],name);
test('accepts a genuine PDF header',async()=>{await validatePdfUpload(file('CPP.pdf','%PDF-1.7\n'));});
test('rejects screenshots and JSON before parsing',async()=>{await assert.rejects(()=>validatePdfUpload(file('photo.jpg','image')),/PDF/);await assert.rejects(()=>validatePdfUpload(file('data.json','{}')),/PDF/);});
test('rejects a non-PDF renamed as PDF',async()=>{await assert.rejects(()=>validatePdfUpload(file('photo.pdf','image data')),/not a valid PDF/);});
