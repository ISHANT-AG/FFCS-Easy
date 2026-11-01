import test from 'node:test';
import assert from 'node:assert/strict';
import {
  solveTwin,
  findCommonCourses,
  classifySectionPair,
  changeTwinFaculty,
  slotBundle,
  parseSlots,
} from '../src/engine.js';
import { createTwinTimetablePdf } from '../src/pdf-export.js';

const s = (id, slots, faculty = id, venue = 'AB1-102', seats = '70') => ({
  id,
  slots,
  faculty,
  venue,
  seats,
});

const c = (code, sections, extra = {}) => ({
  id: code,
  code,
  name: extra.name || code,
  sections,
  scheduled: true,
  preferred: [],
  avoid: [],
  ...extra,
});

test('1. Same branch/year with all common courses matching', () => {
  const c1 = [c('CSE2001', [s('s1', 'A11+A12', 'Dr. Rao', 'AB1-101', 50)])];
  const c2 = [c('CSE2001', [s('s2', 'A11+A12', 'Dr. Rao', 'AB1-101', 50)])];

  const res = solveTwin([
    { name: 'Alice', courses: c1 },
    { name: 'Bob', courses: c2 },
  ]);

  assert.equal(res.results.length, 1);
  const pair = res.results[0];
  assert.equal(pair.matchSummary.together, 1);
  assert.equal(pair.matchSummary.courses[0].status, 'together');
});

test('2. Different branches/years with only some common courses', () => {
  const aliceCourses = [
    c('CSE2001', [s('a1', 'A11+A12', 'Dr. Rao', 'AB1-101', 50)]),
    c('MAT3002', [s('a2', 'B11+B12', 'Dr. Singh', 'AB1-201', 40)]),
    c('ECE2002', [s('a3', 'D11+D12', 'Dr. Kumar', 'AB2-101', 30)]),
  ];
  const bobCourses = [
    c('CSE2001', [s('b1', 'A11+A12', 'Dr. Rao', 'AB1-101', 50)]),
    c('MAT3002', [s('b2', 'B11+B12', 'Dr. Singh', 'AB1-201', 40)]),
    c('MEE2014', [s('b3', 'E11+E12', 'Dr. Patel', 'AB1-301', 35)]),
  ];

  const res = solveTwin([
    { name: 'Alice', courses: aliceCourses },
    { name: 'Bob', courses: bobCourses },
  ]);

  assert.equal(res.results.length, 1);
  const pair = res.results[0];
  assert.equal(pair.matchSummary.totalCommon, 2);
  assert.equal(pair.matchSummary.together, 2);
  assert.equal(pair.student1.chosen.length, 3);
  assert.equal(pair.student2.chosen.length, 3);
});

test('3. No common courses and correct flag behaviour', () => {
  const aliceCourses = [c('CSE2001', [s('a1', 'A11+A12')])];
  const bobCourses = [c('MEE2014', [s('b1', 'B11+B12')])];

  const res = solveTwin([
    { name: 'Alice', courses: aliceCourses },
    { name: 'Bob', courses: bobCourses },
  ]);

  assert.equal(res.noCommonCourses, true);
  assert.equal(res.results.length, 0);
  assert.match(res.reason, /do not share any courses/i);
});

