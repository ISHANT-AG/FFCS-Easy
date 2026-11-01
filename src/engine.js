export const TIMES = [
  '08:30–10:00',
  '10:05–11:35',
  '11:40–13:10',
  '13:15–14:45',
  '14:50–16:20',
  '16:25–17:55',
  '18:00–19:30',
];
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const GRID = [
  ['A11', 'B11', 'C11', 'A21', 'A14', 'B21', 'C21'],
  ['D11', 'E11', 'F11', 'D21', 'E14', 'E21', 'F21'],
  ['A12', 'B12', 'C12', 'A22', 'B14', 'B22', 'A24'],
  ['D12', 'E12', 'F12', 'D22', 'F14', 'E22', 'F22'],
  ['A13', 'B13', 'C13', 'A23', 'C14', 'B23', 'B24'],
  ['D13', 'E13', 'F13', 'D23', 'D14', 'D24', 'E23'],
];
export const START = [510, 605, 700, 795, 890, 985, 1080],
  END = [600, 695, 790, 885, 980, 1075, 1170];
const facultyKey = (s) =>
  String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
const nameWords = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
export function matchesAvoidFaculty(query, faculty) {
  const q = nameWords(query),
    f = nameWords(faculty);
  if (!q.length) return false;
  if (q.join('') === f.join('')) return true;
  return f.some((_, i) => q.every((word, j) => word === f[i + j]));
}

