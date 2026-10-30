import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateSection, solve } from '../src/engine.js';
const library = JSON.parse(await readFile(new URL('../data/sections.json', import.meta.url)));
test('all 187 shared sections have valid slots and consistent seat counts', () => {
  assert.equal(library.courses.length, 9);
  assert.equal(
    library.courses.reduce((n, c) => n + c.sections.length, 0),
    187
  );
  for (const c of library.courses)
    for (const s of c.sections) {
      validateSection(s, { allowNil: !c.scheduled });
      if (s.totalSeats != null) assert.equal(s.totalSeats - s.allottedSeats, Number(s.seats));
    }
  assert.equal(library.ignoredSources.length, 3);
});
test('identified screenshot courses generate a lunch-protected bus plan', () => {
  const courses = library.courses.map((c) => ({ ...c, preferred: [], avoid: [] }));
  const r = solve(courses, { lunch: true, bus: true, busTime: '16:20', walkMinutes: 10 });
  assert.ok(r.results.length);
  assert.equal(r.results[0].chosen.length, 9);
  assert.ok(r.results[0].items.every((x) => x.period < 4));
});
test('PDF history stays separate from matching screenshot seat counts', () => {
  const original = library.courses.find((c) => c.code === 'CSE2001').sections[0];
  const pdf = library.pdfSnapshots.find((c) => c.code === 'CSE2001').sections[0];
  assert.equal(original.seats, '99');
  assert.equal(pdf.seats, '75');
  assert.equal(original.sourceRowId, pdf.sourceRowId);
  assert.equal(pdf.sourceDate, '2026-06-20');
  assert.equal(pdf.registrationMode, 'mock');
});