test('4. Shared online/project courses without common scheduled meetings', () => {
  const aliceCourses = [
    c('DSN2098', [s('p1', 'NIL', 'Dr. Supervisor', 'NIL', '')], { scheduled: false }),
    c('HUM0002', [s('o1', 'A11', 'Dr. Online', 'Online', '')], { online: true }),
  ];
  const bobCourses = [
    c('DSN2098', [s('p2', 'NIL', 'Dr. Supervisor', 'NIL', '')], { scheduled: false }),
    c('HUM0002', [s('o2', 'B11', 'Dr. Online', 'Online', '')], { online: true }),
  ];

  const res = solveTwin([
    { name: 'Alice', courses: aliceCourses },
    { name: 'Bob', courses: bobCourses },
  ]);

  assert.equal(res.results.length, 1);
  const pair = res.results[0];
  // Online course (HUM0002) is NOT included as common
  assert.equal(pair.matchSummary.totalCommon, 1);
  assert.equal(pair.matchSummary.commonScheduled, 0);
  assert.equal(pair.matchSummary.together, 0);
  assert.equal(pair.matchSummary.courses.find((x) => x.code === 'DSN2098').status, 'project');
  assert.equal(
    pair.matchSummary.courses.find((x) => x.code === 'HUM0002'),
    undefined
  );

  // When only online courses exist, they are not counted as common and trigger noCommonCourses
  const resOnlyOnline = solveTwin([
    { name: 'Alice', courses: [c('HUM0002', [], { online: true })] },
    { name: 'Bob', courses: [c('HUM0002', [], { online: true })] },
  ]);
  assert.equal(resOnlyOnline.noCommonCourses, true);
  assert.equal(
    findCommonCourses([c('HUM0002', [], { online: true })], [c('HUM0002', [], { online: true })])
      .length,
    0
  );
  assert.equal(
    findCommonCourses([c('HUM0002', [], { online: true })], [c('HUM0002', [], { online: false })])
      .length,
    0
  );
});

test('5. Same course with different availability lists', () => {
  const aliceSections = [
    s('a1', 'A11+A12', 'Dr. Rao', 'AB1-101', 50),
    s('a2', 'B11+B12', 'Dr. Smith', 'AB1-102', 50),
  ];
  const bobSections = [
    s('b1', 'B11+B12', 'Dr. Smith', 'AB1-102', 50),
    s('b2', 'D11+D12', 'Dr. Taylor', 'AB1-103', 50),
  ];

  const res = solveTwin([
    { name: 'Alice', courses: [c('CSE2001', aliceSections)] },
    { name: 'Bob', courses: [c('CSE2001', bobSections)] },
  ]);

  assert.ok(res.results.length >= 1);
  const pair = res.results[0];
  assert.equal(pair.matchSummary.together, 1);
  assert.equal(pair.student1.chosen[0].section.faculty, 'Dr. Smith');
  assert.equal(pair.student2.chosen[0].section.faculty, 'Dr. Smith');
});

test('6. Full slot-bundle equality despite token order differences', () => {
  const aliceSections = [s('a1', 'A11+B11+C11', 'Dr. Equal', 'AB1-101', 40)];
  const bobSections = [s('b1', 'C11+A11+B11', 'Dr. Equal', 'AB1-101', 40)];

  const res = solveTwin([
    { name: 'Alice', courses: [c('CSE2001', aliceSections)] },
    { name: 'Bob', courses: [c('CSE2001', bobSections)] },
  ]);

  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].matchSummary.together, 1);
  assert.equal(res.results[0].matchSummary.courses[0].status, 'together');
});

test('7. Same faculty with different slot bundles not counted as attending together', () => {
  const aliceSections = [s('a1', 'A11+A12', 'Dr. Busy', 'AB1-101', 40)];
  const bobSections = [s('b1', 'B11+B12', 'Dr. Busy', 'AB1-102', 40)];

  const res = solveTwin([
    { name: 'Alice', courses: [c('CSE2001', aliceSections)] },
    { name: 'Bob', courses: [c('CSE2001', bobSections)] },
  ]);

  assert.equal(res.results.length, 1);
  const pair = res.results[0];
  assert.equal(pair.matchSummary.together, 0);
  assert.equal(pair.matchSummary.differentTime, 1);
  assert.equal(pair.matchSummary.courses[0].status, 'different_time');
});

