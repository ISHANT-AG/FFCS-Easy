import { validateSection, slotBundle } from './engine.js';
export const needsFaculty = (c) => !c.online && c.scheduled !== false && !(c.sections || []).length;

export function getCourseStatus(c) {
  if (c.online) {
    return {
      label: 'Online',
      cardLabel: 'Online',
      badgeClass: 'badge-slate',
      isReady: true,
    };
  }
  if (c.sections && c.sections.length > 0) {
    return {
      label: `${c.sections.length} saved`,
      cardLabel: `${c.sections.length} saved`,
      badgeClass: 'badge-success',
      isReady: true,
    };
  }
  if (c.scheduled === false) {
    return {
      label: 'Optional',
      cardLabel: 'No weekly classes · Optional',
      badgeClass: 'badge-slate',
      isReady: true,
    };
  }
  return {
    label: 'Needs PDF',
    cardLabel: 'No list yet',
    badgeClass: 'badge-amber',
    isReady: false,
  };
}
const key = (s) =>
  [
    s.faculty
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ''),
    slotBundle(s, String(s.slots).trim().toUpperCase() !== 'NIL'),
    s.venue
      .trim()
      .toUpperCase()
      .replace(/^AB0+([12])(?=[-\s])/, 'AB$1'),
  ].join('|');
export function mergeSections(course, incoming) {
  if (!incoming.length) throw Error('No faculty options found.');
  const rows = incoming.map((s) => ({
    ...s,
    faculty: String(s.faculty ?? '').trim(),
    slots: String(s.slots ?? '')
      .trim()
      .toUpperCase(),
    venue: String(s.venue ?? '').trim(),
    seats: s.seats ?? '',
  }));
  for (const row of rows) {
    validateSection(row, { allowNil: course.scheduled === false });
    if (course.scheduled === false && row.slots !== 'NIL')
      throw Error('Use NIL for a course without weekly classes.');
  }
  const merged = [],
    positions = new Map();
  for (const source of [course.sections || [], rows]) {
    const occurrences = new Map();
    for (const row of source) {
      let rowKey = key(row);
      if (course.scheduled === false) {
        const occurrence = occurrences.get(rowKey) || 0;
        occurrences.set(rowKey, occurrence + 1);
        rowKey += ':entry' + occurrence;
      }
      if (!positions.has(rowKey)) {
        positions.set(rowKey, merged.length);
        merged.push({ ...row });
      } else {
        const i = positions.get(rowKey);
        merged[i] = { ...merged[i], ...row, id: merged[i].id };
      }
    }
  }
  return merged;
}
