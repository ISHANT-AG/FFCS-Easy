import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSlots, solve, zone, metrics, parseCatalogue } from '../src/engine.js';
const section = (slots, faculty = 'A', venue = 'AB1-102', seats = '10') => ({
  id: Math.random().toString(),
  slots,
  faculty,
  venue,
  seats,
});
const course = (code, sections, extra = {}) => ({
  code,
  name: code,
  scheduled: true,
  sections,
  preferred: [],
  avoid: [],
  ...extra,
});
test('maps a bundled section to three correct weekdays', () => {
  assert.deepEqual(
    parseSlots('A11+A12+A13').map((s) => [s.day, s.period]),
    [
      [0, 0],
      [2, 0],
      [4, 0],
    ]
  );
  assert.throws(() => parseSlots('A99'));
});
test('rejects collisions across any of the bundled meetings', () => {
  const r = solve([course('X', [section('A11+A12')]), course('Y', [section('A12')])]);
  assert.equal(r.results.length, 0);
});
test('lunch must leave one midday slot free each day', () => {
  const courses = [course('X', [section('C11')]), course('Y', [section('A21')])];
  assert.equal(solve(courses, { lunch: true }).results.length, 0);
  assert.equal(solve(courses, { lunch: false }).results.length, 1);
});
test('bus cutoff includes walking and 16:20 ending class is too late', () => {
  const c = [course('X', [section('A14')])];
  assert.equal(solve(c, { bus: true, busTime: '16:20', walkMinutes: 10 }).results.length, 0);
  assert.equal(solve(c, { bus: true, busTime: '16:20', walkMinutes: 0 }).results.length, 1);
  assert.equal(solve([course('Y', [section('B21')])], {}, 'bus').results.length, 0);
});
test('strict faculty, avoid and zero seats exclude sections', () => {
  const c = course(
    'X',
    [section('A11', 'A'), section('B11', 'B'), section('D11', 'C', 'AB1', '0')],
    { only: 'B' }
  );
  assert.equal(solve([c]).results[0].chosen[0].section.faculty, 'B');
  c.avoid = ['B'];
  assert.equal(solve([c]).results.length, 0);
});
test('ranked preferred faculty changes ordering', () => {
  const c = course('X', [section('A11', 'A'), section('A11', 'B')], { preferred: ['B', 'A'] });
  assert.equal(solve([c]).results[0].chosen[0].section.faculty, 'B');
});
test('travel is soft, nearby rooms incur no penalty', () => {
  assert.equal(zone('AB02-401'), 'far');
  assert.equal(zone('AB2-401'), 'far');
  assert.equal(zone('Lab Complex'), 'near');
  const r = solve(
    [course('X', [section('A11', 'A')]), course('Y', [section('B11', 'B', 'AB2-401')])],
    { travel: true }
  );
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].metrics.travel, 1);
});
test('less travel selects nearby alternative', () => {
  const r = solve(
    [
      course('X', [section('A11')]),
      course('Y', [section('B11', 'B', 'AB2-401'), section('B11', 'C', 'Lab Complex')]),
    ],
    {},
    'travel'
  );
  assert.equal(r.results[0].chosen[1].section.faculty, 'C');
});
test('morning and evening presets rank real alternatives', () => {
  const c = [course('X', [section('A11'), section('C21')])];
  assert.equal(solve(c, {}, 'morning').results[0].items[0].period, 0);
  assert.equal(solve(c, {}, 'evening').results[0].items[0].period, 6);
});
test('whole day favours spread morning and evening over only mornings', () => {
  const c = [course('X', [section('A11')]), course('Y', [section('B11'), section('C21')])];
  assert.equal(
    solve(c, { lunch: false }, 'balanced').results[0].items.find((x) => x.course === 'Y').period,
    6
  );
});
test('project without weekly meetings does not require a section', () => {
  assert.equal(
    solve([course('X', [section('A11')]), course('P', [], { scheduled: false })]).results.length,
    1
  );
});
test('missing data is reported and search limits are transparent', () => {
  assert.match(solve([course('X', [])]).reason, /X/);
  const r = solve([course('X', [section('A11'), section('B11')])], { maxNodes: 2 });
  assert.equal(r.truncated, true);
});
test('PDF rows parse by batch, keeping credit and category', () => {
  assert.deepEqual(
    parseCatalogue('1 25BCE CSE2001 Object Oriented Programming with C++ LTP 4 PC')[0],
    {
      batch: '25BCE',
      code: 'CSE2001',
      name: 'Object Oriented Programming with C++',
      type: 'LTP',
      credits: 4,
      category: 'PC',
    }
  );
});

test('NIL project faculty appears on shortlist without reserving a period', () => {
  const c = course(
    'PROJECT',
    [section('NIL', 'Project A', 'NIL'), section('NIL', 'Project B', 'NIL')],
    { scheduled: false, only: 'Project B' }
  );
  const r = solve([course('X', [section('A11')]), c]);
  assert.equal(r.results[0].items.length, 1);
  assert.equal(
    r.results[0].chosen.find((x) => x.course.code === 'PROJECT').section.faculty,
    'Project B'
  );
  c.avoid = ['Project B'];
  assert.equal(solve([c]).results.length, 0);
});
test('NIL does not bypass validation for a weekly course', () => {
  assert.equal(solve([course('X', [section('NIL', 'A', 'NIL')])]).results.length, 0);
});
test('project faculty ranking applies without multiplying timetable alternatives', () => {
  const c = course('P', [section('NIL', 'A', 'NIL'), section('NIL', 'B', 'NIL')], {
    scheduled: false,
    preferred: ['B', 'A'],
  });
  const r = solve([course('X', [section('A11')]), c]);
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].chosen.find((x) => x.course.code === 'P').section.faculty, 'B');
});
test('evening only uses classes from 13:15 onward', () => {
  const r = solve([course('X', [section('C11'), section('A21')])], {}, 'evening');
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].items[0].period, 3);
  assert.equal(solve([course('X', [section('A11')])], {}, 'evening').results.length, 0);
});
test('morning finish-by-13:15 preference stays soft when late class is necessary', () => {
  const r = solve([course('X', [section('A21')])], {}, 'morning');
  assert.equal(r.results.length, 1);
});
test('faculty name matching ignores casing and repeated spaces', () => {
  const c = course('X', [section('A11', 'KANNAN S'), section('A11', 'ANKUR JAIN')], {
    preferred: ['ankur   jain'],
    avoid: ['kannan s'],
  });
  const r = solve([c]);
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].chosen[0].section.faculty, 'ANKUR JAIN');
});
