import test from 'node:test';
import assert from 'node:assert/strict';
import { diverseTimetables, solve } from '../src/engine.js';
const candidate = (signature, score, slots) => ({
  signature,
  score,
  chosen: slots.map((s, i) => ({ course: { code: 'C' + i }, section: { slots: s } })),
});
test('shortlist prioritizes changes across multiple courses over near-identical high-score layouts', () => {
  const base = candidate('base', 0, ['A11', 'B11', 'C11']);
  const tiny = candidate('tiny', 1, ['A12', 'B11', 'C11']);
  const different = candidate('different', 50, ['A21', 'B21', 'C21']);
  const selected = diverseTimetables([tiny, different, base], 2);
  assert.deepEqual(
    selected.map((s) => s.signature),
    ['base', 'different']
  );
});
test('each next option is distant from all previously selected layouts', () => {
  const rows = [
    candidate('a', 0, ['A11', 'B11']),
    candidate('b', 10, ['A21', 'B21']),
    candidate('c', 1, ['A12', 'B11']),
    candidate('d', 20, ['A13', 'B13']),
  ];
  assert.deepEqual(
    diverseTimetables(rows, 3).map((s) => s.signature),
    ['a', 'b', 'd']
  );
});
test('faculty-only permutations remain grouped even when requesting five options', () => {
  const c = {
    code: 'CPP',
    name: 'CPP',
    sections: Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      faculty: 'Faculty ' + i,
      venue: 'AB-101',
      slots: i < 4 ? 'A11+A12+A13' : 'B11+B12+B13',
      seats: 10,
    })),
  };
  const r = solve([c], { lunch: false });
  assert.equal(r.results.length, 2);
  assert.equal(new Set(r.results.map((s) => s.signature)).size, 2);
  assert.ok(r.results.every((s) => s.chosen[0].alternatives.length === 4));
});

test('first three preserve exact occupied cells while swapping course slots', async () => {
  const { consistentTimetables, dailyPattern } = await import('../src/engine.js');
  const base = candidate('base', 0, ['A11', 'B11', 'C11']);
  const swap1 = candidate('swap1', 60, ['B11', 'C11', 'A11']);
  const swap2 = candidate('swap2', 80, ['C11', 'A11', 'B11']);
  const alternate = candidate('alternate', 1, ['A21', 'B21', 'C21']);
  const alternate2 = candidate('alternate2', 2, ['A12', 'B12', 'C12']);
  const r = consistentTimetables([base, alternate, alternate2, swap1, swap2]);
  assert.deepEqual(
    r.slice(0, 3).map((s) => s.signature),
    ['base', 'swap1', 'swap2']
  );
  assert.ok(r.slice(0, 3).every((s) => dailyPattern(s) === dailyPattern(base)));
  assert.equal(r.length, 5);
});
test('solver finds three subject swaps with the same daily routine and eligible teachers', () => {
  const slots = ['A11+A12+A13', 'B11+B12+B13', 'C11+C12+C13'];
  const courses = Array.from({ length: 3 }, (_, i) => ({
    code: 'C' + i,
    name: 'Course ' + i,
    avoid: ['Avoid'],
    sections: slots.flatMap((slot, j) => [
      {
        id: i + '-' + j,
        slots: slot,
        faculty: 'Teacher ' + i + ' ' + j,
        venue: 'AB-101',
        seats: 10,
      },
      { id: i + '-full-' + j, slots: slot, faculty: 'Full', venue: 'AB-101', seats: 0 },
      { id: i + '-avoid-' + j, slots: slot, faculty: 'Avoid', venue: 'AB-101', seats: 10 },
    ]),
  }));
  const r = solve(courses, { lunch: true });
  assert.equal(r.results.length, 5);
  const occupied = (s) =>
    s.items
      .map((x) => x.code)
      .sort()
      .join('+');
  assert.ok(r.results.slice(0, 3).every((s) => occupied(s) === occupied(r.results[0])));
  assert.equal(new Set(r.results.slice(0, 3).map((s) => s.signature)).size, 3);
  assert.ok(
    r.results.every((s) =>
      s.chosen.every((x) => x.section.seats > 0 && x.section.faculty !== 'Avoid')
    )
  );
});
test('fewer matching routines fall back to other valid timing arrangements', async () => {
  const { consistentTimetables } = await import('../src/engine.js');
  const rows = [
    candidate('best', 0, ['A11', 'B11']),
    candidate('swap', 8, ['B11', 'A11']),
    candidate('flex', 1, ['A21', 'B21']),
  ];
  assert.deepEqual(
    consistentTimetables(rows).map((s) => s.signature),
    ['best', 'swap', 'flex']
  );
});

test('morning preference never adds evening alternatives when morning-only schedules exist', () => {
  const courses = Array.from({ length: 2 }, (_, i) => ({
    code: 'C' + i,
    name: 'Course',
    sections: ['A11+A12+A13', 'B11+B12+B13', 'A21+A22+A23', 'B21+B22+B23'].map((slots, j) => ({
      id: i + '-' + j,
      faculty: 'Teacher ' + j,
      slots,
      venue: 'AB-101',
      seats: 20,
    })),
  }));
  const r = solve(courses, { lunch: true }, 'morning');
  assert.equal(r.results.length, 2);
  assert.ok(r.results.every((s) => s.items.every((x) => x.period <= 2)));
  assert.equal(r.morningFallback, undefined);
});
test('morning preference still returns a valid late fallback when no morning-only plan exists', () => {
  const c = {
    code: 'C1',
    name: 'Course',
    sections: [{ id: 'late', faculty: 'Teacher', slots: 'B21', venue: 'AB-101', seats: 10 }],
  };
  const r = solve([c], {}, 'morning');
  assert.equal(r.results.length, 1);
  assert.equal(r.morningFallback, true);
});
