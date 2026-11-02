import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { solve, solveTwin, lunchValid } from '../src/engine.js';
import { parsePortalText } from '../src/portal.js';
const json = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
test('same six-course twin plan retains the compact individual routine, including 11:40 classes', () => {
  const fixtures = json('portal-fixtures.json');
  const courses = ['CSE2001', 'CSE3001', 'ECE2002', 'MAT3002'].map((code) => ({
    ...parsePortalText(fixtures.find((x) => x.code === code).text),
    scheduled: true,
    preferred: [],
    avoid: [],
  }));
  for (const [code, file] of [
    ['CHY1006', 'evs'],
    ['MEE2014', 'edm'],
  ])
    courses.push({
      code,
      name: code,
      scheduled: true,
      sections: json(file + '-screenshot-sections.json'),
      preferred: [],
      avoid: [],
    });
  for (const c of courses) c.sections.forEach((s, i) => (s.id = c.code + i));
  const settings = {
    lunch: true,
    travel: true,
    bus: false,
    busTime: '16:20',
    walkMinutes: 10,
    maxMilliseconds: 3000,
  };
  const individual = solve(courses, settings, 'compact');
  const twin = solveTwin([
    { name: 'A', courses, settings },
    { name: 'B', courses: structuredClone(courses), settings },
  ]);
  assert.equal(twin.results[0].matchedTogether, 6);
  assert.ok(twin.results[0].student1.score <= individual.results[0].score);
  assert.ok(twin.results[0].student1.items.some((x) => x.period === 2));
  for (const p of twin.results) {
    assert.ok(lunchValid(p.student1.items));
    assert.ok(lunchValid(p.student2.items));
  }
  console.log(
    JSON.stringify({
      individualGaps: individual.results[0].metrics.gaps,
      twinGaps: twin.results[0].student1.metrics.gaps,
      twinTravel: twin.results[0].student1.metrics.travel,
    })
  );
});
