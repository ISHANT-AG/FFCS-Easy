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

test('total, allotted and available columns keep only the available seat count', () => {
  const r = parsePortalText(
    'PHY1003 - Introduction to Computational Physics - Lecture and Tutorial, practical hours only\n' +
    'Slot Venue Faculty Slot Status Total Seats Allotted Available\n' +
    'A11+A12+A13 CR-002 SHARAD CHANDRA TRIPATHI — 65 0 65\n' +
    'A11+A12+A13 CR-003 GEETANJALI GIRI — 65 17 48\n' +
    'A21+A22+A23 CR-004 ABHINAV KUMAR — 65 — —\n' +
    'C21+F11+F12 CR-002 SARAVANAN L — 65 6 59\n' +
    '40 options transcribed. Seat counts are snapshots from the supplied VTOP screenshots.'
  );
  assert.deepEqual(r.sections.map(({ faculty, seats }) => [faculty, seats]), [
    ['SHARAD CHANDRA TRIPATHI', '65'],
    ['GEETANJALI GIRI', '48'],
    ['ABHINAV KUMAR', ''],
    ['SARAVANAN L', '59'],
  ]);
});

test('VTOP course table and course-type-prefixed rows import with seat availability', () => {
  const r = parsePortalText(
    'Course Owner Course Code Course Title L T P J C Pre-Requisite Co-Requisite Anti-Requisite\n' +
    'SASL MAT2003 Applied Numerical Method 2 1 0 0 3\n' +
    'Course Type Slot Venue Faculty Slot Status Total Seats Alloted Seats Available Seats\n' +
    'Lecture and Tutorial Hours Only A11+A12 CR-013 SUCHISMITA PATRA Clashed with A11/ A12 65 8 57\n' +
    'Lecture and Tutorial Hours Only B11+B12 AB-103 MAYANK SHARMA NONE 65 9 56\n' +
    'Lecture and Tutorial Hours Only B22+B24 CR-019 DHARMALINGAM M Copyright © 2020 Software Development Cell (VIT) Clashed with B24 65 5 60\n' +
    'Go Back'
  );
  assert.equal(r.code, 'MAT2003');
  assert.equal(r.name, 'Applied Numerical Method');
  assert.equal(r.sections.length, 3);
  assert.deepEqual(r.sections.map(({ faculty, seats }) => [faculty, seats]), [
    ['SUCHISMITA PATRA', '57'],
    ['MAYANK SHARMA', '56'],
    ['DHARMALINGAM M', '60'],
  ]);
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

test('practical-only workplace communication PDF imports every faculty row', async () => {
  const f = JSON.parse(await readFile(new URL('workplace-portal-fixture.json', import.meta.url)));
  const r = parsePortalText(f.text);
  assert.equal(r.code, 'SST2003');
  assert.equal(r.name, 'Dynamics of workplace communication Skills');
  assert.equal(r.sections.length, f.count);
  assert.equal(r.sections[0].faculty, 'ANITA YADAV');
  assert.equal(r.sections[0].seats, '67');
  assert.equal(r.sections.at(-1).faculty, 'TAUSEEF QAMAR');
  assert.equal(r.sections.at(-1).seats, '32');
});

test('missing heading can use the selected course while conflicting course codes stay blocked', () => {
  const selected = { code: 'CSE2006', name: 'Programming in Java' };
  const r = parsePortalText('Slot Venue Faculty\nA11 AB-101 FACE TRAINER 2', selected);
  assert.equal(r.code, 'CSE2006');
  assert.equal(r.sections[0].faculty, 'FACE TRAINER 2');
  assert.equal(r.sections[0].seats, '');
  assert.throws(() => parsePortalText('Course CSE2001\nA11 AB-101 TEACHER', selected), /CSE2001/);
});
test('Full markers exclude sections even without a numeric seat count', () => {
  const r = parsePortalText(
    'CSE2006 - Java - LP\nSlot Venue Faculty Available\nA11 AB-101 TEACHER Full\nB11 AB-102 OTHER NONE Full\nC11 AB-103 THIRD No seats available\nD11 AB-104 OPEN'
  );
  assert.deepEqual(
    r.sections.map((s) => s.seats),
    ['0', '0', '0', '']
  );
  assert.deepEqual(
    r.sections.map((s) => s.faculty),
    ['TEACHER', 'OTHER', 'THIRD', 'OPEN']
  );
  const course = { scheduled: true, avoid: [], preferred: [], sections: r.sections };
  assert.deepEqual(
    eligibleSections(course).map((s) => s.faculty),
    ['OPEN']
  );
});
test('empty image-only text reports a clear text PDF requirement', () => {
  assert.throws(() => parsePortalText('   '), /image-only PDFs/);
});
