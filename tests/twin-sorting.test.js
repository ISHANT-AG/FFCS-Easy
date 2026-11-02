import test from 'node:test';
import assert from 'node:assert/strict';
import { consistentTimetables, consistentTwinTimetables } from '../src/engine.js';
const chosen = (slots) =>
  slots.map((slots, i) => ({ course: { code: 'C' + i, scheduled: true }, section: { slots } }));
const pair = (id, score, slots1, slots2 = slots1, together = 3, sameTime = 0) => ({
  pairSig: id,
  pairedScore: score,
  matchedTogether: together,
  matchedSameTime: sameTime,
  chosen1: chosen(slots1),
  chosen2: chosen(slots2),
});
test('twin shortlist uses the same order as individual for identical student routines', () => {
  const pairs = [
    pair('base', 0, ['A11', 'B11', 'C11']),
    pair('near', 1, ['A12', 'B11', 'C11']),
    pair('swap1', 20, ['B11', 'C11', 'A11']),
    pair('swap2', 30, ['C11', 'A11', 'B11']),
    pair('far', 50, ['A21', 'B21', 'C21']),
    pair('farther', 60, ['D11', 'E11', 'F11']),
  ];
  const individual = pairs.map((p) => ({
    chosen: p.chosen1,
    score: p.pairedScore,
    signature: p.pairSig,
  }));
  assert.deepEqual(
    consistentTwinTimetables(pairs).map((p) => p.pairSig),
    consistentTimetables(individual).map((p) => p.signature)
  );
});
test('pair matching is lexicographic and never loses shared classes for quality or variety', () => {
  const best = pair('together', 1e9, ['A11'], ['A11'], 1, 0),
    worse = pair('apart', -1e9, ['B11'], ['C11'], 0, 0);
  assert.deepEqual(
    consistentTwinTimetables([worse, best]).map((p) => p.pairSig),
    ['together']
  );
});
test('same-routine comparison preserves each student pattern separately', () => {
  const best = pair('best', 0, ['A11', 'B11'], ['C11', 'D11']);
  const cross = pair('cross', 1, ['C11', 'D11'], ['A11', 'B11']);
  const swap = pair('swap', 2, ['B11', 'A11'], ['D11', 'C11']);
  assert.deepEqual(
    consistentTwinTimetables([best, cross, swap], 3).map((p) => p.pairSig),
    ['best', 'swap', 'cross']
  );
});
test('paired shortlist ignores faculty-only duplicates and keeps lowest score', () => {
  const a = pair('same', 5, ['A11']),
    b = pair('same', 1, ['A11']);
  assert.equal(consistentTwinTimetables([a, b]).length, 1);
  assert.equal(consistentTwinTimetables([a, b])[0].pairedScore, 1);
});

test('routine alternatives use individual preference scores without counting meetings twice', async () => {
  const { solveTwin } = await import('../src/engine.js');
  const slots = ['A11+A12+A13', 'B11+B12+B13', 'C11+C12+C13'];
  const courses = Array.from({ length: 3 }, (_, i) => ({
    code: 'C' + i,
    name: 'Course',
    scheduled: true,
    preferred: [],
    avoid: [],
    sections: slots.map((slots, j) => ({
      id: i + '-' + j,
      slots,
      faculty: 'Teacher ' + j,
      venue: 'AB-101',
      seats: 50,
    })),
  }));
  const r = solveTwin([
    { name: 'A', courses: structuredClone(courses), settings: { lunch: true } },
    { name: 'B', courses: structuredClone(courses), settings: { lunch: true } },
  ]);
  for (const p of r.results)
    assert.equal(
      p.pairedScore,
      -p.matchedTogether * 1000000 - p.matchedSameTime * 10000 + p.student1.score + p.student2.score
    );
});