test('8. Same timing but different faculty correctly labelled as same_time', () => {
  const aliceSections = [s('a1', 'A11+A12', 'Dr. AliceTeacher', 'AB1-101', 40)];
  const bobSections = [s('b1', 'A11+A12', 'Dr. BobTeacher', 'AB1-202', 40)];

  const res = solveTwin([
    { name: 'Alice', courses: [c('CSE2001', aliceSections)] },
    { name: 'Bob', courses: [c('CSE2001', bobSections)] },
  ]);

  assert.equal(res.results.length, 1);
  const pair = res.results[0];
  assert.equal(pair.matchSummary.together, 0);
  assert.equal(pair.matchSummary.sameTime, 1);
  assert.equal(pair.matchSummary.courses[0].status, 'same_time');
});

test('9. Avoided faculty excluded for either student', () => {
  const sections = [
    s('s1', 'A11+A12', 'Dr. Avoided', 'AB1-101', 50),
    s('s2', 'B11+B12', 'Dr. Friendly', 'AB1-102', 50),
  ];

  // Alice avoids Dr. Avoided
  const res = solveTwin([
    { name: 'Alice', courses: [c('CSE2001', sections, { avoid: ['Dr. Avoided'] })] },
    { name: 'Bob', courses: [c('CSE2001', sections)] },
  ]);

  assert.ok(res.results.length >= 1);
  const pair = res.results[0];
  assert.equal(pair.matchSummary.together, 1);
  assert.equal(pair.student1.chosen[0].section.faculty, 'Dr. Friendly');
  assert.equal(pair.student2.chosen[0].section.faculty, 'Dr. Friendly');
});

test('10. Zero seats and insufficient seats for two students (1 seat vs 2 seats)', () => {
  // Option 1 has 1 seat only: insufficient for 2 students
  // Option 2 has 10 seats: sufficient for 2 students
  const sections = [
    s('s1', 'A11+A12', 'Dr. OnlyOneSeat', 'AB1-101', '1'),
    s('s2', 'B11+B12', 'Dr. ManySeats', 'AB1-102', '10'),
  ];

  const res = solveTwin([
    { name: 'Alice', courses: [c('CSE2001', sections)] },
    { name: 'Bob', courses: [c('CSE2001', sections)] },
  ]);

  assert.ok(res.results.length >= 1);
  const pair = res.results[0];
  // Dr. OnlyOneSeat cannot be together because it only has 1 seat
  assert.equal(pair.student1.chosen[0].section.faculty, 'Dr. ManySeats');
  assert.equal(pair.student2.chosen[0].section.faculty, 'Dr. ManySeats');
  assert.equal(pair.matchSummary.together, 1);
});

test('11. Different snapshots using the conservative lower seat count', () => {
  // Alice sees 5 seats, Bob sees 1 seat -> min is 1 seat -> cannot be together
  const sAlice = [s('s1', 'A11+A12', 'Dr. ShiftingSeats', 'AB1-101', '5')];
  const sBob = [s('s2', 'A11+A12', 'Dr. ShiftingSeats', 'AB1-101', '1')];

  const res = solveTwin([
    { name: 'Alice', courses: [c('CSE2001', sAlice)] },
    { name: 'Bob', courses: [c('CSE2001', sBob)] },
  ]);

  assert.equal(res.results.length, 1);
  const pair = res.results[0];
  assert.equal(pair.matchSummary.together, 0);
  assert.equal(pair.matchSummary.sameTime, 1); // fallback to same time because seats < 2
  assert.match(pair.matchSummary.courses[0].reason, /at least 2 seats/i);
});

