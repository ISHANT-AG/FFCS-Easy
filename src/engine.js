export const TIMES = ['08:30–10:00','10:05–11:35','11:40–13:10','13:15–14:45','14:50–16:20','16:25–17:55','18:00–19:30'];
export const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export const GRID = [['A11','B11','C11','A21','A14','B21','C21'],['D11','E11','F11','D21','E14','E21','F21'],['A12','B12','C12','A22','B14','B22','A24'],['D12','E12','F12','D22','F14','E22','F22'],['A13','B13','C13','A23','C14','B23','B24'],['D13','E13','F13','D23','D14','D24','E23']];
export const START = [510,605,700,795,890,985,1080], END = [600,695,790,885,980,1075,1170];
const facultyKey = s=>String(s||'').trim().replace(/\s+/g,' ').toLowerCase();
const nameWords=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
export function matchesAvoidFaculty(query,faculty){const q=nameWords(query),f=nameWords(faculty);if(!q.length)return false;if(q.join('')===f.join(''))return true;return f.some((_,i)=>q.every((word,j)=>word===f[i+j]));}

const index = Object.fromEntries(GRID.flatMap((r,d)=>r.map((s,p)=>[s,{day:d,period:p}])));
export function parseSlots(text) { const codes=String(text).toUpperCase().split(/[+,;\s]+/).filter(Boolean); if(!codes.length) throw Error('Enter at least one slot.'); const bad=codes.filter(s=>!index[s]); if(bad.length) throw Error('Unknown slot: '+bad.join(', ')); return [...new Set(codes)].map(s=>({...index[s],code:s})); }
export function zone(venue) { return /^AB0?2\b/i.test(venue.trim())?'far':'near'; }
export function validateSection(s, {allowNil=false}={}) { if(!s.faculty?.trim()) throw Error('Faculty is required.'); if(!s.venue?.trim()) throw Error('Venue is required.'); if(!(allowNil && String(s.slots).trim().toUpperCase()==='NIL'))parseSlots(s.slots); if(s.seats!=='' && s.seats!=null && (!Number.isInteger(Number(s.seats)) || Number(s.seats)<0)) throw Error('Seats must be a whole non-negative number.'); }
export function lunchValid(items) { return DAYS.every((_,d)=> !items.some(x=>x.day===d&&x.period===2) || !items.some(x=>x.day===d&&x.period===3)); }
export function metrics(items) { let gaps=0,travel=0,morning=0,evening=0,balance=0,days=0; for(let d=0;d<6;d++){const a=items.filter(x=>x.day===d).sort((a,b)=>a.period-b.period);if(!a.length)continue;days++; for(const x of a){morning+=Math.max(0,x.period-2);evening+=Math.max(0,3-x.period);} for(let i=1;i<a.length;i++){const delta=a[i].period-a[i-1].period;gaps+=delta-1;if(delta===1&&zone(a[i].venue)!==zone(a[i-1].venue))travel++;} balance+=Math.abs(a.reduce((s,x)=>s+x.period,0)/a.length-3); } return {gaps,travel,morning,evening,balance,days}; }
export const PRESETS = [{id:'compact',name:'Minimal gaps',description:'Keep your campus day compact.'},{id:'morning',name:'Morning person',description:'Make room for free evenings.'},{id:'evening',name:'Evening person',description:'Start your day a little later.'},{id:'travel',name:'Less travel',description:'Fewer back-to-back AB2 switches.'},{id:'balanced',name:'Whole day',description:'Spread classes across the day.'},{id:'bus',name:'Day scholar',description:'Finish before your bus deadline.'}];
export function slotBundle(section, scheduled=true) {
 return scheduled===false?'NIL':parseSlots(section.slots).map(x=>x.code).sort().join('+');
}
export function eligibleSections(course) {
 if(course.online)return [];
 return (course.sections||[]).filter(s=>{
  if(s.seats!==''&&s.seats!=null&&!(Number(s.seats)>0))return false;
  if((Array.isArray(course.avoid)?course.avoid:String(course.avoid||'').split(/[,;\n]+/)).some(f=>matchesAvoidFaculty(f,s.faculty)))return false;
  if(course.only&&facultyKey(course.only)!==facultyKey(s.faculty))return false;
  try{validateSection(s,{allowNil:course.scheduled===false});return course.scheduled!==false||String(s.slots).trim().toUpperCase()==='NIL';}catch{return false;}
 });
}
function preferencePenalty(course,section){const names=course.preferred||[],rank=names.findIndex(f=>facultyKey(f)===facultyKey(section.faculty));return names.length?(rank<0?names.length+1:rank):0;}
function scoreSchedule(items,m,penalty,settings,preset){
 let score=m.gaps*10+penalty*30+(settings.travel?m.travel*35:0);
 if(preset==='morning')score+=items.reduce((n,x)=>n+Math.max(0,END[x.period]-795),0)*10;
 if(preset==='evening')score+=m.evening*25;
 if(preset==='travel')score+=m.travel*70;
 if(preset==='balanced')score=m.balance*30+m.gaps*2+penalty*30+(settings.travel?m.travel*35:0);
 return score;
}
function deadlineFor(settings){const [h,m]=(settings.busTime||'16:20').split(':').map(Number);return h*60+m-(Number(settings.walkMinutes)||0);}
function sectionItems(course,section){return (course.scheduled===false?[]:parseSlots(section.slots)).map(x=>({...x,venue:section.venue,faculty:section.faculty,course:course.code,name:course.name,section:section.id}));}
function scheduleFrom(chosen,settings,preset){
 const items=chosen.flatMap(({course,section})=>sectionItems(course,section)),m=metrics(items);
 const enriched=chosen.map(({course,section})=>({course,section,alternatives:eligibleSections(course).filter(s=>slotBundle(s,course.scheduled)===slotBundle(section,course.scheduled))}));
 const signature=chosen.filter(x=>x.course.scheduled!==false).map(({course,section})=>course.code+':'+slotBundle(section)).sort().join('|');
 const penalty=chosen.reduce((n,x)=>n+preferencePenalty(x.course,x.section),0);
 return {chosen:enriched,items,metrics:m,signature,score:scoreSchedule(items,m,penalty,settings,preset)};
}
export function changeFaculty(schedule,courseCode,sectionId,settings={},preset='compact') {
 const current=schedule.chosen.find(x=>x.course.code===courseCode);
 if(!current)throw Error('Course not found in this timetable.');
 const next=eligibleSections(current.course).find(s=>s.id===sectionId);
 if(!next||slotBundle(next,current.course.scheduled)!==slotBundle(current.section,current.course.scheduled))throw Error('Choose an eligible faculty with the same time slots.');
 return scheduleFrom(schedule.chosen.map(x=>x===current?{course:x.course,section:next}:x),settings,preset);
}
// Compare course timings only; faculty/room changes never create another layout.
const timingCache=new WeakMap();
function timingMap(schedule){
 if(!timingCache.has(schedule))timingCache.set(schedule,new Map(schedule.chosen.filter(x=>x.course.scheduled!==false).map(x=>[x.course.code,new Set(slotBundle(x.section).split('+'))])));
 return timingCache.get(schedule);
}
function timingDistance(a,b){
 const left=timingMap(a),right=timingMap(b);let moved=0,meetings=0;
 for(const [course,slots] of left){const next=right.get(course)||new Set();const delta=[...slots].filter(s=>!next.has(s)).length+[...next].filter(s=>!slots.has(s)).length;if(delta){moved++;meetings+=delta;}}
 return moved*100+meetings;
}
export function diverseTimetables(input,limit){
 const candidates=[...input].sort((a,b)=>a.score-b.score||a.signature.localeCompare(b.signature)),selected=[];
 // Keep the best preference match first, then maximize the minimum timing
 // difference from EVERY option already selected. Scores break distance ties.
 while(candidates.length&&selected.length<limit){
  let bestIndex=0,bestDistance=-1;
  if(selected.length)for(let i=0;i<candidates.length;i++){
   const distance=Math.min(...selected.map(s=>timingDistance(s,candidates[i])));
   if(distance>bestDistance){bestDistance=distance;bestIndex=i;}
  }
  selected.push(candidates.splice(bestIndex,1)[0]);
 }
 return selected;
}
export function solve(courses,settings={},preset='compact',limit=5,hooks={}) {
 limit=Math.min(100,Math.max(1,Number(limit)||5));
 const prepared=new WeakMap();
 const started=Date.now(),maxMilliseconds=Math.max(1,Number(settings.maxMilliseconds)||3000);let lastProgress=started;
 const active=courses.filter(c=>!c.online&&(c.scheduled!==false||(c.sections||[]).length)),missing=[],nodesMax=settings.maxNodes||250000;
 const lists=active.map(c=>{
  const eligible=eligibleSections(c),groups=new Map();
  // Faculty with identical meetings and building group have identical effects
  // on scheduling. Search one best representative, keep all for the dropdown.
  for(const s of eligible){const key=slotBundle(s,c.scheduled)+(c.scheduled===false?'':':'+zone(s.venue));const prior=groups.get(key);if(!prior||preferencePenalty(c,s)<preferencePenalty(c,prior)||(preferencePenalty(c,s)===preferencePenalty(c,prior)&&Number(s.seats||0)>Number(prior.seats||0)))groups.set(key,s);}
  const options=[...groups.values()].sort((a,b)=>preferencePenalty(c,a)-preferencePenalty(c,b));
  for(const section of options){const items=sectionItems(c,section);let low=0,high=0;for(const x of items){const bit=x.day*7+x.period;if(bit<32)low|=1<<bit;else high|=1<<(bit-32);}prepared.set(section,{items,low,high,penalty:preferencePenalty(c,section),signature:c.code+':'+slotBundle(section,c.scheduled)});}
  if(!options.length)missing.push(c.code);return {course:c,options};
 }).sort((a,b)=>a.options.length-b.options.length);
 if(missing.length)return {results:[],reason:'No eligible sections for '+missing.join(', ')+'. Check uploaded options or faculty preferences.',nodes:0,truncated:false};
 if(!active.length)return {results:[],reason:'Select at least one course with weekly classes.',nodes:0,truncated:false};
 let nodes=0,truncated=false;const pool=new Map(),poolLimit=Math.max(128,limit*12),bus=settings.bus||preset==='bus',deadline=deadlineFor(settings);
 function visit(k,items,chosen,low=0,high=0,penalty=0){
  if(++nodes>nodesMax){truncated=true;return;}
  if((nodes&255)===0){const now=Date.now();if(now-started>=maxMilliseconds){truncated=true;return;}if(now-lastProgress>=200){lastProgress=now;hooks.onProgress?.({nodes,found:pool.size});}}
  if(k===lists.length){
   const m=metrics(items),signature=chosen.filter(x=>x.course.scheduled!==false).map(x=>prepared.get(x.section).signature).sort().join('|');
   const candidate={chosen:[...chosen],items:[...items],metrics:m,signature,score:scoreSchedule(items,m,penalty,settings,preset)},previous=pool.get(signature);
   if(!previous||candidate.score<previous.score)pool.set(candidate.signature,candidate);
   if(pool.size>poolLimit*2){const ranked=[...pool.values()].sort((a,b)=>a.score-b.score),quality=ranked.slice(0,poolLimit-limit),variety=diverseTimetables(ranked,limit);pool.clear();for(const entry of [...quality,...variety])pool.set(entry.signature,entry);}return;
  }
  const {course:c,options}=lists[k];
  for(const s of options){
   if(truncated)return;const info=prepared.get(s),added=info.items;
   if((low&info.low)||(high&info.high))continue;
   if(bus&&added.some(x=>END[x.period]>deadline))continue;
   if(preset==='evening'&&added.some(x=>START[x.period]<795))continue;
   const nextLow=low|info.low,nextHigh=high|info.high;
   if(settings.lunch!==false&&([12,1536,196608,25165824,-1073741824].some(mask=>(nextLow&mask)===mask)||(nextHigh&96)===96))continue;
   visit(k+1,[...items,...added],[...chosen,{course:c,section:s}],nextLow,nextHigh,penalty+info.penalty);
  }
 }
 visit(0,[],[]);
 const selected=diverseTimetables([...pool.values()],limit);
 return {results:selected.map(s=>scheduleFrom(s.chosen,settings,preset)),nodes,truncated,elapsedMs:Date.now()-started,reason:selected.length?'':truncated?'Search limit reached before a timetable was found. Try again or adjust your preferences.':'No timetable meets all rules. Check overlapping slots, faculty choices, lunch or the bus deadline.'};
}
export function parseCatalogue(text){const rows=[];for(const line of text.split('\n')){const m=line.trim().match(/^\d+\s+(\d{2}[A-Z]{3})\s+([A-Z]{3}\d{4})\s+(.+?)\s+(LTP|LT|LP|PJ|P)\s+(\d+)\s+(\w+)\s*$/);if(m){const [,batch,code,name,type,credits,category]=m;rows.push({batch,code,name,type,credits:Number(credits),category});}}return rows;}
