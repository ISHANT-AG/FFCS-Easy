import {DAYS,TIMES,eligibleSections,slotBundle} from './engine.js';
const ascii=s=>String(s??'').replace(/[–−]/g,'-').replace(/·/g,' / ').replace(/[^\x20-\x7E]/g,'');
let library;
async function loadPdfLibrary(){
 if(globalThis.jspdf?.jsPDF)return globalThis.jspdf.jsPDF;
 if(!library)library=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';script.onload=()=>{if(globalThis.jspdf?.jsPDF)resolve(globalThis.jspdf.jsPDF);else{library=null;reject(Error('Could not load PDF export. Please retry.'));}};script.onerror=()=>{library=null;reject(Error('Could not load PDF export. Check your connection and retry.'));};document.head.append(script);});
 return library;
}
export function assertExportEligible(schedule,courses){
 for(const chosen of schedule.chosen){const current=courses?courses.find(c=>c.code===chosen.course.code):chosen.course;const section=current&&eligibleSections(current).find(s=>s.id===chosen.section.id);if(!section||slotBundle(section,current.scheduled)!==slotBundle(chosen.section,chosen.course.scheduled)||section.faculty!==chosen.section.faculty||section.venue!==chosen.section.venue)throw Error('A selected faculty or section has changed or is no longer eligible. Regenerate your timetable before exporting.');}
}
export function createTimetablePdf(JsPDF,schedule,{option=1,courses}={}){
 assertExportEligible(schedule,courses);
 const doc=new JsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
 doc.setProperties({title:'FFCS easy - Timetable '+option,subject:'Selected timetable and faculty',creator:'FFCS easy'});
 const margin=10,top=30,header=9,rowHeight=21,width=doc.internal.pageSize.getWidth()-margin*2,timeWidth=25,dayWidth=(width-timeWidth)/6;
 doc.setFont('helvetica','bold');doc.setFontSize(17);doc.setTextColor(36,60,49);doc.text('FFCS easy | Timetable '+option,margin,15);
 doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(85,95,90);doc.text('Fall 2026-27  |  '+schedule.metrics.gaps+' gap slots  |  '+schedule.metrics.travel+' consecutive AB2 trips',margin,22);
 doc.setLineWidth(.2);doc.setDrawColor(205,214,204);
 const cell=(x,y,w,h,fill)=>{doc.setFillColor(...fill);doc.rect(x,y,w,h,'FD');};
 cell(margin,top,timeWidth,header,[237,243,231]);doc.setFont('helvetica','bold');doc.setTextColor(36,60,49);doc.setFontSize(9);doc.text('Time',margin+timeWidth/2,top+5.8,{align:'center'});
 DAYS.forEach((day,d)=>{const x=margin+timeWidth+d*dayWidth;cell(x,top,dayWidth,header,[237,243,231]);doc.text(day,x+dayWidth/2,top+5.8,{align:'center'});});
 const codes=[...new Set(schedule.items.map(i=>i.course))],colours=[[235,242,232],[232,238,245],[247,239,230],[241,235,245],[229,242,240]];
 TIMES.forEach((time,p)=>{const y=top+header+p*rowHeight;cell(margin,y,timeWidth,rowHeight,[248,249,246]);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(75,85,75);doc.text(ascii(time),margin+timeWidth/2,y+rowHeight/2+1,{align:'center'});
  DAYS.forEach((_,d)=>{const x=margin+timeWidth+d*dayWidth,event=schedule.items.find(i=>i.day===d&&i.period===p);cell(x,y,dayWidth,rowHeight,event?colours[codes.indexOf(event.course)%colours.length]:[255,255,255]);if(!event)return;
   doc.setTextColor(30,47,38);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text(ascii(event.course),x+2,y+4.5);
   doc.setFont('helvetica','normal');let size=8,lines;do{doc.setFontSize(size);lines=doc.splitTextToSize(ascii(event.faculty),dayWidth-4);if(lines.length<=3)break;size-=.5;}while(size>5);
   doc.text(lines,x+2,y+8.5,{lineHeightFactor:1.1});doc.setFontSize(7.5);doc.setTextColor(70,80,70);doc.text(ascii(event.venue),x+2,y+rowHeight-2.5);
  });
 });
 const bottom=top+header+rowHeight*7;doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(90,100,90);doc.text('Check current seats in FFCS before registration. Online courses are excluded from this timetable.',margin,bottom+7);
 const projects=schedule.chosen.filter(x=>x.course.scheduled===false);if(projects.length){const text='No weekly classes: '+projects.map(x=>x.course.code+' - '+x.section.faculty).join('; ');doc.setFontSize(6.5);doc.text(doc.splitTextToSize(ascii(text),width),margin,bottom+12);}
 return doc;
}
export async function downloadTimetablePdf(schedule,options={}){
 assertExportEligible(schedule,options.courses);
 const JsPDF=await loadPdfLibrary(),doc=createTimetablePdf(JsPDF,schedule,options);doc.save('FFCS-Timetable-'+(options.option||1)+'.pdf');
}