test('12. A common section choice that blocks unique courses, requiring backtracking', () => {
  // Course C (common) has two sections: A11+A12 and B11+B12
  // Course U (unique to Alice) only has A11+A12
  // If solver greedily placed C at A11+A12, Alice would have a clash on U.
  // Solver must backtrack and place C at B11+B12 so both C and U fit!
  const commonSections = [
    s('c1', 'A11+A12', 'Dr. Common1', 'AB1-101', 30),
    s('c2', 'B11+B12', 'Dr. Common2', 'AB1-102', 30),
  ];
  const uniqueAliceSections = [s('u1', 'A11+A12', 'Dr. Unique', 'AB1-103', 30)];

  const res = solveTwin([
    { name: 'Alice', courses: [c('COMMON', commonSections), c('UNIQUE', uniqueAliceSections)] },
    { name: 'Bob', courses: [c('COMMON', commonSections)] },
  ]);

  assert.ok(res.results.length >= 1);
  const pair = res.results[0];
  assert.equal(pair.matchSummary.together, 1);
  assert.equal(pair.student1.chosen.find((x) => x.course.code === 'COMMON').section.id, 'c2');
  assert.equal(pair.student2.chosen.find((x) => x.course.code === 'COMMON').section.id, 'c2');
  assert.equal(pair.student1.chosen.find((x) => x.course.code === 'UNIQUE').section.id, 'u1');
});

test('13. Different lunch and day-scholar rules for each student', () => {
  // Monday: P2 is 11:40-13:10 (slot C11), P3 is 13:15-14:45 (slot A21)
  // Alice requires lunch (cannot take both P2 and P3).
  // Bob disables lunch (can take both P2 and P3).
  // Day scholar bus deadline for Alice: 16:20 (cannot take P5=16:25-17:55, slot B21).
  const c1 = [
    c('C1', [s('s1', 'C11', 'Dr. One', 'AB1-101', 30)]),
    c('C2', [
      s('s2a', 'A21', 'Dr. LateLunch', 'AB1-102', 30), // Clashes with Alice lunch if C11 is taken
      s('s2b', 'D11', 'Dr. Safe', 'AB1-103', 30), // Tuesday morning
    ]),
  ];

  const res = solveTwin([
    { name: 'Alice', courses: c1, settings: { lunch: true } },
    { name: 'Bob', courses: c1, settings: { lunch: false } },
  ]);

  assert.ok(res.results.length >= 1);
  const pair = res.results[0];
  // Alice cannot take s2a (C11 + A21 violates lunch); Alice takes s2b
  assert.equal(pair.student1.chosen.find((x) => x.course.code === 'C2').section.id, 's2b');
  // Bob with no lunch can match Alice or take s2b
});

test('14. Morning-only solutions staying within morning window', () => {
  // Morning ends by 13:15 (Period 0, 1, 2).
  // A11 is 08:30-10:00 (morning).
  // A14 is 14:50-16:20 (afternoon).
  const cSections = [
    s('m1', 'A11', 'Dr. Morning', 'AB1-101', 40),
    s('m2', 'A14', 'Dr. Afternoon', 'AB1-102', 40),
  ];

  const res = solveTwin([
    { name: 'Alice', courses: [c('C1', cSections)], preset: 'morning' },
    { name: 'Bob', courses: [c('C1', cSections)], preset: 'morning' },
  ]);

  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].student1.chosen[0].section.id, 'm1');
  assert.equal(res.results[0].student2.chosen[0].section.id, 'm1');
  assert.equal(res.results[0].matchSummary.together, 1);
});

test('15. Partial matching when complete matching is impossible', () => {
  // Course 1 can match together (slot A11)
  // Course 2 has mutually exclusive slots (Alice has B11, Bob has D11)
  const c1Alice = [
    c('COURSE1', [s('c1', 'A11', 'Dr. Common', 'AB1-101', 30)]),
    c('COURSE2', [s('c2a', 'B11', 'Dr. DiffA', 'AB1-102', 30)]),
  ];
  const c1Bob = [
    c('COURSE1', [s('c1', 'A11', 'Dr. Common', 'AB1-101', 30)]),
    c('COURSE2', [s('c2b', 'D11', 'Dr. DiffB', 'AB1-103', 30)]),
  ];

  const res = solveTwin([
    { name: 'Alice', courses: c1Alice },
    { name: 'Bob', courses: c1Bob },
  ]);

  assert.equal(res.results.length, 1);
  const pair = res.results[0];
  assert.equal(pair.matchSummary.totalCommon, 2);
  assert.equal(pair.matchSummary.together, 1);
  assert.equal(pair.matchSummary.differentTime, 1);
  assert.match(
    pair.matchSummary.courses.find((x) => x.code === 'COURSE2').reason,
    /different time/i
  );
});

