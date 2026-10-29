import {validateSection,slotBundle} from './engine.js';
export const needsFaculty = c=>!c.online && c.scheduled!==false && !(c.sections||[]).length;
const key=s=>[s.faculty.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,''),slotBundle(s,String(s.slots).trim().toUpperCase()!=='NIL'),s.venue.trim().toUpperCase().replace(/^AB0+([12])(?=[-\s])/,'AB$1')].join('|');
export function mergeSections(course, incoming) {
 if(!incoming.length)throw Error('No faculty options found.');
 const rows=incoming.map(s=>({...s,faculty:String(s.faculty??'').trim(),slots:String(s.slots??'').trim().toUpperCase(),venue:String(s.venue??'').trim(),seats:s.seats??''}));
 for(const row of rows){validateSection(row,{allowNil:course.scheduled===false});if(course.scheduled===false&&row.slots!=='NIL')throw Error('Use NIL for a course without weekly classes.');}
 const merged=[];
 for(const row of [...(course.sections||[]),...rows]){const i=merged.findIndex(s=>key(s)===key(row));if(i<0)merged.push({...row});else merged[i]={...merged[i],...row,id:merged[i].id};}
 return merged;
}
