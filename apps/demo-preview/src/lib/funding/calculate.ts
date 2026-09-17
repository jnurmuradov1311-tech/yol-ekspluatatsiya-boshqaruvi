import type {Asset,AssetSnapshot,FundingLine,FundingPolicy,FundingResult,ResourceCost,Road} from './types';
import {iqnWorkCatalog,normalizeUnit,workNormMinutes} from '../iqn/catalog';
import {automaticResourceRecipe,plannedResources,resourcePlanIssue,resourceUnit} from '../iqn/resource-plan';
import {conditionShares,equipmentNorms,recurrence} from './norms';
import {equipmentBudget,staffRoles} from './equipment';
import {sourceLabor} from './source-labor';
import {fleetNorms} from './fleet-data';
export const rateKey=(kind:string,code:string,unit:string)=>`${kind}:${code}:${kind==='machine'?'soat':resourceUnit(unit)}`;
const sum=(values:number[])=>values.reduce((a,b)=>a+b,0);
const money=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export function priority(road:Road){return ({INTERNATIONAL:30,STATE:20,LOCAL:10}[road.importance])+({GOOD:0,FAIR:10,POOR:20,CRITICAL:30}[road.condition]);}
// Budget defaults are explicit technologies, not claims about hidden RAMS attributes.
export function assetWorkSpecs(asset:Asset,policy:FundingPolicy){
 const q=asset.quantity,override=asset.annualFrequency;
 if(asset.workId)return [{workId:asset.workId,quantity:asset.workQuantity??0,unit:asset.workUnit??asset.unit,frequency:override??0,source:asset.frequencyBasis||'Davriylik asosi kerak',gap:asset.workQuantity===undefined?'Tanlangan ish uchun alohida hajm kiriting.':override===undefined?'Davriylikni kiriting.':!asset.frequencyBasis?.trim()?'Davriylik asosi kerak.':''}];
 const row=(workId:string,quantity:number,unit:string,frequency:number,source='IQN 02-24 · 1-ilova',gap='')=>({workId,quantity,unit,frequency:override??frequency,source:override===undefined?source:asset.frequencyBasis||'Davriylik asosi kerak',gap:override!==undefined&&!asset.frequencyBasis?.trim()?'Davriylik asosi kerak.':gap});
 switch(asset.kind){
  case 'PAVEMENT':{
   const repeats=asset.condition==='POOR'?policy.conditionIIIRepeats:asset.condition==='CRITICAL'?policy.conditionIVRepeats:2;
   const conditions=asset.parameters;
   const workId=conditions?.thicknessMm===50&&conditions.largestPatchM2!==undefined&&conditions.largestPatchM2<=1?`iqn02-r-27-14-${conditions.removeOld?'023':'024'}-01-t${conditions.removeOld?'45':'46'}`:conditions?.thicknessMm===70&&conditions.largestPatchM2!==undefined&&conditions.largestPatchM2<=3?`iqn02-r-27-14-${conditions.removeOld?'023':'024'}-02-t${conditions.removeOld?'45':'46'}`:'';
   const count=override??repeats;
   const missing=count===null?'III–IV holat davriyligini aniqlashtiring.':(asset.condition==='POOR'||asset.condition==='CRITICAL')&&!policy.conditionBasis.trim()&&override===undefined?'Holat davriyligi qarorining asosini yozing.':!conditions||conditions.removeOld===undefined||!workId?'Ta’mir qalinligi, eng katta chuqurcha va eski qoplama usulini belgilang.':'';
   const annual=Math.max(asset.defectQuantity??0,q*conditionShares[asset.condition]*(count??0));
   return [{workId,quantity:annual,unit:asset.unit,frequency:1,source:`IQN 02-24 · 1-ilova, 8-band · ${Number((conditionShares[asset.condition]*100).toFixed(4))}% × ${count??'?'} marta/yil; o‘lchangan hajm bilan kattasi${policy.conditionBasis?' · '+policy.conditionBasis:''}`,gap:override!==undefined&&!asset.frequencyBasis?.trim()?'Davriylik asosi kerak.':missing}];
  }
  case 'GRASS':return [row('iqn02-r-27-14-011-01-t39',normalizeUnit(asset.unit)==='m2'?q/2000:q,'km',recurrence.mowing,'IQN 02-24 · 1-ilova, 3-band; 2 m qamrovli o‘rish',!['m2','km'].includes(normalizeUnit(asset.unit))?'O‘rish uchun m² yoki 2 m qamrovdagi km kerak.':'')];
  case 'DRAIN':return [row('iqn02-r-27-14-017-01-t41',q,asset.unit,recurrence.drain)];
  case 'CULVERT':return [row('iqn02-t7-r4',q,asset.unit,recurrence.culvert)];
  case 'SIGN':return [row('iqn02-t12-r23',q,asset.unit,asset.industrialZone?14:10,`IQN 02-24 · 1-ilova, 16 · ${asset.industrialZone?'sanoat hududi':'sanoat hududidan tashqari'}`,asset.industrialZone===undefined?'Sanoat hududi ekanligini belgilang.':'')];
  case 'PAVILION':return [row('iqn02-r-27-14-059-01-t72',q,asset.unit,recurrence.pavilionWash,'IQN 02-24 · 1-ilova',override!==undefined?'Yuvish va bo‘yash davriyligini alohida ish sifatida kiriting.':''),{...row('iqn02-r-27-14-060-01-t73',q,asset.unit,recurrence.pavilionPaint),frequency:recurrence.pavilionPaint}];
  case 'BARRIER':return [row('iqn02-t8-r12',q,asset.unit,recurrence.barrierWash),...(asset.defectQuantity?[{...row('iqn02-r-27-14-054-01-t68',asset.defectQuantity,asset.unit,1),frequency:1,source:'RAMS · bir martalik egilgan metall to‘siq',gap:asset.repairMethod==='STRAIGHTEN'?'':'Metall to‘siqni to‘g‘rilash usulini tasdiqlang.'}]:[])];
  case 'CURB':return asset.defectQuantity?[{...row('iqn02-r-27-14-061-01-t74',asset.defectQuantity,asset.unit,1),frequency:1,source:'RAMS · bir martalik bordyur to‘g‘rilash',gap:asset.repairMethod==='STRAIGHTEN'?'':'Bordyurni qayta joylashtirish usulini tasdiqlang.'}]:[];
  case 'LIGHTING':return [row('iqn02-t17-r4',q,asset.unit,recurrence.lightingWash),...(asset.defectQuantity?[{...row('iqn02-r-27-14-069-01-t81',asset.defectQuantity,asset.unit,1),frequency:1,source:'RAMS · bir martalik to‘liq yoritgich almashtirish',gap:asset.repairMethod==='REPLACE_FIXTURE'?'':'To‘liq yoritgich almashtirilishini tasdiqlang.'}]:[])];
  default:return [];
 }
}
export function fleetRequirements(roads:Road[]){
 return fleetNorms.map(norm=>({name:norm.name,specification:norm.specification,source:norm.sourceReference,quantity:sum(roads.map(r=>{const cat=r.category==='Ia'||r.category==='Ib'?'I':r.category;return (norm.per100Km[cat]??0)*r.lengthKm/100;})),unavailable:roads.filter(r=>norm.per100Km[r.category==='Ia'||r.category==='Ib'?'I':r.category]===null).map(r=>r.code)}));
}
export function validatePolicy(policy:FundingPolicy){
 for(const staff of policy.staff??[]){if(!staffRoles[staff.role]||['yol_ishchisi','mashinist','haydovchi','yol_ustasi'].includes(staff.role)||!Number.isInteger(staff.heads)||staff.heads<0||!Number.isFinite(staff.fte)||staff.fte<0||staff.fte>staff.heads||!Number.isFinite(staff.monthly)||staff.monthly<0||staff.heads>0&&!staff.basis?.trim())throw new Error('Qo‘shimcha shtat: haqiqiy odam soni, stavka, oylik va asosni tekshiring.');}
 if(new Set((policy.staff??[]).map(s=>s.role)).size!==(policy.staff??[]).length)throw new Error('Shtat lavozimi takrorlangan.');
 for(const cost of policy.otherCosts??[])if(!Number.isFinite(cost.amount)||cost.amount<0||!cost.name?.trim()||cost.amount>0&&!cost.basis?.trim())throw new Error('Boshqa xarajat summasi va asosini tekshiring.');
 if(policy.worksiteCount!==undefined&&(!Number.isInteger(policy.worksiteCount)||policy.worksiteCount<0))throw new Error('Ish joylari soni butun bo‘lsin.');
 for(const n of [...Object.values(policy.equipmentStock??{}),...Object.values(policy.equipmentIssueQuantity??{})])if(!Number.isFinite(n)||n<0)throw new Error('Jihoz miqdori yaroqsiz.');

 if(!Number.isInteger(policy.year)||policy.year<2020||policy.year>2100)throw new Error('Hisob yilini tekshiring.');
 for(const key of ['annualHours','workerMonthly','operatorMonthly','supervisorMonthly','wageCoefficient','divisionCount'] as const)if(!Number.isFinite(policy[key])||policy[key]<=0||policy[key]>1e12)throw new Error(`${key}: musbat qiymat kiriting.`);
 if(policy.annualHours>366*24)throw new Error('Yillik ish vaqti yildagi soatlardan katta.');
 for(const key of ['allowancePercent','holidayPerYear','mealPerMonth','employerTaxPercent','overheadPercent','contingencyPercent','otherAnnual'] as const)if(!Number.isFinite(policy[key])||policy[key]<0||policy[key]>1e12)throw new Error(`${key}: manfiy yoki yaroqsiz qiymat.`);
 if(policy.supervisors!==null&&(!Number.isInteger(policy.supervisors)||policy.supervisors<0))throw new Error('Ustalar soni butun, manfiy bo‘lmagan son bo‘lsin.');
 if(!Number.isInteger(policy.divisionCount))throw new Error('Yo‘l bo‘limlari soni butun bo‘lsin.');
 for(const v of [policy.conditionIIIRepeats,policy.conditionIVRepeats])if(v!==null&&(!Number.isFinite(v)||v<=0||v>366))throw new Error('Holat davriyligini tekshiring.');
 for(const rate of Object.values(policy.rates))if(rate.price!==null&&(!Number.isFinite(rate.price)||rate.price<0||rate.price>1e12))throw new Error('Tarif manfiy yoki yaroqsiz.');
 for(const value of Object.values(policy.equipmentPrices))if(value!==null&&(!Number.isFinite(value)||value<0||value>1e12))throw new Error('Jihoz narxi yaroqsiz.');
}
export function calculateFunding(snapshot:AssetSnapshot,policy:FundingPolicy):FundingResult{
 validatePolicy(policy);
 const roads=snapshot.roads.filter(r=>policy.roadSelection.includes(r.id));
 const lines:FundingLine[]=[],gaps:string[]=[],warnings:string[]=[];
 for(const road of roads){if(!Number.isFinite(road.lengthKm)||road.lengthKm<=0)throw new Error('Yo‘l uzunligi musbat bo‘lsin.');for(const a of road.assets){if(a.annualFrequency!==undefined&&(!Number.isFinite(a.annualFrequency)||a.annualFrequency<=0||a.annualFrequency>366))throw new Error(`${a.name}: yillik davriylik yaroqsiz.`);if(a.workQuantity!==undefined&&(!Number.isFinite(a.workQuantity)||a.workQuantity<0))throw new Error(`${a.name}: ish hajmi yaroqsiz.`);if(!Number.isFinite(a.quantity)||a.quantity<0||a.defectQuantity!==undefined&&(!Number.isFinite(a.defectQuantity)||a.defectQuantity<0||a.defectQuantity>a.quantity))throw new Error(`${a.name}: aktiv yoki nuqson hajmi yaroqsiz.`);}}
 if(!roads.length)throw new Error('Hisob uchun kamida bitta yo‘l tanlang.');
 if(!policy.reference.trim())gaps.push('Tarif va hisob shartlarining asosini kiriting.');
 const resourcesByKey=new Map<string,ResourceCost>(),roadMissing=new Map<string,number>();
 for(const road of roads){
  const gapStart=gaps.length;
  if(!road.assets.length)gaps.push(`${road.code}: aktivlar ro‘yxati yo‘q.`);
  for(const asset of road.assets){
   const specs=assetWorkSpecs(asset,policy);
   if(!asset.workId&&asset.defectQuantity&&['SIGN','DRAIN','PAVILION','GRASS','CULVERT'].includes(asset.kind))gaps.push(`${road.code} · ${asset.name}: nuqsonni bartaraf etish uchun alohida ish hajmi va me’yori kerak; joriy band xizmat ishlarini hisoblaydi.`);
   if(!specs.length&&asset.kind!=='CURB')gaps.push(`${road.code} · ${asset.name}: mos ish me’yori belgilanmagan.`);
   if(asset.kind==='CURB'&&asset.defectQuantity===undefined&&asset.condition!=='GOOD')gaps.push(`${road.code} · ${asset.name}: nuqson hajmi kerak.`);
   for(const [index,spec] of specs.entries()){
    const work=iqnWorkCatalog.find(w=>w.id===spec.workId),lineGaps:string[]=[];
    if(spec.gap)lineGaps.push(spec.gap);
    if(!work){gaps.push(`${road.code} · ${asset.name}: ${spec.gap||'Ish turini belgilang.'}`);continue;}
    if(normalizeUnit(spec.unit)!==normalizeUnit(work.unit))lineGaps.push(`Aktiv birligi ${spec.unit}, ish birligi ${work.unit}.`);
    const quantity=spec.quantity*spec.frequency;
    if(!Number.isFinite(quantity)||quantity<0)throw new Error('Ish hajmi yaroqsiz.');
    if(work.normIssue)lineGaps.push(work.normIssue);
    if(work.normRange&&(asset.selectedNormHours===undefined||!Number.isFinite(asset.selectedNormHours)||asset.selectedNormHours<work.normRange[0]!||asset.selectedNormHours>work.normRange[1]!))lineGaps.push('Mehnat oralig‘idan tasdiqlangan qiymat tanlang.');
    const missing=resourcePlanIssue(work,asset.resourcePlan,iqnWorkCatalog);if(missing)lineGaps.push(missing);
    const source=sourceLabor[work.id];
    const recipe=automaticResourceRecipe(work,iqnWorkCatalog);
    const split=work.catalogSeries==='RESOURCE'?source:recipe?sourceLabor[recipe.id]:undefined;
    let worker=work.catalogSeries==='TIME'?(Number.isFinite(workNormMinutes(work,{selectedNormHours:asset.selectedNormHours}))?workNormMinutes(work,{selectedNormHours:asset.selectedNormHours})/60:0):(split?.worker??0);
    let operator=work.catalogSeries==='RESOURCE'?(split?.operator??0):0;
    if(work.catalogSeries==='RESOURCE'&&(!split||split.worker===null||split.operator===null))lineGaps.push('Ishchi va mashinist mehnat sarfi aniqlashtirilishi kerak.');
    const resourceRows=plannedResources(work,asset.resourcePlan,iqnWorkCatalog);
    if(work.catalogSeries==='TIME'&&resourceRows.some(r=>r.kind==='machine')){if(asset.operatorHoursPerUnit!==undefined&&Number.isFinite(asset.operatorHoursPerUnit)&&asset.operatorHoursPerUnit>=0&&asset.operatorBasis?.trim())operator=asset.operatorHoursPerUnit;else lineGaps.push('Mashinist mehnat sarfi uchun alohida norma va asos kerak.');}
    if(lineGaps.some(g=>g.startsWith('Aktiv birligi'))){worker=0;operator=0;}
    const costRows:ResourceCost[]=resourceRows.map(r=>{
     const unit=r.kind==='machine'?'soat':resourceUnit(r.unit),key=rateKey(r.kind,r.code,unit),rate=policy.rates[key];
     let price=rate?.price??null;
     if(rate&&resourceUnit(rate.unit)!==unit){lineGaps.push(`${r.name}: tarif birligi mos emas.`);price=null;}
     if(r.kind==='machine'&&rate?.includesOperator){lineGaps.push(`${r.name}: haydovchi oyligisiz tarif kerak (IQN 03-24, 7.3).`);price=null;}
     if(price===null)lineGaps.push(`${r.name}: ${unit} uchun narx kerak.`);
     if(price!==null&&!rate?.source.trim()){lineGaps.push(`${r.name}: narx asosi kerak.`);price=null;}
     const qty=lineGaps.some(g=>g.startsWith('Aktiv birligi'))?0:quantity*r.quantityPerUnit!;
     return {key,code:r.code,name:r.name,kind:r.kind as 'material'|'machine',unit,quantity:qty,price,amount:price===null?null:qty*price,source:rate?.source??''};
    });
    const line={resourcePlan:asset.resourcePlan,selectedNormHours:asset.selectedNormHours,id:`${road.id}:${asset.id}:${index}`,roadId:road.id,assetId:asset.id,assetName:asset.name,workId:work.id,workName:work.name,quantity,unit:work.unit,frequency:spec.frequency,frequencySource:spec.source,normReference:work.normReference+(asset.operatorBasis?' · mashinist: '+asset.operatorBasis:''),workerHours:quantity*worker,operatorHours:quantity*operator,directCost:0,resources:costRows,gaps:[...new Set(lineGaps)],priority:priority(road)};
    lines.push(line);gaps.push(...line.gaps.map(g=>`${road.code} · ${asset.name}: ${g}`));
    for(const r of costRows){const old=resourcesByKey.get(r.key);resourcesByKey.set(r.key,{...r,quantity:(old?.quantity??0)+r.quantity,amount:r.amount===null||old?.amount===null?null:(old?.amount??0)+r.amount});}
   }
  }
  roadMissing.set(road.id,new Set(gaps.slice(gapStart)).size);
 }
 const workerHours=sum(lines.map(l=>l.workerHours)),operatorHours=sum(lines.map(l=>l.operatorHours));
 const workers=Math.ceil(workerHours/policy.annualHours),operators=Math.ceil(operatorHours/policy.annualHours),supervisors=policy.supervisors??Math.ceil(sum(roads.map(r=>r.lengthKm))/20);
 const payrollRows=[{name:'Yo‘l ishchilari',count:workers,base:policy.workerMonthly},{name:'Haydovchi va mashinistlar',count:operators,base:policy.operatorMonthly},{name:'Yo‘l ustalari',count:supervisors,base:policy.supervisorMonthly}].map(r=>{const monthly=r.base*policy.wageCoefficient*(1+policy.allowancePercent/100)+policy.mealPerMonth+policy.holidayPerYear/12;return {name:r.name,count:r.count,heads:r.count,base:r.base,monthly,annual:monthly*r.count*12};});
 for(const staff of policy.staff??[]){const monthly=staff.monthly*policy.wageCoefficient*(1+policy.allowancePercent/100)+policy.mealPerMonth+policy.holidayPerYear/12;payrollRows.push({name:staffRoles[staff.role]??staff.role,count:staff.fte,heads:staff.heads,base:staff.monthly,monthly,annual:monthly*staff.fte*12});}
 const labor=sum(payrollRows.map(r=>r.annual));
 for(const line of lines)line.directCost=(workerHours?line.workerHours/workerHours*payrollRows[0]!.annual:0)+(operatorHours?line.operatorHours/operatorHours*payrollRows[1]!.annual:0)+sum(line.resources.map(r=>r.amount??0));
 const resources=[...resourcesByKey.values()],materials=sum(resources.filter(r=>r.kind==='material').map(r=>r.amount??0)),machinery=sum(resources.filter(r=>r.kind==='machine').map(r=>r.amount??0));
 const ppeRows=equipmentBudget(policy,workers,operators,supervisors);
 for(const row of ppeRows)if(row.quantity>0&&row.price===null)gaps.push(`${row.name}: jihoz narxi kerak.`);
 const ppe=sum(ppeRows.map(r=>r.amount??0)),employerTax=labor*policy.employerTaxPercent/100,other=policy.otherAnnual+sum((policy.otherCosts??[]).map(r=>r.amount));
 const direct=labor+materials+machinery+ppe+employerTax+other,overhead=direct*policy.overheadPercent/100,contingency=(direct+overhead)*policy.contingencyPercent/100,total=money(direct+overhead+contingency);
 const roadBases=roads.map(r=>{const ls=lines.filter(l=>l.roadId===r.id),wh=sum(ls.map(l=>l.workerHours)),oh=sum(ls.map(l=>l.operatorHours));
 const wages=(workerHours?wh/workerHours*payrollRows[0]!.annual:0)+(operatorHours?oh/operatorHours*payrollRows[1]!.annual:0);
 return {id:r.id,code:r.code,amount:wages+sum(ls.flatMap(l=>l.resources).map(x=>x.amount??0)),priority:priority(r),lineCount:ls.length,missing:roadMissing.get(r.id)??0};});
 const baseTotal=sum(roadBases.map(r=>r.amount)),shared=total-baseTotal,totalKm=sum(roads.map(r=>r.lengthKm));
 const roadCosts=roadBases.map((r,i)=>({...r,amount:r.amount+shared*(baseTotal?r.amount/baseTotal:totalKm?roads[i]!.lengthKm/totalKm:0)})).sort((a,b)=>b.priority-a.priority);
 const lastPositive=roadCosts.findLastIndex(r=>r.amount>0);let remaining=total;
 roadCosts.forEach((r,i)=>{r.amount=r.amount<=0?0:i===lastPositive?remaining:Math.min(remaining,Math.max(0,money(r.amount)));remaining=money(remaining-r.amount);});
 warnings.push('Ishchilar soni tanlangan yo‘llar uchun jami odam-soatdan bir marta yaxlitlanadi. Oylik yillik shtat usulida; odam-soat qiymati yana qo‘shilmaydi.');
 warnings.push('Jihoz xarajati xizmat muddati bo‘yicha yillik ulushdir. Xarid sanasi va ombor qoldig‘isiz aniq xarid soni emas.');
 warnings.push('Mashina-soat narxi haydovchi oyligisiz; material narxi yetkazish va saqlash xarajatlari bilan kiritiladi.');
 warnings.push('Konus va vaqtinchalik belgilar xizmat muddati manbada yo‘q: birlamchi ehtiyojdan yaroqli qoldiq ayiriladi. Takroriy yillik almashtirish normasi qo‘llanmaydi.');
 if(/namuna/i.test(policy.reference)||resources.some(r=>/namuna/i.test(r.source)))warnings.push('Tariflar namuna; real budjet uchun tashkilotning amaldagi narxlarini kiriting.');
 if(snapshot.mode==='DEMO')warnings.push('Aktivlar va boshlang‘ich tariflar namuna. Real ajratma sifatida foydalanishdan oldin almashtiring.');
 if((Date.now()-Date.parse(snapshot.observedAt))/86400000>365)gaps.push('Aktivlar tekshiruvi bir yildan eski; holatini yangilang.');
 return {lines,gaps:[...new Set(gaps)],warnings,complete:gaps.length===0,workerHours,operatorHours,workers,operators,labor,payrollRows,materials,machinery,ppe,ppeRows,employerTax,overhead,contingency,other,total:money(total),roads:roadCosts,resources};
}