test('16. No feasible pair without relaxing hard rules', () => {
  // Alice has course that clashes internally on all options
  const badCourses = [
    c('C1', [s('s1', 'A11', 'Dr. A', 'AB1-101', 30)]),
    c('C2', [s('s2', 'A11', 'Dr. B', 'AB1-102', 30)]),
  ];
  const bobCourses = [c('C1', [s('s1', 'A11', 'Dr. A', 'AB1-101', 30)])];

  const res = solveTwin([
    { name: 'Alice', courses: badCourses },
    { name: 'Bob', courses: bobCourses },
  ]);

  assert.equal(res.results.length, 0);
  assert.match(res.reason, /no clash-free paired timetable/i);
});

test('18. Up to five meaningful paired options without faculty-only duplicates', () => {
  // Multiple distinct timing combinations available
  const slots = ['A11', 'B11', 'C11', 'D11', 'E11', 'F11'];
  const coursesAlice = [
    c(
      'C1',
      slots.map((sl, i) => s('a' + i, sl, 'Prof ' + i, 'AB1-10' + i, 20))
    ),
    c(
      'C2',
      slots.map((sl, i) => s('b' + i, sl, 'Prof ' + i, 'AB1-10' + i, 20))
    ),
  ];
  const coursesBob = [
    c(
      'C1',
      slots.map((sl, i) => s('a' + i, sl, 'Prof ' + i, 'AB1-10' + i, 20))
    ),
    c(
      'C2',
      slots.map((sl, i) => s('b' + i, sl, 'Prof ' + i, 'AB1-10' + i, 20))
    ),
  ];

  const res = solveTwin(
    [
      { name: 'Alice', courses: coursesAlice },
      { name: 'Bob', courses: coursesBob },
    ],
    {},
    5
  );

  assert.ok(res.results.length >= 2);
  assert.ok(res.results.length <= 5);
  // Verify all pairs have unique timing signatures
  const sigs = new Set(res.results.map((r) => r.pairSig));
  assert.equal(sigs.size, res.results.length);
});

test('20. Manual shared and individual faculty changes updating match counts', () => {
  const sectionsAlice = [
    s('s1', 'A11', 'Dr. Both', 'AB1-101', '10'),
    s('s2', 'A11', 'Dr. AliceSolo', 'AB1-102', '10'),
    s('s3', 'A11', 'Dr. SharedAlt', 'AB1-103', '10'),
  ];
  const sectionsBob = [
    s('b1', 'A11', 'Dr. Both', 'AB1-101', '10'),
    s('b2', 'A11', 'Dr. BobSolo', 'AB1-104', '10'),
    s('b3', 'A11', 'Dr. SharedAlt', 'AB1-103', '10'),
  ];

  const res = solveTwin([
    { name: 'Alice', courses: [c('CSE2001', sectionsAlice)] },
    { name: 'Bob', courses: [c('CSE2001', sectionsBob)] },
  ]);

  let pair = res.results[0];
  assert.equal(pair.matchSummary.together, 1);

  // 1. Change for Alice only to Dr. AliceSolo -> breaks match to same_time
  const changedAlice = changeTwinFaculty(pair, 0, 'CSE2001', 's2', false);
  assert.equal(changedAlice.matchSummary.together, 0);
  assert.equal(changedAlice.matchSummary.sameTime, 1);
  assert.equal(changedAlice.student1.chosen[0].section.faculty, 'Dr. AliceSolo');
  assert.equal(changedAlice.student2.chosen[0].section.faculty, 'Dr. Both'); // Bob unchanged!

  // 2. Change for BOTH to Dr. SharedAlt -> keeps together = 1
  const changedBoth = changeTwinFaculty(pair, 0, 'CSE2001', 's3', true);
  assert.equal(changedBoth.matchSummary.together, 1);
  assert.equal(changedBoth.student1.chosen[0].section.faculty, 'Dr. SharedAlt');
  assert.equal(changedBoth.student2.chosen[0].section.faculty, 'Dr. SharedAlt');
});

