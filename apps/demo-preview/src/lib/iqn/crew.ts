export type CrewRole='WORKER'|'OPERATOR'|'SAFETY';
export type CrewMember={id:string;fullName:string;skills:string[];availableMinutes:number};
export function assignCrew(roster:CrewMember[],selectedIds:string[]|undefined,workerMinutes:number,operatorMinutes:number,workerMinimum:number,safetyMinimum:number,window:number,machineMinutes:number){
 const candidates=roster.filter(w=>w.availableMinutes>0&&(!selectedIds||selectedIds.includes(w.id))).sort((a,b)=>a.skills.length-b.skills.length||b.availableMinutes-a.availableMinutes);
 const picked:Array<CrewMember&{role:CrewRole;assignedMinutes:number}>=[];
 const requirements={WORKER:workerMinutes>0?Math.max(workerMinimum,Math.ceil(workerMinutes/window)):0,OPERATOR:operatorMinutes>0||machineMinutes>0?Math.max(1,Math.ceil(operatorMinutes/window)):0,SAFETY:safetyMinimum};
 const select=(role:CrewRole,skill:string,total:number,min:number)=>{
  const pool=candidates.filter(w=>w.skills.includes(skill)&&!picked.some(p=>p.id===w.id));
  let count=min;
  while(count<pool.length&&pool.slice(0,count).some(w=>w.availableMinutes<Math.ceil(total/Math.max(1,count))))count++;
  const selected=pool.slice(0,count),minutes=Math.ceil(total/Math.max(1,selected.length));
  picked.push(...selected.map(w=>({...w,role,assignedMinutes:minutes})));
 };
 select('OPERATOR','operator',Math.max(operatorMinutes,machineMinutes),requirements.OPERATOR);
 select('SAFETY','safety',0,requirements.SAFETY);
 select('WORKER','road_worker',workerMinutes,requirements.WORKER);
 const active=Math.max(machineMinutes,...picked.filter(p=>p.role!=='SAFETY').map(p=>p.assignedMinutes),0);
 for(const p of picked)if(p.role==='SAFETY')p.assignedMinutes=Math.ceil(active);
 // Norms drive staff demand; actual attendance is recorded independently.
 const counts={WORKER:picked.filter(w=>w.role==='WORKER').length,OPERATOR:picked.filter(w=>w.role==='OPERATOR').length,SAFETY:picked.filter(w=>w.role==='SAFETY').length};
 const validIds=!selectedIds||new Set(selectedIds).size===selectedIds.length&&selectedIds.every(id=>roster.some(w=>w.id===id));
 return {picked,requirements,counts,staffEnough:validIds&&(Object.keys(counts) as CrewRole[]).every(k=>counts[k]>=requirements[k]),timeEnough:picked.every(w=>w.assignedMinutes<=window&&w.availableMinutes>=w.assignedMinutes)};
}
