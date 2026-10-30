import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, DAYS } from '../src/engine.js';
import { assertExportEligible, createTimetablePdf } from '../src/pdf-export.js';
const c = {
  code: 'X',
  name: 'Example',
  scheduled: true,
  sections: [{ id: 'a', faculty: 'SANAT JAIN', slots: 'A11', venue: 'AB1-102', seats: 10 }],
};
test('PDF export refuses a stale result when selected faculty has since been avoided or filled', () => {
  const r = solve([c]).results[0];
  assert.throws(() => assertExportEligible(r, [{ ...c, avoid: ['sanat'] }]));
  assert.throws(() =>
    assertExportEligible(r, [{ ...c, sections: [{ ...c.sections[0], seats: 0 }] }])
  );
  assert.doesNotThrow(() => assertExportEligible(r, [c]));
});
class PdfRecorder {
  constructor(options) {
    this.options = options;
    this.texts = [];
    this.rectangles = [];
    this.internal = { pageSize: { getWidth: () => 297, getHeight: () => 210 } };
  }
  setProperties() {}
  setFont() {}
  setFontSize() {}
  setTextColor() {}
  setLineWidth() {}
  setDrawColor() {}
  setFillColor() {}
  text(value, x, y) {
    this.texts.push({ value: Array.isArray(value) ? value.join(' ') : value, x, y });
  }
  rect(x, y, w, h) {
    this.rectangles.push({ x, y, w, h });
  }
  splitTextToSize(value) {
    return [value];
  }
}
test('landscape export draws all six weekdays and the full timetable inside page bounds', () => {
  const r = solve([c]).results[0],
    doc = createTimetablePdf(PdfRecorder, r, { option: 5, courses: [c] });
  assert.equal(doc.options.orientation, 'landscape');
  for (const day of DAYS) assert.ok(doc.texts.some((t) => t.value === day));
  for (const rect of doc.rectangles) {
    assert.ok(rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.w <= 297.001);
    assert.ok(rect.y + rect.h <= 210);
  }
  assert.ok(doc.texts.some((t) => t.value === 'SANAT JAIN'));
  assert.ok(doc.texts.some((t) => t.value === 'AB1-102'));
  assert.ok(doc.texts.some((t) => t.value.includes('Timetable 5')));
});
test('PDF export rejects removed courses and stale rooms or slot changes', () => {
  const r = solve([c]).results[0];
  assert.throws(() => assertExportEligible(r, []));
  for (const delta of [{ slots: 'B11' }, { venue: 'AB2-401' }, { faculty: 'OTHER' }])
    assert.throws(() =>
      assertExportEligible(r, [{ ...c, sections: [{ ...c.sections[0], ...delta }] }])
    );
});
