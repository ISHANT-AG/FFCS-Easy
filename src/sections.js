import {validateSection} from './engine.js';
export const needsFaculty = c=>!c.online && c.scheduled!==false && !(c.sections||[]).length;
const key=s=>[s.faculty.trim().toLowerCase().replace(/\s+/g,' '),s.slots.toUpperCase().replace(/\s/g,''),s.venue.trim().toUpperCase()].join('|');
export function mergeSections(course, incoming) {
 if(!incoming.length)throw Error('No faculty options found.');
 const rows=incoming.map(s=>({...s,faculty:String(s.faculty??'').trim(),slots:String(s.slots??'').trim().toUpperCase(),venue:String(s.venue??'').trim(),seats:s.seats??''}));
 for(const row of rows){validateSection(row,{allowNil:course.scheduled===false});if(course.scheduled===false&&row.slots!=='NIL')throw Error('Use NIL for a course without weekly classes.');}
 const merged=(course.sections||[]).map(s=>({...s}));
 for(const row of rows){const i=merged.findIndex(s=>key(s)===key(row));if(i<0)merged.push(row);else merged[i]={...merged[i],...row,id:merged[i].id};}
 return merged;
}