const index = Object.fromEntries(
  GRID.flatMap((r, d) => r.map((s, p) => [s, { day: d, period: p }]))
);
export function parseSlots(text) {
  const codes = String(text)
    .toUpperCase()
    .split(/[+,;\s]+/)
    .filter(Boolean);
  if (!codes.length) throw Error('Enter at least one slot.');
  const bad = codes.filter((s) => !index[s]);
  if (bad.length) throw Error('Unknown slot: ' + bad.join(', '));
  return [...new Set(codes)].map((s) => ({ ...index[s], code: s }));
}
export function zone(venue) {
  return /^AB0?2\b/i.test(venue.trim()) ? 'far' : 'near';
}
export function validateSection(s, { allowNil = false } = {}) {
  if (!s.faculty?.trim()) throw Error('Faculty is required.');
  if (!s.venue?.trim()) throw Error('Venue is required.');
  if (!(allowNil && String(s.slots).trim().toUpperCase() === 'NIL')) parseSlots(s.slots);
  if (
    s.seats !== '' &&
    s.seats != null &&
    (!Number.isInteger(Number(s.seats)) || Number(s.seats) < 0)
  )
    throw Error('Seats must be a whole non-negative number.');
}
export function lunchValid(items) {
  return DAYS.every(
    (_, d) =>
      !items.some((x) => x.day === d && x.period === 2) ||
      !items.some((x) => x.day === d && x.period === 3)
  );
}
export function metrics(items) {
  let gaps = 0,
    travel = 0,
    morning = 0,
    evening = 0,
    balance = 0,
    days = 0;
  for (let d = 0; d < 6; d++) {
    const a = items.filter((x) => x.day === d).sort((a, b) => a.period - b.period);
    if (!a.length) continue;
    days++;
    for (const x of a) {
      morning += Math.max(0, x.period - 2);
      evening += Math.max(0, 3 - x.period);
    }
    for (let i = 1; i < a.length; i++) {
      const delta = a[i].period - a[i - 1].period;
      gaps += delta - 1;
      if (delta === 1 && zone(a[i].venue) !== zone(a[i - 1].venue)) travel++;
    }
    balance += Math.abs(a.reduce((s, x) => s + x.period, 0) / a.length - 3);
  }
  return { gaps, travel, morning, evening, balance, days };
}
export const PRESETS = [
  { id: 'compact', name: 'Minimal gaps', description: 'Keep your campus day compact.' },
  { id: 'morning', name: 'Morning person', description: 'Make room for free evenings.' },
  { id: 'evening', name: 'Evening person', description: 'Start your day a little later.' },
  { id: 'travel', name: 'Less travel', description: 'Fewer back-to-back AB2 switches.' },
  { id: 'balanced', name: 'Whole day', description: 'Spread classes across the day.' },
  { id: 'bus', name: 'Day scholar', description: 'Finish before your bus deadline.' },
];
export function slotBundle(section, scheduled = true) {
  return scheduled === false || String(section?.slots).trim().toUpperCase() === 'NIL'
    ? 'NIL'
    : parseSlots(section.slots)
        .map((x) => x.code)
        .sort()
        .join('+');
}
export function eligibleSections(course) {
  if (course.online) return [];
  return (course.sections || []).filter((s) => {
    if (s.seats !== '' && s.seats != null && !(Number(s.seats) > 0)) return false;
    if (
      (Array.isArray(course.avoid)
        ? course.avoid
        : String(course.avoid || '').split(/[,;\n]+/)
      ).some((f) => matchesAvoidFaculty(f, s.faculty))
    )
      return false;
    if (course.only && facultyKey(course.only) !== facultyKey(s.faculty)) return false;
    try {
      validateSection(s, { allowNil: course.scheduled === false });
      return course.scheduled !== false || String(s.slots).trim().toUpperCase() === 'NIL';
    } catch {
      return false;
    }
  });
}
function preferencePenalty(course, section) {
  const names = course.preferred || [],
    rank = names.findIndex((f) => facultyKey(f) === facultyKey(section.faculty));
  return names.length ? (rank < 0 ? names.length + 1 : rank) : 0;
}
function scoreSchedule(items, m, penalty, settings, preset) {
  let score = m.gaps * 10 + penalty * 30 + (settings.travel ? m.travel * 35 : 0);
  if (preset === 'morning')
    score += items.reduce((n, x) => n + Math.max(0, END[x.period] - 795), 0) * 10;
  if (preset === 'evening') score += m.evening * 25;
  if (preset === 'travel') score += m.travel * 70;
  if (preset === 'balanced')
    score = m.balance * 30 + m.gaps * 2 + penalty * 30 + (settings.travel ? m.travel * 35 : 0);
  return score;
}
function deadlineFor(settings) {
  const [h, m] = (settings.busTime || '16:45').split(':').map(Number);
  return h * 60 + m - (Number(settings.walkMinutes) || 0);
}
function sectionItems(course, section) {
  if (
    course.scheduled === false ||
    course.online ||
    String(section?.slots).trim().toUpperCase() === 'NIL'
  ) {
    return [];
  }
  return parseSlots(section.slots).map((x) => ({
    ...x,
    venue: section.venue,
    faculty: section.faculty,
    course: course.code,
    name: course.name,
    section: section.id,
  }));
}
function scheduleFrom(chosen, settings, preset) {
  const items = chosen.flatMap(({ course, section }) => sectionItems(course, section)),
    m = metrics(items);
  const enriched = chosen.map(({ course, section }) => ({
    course,
    section,
    alternatives: eligibleSections(course).filter(
      (s) => slotBundle(s, course.scheduled) === slotBundle(section, course.scheduled)
    ),
  }));
  const signature = chosen
    .filter(
      (x) =>
        x.course.scheduled !== false &&
        !x.course.online &&
        String(x.section?.slots).trim().toUpperCase() !== 'NIL'
    )
    .map(({ course, section }) => course.code + ':' + slotBundle(section, true))
    .sort()
    .join('|');
  const penalty = chosen.reduce((n, x) => n + preferencePenalty(x.course, x.section), 0);
  return {
    chosen: enriched,
    items,
    metrics: m,
    signature,
    score: scoreSchedule(items, m, penalty, settings, preset),
  };
}
export function changeFaculty(schedule, courseCode, sectionId, settings = {}, preset = 'compact') {
  const current = schedule.chosen.find((x) => x.course.code === courseCode);
  if (!current) throw Error('Course not found in this timetable.');
  const next = eligibleSections(current.course).find((s) => s.id === sectionId);
  if (
    !next ||
    slotBundle(next, current.course.scheduled) !==
      slotBundle(current.section, current.course.scheduled)
  )
    throw Error('Choose an eligible faculty with the same time slots.');
  return scheduleFrom(
    schedule.chosen.map((x) => (x === current ? { course: x.course, section: next } : x)),
    settings,
    preset
  );
}
// Compare course timings only; faculty/room changes never create another layout.
const timingCache = new WeakMap();
function timingMap(schedule) {
  if (!timingCache.has(schedule))
    timingCache.set(
      schedule,
      new Map(
        schedule.chosen
          .filter((x) => x.course.scheduled !== false)
          .map((x) => [x.course.code, new Set(slotBundle(x.section).split('+'))])
      )
    );
  return timingCache.get(schedule);
}
function timingDistance(a, b) {
  const left = timingMap(a),
    right = timingMap(b);
  let moved = 0,
    meetings = 0;
  for (const [course, slots] of left) {
    const next = right.get(course) || new Set();
    const delta =
      [...slots].filter((s) => !next.has(s)).length + [...next].filter((s) => !slots.has(s)).length;
    if (delta) {
      moved++;
      meetings += delta;
    }
  }
  return moved * 100 + meetings;
}
export function diverseTimetables(input, limit) {
  const candidates = [...input].sort(
      (a, b) => a.score - b.score || a.signature.localeCompare(b.signature)
    ),
    selected = [];
  // Keep the best preference match first, then maximize the minimum timing
  // difference from EVERY option already selected. Scores break distance ties.
  while (candidates.length && selected.length < limit) {
    let bestIndex = 0,
      bestDistance = -1;
    if (selected.length)
      for (let i = 0; i < candidates.length; i++) {
        const distance = Math.min(...selected.map((s) => timingDistance(s, candidates[i])));
        if (distance > bestDistance) {
          bestDistance = distance;
          bestIndex = i;
        }
      }
    selected.push(candidates.splice(bestIndex, 1)[0]);
  }
  return selected;
}
// Occupied grid cells define the daily routine, regardless of the subject.
export function dailyPattern(schedule) {
  return [...new Set([...timingMap(schedule).values()].flatMap((slots) => [...slots]))]
    .sort()
    .join('+');
}
export function consistentTimetables(input, limit = 5) {
  const ranked = [
    ...new Map(
      [...input]
        .sort((a, b) => a.score - b.score || a.signature.localeCompare(b.signature))
        .map((s) => [s.signature, s])
    ).values(),
  ];
  if (!ranked.length) return [];
  const best = ranked[0],
    pattern = dailyPattern(best);
  const same = ranked.filter((s) => dailyPattern(s) === pattern);
  const selected = diverseTimetables(same, Math.min(3, limit));
  const remaining = ranked.filter((s) => !selected.includes(s));
  // Fill the remaining places with timing flexibility; exact routine swaps
  // always precede these, and faculty-only variants share one signature.
  while (remaining.length && selected.length < limit) {
    let index = 0,
      distance = -1;
    for (let i = 0; i < remaining.length; i++) {
      const d = Math.min(...selected.map((s) => timingDistance(s, remaining[i])));
      if (d > distance) {
        distance = d;
        index = i;
      }
    }
    selected.push(remaining.splice(index, 1)[0]);
  }
  return selected;
}
export function solve(courses, settings = {}, preset = 'compact', limit = 5, hooks = {}) {
  // Prefer an entirely morning shortlist before considering necessary late classes.
  if (preset === 'morning' && !settings._morningAttempt) {
    const morning = solve(
      courses,
      { ...settings, _morningAttempt: true, _morningOnly: true },
      preset,
      limit,
      hooks
    );
    if (morning.results.length) return morning;
    const fallback = solve(courses, { ...settings, _morningAttempt: true }, preset, limit, hooks);
    return {
      ...fallback,
      nodes: morning.nodes + fallback.nodes,
      elapsedMs: morning.elapsedMs + fallback.elapsedMs,
      morningFallback: true,
    };
  }
  limit = Math.min(100, Math.max(1, Number(limit) || 5));
  const prepared = new WeakMap();
  const started = Date.now(),
    maxMilliseconds = Math.max(1, Number(settings.maxMilliseconds) || 3000);
  let lastProgress = started;
  const active = courses.filter(
      (c) => !c.online && (c.scheduled !== false || (c.sections || []).length)
    ),
    missing = [],
    nodesMax = settings.maxNodes || 250000;
  const lists = active
    .map((c) => {
      const eligible = eligibleSections(c),
        groups = new Map();
      // Faculty with identical meetings and building group have identical effects
      // on scheduling. Search one best representative, keep all for the dropdown.
      for (const s of eligible) {
        const key = slotBundle(s, c.scheduled) + (c.scheduled === false ? '' : ':' + zone(s.venue));
        const prior = groups.get(key);
        if (
          !prior ||
          preferencePenalty(c, s) < preferencePenalty(c, prior) ||
          (preferencePenalty(c, s) === preferencePenalty(c, prior) &&
            Number(s.seats || 0) > Number(prior.seats || 0))
        )
          groups.set(key, s);
      }
      const options = [...groups.values()].sort(
        (a, b) => preferencePenalty(c, a) - preferencePenalty(c, b)
      );
      for (const section of options) {
        const items = sectionItems(c, section);
        let low = 0,
          high = 0;
        for (const x of items) {
          const bit = x.day * 7 + x.period;
          if (bit < 32) low |= 1 << bit;
          else high |= 1 << (bit - 32);
        }
        prepared.set(section, {
          items,
          low,
          high,
          penalty: preferencePenalty(c, section),
          signature: c.code + ':' + slotBundle(section, c.scheduled),
        });
      }
      if (!options.length) missing.push(c.code);
      return { course: c, options };
    })
    .sort((a, b) => a.options.length - b.options.length);
  if (missing.length)
    return {
      results: [],
      reason:
        'No eligible sections for ' +
        missing.join(', ') +
        '. Check uploaded options or faculty preferences.',
      nodes: 0,
      truncated: false,
    };
  if (!active.length)
    return {
      results: [],
      reason: 'Select at least one course with weekly classes.',
      nodes: 0,
      truncated: false,
    };
  let nodes = 0,
    truncated = false;
  const pool = new Map(),
    poolLimit = Math.max(128, limit * 12),
    bus = settings.bus || preset === 'bus',
    deadline = deadlineFor(settings);
  function visit(k, items, chosen, low = 0, high = 0, penalty = 0) {
    if (++nodes > nodesMax) {
      truncated = true;
      return;
    }
    if ((nodes & 255) === 0) {
      const now = Date.now();
      if (now - started >= maxMilliseconds) {
        truncated = true;
        return;
      }
      if (now - lastProgress >= 200) {
        lastProgress = now;
        hooks.onProgress?.({ nodes, found: pool.size });
      }
    }
    if (k === lists.length) {
      const m = metrics(items),
        signature = chosen
          .filter((x) => x.course.scheduled !== false)
          .map((x) => prepared.get(x.section).signature)
          .sort()
          .join('|');
      const candidate = {
          chosen: [...chosen],
          items: [...items],
          metrics: m,
          signature,
          score: scoreSchedule(items, m, penalty, settings, preset),
        },
        previous = pool.get(signature);
      if (!previous || candidate.score < previous.score) pool.set(candidate.signature, candidate);
      if (pool.size > poolLimit * 2) {
        const ranked = [...pool.values()].sort((a, b) => a.score - b.score),
          quality = ranked.slice(0, poolLimit - limit),
          variety = consistentTimetables(ranked, limit);
        pool.clear();
        for (const entry of [...quality, ...variety]) pool.set(entry.signature, entry);
      }
      return;
    }
    const { course: c, options } = lists[k];
    for (const s of options) {
      if (truncated) return;
      const info = prepared.get(s),
        added = info.items;
      if (low & info.low || high & info.high) continue;
      if (bus && added.some((x) => END[x.period] > deadline)) continue;
      if (settings._morningOnly && added.some((x) => END[x.period] > 795)) continue;
      if (preset === 'evening' && added.some((x) => START[x.period] < 795)) continue;
      const nextLow = low | info.low,
        nextHigh = high | info.high;
      if (
        settings.lunch !== false &&
        ([12, 1536, 196608, 25165824, -1073741824].some((mask) => (nextLow & mask) === mask) ||
          (nextHigh & 96) === 96)
      )
        continue;
      visit(
        k + 1,
        [...items, ...added],
        [...chosen, { course: c, section: s }],
        nextLow,
        nextHigh,
        penalty + info.penalty
      );
    }
  }
  visit(0, [], []);
  // Search the winning routine directly as well: a bounded global search
  // may stop before reaching its subject permutations in the original order.
  if (pool.size && limit > 1) {
    const anchor = [...pool.values()].sort((a, b) => a.score - b.score)[0];
    let targetLow = 0,
      targetHigh = 0;
    for (const x of anchor.chosen) {
      targetLow |= prepared.get(x.section).low;
      targetHigh |= prepared.get(x.section).high;
    }
    const fixed = lists
      .map((x) => ({
        ...x,
        options: x.options.filter((s) => {
          const p = prepared.get(s);
          return (p.low & ~targetLow) === 0 && (p.high & ~targetHigh) === 0;
        }),
      }))
      .sort((a, b) => a.options.length - b.options.length);
    const until = Date.now() + 200;
    let attempts = 0;
    function swaps(k, chosen, items, low = 0, high = 0, penalty = 0) {
      if (++attempts > 20000 || Date.now() > until) return;
      if (k === fixed.length) {
        if (low !== targetLow || high !== targetHigh) return;
        const signature = chosen
            .filter((x) => x.course.scheduled !== false)
            .map((x) => prepared.get(x.section).signature)
            .sort()
            .join('|'),
          m = metrics(items),
          candidate = {
            chosen,
            items,
            metrics: m,
            signature,
            score: scoreSchedule(items, m, penalty, settings, preset),
          },
          prior = pool.get(signature);
        if (!prior || candidate.score < prior.score) pool.set(signature, candidate);
        return;
      }
      for (const section of fixed[k].options) {
        const p = prepared.get(section);
        if (low & p.low || high & p.high) continue;
        swaps(
          k + 1,
          [...chosen, { course: fixed[k].course, section }],
          [...items, ...p.items],
          low | p.low,
          high | p.high,
          penalty + p.penalty
        );
        if (attempts > 20000 || Date.now() > until) break;
      }
    }
    swaps(0, [], []);
  }
  const selected = consistentTimetables([...pool.values()], limit);
  return {
    results: selected.map((s) => scheduleFrom(s.chosen, settings, preset)),
    nodes,
    truncated,
    elapsedMs: Date.now() - started,
    reason: selected.length
      ? ''
      : truncated
        ? 'Search limit reached before a timetable was found. Try again or adjust your preferences.'
        : 'No timetable meets all rules. Check overlapping slots, faculty choices, lunch or the bus deadline.',
  };
}

