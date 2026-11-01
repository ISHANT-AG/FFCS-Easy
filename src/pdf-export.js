import { DAYS, TIMES, eligibleSections, slotBundle } from './engine.js';
const ascii = (s) =>
  String(s ?? '')
    .replace(/[–−]/g, '-')
    .replace(/·/g, ' / ')
    .replace(/[^\x20-\x7E]/g, '');
let library;
async function loadPdfLibrary() {
  if (globalThis.jspdf?.jsPDF) return globalThis.jspdf.jsPDF;
  if (!library)
    library = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';
      script.onload = () => {
        if (globalThis.jspdf?.jsPDF) resolve(globalThis.jspdf.jsPDF);
        else {
          library = null;
          reject(Error('Could not load PDF export. Please retry.'));
        }
      };
      script.onerror = () => {
        library = null;
        reject(Error('Could not load PDF export. Check your connection and retry.'));
      };
      document.head.append(script);
    });
  return library;
}
export function assertExportEligible(schedule, courses) {
  for (const chosen of schedule.chosen) {
    const current = courses ? courses.find((c) => c.code === chosen.course.code) : chosen.course;
    if (!current) {
      throw Error(
        'A selected course has been removed. Regenerate your timetable before exporting.'
      );
    }
    const isUnscheduled = current.scheduled === false || current.online === true;
    const isNilSection =
      !chosen.section ||
      String(chosen.section.slots).toUpperCase() === 'NIL' ||
      String(chosen.section.faculty).toUpperCase() === 'NIL' ||
      String(chosen.section.venue).toUpperCase() === 'NIL';

    // Optional project or online course without uploaded faculty sections is a legitimate placeholder
    if (isUnscheduled && isNilSection && (!current.sections || current.sections.length === 0)) {
      continue;
    }

    const eligible = eligibleSections(current);
    const section = eligible.find((s) => s.id === chosen.section?.id);
    if (
      !section ||
      slotBundle(section, current.scheduled) !==
        slotBundle(chosen.section, chosen.course.scheduled) ||
      section.faculty !== chosen.section.faculty ||
      section.venue !== chosen.section.venue
    )
      throw Error(
        'A selected faculty or section has changed or is no longer eligible. Regenerate your timetable before exporting.'
      );
  }
}
export function createTimetablePdf(JsPDF, schedule, { option = 1, courses } = {}) {
  assertExportEligible(schedule, courses);
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({
    title: 'FFCS easy - Timetable ' + option,
    subject: 'Selected timetable and faculty',
    creator: 'FFCS easy',
  });
  const margin = 10,
    top = 30,
    header = 9,
    rowHeight = 21,
    width = doc.internal.pageSize.getWidth() - margin * 2,
    timeWidth = 25,
    dayWidth = (width - timeWidth) / 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(36, 60, 49);
  doc.text('FFCS easy | Timetable ' + option, margin, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(85, 95, 90);
  doc.text(
    'Fall 2026-27  |  ' +
      schedule.metrics.gaps +
      ' gap slots  |  ' +
      schedule.metrics.travel +
      ' consecutive AB2 trips',
    margin,
    22
  );
  doc.setLineWidth(0.2);
  doc.setDrawColor(205, 214, 204);
  const cell = (x, y, w, h, fill) => {
    doc.setFillColor(...fill);
    doc.rect(x, y, w, h, 'FD');
  };
  cell(margin, top, timeWidth, header, [237, 243, 231]);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(36, 60, 49);
  doc.setFontSize(9);
  doc.text('Time', margin + timeWidth / 2, top + 5.8, { align: 'center' });
  DAYS.forEach((day, d) => {
    const x = margin + timeWidth + d * dayWidth;
    cell(x, top, dayWidth, header, [237, 243, 231]);
    doc.text(day, x + dayWidth / 2, top + 5.8, { align: 'center' });
  });
  const codes = [...new Set(schedule.items.map((i) => i.course))],
    colours = [
      [224, 231, 255],
      [254, 243, 199],
      [209, 250, 229],
      [237, 233, 254],
      [255, 228, 230],
      [207, 250, 254],
      [255, 237, 213],
      [250, 232, 255],
      [224, 242, 254],
      [236, 252, 203],
    ];
  TIMES.forEach((time, p) => {
    const y = top + header + p * rowHeight;
    cell(margin, y, timeWidth, rowHeight, [248, 249, 246]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(75, 85, 75);
    doc.text(ascii(time), margin + timeWidth / 2, y + rowHeight / 2 + 1, { align: 'center' });
    DAYS.forEach((_, d) => {
      const x = margin + timeWidth + d * dayWidth,
        event = schedule.items.find((i) => i.day === d && i.period === p);
      cell(
        x,
        y,
        dayWidth,
        rowHeight,
        event ? colours[codes.indexOf(event.course) % colours.length] : [255, 255, 255]
      );
      if (!event) return;
      doc.setTextColor(30, 47, 38);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(ascii(event.course), x + 2, y + 4.5);
      doc.setFont('helvetica', 'normal');
      let size = 8,
        lines;
      do {
        doc.setFontSize(size);
        lines = doc.splitTextToSize(ascii(event.faculty), dayWidth - 4);
        if (lines.length <= 3) break;
        size -= 0.5;
      } while (size > 5);
      doc.text(lines, x + 2, y + 8.5, { lineHeightFactor: 1.1 });
      doc.setFontSize(7.5);
      doc.setTextColor(70, 80, 70);
      doc.text(ascii(event.venue), x + 2, y + rowHeight - 2.5);
    });
  });
  const bottom = top + header + rowHeight * 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(90, 100, 90);
  doc.text(
    'Check current seats in FFCS before registration. Online courses are excluded from this timetable.',
    margin,
    bottom + 7
  );
  const projects = schedule.chosen.filter((x) => x.course.scheduled === false);
  if (projects.length) {
    const text =
      'No weekly classes: ' +
      projects
        .map((x) => {
          const fac =
            x.section?.faculty && String(x.section.faculty).toUpperCase() !== 'NIL'
              ? x.section.faculty
              : null;
          return fac ? `${x.course.code} (${fac})` : `${x.course.code} (Project)`;
        })
        .join('; ');
    doc.setFontSize(6.5);
    doc.text(doc.splitTextToSize(ascii(text), width), margin, bottom + 12);
  }
  return doc;
}

export function renderSchedulePage(
  doc,
  schedule,
  { option = 1, studentName = '', partnerName = '', matchSummary } = {}
) {
  const margin = 10,
    top = 30,
    header = 9,
    rowHeight = 21,
    width = doc.internal.pageSize.getWidth() - margin * 2,
    timeWidth = 25,
    dayWidth = (width - timeWidth) / 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(30, 58, 138); // Royal cobalt
  const title = studentName
    ? `FFCS easy · Timetable ${option} · ${studentName}`
    : `FFCS easy | Timetable ${option}`;
  doc.text(ascii(title), margin, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(85, 95, 90);

  let sub = `Fall 2026-27  |  ${schedule.metrics.gaps} gap slots  |  ${schedule.metrics.travel} consecutive AB2 trips`;
  if (matchSummary && matchSummary.together != null) {
    sub += `  |  Together in ${matchSummary.together} of ${matchSummary.commonScheduled} common courses`;
  }
  doc.text(ascii(sub), margin, 21);

  doc.setLineWidth(0.2);
  doc.setDrawColor(205, 214, 204);
  const cell = (x, y, w, h, fill) => {
    doc.setFillColor(...fill);
    doc.rect(x, y, w, h, 'FD');
  };

  cell(margin, top, timeWidth, header, [237, 243, 231]);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(36, 60, 49);
  doc.setFontSize(9);
  doc.text('Time', margin + timeWidth / 2, top + 5.8, { align: 'center' });
  DAYS.forEach((day, d) => {
    const x = margin + timeWidth + d * dayWidth;
    cell(x, top, dayWidth, header, [237, 243, 231]);
    doc.text(day, x + dayWidth / 2, top + 5.8, { align: 'center' });
  });

  const codes = [...new Set(schedule.items.map((i) => i.course))],
    colours = [
      [224, 231, 255],
      [254, 243, 199],
      [209, 250, 229],
      [237, 233, 254],
      [255, 228, 230],
      [207, 250, 254],
      [255, 237, 213],
      [250, 232, 255],
      [224, 242, 254],
      [236, 252, 203],
    ];

  // Map of together course codes
  const togetherCodes = new Set(
    (matchSummary?.courses || [])
      .filter((c) => c.status === 'together')
      .map((c) => c.code.toUpperCase())
  );

  TIMES.forEach((time, p) => {
    const y = top + header + p * rowHeight;
    cell(margin, y, timeWidth, rowHeight, [248, 249, 246]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(75, 85, 75);
    doc.text(ascii(time), margin + timeWidth / 2, y + rowHeight / 2 + 1, { align: 'center' });

    DAYS.forEach((_, d) => {
      const x = margin + timeWidth + d * dayWidth,
        event = schedule.items.find((i) => i.day === d && i.period === p);
      cell(
        x,
        y,
        dayWidth,
        rowHeight,
        event ? colours[codes.indexOf(event.course) % colours.length] : [255, 255, 255]
      );
      if (!event) return;

      const isTogether = togetherCodes.has(event.course.toUpperCase());

      doc.setTextColor(30, 47, 38);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text(ascii(event.course), x + 2, y + 4.5);

      if (isTogether) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.setTextColor(30, 58, 138); // Cobalt
        doc.text('[Together]', x + dayWidth - 2, y + 4.5, { align: 'right' });
      }

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 47, 38);
      let size = 7.5,
        lines;
      do {
        doc.setFontSize(size);
        lines = doc.splitTextToSize(ascii(event.faculty), dayWidth - 4);
        if (lines.length <= 3) break;
        size -= 0.5;
      } while (size > 5);
      doc.text(lines, x + 2, y + 8.5, { lineHeightFactor: 1.1 });

      doc.setFontSize(7);
      doc.setTextColor(70, 80, 70);
      doc.text(ascii(event.venue), x + 2, y + rowHeight - 2.5);
    });
  });

  const bottom = top + header + rowHeight * 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(90, 100, 90);
  doc.text(
    'Check current seats in FFCS before registration. Online courses are excluded from this timetable.',
    margin,
    bottom + 6
  );

  const projects = schedule.chosen.filter((x) => x.course.scheduled === false);
  if (projects.length) {
    const text =
      'No weekly classes: ' +
      projects
        .map((x) => {
          const fac =
            x.section?.faculty && String(x.section.faculty).toUpperCase() !== 'NIL'
              ? x.section.faculty
              : null;
          return fac ? `${x.course.code} (${fac})` : `${x.course.code} (Project)`;
        })
        .join('; ');
    doc.setFontSize(6.5);
    doc.text(doc.splitTextToSize(ascii(text), width), margin, bottom + 11);
  }
}

export function createTwinTimetablePdf(
  JsPDF,
  twinPair,
  { option = 1, which = 'both', courses1, courses2 } = {}
) {
  const sched1 = twinPair.student1;
  const sched2 = twinPair.student2;
  const name1 = sched1.name || 'You';
  const name2 = sched2.name || 'Friend';

  if (which === 'student1' || which === 'both') {
    assertExportEligible(sched1, courses1);
  }
  if (which === 'student2' || which === 'both') {
    assertExportEligible(sched2, courses2);
  }

  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const docTitle =
    which === 'student1'
      ? `FFCS easy - Timetable ${option} - ${name1}`
      : which === 'student2'
        ? `FFCS easy - Timetable ${option} - ${name2}`
        : `FFCS easy - Twin Timetable ${option} - ${name1} and ${name2}`;

  doc.setProperties({
    title: docTitle,
    subject: `Timetables for ${name1} and ${name2}`,
    creator: 'FFCS easy',
  });

  if (which === 'student1') {
    renderSchedulePage(doc, sched1, {
      option,
      studentName: name1,
      partnerName: name2,
      matchSummary: twinPair.matchSummary,
    });
  } else if (which === 'student2') {
    renderSchedulePage(doc, sched2, {
      option,
      studentName: name2,
      partnerName: name1,
      matchSummary: twinPair.matchSummary,
    });
  } else {
    // Both: Page 1 for Student 1, Page 2 for Student 2
    renderSchedulePage(doc, sched1, {
      option,
      studentName: name1,
      partnerName: name2,
      matchSummary: twinPair.matchSummary,
    });
    doc.addPage('a4', 'landscape');
    renderSchedulePage(doc, sched2, {
      option,
      studentName: name2,
      partnerName: name1,
      matchSummary: twinPair.matchSummary,
    });
  }

  return doc;
}

export async function downloadTimetablePdf(schedule, options = {}) {
  assertExportEligible(schedule, options.courses);
  const JsPDF = await loadPdfLibrary(),
    doc = createTimetablePdf(JsPDF, schedule, options);
  doc.save('FFCS-Timetable-' + (options.option || 1) + '.pdf');
}

export async function downloadTwinTimetablePdf(twinPair, options = {}) {
  const JsPDF = await loadPdfLibrary();
  const which = options.which || 'both';
  const doc = createTwinTimetablePdf(JsPDF, twinPair, options);
  const name1 = (twinPair.student1.name || 'Student1').replace(/[^a-zA-Z0-9_-]/g, '_');
  const name2 = (twinPair.student2.name || 'Student2').replace(/[^a-zA-Z0-9_-]/g, '_');
  let filename = `FFCS-Twin-Option-${options.option || 1}-${name1}-and-${name2}.pdf`;
  if (which === 'student1') {
    filename = `FFCS-Timetable-Option-${options.option || 1}-${name1}.pdf`;
  } else if (which === 'student2') {
    filename = `FFCS-Timetable-Option-${options.option || 1}-${name2}.pdf`;
  }
  doc.save(filename);
}
