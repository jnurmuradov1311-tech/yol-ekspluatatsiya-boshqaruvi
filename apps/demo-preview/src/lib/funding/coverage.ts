import registry from './iqn02-coverage.json';
import {iqnWorkCatalog} from '../iqn/catalog';
import type {AssetSnapshot,FundingPolicy,FundingResult} from './types';
const catalog=new Map(iqnWorkCatalog.map(w=>[w.id,w]));
const topicIds=new Map(registry.timeDomains.map(d=>[d.id,catalog.get(d.workIds[0]!)?.iqnTopicId]));
export const coverageRequirements=[
 ...registry.timeDomains.map(d=>({id:d.id,name:d.name,source:d.source,scope:'road'})),
 ...registry.annex1Requirements.map((r,i)=>({id:`annex1-${i+1}`,name:r.nameCyrillic,source:`${r.source} · davr: ${r.intervalYearsRaw} yil; takrorlanish: ${r.degreeRaw}. ${r.notes.join('; ')}`,scope:'road'})),
 {id:'staff',name:'Barcha boshqaruv va xizmat ko‘rsatish xodimlari',source:'IQN 03-24 · 4.3, 5.2, 10-band va 5-jadval',scope:'organization'},
 {id:'pay',name:'Ish haqi, ustamalar va kompensatsiyalar',source:'IQN 03-24 · 5.3-band',scope:'organization'},
 {id:'kit',name:'44 band: shaxsiy, umumiy jihozlar va ish materiallari',source:'IQN 03-24 · 3-jadval',scope:'organization'},
 {id:'transport',name:'Uzoq masofaga tashish va xizmat transporti',source:'IQN 03-24 · 1.4, 2-jadval',scope:'organization'},
 {id:'other',name:'Kommunal, aloqa, IT, diagnostika, qo‘riqlash, meteorologiya, o‘qitish va soliqlar',source:'IQN 03-24 · 9-band',scope:'organization'},
 {id:'fleet',name:'Toifa bo‘yicha texnika parki va xizmat mashinalari',source:'IQN 02-24 · 3-ilova; IQN 03-24 · 2-jadval',scope:'organization'},
];
export function coverageRows(snapshot:AssetSnapshot,policy:FundingPolicy,result:FundingResult){
 const byRoad=new Map(snapshot.roads.map(r=>[r.id,result.lines.filter(l=>l.roadId===r.id)]));
 return coverageRequirements.flatMap(req=>(req.scope==='road'?snapshot.roads.filter(r=>policy.roadSelection.includes(r.id)).map(r=>({id:r.id,label:r.code})): [{id:'organization',label:'Tashkilot'}]).map(scope=>{
  const key=`${scope.id}|${req.id}`,decision=policy.coverage?.[key];
  const available=(scope.id==='organization'?result.lines:byRoad.get(scope.id)??[]).filter(l=>!req.id.startsWith('iqn02-topic-')||catalog.get(l.workId)?.iqnTopicId===topicIds.get(req.id)||catalog.get(l.workId)?.catalogSeries==='RESOURCE');
  const validLinks=(decision?.lineIds??[]).filter(id=>available.some(l=>l.id===id&&!l.gaps.length));
  const issue=!decision?'Ko‘rib chiqilmagan':!['INCLUDED','NOT_APPLICABLE'].includes(decision.state)?'Qaror yaroqsiz':!decision.reason?.trim()?'Qamrov yoki istisno asosini yozing':decision.state==='INCLUDED'&&req.scope==='road'&&!validLinks.length?'Hisoblangan ish bandini bog‘lang':decision.state==='NOT_APPLICABLE'&&req.id.startsWith('iqn02-topic-')&&available.some(l=>catalog.get(l.workId)?.catalogSeries==='TIME')?'Hisobda shu yo‘nalish ishi bor':'';
  return {...req,key,scopeLabel:scope.label,decision,available,issue};
 }));
}
export function approvalIssues(snapshot:AssetSnapshot,policy:FundingPolicy,result:FundingResult,limit:number|null){
 const reviewed=coverageRows(snapshot,policy,result);
 const issues=[...result.gaps,...reviewed.filter(r=>r.issue).map(r=>`${r.scopeLabel} · ${r.name}: ${r.issue}`)];
 for(const l of result.lines)if(!reviewed.some(r=>r.id.startsWith('iqn02-topic-')&&r.decision?.state==='INCLUDED'&&r.decision.lineIds?.includes(l.id)&&r.available.some(v=>v.id===l.id)))issues.push(`${l.assetName}: IQN yo‘nalishiga bog‘lanmagan.`);
 if(!result.lines.some(l=>l.quantity>0))issues.push('Tasdiqlash uchun ish hajmi yo‘q.');

 for(const road of snapshot.roads.filter(r=>policy.roadSelection.includes(r.id))){const ids=result.lines.filter(l=>l.roadId===road.id).map(l=>l.workId);for(const table of [28,29])if(ids.some(id=>new RegExp(`^iqn02-t${table}-r(?:${table===28?'43|45':'20|22'})$`).test(id))&&ids.filter(id=>id.startsWith(`iqn02-t${table}-`)).length>1)issues.push(`${road.code}: ${table}-jadvalning jami va tarkibiy ishlarini birga qo‘shmang.`);}
 return [...new Set(issues)];
}
