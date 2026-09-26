import {calculateFunding} from './calculate';
import {fundedPlan} from './funded-plan';
import {approvalIssues} from './coverage';
import {parseBudgetLimit} from './allocation';
import {normalizeUnit} from '../iqn/catalog';
import type {AssetSnapshot,FundingPolicy,FundingLine} from './types';
import type {WorkOrderDetail,ManualPlanInput} from '../api/types';
export type AnnualRef={year:number;lineId:string;budgetVersionId:string};
export type BudgetProgram={id:string;year:number;revision:number;approvedAt:string;approvedBy:string;state:'APPROVED'|'SUPERSEDED';fingerprint:string;snapshot:AssetSnapshot;policy:FundingPolicy;limit:number|null;total:number;requiredTotal?:number;deferred?:Array<{lineId:string;quantity:number;unit:string;workName:string}>;lines:(FundingLine&{monthly:number[]})[]};
export type AnnualLedger={programs:BudgetProgram[]};
export const annualLedger:AnnualLedger={programs:[]};
const eps=0.00000051;
export const roundedQuantity=(n:number)=>Math.round(n*1e6)/1e6;
export function activeProgram(year:number,ledger=annualLedger){return ledger.programs.find(p=>p.year===year&&p.state==='APPROVED');}
export function annualUsage(lineId:string,year:number,orders:WorkOrderDetail[],month?:number,exclude?:string){
 let completed=0,reserved=0;
 for(const order of orders){if(order.id===exclude||order.annualRef?.year!==year||order.annualRef.lineId!==lineId||month!==undefined&&Number(order.scheduledDate.slice(5,7))!==month||order.state==='CANCELLED')continue;
  if(order.completion?.state==='VERIFIED')completed+=Number(order.completion.actualQuantity.value);else reserved+=Number(order.exactQuantity.value);
 }
 return {completed:roundedQuantity(completed),reserved:roundedQuantity(reserved),used:roundedQuantity(completed+reserved)};
}
export function approveBudget(snapshot:AssetSnapshot,policy:FundingPolicy,limitInput:unknown,actor:string,orders:WorkOrderDetail[],ledger=annualLedger){
 const need=calculateFunding(snapshot,policy),limit=parseBudgetLimit(limitInput),issues=approvalIssues(snapshot,policy,need,limit);
 if(issues.length)throw new Error(`Budjet tasdiqlanmadi: ${issues.length} ta aniqlashtirish. ${issues[0]}`);
 const fingerprint=JSON.stringify({snapshot,policy,limit}),old=activeProgram(policy.year,ledger);
 if(old?.fingerprint===fingerprint)return {program:old,reused:true};
 const minimums=Object.fromEntries((old?.lines??[]).map(l=>[l.id,annualUsage(l.id,policy.year,orders).used]));
 const selection=fundedPlan(snapshot,policy,limit,minimums);if(selection.issue)throw new Error(selection.issue);const result=selection.funded;
 for(const previous of old?.lines??[]){const used=annualUsage(previous.id,policy.year,orders).used,next=result.lines.find(l=>l.id===previous.id);
  if(used>0&&(!next||next.quantity+eps<used))throw new Error(`${previous.workName}: yangi yillik hajm bajarilgan va band hajmdan kam.`);
  if(used>0&&next&&JSON.stringify([next.workId,next.unit,next.resourcePlan,next.selectedNormHours,roundedQuantity(next.workerHours/next.quantity),roundedQuantity(next.operatorHours/next.quantity)])!==JSON.stringify([previous.workId,previous.unit,previous.resourcePlan,previous.selectedNormHours,roundedQuantity(previous.workerHours/previous.quantity),roundedQuantity(previous.operatorHours/previous.quantity)]))throw new Error(`${previous.workName}: ijrodagi band me’yori o‘zgartirilmaydi. Yangi ishni alohida band qilib kiriting.`);
 }
 const lines=result.lines.filter(l=>l.quantity>0).map(l=>{const prev=old?.lines.find(p=>p.id===l.id),monthly=prev?.monthly.slice()??Array(12).fill(0);if(monthly.reduce((a,b)=>a+b,0)>l.quantity+eps){for(let m=0;m<12;m++)monthly[m]=annualUsage(l.id,policy.year,orders,m+1).used;}return {...structuredClone(l),monthly};});
 const program:BudgetProgram={id:crypto.randomUUID(),year:policy.year,revision:(old?.revision??0)+1,approvedAt:new Date().toISOString(),approvedBy:actor,state:'APPROVED',fingerprint,snapshot:structuredClone(snapshot),policy:structuredClone(policy),limit,total:result.total,requiredTotal:need.total,deferred:selection.lines.filter(l=>l.deferredQuantity>0).map(l=>({lineId:l.id,quantity:l.deferredQuantity,unit:l.unit,workName:l.workName})),lines};
 if(old)old.state='SUPERSEDED';ledger.programs.unshift(program);return {program,reused:false};
}
export function allocateMonths(year:number,lineId:string,monthly:number[],orders:WorkOrderDetail[],ledger=annualLedger){
 const program=activeProgram(year,ledger),line=program?.lines.find(l=>l.id===lineId);if(!line)throw new Error('Tasdiqlangan budjet bandi topilmadi.');
 if(monthly.length!==12||monthly.some(n=>!Number.isFinite(n)||n<0))throw new Error('12 oy uchun manfiy bo‘lmagan hajm kiriting.');
 if(normalizeUnit(line.unit)==='dona'&&monthly.some(n=>!Number.isInteger(n)))throw new Error('Oylik element sonlari butun bo‘lsin.');
 const values=monthly.map(roundedQuantity);
 if(values.reduce((a,b)=>a+b,0)>line.quantity+eps)throw new Error('Oylik hajmlar yig‘indisi tasdiqlangan yillik rejadan oshdi.');
 for(let m=0;m<12;m++)if(values[m]!+eps<annualUsage(lineId,year,orders,m+1).used)throw new Error(`${m+1}-oyda bajarilgan yoki topshiriqqa band hajm bor. Uni kamaytirib bo‘lmaydi.`);
 line.monthly=values;return program!;
}
export function annualSourceId(year:number,lineId:string,month:number){return `annual:${year}:${encodeURIComponent(lineId)}:${String(month).padStart(2,'0')}`;}
export function annualSource(id:string,ledger=annualLedger){
 for(const program of ledger.programs.filter(p=>p.state==='APPROVED'))for(const line of program.lines)for(let m=1;m<=12;m++)if(id===annualSourceId(program.year,line.id,m))return {program,line,month:m};return undefined;
}
export function bindAnnualInput(input:ManualPlanInput,orders:WorkOrderDetail[],ledger=annualLedger){
 const year=Number(input.scheduledDate.slice(0,4)),program=activeProgram(year,ledger),source=annualSource(input.sourceDefectId??'',ledger);
 if(source&&source.program.year!==year)throw new Error('Topshiriq sanasi tasdiqlangan yillik rejaga mos emas.');
 if(!program){if(ledger.programs.some(p=>p.state==='APPROVED'))throw new Error('Tanlangan yil uchun saqlash budjeti tasdiqlanmagan.');return undefined;}
 const line=source?.line??program.lines.find(l=>l.roadId===input.roadId&&l.workId===input.workVariantId&&(!input.annualLineId||l.id===input.annualLineId));
 if(!line)throw new Error('Bu ish tasdiqlangan yillik budjetda yo‘q. Avval budjetga o‘zgartirish kiriting.');
 if(!source&&!input.annualLineId&&program.lines.filter(l=>l.roadId===input.roadId&&l.workId===input.workVariantId).length>1)throw new Error('Mos yillik reja bandini tanlang.');
 if(line.workId!==input.workVariantId||line.roadId!==input.roadId)throw new Error('Ish yoki yo‘l budjet bandiga mos emas.');
 if(JSON.stringify(input.resourcePlan??null)!==JSON.stringify(line.resourcePlan??null)||input.selectedNormHours!==line.selectedNormHours)throw new Error('Resurs tarkibi va tanlangan norma tasdiqlangan budjet bandiga mos bo‘lsin.');
 const end=input.scheduledEndDate??input.scheduledDate,month=Number(input.scheduledDate.slice(5,7));
 if(end.slice(0,7)!==input.scheduledDate.slice(0,7)||source&&month!==source.month)throw new Error('Topshiriq bitta ajratilgan oy ichida bo‘lsin. Keyingi oy uchun alohida topshiriq yarating.');
 const quantity=Number(input.exactQuantity),usage=annualUsage(line.id,year,orders,month),annual=annualUsage(line.id,year,orders);
 if(!Number.isFinite(quantity)||quantity<=0||usage.used+quantity>line.monthly[month-1]!+eps||annual.used+quantity>line.quantity+eps)throw new Error(`Yillik/oylik limit yetmaydi. Bu oyda qolgan hajm: ${roundedQuantity(Math.max(0,line.monthly[month-1]!-usage.used))} ${line.unit}.`);
 return {year,lineId:line.id,budgetVersionId:program.id};
}
export function checkAnnualOrders(newOrders:WorkOrderDetail[],orders:WorkOrderDetail[],ledger=annualLedger){
 for(const order of newOrders){const ref=order.annualRef;if(!ref)continue;const p=activeProgram(ref.year,ledger),l=p?.lines.find(l=>l.id===ref.lineId);if(!l||Number(order.scheduledDate.slice(0,4))!==ref.year||normalizeUnit(order.exactQuantity.unit)!==normalizeUnit(l.unit))throw new Error('Topshiriq yili, bandi yoki birligi yillik rejaga mos emas.');
  const all=[...orders.filter(o=>!newOrders.some(n=>n.id===o.id)),...newOrders],m=Number(order.scheduledDate.slice(5,7));if(annualUsage(l.id,ref.year,all).used>l.quantity+eps||annualUsage(l.id,ref.year,all,m).used>l.monthly[m-1]!+eps)throw new Error('Topshiriqlar yig‘indisi yillik yoki oylik limitdan oshdi.');
 }
}
export function annualView(year:number,orders:WorkOrderDetail[],ledger=annualLedger){
 const program=activeProgram(year,ledger);if(!program)return {program:null,lines:[],progress:0};
 const lines=program.lines.map(l=>{const u=annualUsage(l.id,year,orders);return {...l,...u,remaining:roundedQuantity(l.quantity-u.used),percent:l.quantity?100*u.completed/l.quantity:0,months:l.monthly.map((planned,i)=>({...annualUsage(l.id,year,orders,i+1),planned,month:i+1}))};});
 const hours=lines.reduce((s,l)=>s+l.workerHours+l.operatorHours,0);const progress=hours?lines.reduce((s,l)=>s+(l.workerHours+l.operatorHours)*l.percent,0)/hours:lines.reduce((s,l)=>s+l.percent,0)/Math.max(1,lines.length);
 return {program,lines,progress};
}
