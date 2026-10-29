// Read course rows only. Portal navigation, personal details and existing clash
// labels belong to the source session and are never scheduling instructions.
export function parsePortalText(text) {
 const header=text.match(/\b([A-Z]{3}\d{4})\s*-\s*(.+?)\s*-\s*(?:Lecture|[^\n]+?\s+0\s+0\s+0\s+1)/i);
 if(!header)throw Error('No recognised course heading in this PDF.');
 const code=header[1].toUpperCase(),name=header[2].trim(),sections=[];
 const weeklyPattern=/^([A-F][12][1-4](?:\s*\+\s*[A-F][12][1-4])*)\s+(\S+)\s+(.+?)\s+(?:NONE|Clashed with\s+.*?)\s+(\d+)(?:\s*Copyright.*)?$/i;
 const records=[];let current=[];
 const flush=()=>{if(current.length)records.push(current.join(' '));current=[];};
 for(const raw of text.split('\n')){
  const line=raw.trim();
  if(/^[A-F][12][1-4](?:\s*\+\s*[A-F][12][1-4])*(?:\s|$)/i.test(line)){flush();current=[line];}
  else if(/^(Copyright|Regular$|Course Option|Register\b|Go Back|Slot Venue|Select Course|https?:|\d{2}\/\d{2}\/\d{4})/i.test(line))flush();
  else if(current.length&&line)current.push(line);
  if(current.length&&weeklyPattern.test(current.join(' ')))flush();
 }
 flush();
 for(const record of records){
  const weekly=record.match(weeklyPattern);
  if(weekly)sections.push({slots:weekly[1].replace(/\s/g,'').toUpperCase(),venue:weekly[2],faculty:weekly[3].trim(),seats:weekly[4]});
 }
 if(records.length&&sections.length!==records.length)throw Error(`Could only read ${sections.length} of ${records.length} faculty rows. The list was not saved; please use a text PDF or correct the rows manually.`);
 for(const raw of text.split('\n')){
  const project=raw.trim().match(/^([A-Z]{3}\d{4})\s*-\s*.+?\s*-\s*(.+?)\s+0\s+0\s+0\s+1\s+1\s+\w+\s+(\d+)\s*$/);
  if(project&&project[1]===code)sections.push({slots:'NIL',venue:'NIL',faculty:project[2].trim(),seats:project[3]});
 }
 if(!sections.length)throw Error('Course found, but no supported section rows could be read.');
 return {code,name,scheduled:sections.some(s=>s.slots!=='NIL'),sections};
}

export function parseScreenshotText(text) {
 const rows=[];
 for(const line of text.split('\n')){
  const m=line.match(/\b([A-F][12][1-4](?:\s*\+\s*[A-F][12][1-4])*)\s+(\S+)\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/i);
  if(m)rows.push({slots:m[1].replace(/\s/g,'').toUpperCase(),venue:m[2],faculty:m[3].trim(),seats:m[6]});
  else {const p=line.match(/\bNIL\s+NIL\s+(.+?)\s+(?:(?:Similar to Registered Slot|Registered Slot)\s+)?(\d+)\s+(\d+)\s+(\d+)\s*$/i);if(p)rows.push({slots:'NIL',venue:'NIL',faculty:p[1].trim(),seats:p[4]});}
 }
 return rows;
}