export function normalizeCourseCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase();
}

export function findCommonCourses(courses1 = [], courses2 = []) {
  const map2 = new Map((courses2 || []).map((c) => [normalizeCourseCode(c.code), c]));
  const common = [];
  for (const c1 of courses1 || []) {
    const code = normalizeCourseCode(c1.code);
    if (!code) continue;
    const c2 = map2.get(code);
    if (c2) {
      // Do not include online courses as common
      if (c1.online || c2.online) continue;
      const isSched = c1.scheduled !== false && c2.scheduled !== false;
      common.push({
        code,
        name: c1.name || c2.name || code,
        course1: c1,
        course2: c2,
        isScheduled: isSched,
        isOnline: false,
        isProject: c1.scheduled === false || c2.scheduled === false,
      });
    }
  }
  return common;
}

export function classifySectionPair(s1, s2, scheduled = true) {
  if (scheduled === false || !s1 || !s2) {
    const sameFac = s1 && s2 && facultyKey(s1.faculty) === facultyKey(s2.faculty);
    return {
      status: 'project',
      together: false,
      sameFaculty: sameFac,
      sameSlot: true,
      reason: 'Course has no weekly classes (Project).',
    };
  }
  const b1 = slotBundle(s1, true);
  const b2 = slotBundle(s2, true);
  if (b1 !== b2) {
    return {
      status: 'different_time',
      together: false,
      sameFaculty: facultyKey(s1.faculty) === facultyKey(s2.faculty),
      sameSlot: false,
      reason: 'Different time slots.',
    };
  }
  const sameFac = facultyKey(s1.faculty) === facultyKey(s2.faculty);
  const v1 = String(s1.venue || '')
    .trim()
    .toUpperCase();
  const v2 = String(s2.venue || '')
    .trim()
    .toUpperCase();
  const sameVenue = v1 === v2;

  const n1 = s1.seats !== '' && s1.seats != null ? Number(s1.seats) : null;
  const n2 = s2.seats !== '' && s2.seats != null ? Number(s2.seats) : null;
  let hasSeatsForTwo = true;
  if (n1 !== null && n2 !== null) {
    hasSeatsForTwo = Math.min(n1, n2) >= 2;
  } else if (n1 !== null) {
    hasSeatsForTwo = n1 >= 2;
  } else if (n2 !== null) {
    hasSeatsForTwo = n2 >= 2;
  }

  if (sameFac && sameVenue && hasSeatsForTwo) {
    return {
      status: 'together',
      together: true,
      sameFaculty: true,
      sameSlot: true,
      reason: '',
    };
  }

  let reason = '';
  if (sameFac && sameVenue && !hasSeatsForTwo) {
    reason = 'Section lacks available seats for two students (requires at least 2 seats).';
  } else if (!sameFac) {
    reason = 'Different faculty teaching at the same time.';
  } else if (!sameVenue) {
    reason = 'Different classroom venue.';
  }

  return {
    status: 'same_time',
    together: false,
    sameFaculty: sameFac,
    sameSlot: true,
    reason,
  };
}

function hasLunchViolation(low, high) {
  return (
    [12, 1536, 196608, 25165824, -1073741824].some((mask) => (low & mask) === mask) ||
    (high & 96) === 96
  );
}

