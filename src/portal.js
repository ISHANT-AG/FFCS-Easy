// Read course rows only. Portal navigation, personal details and existing clash
// labels belong to the source session and are never scheduling instructions.
export function parsePortalText(text, selectedCourse = null) {
  if (!text.trim())
    throw Error(
      'No readable text found. Save the faculty page as a text PDF; image-only PDFs are not supported.'
    );
  // Portal exports use either a descriptive heading, a short LP/LT code,
  // or a separate course-code/title table on the Modify Slot screen.
  let header =
    text.match(
      /\b([A-Z]{3}\d{4})\s*-\s*(.+?)\s*-\s*(?:Lecture|Practical|Tutorial|Theory|Project|LP\b|LT[PJ]?\b|PJ\b|P\b|[^\n]+?\s+0\s+0\s+0\s+1)/i
    ) ||
    text.match(/Course Code:\s*([A-Z]{3}\d{4})\s+Course Title:\s*(.+?)(?:\s+Course Type:|\n|$)/i) ||
    text.match(/Course Code\s+Course Title\s*\n\s*([A-Z]{3}\d{4})\s+([^\n]+)/i) ||
    text.match(
      /Course Owner\s+Course Code\s+Course Title[^\n]*\n\s*\S+\s+([A-Z]{3}\d{4})\s+(.+?)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+(?:\s|$)/i
    );
  if (!header && selectedCourse?.code && /^[A-F][12][1-4](?:\s|\+)/im.test(text)) {
    const foundCode = text.match(/\b[A-Z]{3}\d{4}\b/i)?.[0]?.toUpperCase();
    if (foundCode && foundCode !== selectedCourse.code.toUpperCase())
      throw Error('This PDF is for ' + foundCode + '. Upload it under that course.');
    header = ['', selectedCourse.code, selectedCourse.name || selectedCourse.code];
  }
  if (!header) throw Error('Could not find the course code and title in this PDF.');
  const code = header[1].toUpperCase(),
    name = header[2].trim(),
    sections = [];
  const slotStart = /^([A-F][12][1-4](?:\s*\+\s*[A-F][12][1-4])*)(?:\s|$)/i;
  const hasSeatColumn = /\b(?:Available|Available Seats|Seats)\b/i.test(text);
  const hasSeatBreakdown = /Total\s+Seats\s+Allot(?:t)?ed(?:\s+Seats)?\s+Available(?:\s+Seats)?/i.test(text);
  const records = [];
  let current = [];
  const flush = () => {
    if (current.length) records.push(current.join(' '));
    current = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(
      /^(?:Lecture|Practical|Tutorial|Theory|Project)\b.*?\s+(?=[A-F][12][1-4](?:\s|\+))/i,
      ''
    );
    if (slotStart.test(line)) {
      flush();
      current = [line];
    } else if (
      /^(Copyright|Regular$|Course Option|Register\b|Update\b|Go Back|Slot\s+Venue|Select Course|https?:|\d{2}\/\d{2}\/\d{4}|VTOP\b|Text transcription|Course Code|\d+\s+options transcribed|Student-prepared dataset)/i.test(
        line
      )
    )
      flush();
    else if (current.length && line) current.push(line);
    if (
      current.length &&
      /\s(?:NONE|Clashed with\s+.*?|Similar to Registered Slot|Registered Slot)\s+\d+(?:\s+Selected)?$/i.test(
        current.join(' ')
      )
    )
      flush();
  }
  flush();
  let skippedRows = 0;
  for (let record of records) {
    record = record
      .replace(/Copyright\s+©?\s*2020\s+Software Development Cell\s*\(VIT\)/gi, '')
      .replace(/Copyright[\s\S]*$/i, '')
      .trim();
    const row = record.match(/^([A-F][12][1-4](?:\s*\+\s*[A-F][12][1-4])*)\s+(\S+)\s+(.+)$/i);
    if (!row) {
      skippedRows++;
      continue;
    }
    let faculty = row[3].trim(),
      seats = '',
      parsedBreakdown = false;
    if (hasSeatBreakdown) {
      // Student-prepared tables can show Total, Allotted and Available as
      // separate columns, with an em dash for an unreadable seat value.
      const breakdown = faculty.match(/\s+(\d+)\s+(\d+|[—–-])\s+(\d+|[—–-])\s*$/);
      if (breakdown) {
        parsedBreakdown = true;
        seats = /^\d+$/.test(breakdown[3]) ? breakdown[3] : '';
        faculty = faculty.slice(0, breakdown.index).replace(/\s+[—–-]\s*$/, '').trim();
      }
    }
    const full = /\s+(?:Full|No seats(?: available)?|Sold out)\s*$/i.test(faculty);
    if (full) {
      faculty = faculty.replace(/\s+(?:Full|No seats(?: available)?|Sold out)\s*$/i, '').trim();
      seats = '0';
    }
    const status = faculty.match(
      /\s+(NONE\b|Clashed with\b|Similar to Registered Slot\b|Registered Slot\b)/i
    );
    if (status) {
      const tail = faculty
        .slice(status.index)
        .replace(/\s+Selected\s*$/i, '')
        .trim();
      if (!full && !parsedBreakdown) seats = tail.match(/\b(\d+)\s*$/)?.[1] ?? '';
      faculty = faculty.slice(0, status.index).trim();
    } else if (hasSeatColumn && !full && !parsedBreakdown) {
      // A number in a faculty name (FACE TRAINER 2) is not a seat count.
      const seat = faculty.match(/\s+(\d+)\s*(?:Selected)?\s*$/i);
      if (seat && !/^FACE\s+TRAINER\s+\d+$/i.test(faculty)) {
        seats = seat[1];
        faculty = faculty.slice(0, seat.index).trim();
      }
    }
    if (!faculty || !/[A-Za-z]/.test(faculty)) {
      skippedRows++;
      continue;
    }
    sections.push({
      slots: row[1].replace(/\s/g, '').toUpperCase(),
      venue: row[2],
      faculty,
      seats,
    });
  }
  for (const raw of text.split('\n')) {
    const project = raw
      .trim()
      .match(/^([A-Z]{3}\d{4})\s*-\s*.+?\s*-\s*(.+?)\s+0\s+0\s+0\s+1\s+1\s+\w+\s+(\d+)\s*$/);
    if (project && project[1] === code)
      sections.push({ slots: 'NIL', venue: 'NIL', faculty: project[2].trim(), seats: project[3] });
  }
  if (!sections.length) throw Error('Course found, but no supported section rows could be read.');
  return { code, name, scheduled: sections.some((s) => s.slots !== 'NIL'), sections, skippedRows };
}

export function parseScreenshotText(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(
      /\b([A-F][12][1-4](?:\s*\+\s*[A-F][12][1-4])*)\s+(\S+)\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/i
    );
    if (m)
      rows.push({
        slots: m[1].replace(/\s/g, '').toUpperCase(),
        venue: m[2],
        faculty: m[3].trim(),
        seats: m[6],
      });
    else {
      const p = line.match(
        /\bNIL\s+NIL\s+(.+?)\s+(?:(?:Similar to Registered Slot|Registered Slot)\s+)?(\d+)\s+(\d+)\s+(\d+)\s*$/i
      );
      if (p) rows.push({ slots: 'NIL', venue: 'NIL', faculty: p[1].trim(), seats: p[4] });
    }
  }
  return rows;
}
