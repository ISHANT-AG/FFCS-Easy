// Read course rows only. Portal navigation, personal details and existing clash
// labels belong to the source session and are never scheduling instructions.
export function parsePortalText(text) {
 const header=text.match(/\b([A-Z]{3}\d{4})\s*-\s*(.+?)\s*-\s*(?:Lecture|[^\n]+?\s+0\s+0\s+0\s+1)/i);
 if(!header)throw Error('No recognised course heading in this PDF.');
 const code=header[1].toUpperCase(),name=header[2].trim(),sections=[];
 for(const raw of text.split('\n')){
  const line=raw.trim();
  const weekly=line.match(/^([A-F][12][1-4](?:\+[A-F][12][1-4])*)\s+(\S+)\s+(.+?)\s+(?:NONE|Clashed with\s+.*?)\s+(\d+)(?:\s*Copyright.*)?$/i);
  if(weekly){sections.push({slots:weekly[1].toUpperCase(),venue:weekly[2],faculty:weekly[3].trim(),seats:weekly[4]});continue;}
  const project=line.match(/^([A-Z]{3}\d{4})\s*-\s*.+?\s*-\s*(.+?)\s+0\s+0\s+0\s+1\s+1\s+\w+\s+(\d+)\s*$/);
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