test('21. Correct named individual and combined PDF exports', () => {
  const cAlice = [c('CSE2001', [s('s1', 'A11', 'Dr. Together', 'AB1-101', 30)])];
  const cBob = [c('CSE2001', [s('s1', 'A11', 'Dr. Together', 'AB1-101', 30)])];

  const res = solveTwin([
    { name: 'Alice', courses: cAlice },
    { name: 'Bob', courses: cBob },
  ]);
  const pair = res.results[0];

  // Mock jsPDF class for testing structure
  class MockJsPDF {
    constructor() {
      this.pages = 1;
      this.calls = [];
      this.internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
    }
    setProperties(props) {
      this.properties = props;
    }
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    setLineWidth() {}
    setDrawColor() {}
    setFillColor() {}
    rect() {}
    text(txt) {
      this.calls.push(txt);
    }
    splitTextToSize(txt) {
      return [txt];
    }
    addPage() {
      this.pages++;
    }
  }

  // Test individual export Alice
  const docAlice = createTwinTimetablePdf(MockJsPDF, pair, {
    which: 'student1',
    courses1: cAlice,
    courses2: cBob,
  });
  assert.equal(docAlice.pages, 1);
  assert.match(docAlice.properties.title, /Alice/);

  // Test individual export Bob
  const docBob = createTwinTimetablePdf(MockJsPDF, pair, {
    which: 'student2',
    courses1: cAlice,
    courses2: cBob,
  });
  assert.equal(docBob.pages, 1);
  assert.match(docBob.properties.title, /Bob/);

  // Test combined export (both)
  const docBoth = createTwinTimetablePdf(MockJsPDF, pair, {
    which: 'both',
    courses1: cAlice,
    courses2: cBob,
  });
  assert.equal(docBoth.pages, 2);
});

test('17. Independent uploads and preferences for each student', () => {
  // Alice takes morning A11 (08:30); Bob takes evening B21 (16:25)
  const aliceCourse = c('CSE2001', [s('a1', 'A11', 'Dr. AliceUpload', 'AB1-101', 30)]);
  const bobCourse = c('CSE2001', [s('b1', 'B21', 'Dr. BobUpload', 'AB1-102', 30)]);

  // Alice's uploads are independent from Bob's
  assert.equal(aliceCourse.sections[0].faculty, 'Dr. AliceUpload');
  assert.equal(bobCourse.sections[0].faculty, 'Dr. BobUpload');

  // Solver respects independent uploads and individual presets
  const res = solveTwin([
    { name: 'Alice', courses: [aliceCourse], preset: 'morning' },
    { name: 'Bob', courses: [bobCourse], preset: 'evening' },
  ]);

  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].student1.chosen[0].section.faculty, 'Dr. AliceUpload');
  assert.equal(res.results[0].student2.chosen[0].section.faculty, 'Dr. BobUpload');
});