function enrichBothAlternatives(sched1, sched2) {
  for (const item1 of sched1.chosen) {
    const code = normalizeCourseCode(item1.course.code);
    const item2 = sched2.chosen.find((x) => normalizeCourseCode(x.course.code) === code);
    if (!item2) {
      item1.bothAlternatives = [];
      continue;
    }
    const alts2 = item2.alternatives || [];
    const both = [];
    for (const s1 of item1.alternatives || []) {
      const match2 = alts2.find(
        (s2) =>
          slotBundle(s1, item1.course.scheduled) === slotBundle(s2, item2.course.scheduled) &&
          facultyKey(s1.faculty) === facultyKey(s2.faculty) &&
          String(s1.venue || '')
            .trim()
            .toUpperCase() ===
            String(s2.venue || '')
              .trim()
              .toUpperCase()
      );
      if (match2) {
        const n1 = s1.seats !== '' && s1.seats != null ? Number(s1.seats) : null;
        const n2 = match2.seats !== '' && match2.seats != null ? Number(match2.seats) : null;
        const seatsOk = (n1 === null || n1 >= 2) && (n2 === null || n2 >= 2);
        if (seatsOk) {
          both.push({
            ...s1,
            conservativeSeats: n1 !== null && n2 !== null ? Math.min(n1, n2) : (n1 ?? n2 ?? ''),
          });
        }
      }
    }
    item1.bothAlternatives = both;
    if (item2) {
      item2.bothAlternatives = both;
    }
  }
}

function recalculateMatchSummary(sched1, sched2, priorSummary = {}) {
  const commonCodes = new Set((priorSummary.courses || []).map((c) => normalizeCourseCode(c.code)));
  const updatedCourses = [];
  let together = 0,
    sameTime = 0,
    differentTime = 0;

  for (const courseInfo of priorSummary.courses || []) {
    const code = normalizeCourseCode(courseInfo.code);
    const item1 = sched1.chosen.find((x) => normalizeCourseCode(x.course.code) === code);
    const item2 = sched2.chosen.find((x) => normalizeCourseCode(x.course.code) === code);

    if (!item1 || !item2) {
      updatedCourses.push(courseInfo);
      continue;
    }

    if (item1.course.online || item2.course.online) {
      updatedCourses.push({
        ...courseInfo,
        status: 'online',
        reason: 'Marked online for one or both students.',
      });
      continue;
    }
    if (item1.course.scheduled === false || item2.course.scheduled === false) {
      const cl = classifySectionPair(item1.section, item2.section, false);
      updatedCourses.push({
        ...courseInfo,
        status: 'project',
        reason: 'Course has no weekly classes (Project).',
      });
      continue;
    }

    const cl = classifySectionPair(item1.section, item2.section, true);
    if (cl.status === 'together') together++;
    else if (cl.status === 'same_time') sameTime++;
    else differentTime++;

    updatedCourses.push({
      ...courseInfo,
      status: cl.status,
      reason: cl.reason,
      faculty1: item1.section?.faculty,
      faculty2: item2.section?.faculty,
    });
  }

  return {
    ...priorSummary,
    together,
    sameTime,
    differentTime,
    courses: updatedCourses,
  };
}

