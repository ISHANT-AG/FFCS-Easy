import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parsePortalText } from '../src/portal.js';
import { validateSection, eligibleSections } from '../src/engine.js';
const fixtures = JSON.parse(await readFile(new URL('portal-fixtures.json', import.meta.url)));
for (const fixture of fixtures)
  test(`parse ${fixture.file}: all ${fixture.count} rows, including page continuations`, () => {
    const r = parsePortalText(fixture.text);
    assert.equal(r.code, fixture.code);
    assert.equal(r.sections.length, fixture.count);
    for (const s of r.sections) {
      validateSection(s, { allowNil: !r.scheduled });
      assert.ok(!/Clashed|NONE|Copyright/.test(s.faculty));
    }
  });
test('source-session clashes do not remove valid options', () => {
  const r = parsePortalText(fixtures.find((f) => f.code === 'MAT3002').text);
  assert.equal(r.sections[0].slots, 'A11+A12');
  assert.equal(r.sections[0].seats, '69');
  assert.ok(!('clash' in r.sections[0]));
});
test('published extracts exclude personal account headers', () => {
  for (const f of fixtures)
    assert.ok(!/25BCE11028|ISHANT AGRAWAL|Sign out|Registered \d/.test(f.text));
});
test('screenshot table rows become reviewable faculty options', async () => {
  const { parseScreenshotText } = await import('../src/portal.js');
  const r = parseScreenshotText(
    'Lecture and Tutorial hours only A11+A12 AB-103 HEMANT KUMAR NASHINE 70 1 69\nProject Only NIL NIL AVIRUP DAS Similar to Registered Slot 350 53 297'
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].faculty, 'HEMANT KUMAR NASHINE');
  assert.equal(r[0].seats, '69');
  assert.equal(r[1].slots, 'NIL');
  assert.equal(r[1].faculty, 'AVIRUP DAS');
});
test('wrapped faculty row and spaced plus signs import without silently dropping the row', () => {
  const r = parsePortalText(
    'CSE2001 - Programming - Lecture\nA11 + A12 AB-102 SARATHKUMAR\nSEBASTIN J NONE 70\nB11 AB-103 OTHER NONE 0\nCopyright test'
  );
  assert.equal(r.sections.length, 2);
  assert.equal(r.sections[0].faculty, 'SARATHKUMAR SEBASTIN J');
  assert.equal(r.sections[0].slots, 'A11+A12');
  assert.equal(r.sections[1].seats, '0');
});
test('readable faculty rows import even when a seat value cannot be read', () => {
  const r = parsePortalText(
    'CSE2001 - Programming - Lecture\nA11 AB-102 TEACHER NONE 70\nB11 AB-103 OTHER NONE unreadable\nCopyright test'
  );
  assert.equal(r.sections.length, 2);
  assert.equal(r.sections[0].seats, '70');
  assert.equal(r.sections[1].faculty, 'OTHER');
  assert.equal(r.sections[1].seats, '');
});

const javaFixtures = JSON.parse(
  await readFile(new URL('java-portal-fixtures.json', import.meta.url))
);
for (const f of javaFixtures)
  test(`Java portal format: ${f.file}`, () => {
    const r = parsePortalText(f.text);
    assert.equal(r.code, 'CSE2006');
    assert.equal(r.sections.length, 32);
    assert.equal(r.sections[0].faculty, 'FACE TRAINER 2');
    assert.equal(r.sections[1].faculty, 'FACE TRAINER 8');
    assert.equal(r.sections.at(-1).faculty, 'FACE TRAINER 8');
    assert.equal(
      r.sections[0].seats,
      f.file === 'java.pdf' ? '45' : f.file === 'CSE2006.pdf' ? '' : '53'
    );
    assert.equal(
      r.sections.at(-1).seats,
      f.file === 'java.pdf' ? '49' : f.file === 'CSE2006.pdf' ? '' : '58'
    );
  });
test('short LP heading, registered rows, selected labels and zero seats are supported', () => {
  const r = parsePortalText(
    'CSE2006 - Programming in Java - LP\nA11 AB-101 FACE TRAINER 2 Similar to Registered Slot 60\nB11 AB-102 FACE TRAINER 8 Registered Slot 0 Selected'
  );
  assert.equal(r.sections.length, 2);
  assert.equal(r.sections[0].faculty, 'FACE TRAINER 2');
  assert.equal(r.sections[1].faculty, 'FACE TRAINER 8');
  assert.equal(r.sections[1].seats, '0');
});

test('missing seats remain eligible while explicit zero seats are excluded', () => {
  const r = parsePortalText(
    'CSE2006 - Java - LP\nSlot Venue Faculty Available\nA11 AB-101 FACE TRAINER 2\nB11 AB-102 FACE TRAINER 8 0\nC11 AB-103 FACE TRAINER 7 4'
  );
  const course = {
    code: 'CSE2006',
    scheduled: true,
    preferred: [],
    avoid: [],
    sections: r.sections.map((s, i) => ({ ...s, id: String(i) })),
  };
  assert.deepEqual(
    eligibleSections(course).map((s) => s.faculty),
    ['FACE TRAINER 2', 'FACE TRAINER 7']
  );
});