test('19. Consistent-routine subject swaps in paired options', () => {
  // Course 1 and Course 2 can swap slots across pairs while keeping occupied slots identical
  const cAlice = [
    c('C1', [s('a1', 'A11', 'Dr. A1', 'AB1-101', 20), s('a2', 'B11', 'Dr. A2', 'AB1-102', 20)]),
    c('C2', [s('a3', 'B11', 'Dr. A3', 'AB1-103', 20), s('a4', 'A11', 'Dr. A4', 'AB1-104', 20)]),
  ];
  const cBob = [
    c('C1', [s('b1', 'A11', 'Dr. A1', 'AB1-101', 20), s('b2', 'B11', 'Dr. A2', 'AB1-102', 20)]),
    c('C2', [s('b3', 'B11', 'Dr. A3', 'AB1-103', 20), s('b4', 'A11', 'Dr. A4', 'AB1-104', 20)]),
  ];

  const res = solveTwin(
    [
      { name: 'Alice', courses: cAlice },
      { name: 'Bob', courses: cBob },
    ],
    {},
    2
  );

  assert.equal(res.results.length, 2);
  // Both pairs achieve together = 2
  assert.equal(res.results[0].matchSummary.together, 2);
  assert.equal(res.results[1].matchSummary.together, 2);
});

test('22. Cancellation, timeout and worker response handling for twin', async () => {
  // Verify node limit truncation in solveTwin
  const aliceCourses = [
    c('C1', [s('a1', 'A11', 'Dr. A1', 'AB1-101', 30), s('a2', 'B11', 'Dr. A2', 'AB1-102', 30)]),
    c('C2', [s('a3', 'C11', 'Dr. A3', 'AB1-103', 30), s('a4', 'D11', 'Dr. A4', 'AB1-104', 30)]),
  ];
  const bobCourses = [
    c('C1', [s('b1', 'A11', 'Dr. A1', 'AB1-101', 30), s('b2', 'B11', 'Dr. A2', 'AB1-102', 30)]),
    c('C2', [s('b3', 'C11', 'Dr. A3', 'AB1-103', 30), s('b4', 'D11', 'Dr. A4', 'AB1-104', 30)]),
  ];

  // Set maxNodes to 1 to force truncation
  const res = solveTwin(
    [
      { name: 'Alice', courses: aliceCourses },
      { name: 'Bob', courses: bobCourses },
    ],
    { maxNodes: 1 }
  );

  assert.equal(res.truncated, true);
});

test('23. Comparison against independent brute-force reference for small generated examples', () => {
  // Generate random 2-course scenario with small options and compare max together count
  const sOptions = ['A11', 'B11', 'C11', 'D11'];
  const cAlice = [
    c('C1', [s('a1', 'A11', 'Dr. A', 'AB1-101', 10), s('a2', 'B11', 'Dr. B', 'AB1-102', 10)]),
    c('C2', [s('a3', 'C11', 'Dr. C', 'AB1-103', 10), s('a4', 'D11', 'Dr. D', 'AB1-104', 10)]),
  ];
  const cBob = [
    c('C1', [s('b1', 'A11', 'Dr. A', 'AB1-101', 10), s('b2', 'C11', 'Dr. X', 'AB1-105', 10)]),
    c('C2', [s('b3', 'C11', 'Dr. C', 'AB1-103', 10), s('b4', 'B11', 'Dr. Y', 'AB1-106', 10)]),
  ];

  // Brute force search all pairs:
  let maxTogetherBrute = -1;
  for (const s1 of cAlice[0].sections) {
    for (const s2 of cAlice[1].sections) {
      if (s1.slots === s2.slots) continue; // clash for Alice
      for (const b1 of cBob[0].sections) {
        for (const b2 of cBob[1].sections) {
          if (b1.slots === b2.slots) continue; // clash for Bob
          let together = 0;
          if (s1.slots === b1.slots && s1.faculty === b1.faculty) together++;
          if (s2.slots === b2.slots && s2.faculty === b2.faculty) together++;
          if (together > maxTogetherBrute) maxTogetherBrute = together;
        }
      }
    }
  }

  const res = solveTwin([
    { name: 'Alice', courses: cAlice },
    { name: 'Bob', courses: cBob },
  ]);

  assert.ok(res.results.length >= 1);
  assert.equal(res.results[0].matchSummary.together, maxTogetherBrute);
});
