import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parsePortalText } from '../src/portal.js';
test('EVS screenshot-derived PDF imports all 22 exact sections and seats', async () => {
  const text = await readFile(new URL('evs-pdf-text.txt', import.meta.url), 'utf8'),
    expected = JSON.parse(await readFile(new URL('evs-screenshot-sections.json', import.meta.url)));
  const r = parsePortalText(text);
  assert.equal(r.code, 'CHY1006');
  assert.equal(r.sections.length, 22);
  assert.deepEqual(r.sections, expected);
});