export function solveTwin(students, options = {}, limit = 5, hooks = {}) {
  const student1 = students[0] || { name: 'Student 1', courses: [] };
  const student2 = students[1] || { name: 'Student 2', courses: [] };
  const c1 = student1.courses || [];
  const c2 = student2.courses || [];
  const s1 = { ...(student1.settings || {}), ...(options.settings1 || {}) };
  const s2 = { ...(student2.settings || {}), ...(options.settings2 || {}) };
  const p1 = student1.preset || options.preset1 || 'compact';
  const p2 = student2.preset || options.preset2 || 'compact';

  limit = Math.min(100, Math.max(1, Number(limit) || 5));

  // Morning preference two-pass strategy
  const morning1 = p1 === 'morning' && !options._morningAttempt;
  const morning2 = p2 === 'morning' && !options._morningAttempt;
  if (morning1 || morning2) {
    const morningOpts = {
      ...options,
      _morningAttempt: true,
      _morning1: morning1,
      _morning2: morning2,
    };
    const morningTry = solveTwin(students, morningOpts, limit, hooks);
    if (morningTry.results.length) return morningTry;
    const fallback = solveTwin(students, { ...options, _morningAttempt: true }, limit, hooks);
    return {
      ...fallback,
      nodes: morningTry.nodes + fallback.nodes,
      elapsedMs: morningTry.elapsedMs + fallback.elapsedMs,
      morningFallback1: morning1,
      morningFallback2: morning2,
    };
  }

  const started = Date.now();
  const maxMilliseconds = Math.max(1, Number(options.maxMilliseconds) || 3000);
  const nodesMax = options.maxNodes || 250000;
  let lastProgress = started;

  const common = findCommonCourses(c1, c2);
  if (!common.length) {
    return {
      results: [],
      noCommonCourses: true,
      reason:
        'Your selected course lists do not share any courses. Edit your courses or continue with Individual FFCS.',
      nodes: 0,
      truncated: false,
      elapsedMs: Date.now() - started,
    };
  }

  const active1 = c1.filter(
    (c) => !c.online && (c.scheduled !== false || (c.sections || []).length)
  );
  const active2 = c2.filter(
    (c) => !c.online && (c.scheduled !== false || (c.sections || []).length)
  );

  const missing1 = active1.filter((c) => !eligibleSections(c).length).map((c) => c.code);
  const missing2 = active2.filter((c) => !eligibleSections(c).length).map((c) => c.code);
  if (missing1.length || missing2.length) {
    const parts = [];
    if (missing1.length)
      parts.push(
        `No eligible sections for ${missing1.join(', ')} for ${student1.name || 'Student 1'}`
      );
    if (missing2.length)
      parts.push(
        `No eligible sections for ${missing2.join(', ')} for ${student2.name || 'Student 2'}`
      );
    return {
      results: [],
      reason: parts.join('; ') + '. Check uploaded options or faculty preferences.',
      nodes: 0,
      truncated: false,
      elapsedMs: Date.now() - started,
    };
  }

  const prepared1 = new WeakMap();
  const prepared2 = new WeakMap();

  const commonCodesSet = new Set(common.map((x) => x.code));
  const commonScheduledCourses = common.filter((x) => x.isScheduled);
  const commonScheduledCodesSet = new Set(commonScheduledCourses.map((x) => x.code));

  function prepareStudentOptions(activeCourses, preparedMap) {
    const result = [];
    for (const c of activeCourses) {
      const eligible = eligibleSections(c);
      const isCommon = commonScheduledCodesSet.has(normalizeCourseCode(c.code));
      let options;
      if (isCommon) {
        // Common scheduled courses: DO NOT discard sections with different faculty,
        // because mutual faculty matching between student 1 and student 2 must be preserved!
        options = eligible;
      } else {
        // Unique course: compression by slotBundle + zone is safe
        const groups = new Map();
        for (const s of eligible) {
          const key =
            slotBundle(s, c.scheduled) + (c.scheduled === false ? '' : ':' + zone(s.venue));
          const prior = groups.get(key);
          if (
            !prior ||
            preferencePenalty(c, s) < preferencePenalty(c, prior) ||
            (preferencePenalty(c, s) === preferencePenalty(c, prior) &&
              Number(s.seats || 0) > Number(prior.seats || 0))
          )
            groups.set(key, s);
        }
        options = [...groups.values()].sort(
          (a, b) => preferencePenalty(c, a) - preferencePenalty(c, b)
        );
      }
      for (const section of options) {
        const items = sectionItems(c, section);
        let low = 0,
          high = 0;
        for (const x of items) {
          const bit = x.day * 7 + x.period;
          if (bit < 32) low |= 1 << bit;
          else high |= 1 << (bit - 32);
        }
        preparedMap.set(section, {
          items,
          low,
          high,
          penalty: preferencePenalty(c, section),
          signature: c.code + ':' + slotBundle(section, c.scheduled),
        });
      }
      result.push({ course: c, options });
    }
    return result;
  }

  const preparedList1 = prepareStudentOptions(active1, prepared1);
  const preparedList2 = prepareStudentOptions(active2, prepared2);

  // Unique scheduled courses for each student
  const uniqueScheduled1 = preparedList1
    .filter(
      (x) =>
        !commonScheduledCodesSet.has(normalizeCourseCode(x.course.code)) &&
        x.course.scheduled !== false
    )
    .sort((a, b) => a.options.length - b.options.length);

  const uniqueScheduled2 = preparedList2
    .filter(
      (x) =>
        !commonScheduledCodesSet.has(normalizeCourseCode(x.course.code)) &&
        x.course.scheduled !== false
    )
    .sort((a, b) => a.options.length - b.options.length);

  // Unscheduled or online courses for each student
  const unscheduled1 = c1
    .filter((c) => c.online || c.scheduled === false || !active1.includes(c))
    .map((c) => {
      const eligible = eligibleSections(c);
      return {
        course: c,
        section: eligible[0] || { slots: 'NIL', venue: 'NIL', faculty: 'NIL', seats: '' },
      };
    });

  const unscheduled2 = c2
    .filter((c) => c.online || c.scheduled === false || !active2.includes(c))
    .map((c) => {
      const eligible = eligibleSections(c);
      return {
        course: c,
        section: eligible[0] || { slots: 'NIL', venue: 'NIL', faculty: 'NIL', seats: '' },
      };
    });

  // Prepare candidate pairs for each common scheduled course
  const commonPairsList = commonScheduledCourses
    .map((comm) => {
      const pCourse1 = preparedList1.find((x) => normalizeCourseCode(x.course.code) === comm.code);
      const pCourse2 = preparedList2.find((x) => normalizeCourseCode(x.course.code) === comm.code);
      if (!pCourse1 || !pCourse2) return null;

      const togetherPairs = [];
      const sameTimeGroups = new Map();
      const diffTimeGroups = new Map();

      for (const s1 of pCourse1.options) {
        for (const s2 of pCourse2.options) {
          const cl = classifySectionPair(s1, s2, true);
          const pen1 = prepared1.get(s1).penalty;
          const pen2 = prepared2.get(s2).penalty;
          const candidate = {
            s1,
            s2,
            classification: cl,
            penalty1: pen1,
            penalty2: pen2,
          };

          if (cl.together) {
            // Retain every mutually eligible shared-faculty candidate
            togetherPairs.push(candidate);
          } else if (cl.status === 'same_time') {
            // Compress non-together same-timing candidates by slot bundle & building zones
            const key = slotBundle(s1, true) + ':' + zone(s1.venue) + ':' + zone(s2.venue);
            const prior = sameTimeGroups.get(key);
            if (!prior || pen1 + pen2 < prior.penalty1 + prior.penalty2) {
              sameTimeGroups.set(key, candidate);
            }
          } else {
            // Compress different-timing candidates by slot bundles & building zones
            const key =
              slotBundle(s1, true) +
              ':' +
              zone(s1.venue) +
              '||' +
              slotBundle(s2, true) +
              ':' +
              zone(s2.venue);
            const prior = diffTimeGroups.get(key);
            if (!prior || pen1 + pen2 < prior.penalty1 + prior.penalty2) {
              diffTimeGroups.set(key, candidate);
            }
          }
        }
      }

      const pairs = [...togetherPairs, ...sameTimeGroups.values(), ...diffTimeGroups.values()];

      pairs.sort((a, b) => {
        const typeOrder = { together: 0, same_time: 1, different_time: 2 };
        const dType = typeOrder[a.classification.status] - typeOrder[b.classification.status];
        if (dType !== 0) return dType;
        const penA = a.penalty1 + a.penalty2;
        const penB = b.penalty1 + b.penalty2;
        if (penA !== penB) return penA - penB;
        if (a.classification.together && b.classification.together) {
          const seatsA = Math.min(Number(a.s1.seats || 999), Number(a.s2.seats || 999));
          const seatsB = Math.min(Number(b.s1.seats || 999), Number(b.s2.seats || 999));
          return seatsB - seatsA;
        }
        return 0;
      });

      return {
        code: comm.code,
        course1: pCourse1.course,
        course2: pCourse2.course,
        pairs,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.pairs.length - b.pairs.length);

  const bus1 = s1.bus || p1 === 'bus';
  const deadline1 = deadlineFor(s1);
  const bus2 = s2.bus || p2 === 'bus';
  const deadline2 = deadlineFor(s2);

  let nodes = 0;
  let truncated = false;
  const pool = new Map();
  const poolLimit = Math.max(128, limit * 12);
  let maxTogetherFound = -1;

  function findUniqueCompletions(
    uniqueList,
    baseLow,
    baseHigh,
    baseItems,
    basePen,
    settings,
    preset,
    isMorningOnly,
    deadline,
    isBus,
    preparedMap
  ) {
    const completions = [];
    function search(k, low, high, items, pen, chosen) {
      if (completions.length >= 3) return;
      if (k === uniqueList.length) {
        const m = metrics(items);
        const score = scoreSchedule(items, m, pen, settings, preset);
        completions.push({ chosen, items, metrics: m, score });
        return;
      }
      const { course, options } = uniqueList[k];
      for (const section of options) {
        const p = preparedMap.get(section);
        if (low & p.low || high & p.high) continue;
        if (isBus && p.items.some((x) => END[x.period] > deadline)) continue;
        if (isMorningOnly && p.items.some((x) => END[x.period] > 795)) continue;
        if (preset === 'evening' && p.items.some((x) => START[x.period] < 795)) continue;
        const nextLow = low | p.low;
        const nextHigh = high | p.high;
        if (settings.lunch !== false && hasLunchViolation(nextLow, nextHigh)) continue;
        search(k + 1, nextLow, nextHigh, [...items, ...p.items], pen + p.penalty, [
          ...chosen,
          { course, section },
        ]);
      }
    }
    search(0, baseLow, baseHigh, baseItems, basePen, []);
    return completions;
  }

  function visitCommon(
    k,
    chosen1,
    chosen2,
    items1,
    items2,
    low1,
    high1,
    low2,
    high2,
    penalty1,
    penalty2,
    matchedTogether,
    matchedSameTime
  ) {
    if (++nodes > nodesMax) {
      truncated = true;
      return;
    }
    if ((nodes & 255) === 0) {
      const now = Date.now();
      if (now - started >= maxMilliseconds) {
        truncated = true;
        return;
      }
      if (now - lastProgress >= 200) {
        lastProgress = now;
        hooks.onProgress?.({ nodes, found: pool.size, bestMatch: maxTogetherFound });
      }
    }

    if (k < commonPairsList.length && maxTogetherFound > 0) {
      const remaining = commonPairsList.length - k;
      if (matchedTogether + remaining < maxTogetherFound) return;
    }

    if (k === commonPairsList.length) {
      // Find unique completions for student 1
      const comp1List = findUniqueCompletions(
        uniqueScheduled1,
        low1,
        high1,
        items1,
        penalty1,
        s1,
        p1,
        options._morning1,
        deadline1,
        bus1,
        prepared1
      );
      if (!comp1List.length) return;

      // Find unique completions for student 2
      const comp2List = findUniqueCompletions(
        uniqueScheduled2,
        low2,
        high2,
        items2,
        penalty2,
        s2,
        p2,
        options._morning2,
        deadline2,
        bus2,
        prepared2
      );
      if (!comp2List.length) return;

      const comp1 = comp1List[0];
      const comp2 = comp2List[0];

      const fullChosen1 = [...chosen1, ...comp1.chosen, ...unscheduled1];
      const fullChosen2 = [...chosen2, ...comp2.chosen, ...unscheduled2];

      const sig1 = fullChosen1
        .filter(
          (x) => x.course.scheduled !== false && String(x.section.slots).toUpperCase() !== 'NIL'
        )
        .map((x) => x.course.code + ':' + slotBundle(x.section, true))
        .sort()
        .join('|');

      const sig2 = fullChosen2
        .filter(
          (x) => x.course.scheduled !== false && String(x.section.slots).toUpperCase() !== 'NIL'
        )
        .map((x) => x.course.code + ':' + slotBundle(x.section, true))
        .sort()
        .join('|');

      const pairSig = sig1 + '||' + sig2;
      const pairedScore =
        -(matchedTogether * 1000000) - matchedSameTime * 10000 + comp1.score + comp2.score;

      const candidate = {
        chosen1: fullChosen1,
        chosen2: fullChosen2,
        matchedTogether,
        matchedSameTime,
        pairedScore,
        pairSig,
      };

      const prev = pool.get(pairSig);
      if (!prev || candidate.pairedScore < prev.pairedScore) {
        pool.set(pairSig, candidate);
        if (matchedTogether > maxTogetherFound) {
          maxTogetherFound = matchedTogether;
        }
      }

      if (pool.size > poolLimit * 2) {
        const sorted = [...pool.values()].sort((a, b) => a.pairedScore - b.pairedScore);
        pool.clear();
        for (const entry of sorted.slice(0, poolLimit)) {
          pool.set(entry.pairSig, entry);
        }
      }
      return;
    }

    const item = commonPairsList[k];
    for (const pair of item.pairs) {
      if (truncated) return;

      const p1Info = prepared1.get(pair.s1);
      const p2Info = prepared2.get(pair.s2);

      // Student 1 checks
      if (low1 & p1Info.low || high1 & p1Info.high) continue;
      if (bus1 && p1Info.items.some((x) => END[x.period] > deadline1)) continue;
      if (options._morning1 && p1Info.items.some((x) => END[x.period] > 795)) continue;
      if (p1 === 'evening' && p1Info.items.some((x) => START[x.period] < 795)) continue;
      const nextLow1 = low1 | p1Info.low;
      const nextHigh1 = high1 | p1Info.high;
      if (s1.lunch !== false && hasLunchViolation(nextLow1, nextHigh1)) continue;

      // Student 2 checks
      if (low2 & p2Info.low || high2 & p2Info.high) continue;
      if (bus2 && p2Info.items.some((x) => END[x.period] > deadline2)) continue;
      if (options._morning2 && p2Info.items.some((x) => END[x.period] > 795)) continue;
      if (p2 === 'evening' && p2Info.items.some((x) => START[x.period] < 795)) continue;
      const nextLow2 = low2 | p2Info.low;
      const nextHigh2 = high2 | p2Info.high;
      if (s2.lunch !== false && hasLunchViolation(nextLow2, nextHigh2)) continue;

      const isTogether = pair.classification.together;
      const isSameTime = pair.classification.status === 'same_time';

      visitCommon(
        k + 1,
        [...chosen1, { course: item.course1, section: pair.s1 }],
        [...chosen2, { course: item.course2, section: pair.s2 }],
        [...items1, ...p1Info.items],
        [...items2, ...p2Info.items],
        nextLow1,
        nextHigh1,
        nextLow2,
        nextHigh2,
        penalty1 + p1Info.penalty,
        penalty2 + p2Info.penalty,
        matchedTogether + (isTogether ? 1 : 0),
        matchedSameTime + (isSameTime ? 1 : 0)
      );
    }
  }

  visitCommon(0, [], [], [], [], 0, 0, 0, 0, 0, 0, 0, 0);

  const rankedCandidates = [...pool.values()].sort((a, b) => a.pairedScore - b.pairedScore);

  function buildMatchSummary(sched1, sched2) {
    const coursesSummary = [];
    let together = 0,
      sameTime = 0,
      differentTime = 0;

    for (const comm of common) {
      const code = comm.code;
      const item1 = sched1.chosen.find((x) => normalizeCourseCode(x.course.code) === code);
      const item2 = sched2.chosen.find((x) => normalizeCourseCode(x.course.code) === code);

      if (!item1 || !item2) {
        coursesSummary.push({
          code,
          name: comm.name,
          status: 'different_time',
          reason: 'Course not scheduled.',
        });
        differentTime++;
        continue;
      }

      if (comm.isOnline) {
        coursesSummary.push({
          code,
          name: comm.name,
          status: 'online',
          reason: 'Course is marked online (no weekly timetable classes).',
        });
        continue;
      }

      if (!comm.isScheduled) {
        coursesSummary.push({
          code,
          name: comm.name,
          status: 'project',
          reason: 'Course has no weekly classes (Project).',
        });
        continue;
      }

      const cl = classifySectionPair(item1.section, item2.section, true);
      if (cl.status === 'together') together++;
      else if (cl.status === 'same_time') sameTime++;
      else differentTime++;

      let factualReason = cl.reason;
      if (cl.status !== 'together' && !factualReason) {
        // Evaluate why it did not match together
        const sList1 = comm.course1.sections || [];
        const sList2 = comm.course2.sections || [];
        const mutual = sList1.filter((sA) =>
          sList2.some(
            (sB) =>
              slotBundle(sA, true) === slotBundle(sB, true) &&
              facultyKey(sA.faculty) === facultyKey(sB.faculty)
          )
        );
        if (!mutual.length) {
          factualReason = 'No mutually available section in uploaded faculty lists.';
        } else if (
          (Array.isArray(comm.course1.avoid) && comm.course1.avoid.length) ||
          (Array.isArray(comm.course2.avoid) && comm.course2.avoid.length)
        ) {
          factualReason = 'Avoided faculty restrictions excluded the shared section(s).';
        } else if (
          mutual.some((m) => {
            const seatsA = Number(m.seats || 0);
            return seatsA > 0 && seatsA < 2;
          })
        ) {
          factualReason =
            'Shared section lacks available seats for two students (requires at least 2 seats).';
        } else {
          factualReason =
            'Conflicting hard timing constraints (clash with required courses, lunch break, or bus deadline).';
        }
      }

      coursesSummary.push({
        code,
        name: comm.name,
        status: cl.status,
        reason: factualReason,
        faculty1: item1.section?.faculty,
        faculty2: item2.section?.faculty,
      });
    }

    return {
      totalCommon: common.length,
      commonScheduled: commonScheduledCourses.length,
      commonUnscheduled: common.length - commonScheduledCourses.length,
      together,
      sameTime,
      differentTime,
      isMaxPossible: !truncated,
      courses: coursesSummary,
    };
  }

  // Consistent routine selection across paired candidates:
  const selectedPairs = [];
  if (rankedCandidates.length) {
    const bestPair = rankedCandidates[0];
    selectedPairs.push(bestPair);

    let targetLow1 = 0,
      targetHigh1 = 0;
    for (const x of bestPair.chosen1) {
      const p = prepared1.get(x.section);
      if (p) {
        targetLow1 |= p.low;
        targetHigh1 |= p.high;
      }
    }

    let targetLow2 = 0,
      targetHigh2 = 0;
    for (const x of bestPair.chosen2) {
      const p = prepared2.get(x.section);
      if (p) {
        targetLow2 |= p.low;
        targetHigh2 |= p.high;
      }
    }

    const pattern1 = dailyPattern(scheduleFrom(bestPair.chosen1, s1, p1));
    const pattern2 = dailyPattern(scheduleFrom(bestPair.chosen2, s2, p2));

    // Explicit search for compatible subject swaps that preserve each student's exact winning routine
    const routineSwaps = [];
    const fixedCommon = commonPairsList
      .map((item) => ({
        ...item,
        pairs: item.pairs.filter((pair) => {
          const p1Info = prepared1.get(pair.s1);
          const p2Info = prepared2.get(pair.s2);
          if (!p1Info || !p2Info) return false;
          if ((p1Info.low & ~targetLow1) !== 0 || (p1Info.high & ~targetHigh1) !== 0) return false;
          if ((p2Info.low & ~targetLow2) !== 0 || (p2Info.high & ~targetHigh2) !== 0) return false;
          return true;
        }),
      }))
      .sort((a, b) => a.pairs.length - b.pairs.length);

    const fixedUnique1 = uniqueScheduled1
      .map((item) => ({
        ...item,
        options: item.options.filter((s) => {
          const p = prepared1.get(s);
          return p && (p.low & ~targetLow1) === 0 && (p.high & ~targetHigh1) === 0;
        }),
      }))
      .sort((a, b) => a.options.length - b.options.length);

    const fixedUnique2 = uniqueScheduled2
      .map((item) => ({
        ...item,
        options: item.options.filter((s) => {
          const p = prepared2.get(s);
          return p && (p.low & ~targetLow2) === 0 && (p.high & ~targetHigh2) === 0;
        }),
      }))
      .sort((a, b) => a.options.length - b.options.length);

    const canDoRoutineSwaps =
      limit > 1 &&
      fixedCommon.every((x) => x.pairs.length > 0) &&
      fixedUnique1.every((x) => x.options.length > 0) &&
      fixedUnique2.every((x) => x.options.length > 0);

    if (canDoRoutineSwaps) {
      const routineDeadline = Date.now() + 250;
      let routineAttempts = 0;
      const seenSwapSigs = new Set([bestPair.pairSig]);

      function searchRoutineUnique(
        uniqueList,
        baseLow,
        baseHigh,
        baseItems,
        basePen,
        prepMap,
        targetLow,
        targetHigh
      ) {
        const results = [];
        function rec(k, low, high, items, pen, chosen) {
          if (results.length >= 2 || ++routineAttempts > 15000 || Date.now() > routineDeadline)
            return;
          if (k === uniqueList.length) {
            if (low === targetLow && high === targetHigh) {
              const m = metrics(items);
              results.push({ chosen, items, metrics: m, pen });
            }
            return;
          }
          const { course, options } = uniqueList[k];
          for (const s of options) {
            const p = prepMap.get(s);
            if (low & p.low || high & p.high) continue;
            rec(k + 1, low | p.low, high | p.high, [...items, ...p.items], pen + p.penalty, [
              ...chosen,
              { course, section: s },
            ]);
          }
        }
        rec(0, baseLow, baseHigh, baseItems, basePen, []);
        return results;
      }

      function searchRoutine(
        k,
        chosen1,
        chosen2,
        items1,
        items2,
        low1,
        high1,
        low2,
        high2,
        pen1,
        pen2,
        together,
        sameTime
      ) {
        if (routineSwaps.length >= 2 || ++routineAttempts > 15000 || Date.now() > routineDeadline)
          return;
        if (together + (fixedCommon.length - k) < bestPair.matchedTogether) return;

        if (k === fixedCommon.length) {
          const comp1List = searchRoutineUnique(
            fixedUnique1,
            low1,
            high1,
            items1,
            pen1,
            prepared1,
            targetLow1,
            targetHigh1
          );
          if (!comp1List.length) return;
          const comp2List = searchRoutineUnique(
            fixedUnique2,
            low2,
            high2,
            items2,
            pen2,
            prepared2,
            targetLow2,
            targetHigh2
          );
          if (!comp2List.length) return;

          const c1 = comp1List[0];
          const c2 = comp2List[0];
          const full1 = [...chosen1, ...c1.chosen, ...unscheduled1];
          const full2 = [...chosen2, ...c2.chosen, ...unscheduled2];

          const sig1 = full1
            .filter(
              (x) => x.course.scheduled !== false && String(x.section.slots).toUpperCase() !== 'NIL'
            )
            .map((x) => x.course.code + ':' + slotBundle(x.section, true))
            .sort()
            .join('|');
          const sig2 = full2
            .filter(
              (x) => x.course.scheduled !== false && String(x.section.slots).toUpperCase() !== 'NIL'
            )
            .map((x) => x.course.code + ':' + slotBundle(x.section, true))
            .sort()
            .join('|');
          const pairSig = sig1 + '||' + sig2;

          if (!seenSwapSigs.has(pairSig)) {
            seenSwapSigs.add(pairSig);
            const m1 = metrics([...items1, ...c1.items]);
            const m2 = metrics([...items2, ...c2.items]);
            const score1 = scoreSchedule([...items1, ...c1.items], m1, pen1 + c1.pen, s1, p1);
            const score2 = scoreSchedule([...items2, ...c2.items], m2, pen2 + c2.pen, s2, p2);
            const pairedScore = -(together * 1000000) - sameTime * 10000 + score1 + score2;
            routineSwaps.push({
              chosen1: full1,
              chosen2: full2,
              matchedTogether: together,
              matchedSameTime: sameTime,
              pairedScore,
              pairSig,
            });
          }
          return;
        }

        const item = fixedCommon[k];
        for (const pair of item.pairs) {
          const p1Info = prepared1.get(pair.s1);
          const p2Info = prepared2.get(pair.s2);
          if (low1 & p1Info.low || high1 & p1Info.high) continue;
          if (low2 & p2Info.low || high2 & p2Info.high) continue;

          searchRoutine(
            k + 1,
            [...chosen1, { course: item.course1, section: pair.s1 }],
            [...chosen2, { course: item.course2, section: pair.s2 }],
            [...items1, ...p1Info.items],
            [...items2, ...p2Info.items],
            low1 | p1Info.low,
            high1 | p1Info.high,
            low2 | p2Info.low,
            high2 | p2Info.high,
            pen1 + p1Info.penalty,
            pen2 + p2Info.penalty,
            together + (pair.classification.together ? 1 : 0),
            sameTime + (pair.classification.status === 'same_time' ? 1 : 0)
          );
        }
      }

      searchRoutine(0, [], [], [], [], 0, 0, 0, 0, 0, 0, 0, 0);
    }

    // Add discovered routine swaps as Options 2 & 3
    routineSwaps.sort((a, b) => a.pairedScore - b.pairedScore);
    for (const swap of routineSwaps.slice(0, Math.min(2, limit - 1))) {
      selectedPairs.push(swap);
    }

    // Fill any remaining options up to limit from general pool (Option 4 and 5 provide broader timing flexibility)
    for (const pair of rankedCandidates.slice(1)) {
      if (selectedPairs.length >= limit) break;
      if (!selectedPairs.some((p) => p.pairSig === pair.pairSig)) {
        selectedPairs.push(pair);
      }
    }
  }

  const finalResults = selectedPairs.map((pair) => {
    const sched1 = scheduleFrom(pair.chosen1, s1, p1);
    const sched2 = scheduleFrom(pair.chosen2, s2, p2);
    sched1.name = student1.name || 'You';
    sched2.name = student2.name || 'Friend';

    enrichBothAlternatives(sched1, sched2);
    const matchSummary = buildMatchSummary(sched1, sched2);

    return {
      student1: sched1,
      student2: sched2,
      matchSummary,
      matchedTogether: matchSummary.together,
      matchedSameTime: matchSummary.sameTime,
      isMaxPossible: matchSummary.isMaxPossible,
      pairedScore: pair.pairedScore,
      pairSig: pair.pairSig,
    };
  });

  return {
    results: finalResults,
    nodes,
    truncated,
    elapsedMs: Date.now() - started,
    noCommonCourses: false,
    reason: finalResults.length
      ? ''
      : truncated
        ? 'Search limit reached before a paired timetable was found. Try adjusting preferences or courses.'
        : 'No clash-free paired timetable meets all rules for both students. Check overlapping slots, avoided faculty, lunch or bus deadlines.',
  };
}

export function changeTwinFaculty(
  pair,
  studentIndex,
  courseCode,
  nextSectionId,
  changeBoth = false,
  settings1 = {},
  settings2 = {},
  preset1 = 'compact',
  preset2 = 'compact'
) {
  const norm = normalizeCourseCode(courseCode);
  const targetSched1 = pair.student1;
  const targetSched2 = pair.student2;

  if (changeBoth) {
    const item1 = targetSched1.chosen.find((x) => normalizeCourseCode(x.course.code) === norm);
    const item2 = targetSched2.chosen.find((x) => normalizeCourseCode(x.course.code) === norm);
    if (!item1 || !item2) throw Error('Common course not found in paired timetable.');

    const next1 = eligibleSections(item1.course).find((s) => s.id === nextSectionId);
    if (!next1)
      throw Error(
        'Selected faculty option is not eligible for ' + (pair.student1.name || 'Student 1')
      );

    const next2 = eligibleSections(item2.course).find(
      (s) =>
        slotBundle(s, item2.course.scheduled) === slotBundle(next1, item1.course.scheduled) &&
        facultyKey(s.faculty) === facultyKey(next1.faculty) &&
        String(s.venue || '')
          .trim()
          .toUpperCase() ===
          String(next1.venue || '')
            .trim()
            .toUpperCase()
    );
    if (!next2)
      throw Error(
        'Corresponding section not eligible or available for ' + (pair.student2.name || 'Student 2')
      );

    const n1 = next1.seats !== '' && next1.seats != null ? Number(next1.seats) : null;
    const n2 = next2.seats !== '' && next2.seats != null ? Number(next2.seats) : null;
    if ((n1 !== null && n1 < 2) || (n2 !== null && n2 < 2)) {
      throw Error(
        'Selected faculty option does not have at least 2 available seats for both students.'
      );
    }

    const newSched1 = scheduleFrom(
      targetSched1.chosen.map((x) =>
        normalizeCourseCode(x.course.code) === norm ? { course: x.course, section: next1 } : x
      ),
      settings1,
      preset1
    );
    const newSched2 = scheduleFrom(
      targetSched2.chosen.map((x) =>
        normalizeCourseCode(x.course.code) === norm ? { course: x.course, section: next2 } : x
      ),
      settings2,
      preset2
    );
    newSched1.name = targetSched1.name;
    newSched2.name = targetSched2.name;

    enrichBothAlternatives(newSched1, newSched2);
    const updatedSummary = recalculateMatchSummary(newSched1, newSched2, pair.matchSummary);
    return {
      ...pair,
      student1: newSched1,
      student2: newSched2,
      matchSummary: updatedSummary,
      matchedTogether: updatedSummary.together,
      matchedSameTime: updatedSummary.sameTime,
      isMaxPossible: updatedSummary.isMaxPossible,
    };
  } else {
    if (studentIndex === 0) {
      const item1 = targetSched1.chosen.find((x) => normalizeCourseCode(x.course.code) === norm);
      if (!item1) throw Error('Course not found in Student 1 timetable.');
      const next1 = eligibleSections(item1.course).find((s) => s.id === nextSectionId);
      if (
        !next1 ||
        slotBundle(next1, item1.course.scheduled) !==
          slotBundle(item1.section, item1.course.scheduled)
      ) {
        throw Error('Choose an eligible faculty with the same time slots.');
      }
      const newSched1 = scheduleFrom(
        targetSched1.chosen.map((x) =>
          normalizeCourseCode(x.course.code) === norm ? { course: x.course, section: next1 } : x
        ),
        settings1,
        preset1
      );
      newSched1.name = targetSched1.name;
      enrichBothAlternatives(newSched1, targetSched2);
      const updatedSummary = recalculateMatchSummary(newSched1, targetSched2, pair.matchSummary);
      return {
        ...pair,
        student1: newSched1,
        matchSummary: updatedSummary,
        matchedTogether: updatedSummary.together,
        matchedSameTime: updatedSummary.sameTime,
        isMaxPossible: updatedSummary.isMaxPossible,
      };
    } else {
      const item2 = targetSched2.chosen.find((x) => normalizeCourseCode(x.course.code) === norm);
      if (!item2) throw Error('Course not found in Student 2 timetable.');
      const next2 = eligibleSections(item2.course).find((s) => s.id === nextSectionId);
      if (
        !next2 ||
        slotBundle(next2, item2.course.scheduled) !==
          slotBundle(item2.section, item2.course.scheduled)
      ) {
        throw Error('Choose an eligible faculty with the same time slots.');
      }
      const newSched2 = scheduleFrom(
        targetSched2.chosen.map((x) =>
          normalizeCourseCode(x.course.code) === norm ? { course: x.course, section: next2 } : x
        ),
        settings2,
        preset2
      );
      newSched2.name = targetSched2.name;
      enrichBothAlternatives(targetSched1, newSched2);
      const updatedSummary = recalculateMatchSummary(targetSched1, newSched2, pair.matchSummary);
      return {
        ...pair,
        student2: newSched2,
        matchSummary: updatedSummary,
        matchedTogether: updatedSummary.together,
        matchedSameTime: updatedSummary.sameTime,
        isMaxPossible: updatedSummary.isMaxPossible,
      };
    }
  }
}

export function parseCatalogue(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line
      .trim()
      .match(
        /^\d+\s+(\d{2}[A-Z]{3})\s+([A-Z]{3}\d{4})\s+(.+?)\s+(LTP|LT|LP|PJ|P)\s+(\d+)\s+(\w+)\s*$/
      );
    if (m) {
      const [, batch, code, name, type, credits, category] = m;
      rows.push({ batch, code, name, type, credits: Number(credits), category });
    }
  }
  return rows;
}
