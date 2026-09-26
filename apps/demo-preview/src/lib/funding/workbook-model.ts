import {coverageRows} from './coverage';
import {staffRoles} from './equipment';
import {calculateFunding,fleetRequirements} from './calculate';
import {parseBudgetLimit} from './allocation';
import {fundedPlan} from './funded-plan';
import {conditionLabels,equipmentNorms,importanceLabels} from './norms';
import {iqnWorkCatalog} from '../iqn/catalog';
import type {AssetSnapshot,FundingPolicy} from './types';

export type BookCell={value:string|number|null;formula?:string;style:string};
export type BookSheet={name:string;widths:number[];rows:Record<number,BookCell[]>;heights:Record<number,number>;merges:string[];freeze:number;filter?:string;tabColor:string;landscape:boolean};
export type BudgetBook={sheets:BookSheet[];total:number;year:number;checks:{sheet:string;cell:string;value:number}[]};
export const column=(n:number):string=>{let result='';for(;n;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;};
const c=(value:string|number|null,style=typeof value==='number'?(Number.isInteger(value)?'integer':'number'):'text'):BookCell=>({value,style});
const f=(formula:string,value:number|string|null,style='formulaMoney'):BookCell=>({formula,value,style:typeof value==='number'&&Number.isInteger(value)&&['formula','link','number'].includes(style)?`${style}Integer`:style});
const sref=(name:string,cell:string)=>`'${name.replaceAll("'","''")}'!${cell}`;
const sum=(ns:number[])=>ns.reduce((a,b)=>a+b,0);
const dataStart=8;
const totalRow=(count:number)=>dataStart+Math.max(1,count);

/** One model owns both the authored XLSX and every runtime download. */
export function budgetWorkbookModel(snapshot:AssetSnapshot,policy:FundingPolicy,limitInput:unknown=null,createdAt=new Date().toISOString()):BudgetBook {
 const selection=fundedPlan(snapshot,policy,limitInput),result=selection.need,limit=parseBudgetLimit(limitInput),allocation={roads:result.roads.map(r=>({...r,allocated:limit===null?null:selection.funded.roads.find(v=>v.id===r.id)?.amount??0,shortfall:limit===null?null:Math.max(0,r.amount-(selection.funded.roads.find(v=>v.id===r.id)?.amount??0))})),allocated:limit===null?null:selection.funded.total,shortfall:limit===null?null:selection.shortfall,unallocated:selection.remaining};
 const selected=snapshot.roads.filter(r=>policy.roadSelection.includes(r.id));
 const roadById=new Map(selected.map(r=>[r.id,r]));
 const isSample=snapshot.mode==='DEMO'||/namuna/i.test(policy.reference)||result.resources.some(r=>/namuna/i.test(r.source));
 const status=`${isSample?'NAMUNA. ':''}${result.complete?'Kiritilgan hajm va tariflar asosidagi hisob.':'QISMAN HISOB. Yetishmagan me’yor va narxlar jami summaga to‘liq kirmagan.'}`;
 const context=`${policy.year}-yil. ${selected.length} ta yo‘l. ${sum(selected.map(r=>r.lengthKm))} km. Summalar so‘mda.`;
 const sheets:BookSheet[]=[];
 const sheet=(name:string,title:string,widths:number[],note:string,output=false):BookSheet=>{
  const sh:BookSheet={name,widths:[2,2,...widths],rows:{},heights:{1:8,2:30,3:23,4:34,5:10,6:8,7:38},merges:[],freeze:7,tabColor:output?'#17324D':'#527A8A',landscape:true};
  const last=column(sh.widths.length);
  sh.rows[2]=[c(null),c(null),c(title,'title')];sh.merges.push(`C2:${last}2`);
  sh.rows[3]=[c(null),c(null),c(context,'subtitle')];sh.merges.push(`C3:${last}3`);
  sh.rows[4]=[c(null),c(null),c(note,'note')];sh.merges.push(`C4:${last}4`);
  sheets.push(sh);return sh;
 };
 const row=(sh:BookSheet,r:number,values:BookCell[],height=32)=>{sh.rows[r]=[c(null),c(null),...values];sh.heights[r]=height;};
 const header=(sh:BookSheet,labels:string[])=>row(sh,7,labels.map(x=>c(x,'header')),42);
 const table=(sh:BookSheet,rows:BookCell[][])=>{const data=rows.length?rows:[Array.from({length:sh.widths.length-2},(_,i)=>c(i===0?'Ma’lumot yo‘q':null))];data.forEach((values,i)=>{
  const lines=Math.max(...values.map((v,k)=>typeof v.value==='string'?Math.ceil(v.value.length/Math.max(8,(sh.widths[k+2]??20)-2)):1));
  row(sh,dataStart+i,values,Math.min(300,Math.max(32,lines*14+10)));
 });sh.filter=`C7:${column(sh.widths.length)}${dataStart+data.length-1}`;};
 const totals=(sh:BookSheet,r:number,values:BookCell[])=>row(sh,r,values.map(v=>({...v,style:v.style.includes('Percent')?'totalPercent':v.style==='integer'||v.style.endsWith('Integer')?'totalInteger':['number','formula','link'].includes(v.style)?'totalNumber':typeof v.value==='number'||v.formula?'totalMoney':'total'})),34);
 const moneySum=(name:string,col:string,n:number,value:number)=>f(`SUM(${sref(name,`${col}${dataStart}:${col}${totalRow(n)-1}`)})`,value,'link');

 const summary=sheet('Jamlama','YO‘LLARNI SAQLASH BUDJETI',[40,23,14,5,32,23],status,true);summary.freeze=0;
 const roadsSheet=sheet('Yo‘llar','YO‘LLAR BO‘YICHA MABLAG‘',[13,38,15,10,25,13,17,20,20,22,22,22,17], 'Ehtiyoj = bevosita xarajat + umumiy xarajat ulushi. Limit bo‘yicha ajratma — rejalashtirish ssenariysi.',true);
 const payroll=sheet('Ish haqi','XODIMLAR VA YILLIK ISH HAQI',[29,17,17,12,20,13,13,19,19,21,24,15], 'Shtat jami odam-soatdan tashkilot bo‘yicha bir marta yaxlitlanadi. Ustalar shtati alohida hisoblanadi.');
 const works=sheet('Ishlar','YILLIK ISHLAR VA BEVOSITA XARAJATLAR',[13,28,17,48,14,12,17,17,21,21,21,23,52,58], 'Hajm va mehnat soatlari tizimdan olingan. Davriylik yillik hajmga kiritilgan. Ishlar jadvaliga umumiy xarajatlar yana qo‘shilmaydi.');
 const resources=sheet('Resurslar','MATERIAL VA MASHINA-MEXANIZMLAR',[13,16,16,38,12,20,20,23,44,37], 'Material narxi yetkazish va saqlash bilan; mashina-soat narxi haydovchi oyligisiz. Bo‘sh narx hisoblanmagan xarajatni bildiradi.');
 const kit=sheet('Jihozlar','JIHOZ VA ASBOBLARNING YILLIK XARAJATI',[32,25,15,16,15,17,12,20,23,50], 'IQN 03-24 bo‘yicha xizmat muddatiga mutanosib yillik ulush. Bu aniq xarid jadvali emas. Ko‘k narx kataklari tahrirlanadi.');
 const fleet=sheet('Texnika parki','TEXNIKA PARKI EHTIYOJI',[46,35,20,19,45], 'IQN 02-24, 3-ilova. Park quvvati xarid qiymati yoki mashina-soat emas; budjet summasiga yana qo‘shilmaydi.');
 const settings=sheet('Hisob shartlari','HISOB SHARTLARI VA TARIFLAR',[46,22,18,66], 'Ko‘k kataklarda tarif va hisob shartlari tahrirlanadi. Aktivlar, ish hajmlari va me’yorlarni tizimda yangilab, Excel’ni qayta yuklang.');settings.tabColor='#367D91';
 const settingsRows:[string,number|string|null,string,string][]=[
  ['Hisob yili',policy.year,'yil','Eksport qilingan hisob davri'],
  ['Bir xodimning yillik ish vaqti',policy.annualHours,'soat','Tashkilot tasdiqlagan yillik ish vaqti'],
  ['Ishchining asosiy oyligi',policy.workerMonthly,'so‘m/oy',policy.reference],
  ['Mashinistning asosiy oyligi',policy.operatorMonthly,'so‘m/oy',policy.reference],
  ['Yo‘l ustasining asosiy oyligi',policy.supervisorMonthly,'so‘m/oy',policy.reference],
  ['Oylik koeffitsiyenti',policy.wageCoefficient,'koeffitsiyent',policy.reference],
  ['Ish haqiga ustama',policy.allowancePercent/100,'foiz',policy.reference],
  ['Bir xodimning ovqat puli',policy.mealPerMonth,'so‘m/oy',policy.reference],
  ['Bir xodimning bayram puli',policy.holidayPerYear,'so‘m/yil',policy.reference],
  ['Yo‘l ustalari soni — qo‘lda',policy.supervisors,'nafar','Bo‘sh katak: IQN 03-24, 10.3-band bo‘yicha hisob'],
  ['Bir ustaga xizmat uzunligi',20,'km','IQN 03-24, 10.3-band'],
  ['Yo‘l bo‘limlari soni',policy.divisionCount,'ta','Jihozlar hisobidagi tashkiliy bo‘linmalar'],
  ['Ish beruvchining ijtimoiy xarajati',policy.employerTaxPercent/100,'foiz','Ish haqi fondidan hisoblanadi'],
  ['Ustama xarajat',policy.overheadPercent/100,'foiz','Ish haqi, resurs, jihoz, ijtimoiy va boshqa xarajatlar yig‘indisidan'],
  ['Zaxira',policy.contingencyPercent/100,'foiz','Ustama xarajat qo‘shilgan jami summadan'],
  ['Boshqa asoslangan xarajat',result.other,'so‘m/yil',policy.reference],
  ['Mavjud budjet limiti',limit,'so‘m','Bo‘sh: limit belgilanmagan. 0: mablag‘ ajratilmagan.'],
 ];
 const S={hours:'D9',worker:'D10',operator:'D11',foreman:'D12',coefficient:'D13',allowance:'D14',meal:'D15',holiday:'D16',supervisors:'D17',supervisorKm:'D18',divisions:'D19',tax:'D20',overhead:'D21',reserve:'D22',other:'D23',limit:'D24'};
 const sf=(cell:string)=>sref(settings.name,cell);
 header(settings,['Ko‘rsatkich','Qiymat','Birlik','Asos']);table(settings,settingsRows.map(([label,value,unit,basis],i)=>[c(label),c(value,[6,12,13,14].includes(i)?'inputPercent':[2,3,4,7,8,15,16].includes(i)?'inputMoney':i===0?'year':i===10?'integer':'input'),c(unit),c(basis)]));
 const ratesHeader=28,ratesStart=29,rateRow=new Map(result.resources.map((r,i)=>[r.key,ratesStart+i]));
 row(settings,ratesHeader,['Resurs narxi','Birlik narxi, so‘m','Birlik','Narx manbasi'].map(x=>c(x,'header')),36);
 result.resources.forEach((r,i)=>row(settings,ratesStart+i,[c(r.name),c(r.price,'inputMoney'),c(r.unit),c(r.source||'Narx asosi kerak')],Math.max(34,Math.ceil(r.name.length/42)*15+12)));
 row(settings,26,[c('Tizimdagi summa — eksport paytida'),c(result.total,'money'),c('so‘m'),c('Mustaqil solishtirish uchun saqlangan summa')]);
 const settingsTail=ratesStart+Math.max(1,result.resources.length)+2;
 const sourceNotes=[`Aktivlar manbasi: ${snapshot.source}`,`Aktivlar tekshiruvi: ${snapshot.observedAt}. Eksport: ${createdAt.slice(0,10)}.`, `Eksport paytidagi holat: ${status}`, `Tarif va hisob asosi: ${policy.reference}`, ...result.warnings,...(policy.otherCosts??[]).map(c=>`${c.name}: ${c.amount} so‘m/yil. ${c.basis}`),...(policy.staff??[]).map(c=>`${staffRoles[c.role]}: ${c.heads} odam, ${c.fte} stavka. ${c.basis}`),
  'IQN 02-24: 1.3–1.7-bandlar, ish turlari me’yorlari va 1-ilova davriyligi. Ahamiyat yoki holat uchun umumiy pul koeffitsiyenti qo‘llanmagan.',
  'IQN 03-24: 7.3-band — mashinist oyligi alohida; 8.3-band — material narxi tarkibi; 3-jadval — jihozlar muddati; 10.3-band — ustalar shtati.',
  'Cheklangan budjet ahamiyat va holat ustuvorligida taqsimlanadi. Yo‘llar tartibi eksport paytidagi ssenariydan olingan.',
  ...result.gaps.map(g=>`Aniqlashtirish kerak: ${g}`)];
 row(settings,settingsTail,[c('MANBALAR VA ANIQLASHTIRISHLAR','section')],28);settings.merges.push(`C${settingsTail}:F${settingsTail}`);
 sourceNotes.forEach((note,i)=>{const r=settingsTail+1+i;row(settings,r,[c(note,note.startsWith('Aniqlashtirish')?'warning':'note')],Math.max(30,Math.ceil(note.length/128)*15+12));settings.merges.push(`C${r}:F${r}`);});

 const workEnd=totalRow(result.lines.length),resourceEntries=result.lines.flatMap((l,i)=>l.resources.map(r=>({line:l,workRow:dataStart+i,resource:r})));
 const resEnd=totalRow(resourceEntries.length),roadEnd=totalRow(result.roads.length),kitEnd=totalRow(result.ppeRows.length);
 header(payroll,['Xodim toifasi','Yillik mehnat, soat','Bir xodim vaqti, soat','Shtat, nafar','Asosiy oylik, so‘m','Koeffitsiyent','Ustama, %','Ovqat puli, so‘m/oy','Bayram puli, so‘m/yil','Bir xodim oyligi, so‘m','Yillik fond, so‘m','Haqiqiy odam']);
 const prows=result.payrollRows.map((p,i)=>{const r=dataStart+i,hours=i===0?result.workerHours:i===1?result.operatorHours:null,base=p.base??[policy.workerMonthly,policy.operatorMonthly,policy.supervisorMonthly][i]!;
  return [c(p.name),i<2?moneySum(works.name,i===0?'I':'J',result.lines.length,hours!):c(null),i<2?f(sf(S.hours),policy.annualHours,'link'):c(null),i<2?f(`ROUNDUP(D${r}/E${r},0)`,p.count,'formula'):i>2?c(p.count,'input'):f(`IF(COUNT(${sf(S.supervisors)})=0,ROUNDUP(SUM(${sref(roadsSheet.name,`H8:H${roadEnd-1}`)})/${sf(S.supervisorKm)},0),${sf(S.supervisors)})`,p.count,'link'),i>2?c(base,'inputMoney'):f(sf([S.worker,S.operator,S.foreman][i]!),base,'linkMoney'),f(sf(S.coefficient),policy.wageCoefficient,'link'),f(sf(S.allowance),policy.allowancePercent/100,'linkPercent'),f(sf(S.meal),policy.mealPerMonth,'linkMoney'),f(sf(S.holiday),policy.holidayPerYear,'linkMoney'),f(`G${r}*H${r}*(1+I${r})+J${r}+K${r}/12`,p.monthly),f(`L${r}*F${r}*12`,p.annual),i<3?f(`F${r}`,p.heads??p.count,'link'):c(p.heads??p.count,'input')];
 });const payrollEnd=totalRow(result.payrollRows.length);table(payroll,prows);totals(payroll,payrollEnd,[c('JAMI'),f(`SUM(D8:D${payrollEnd-1})`,result.workerHours+result.operatorHours,'formula'),c(null),f(`SUM(F8:F${payrollEnd-1})`,sum(result.payrollRows.map(r=>r.count)),'formula'),...Array(6).fill(c(null)),f(`SUM(M8:M${payrollEnd-1})`,result.labor),f(`SUM(N8:N${payrollEnd-1})`,sum(result.payrollRows.map(p=>p.heads??p.count)),'formula')]);

 header(resources,['Yo‘l','Ishlar varag‘i','Resurs turi','Resurs nomi','Birlik','Yillik miqdor','Birlik narxi, so‘m','Yillik summa, so‘m','Narx manbasi','Holat']);
 table(resources,resourceEntries.map(({line,workRow,resource:r},i)=>{
  const rr=dataStart+i,pr=sref(settings.name,`D${rateRow.get(r.key)}`);
  return [c(roadById.get(line.roadId)!.code),c(`${workRow}-qator`),c(r.kind==='material'?'Material':'Mashina'),c(r.name),c(r.unit),c(r.quantity,'quantity'),f(`IF(COUNT(${pr})=0,"",${pr})`,r.price,'linkMoney'),f(`IF(COUNT(I${rr})=0,"",H${rr}*I${rr})`,r.amount),c(/namuna/i.test(r.source)?'Namuna tarif':r.source),f(`IF(COUNT(I${rr})=0,"Narx yoki tarif asosi kerak","Hisoblangan")`,r.price===null?'Narx yoki tarif asosi kerak':'Hisoblangan','text')];
 }));totals(resources,resEnd,[c('JAMI'),...Array(6).fill(c(null)),f(`SUM(J8:J${resEnd-1})`,result.materials+result.machinery)]);

 header(works,['Yo‘l','Aktiv','IQN kodi','Ish turi','Yillik hajm','Birlik','Ishchi soati','Mashinist soati','Ish haqi ulushi','Material, so‘m','Mashina, so‘m','Bevosita jami, so‘m','Me’yor va davriylik','Aniqlashtirish']);
 table(works,result.lines.map((l,i)=>{const r=dataStart+i,wages=(result.workerHours?l.workerHours/result.workerHours*result.payrollRows[0]!.annual:0)+(result.operatorHours?l.operatorHours/result.operatorHours*result.payrollRows[1]!.annual:0);
  const resourceSum=(kind:string)=>`SUMIFS(${sref(resources.name,`$J$8:$J$${resEnd-1}`)},${sref(resources.name,`$D$8:$D$${resEnd-1}`)},"${r}-qator",${sref(resources.name,`$E$8:$E$${resEnd-1}`)},"${kind}")`;
  return [c(roadById.get(l.roadId)!.code),c(l.assetName),c(iqnWorkCatalog.find(w=>w.id===l.workId)?.code??l.workId),c(l.workName),c(l.quantity),c(l.unit),c(l.workerHours),c(l.operatorHours),f(`IF(${sref(payroll.name,'D8')}=0,0,I${r}/${sref(payroll.name,'D8')}*${sref(payroll.name,'M8')})+IF(${sref(payroll.name,'D9')}=0,0,J${r}/${sref(payroll.name,'D9')}*${sref(payroll.name,'M9')})`,wages,'linkMoney'),f(resourceSum('Material'),sum(l.resources.filter(x=>x.kind==='material').map(x=>x.amount??0)),'linkMoney'),f(resourceSum('Mashina'),sum(l.resources.filter(x=>x.kind==='machine').map(x=>x.amount??0)),'linkMoney'),f(`SUM(K${r}:M${r})`,l.directCost),c(`${l.normReference}. ${l.frequencySource}`),c(l.gaps.length?l.gaps.join('\n'):'—')];
 }));totals(works,workEnd,[c('JAMI'),...Array(5).fill(c(null)),f(`SUM(I8:I${workEnd-1})`,result.workerHours,'formula'),f(`SUM(J8:J${workEnd-1})`,result.operatorHours,'formula'),f(`SUM(K8:K${workEnd-1})`,result.payrollRows[0]!.annual+result.payrollRows[1]!.annual),f(`SUM(L8:L${workEnd-1})`,result.materials),f(`SUM(M8:M${workEnd-1})`,result.machinery),f(`SUM(N8:N${workEnd-1})`,sum(result.lines.map(l=>l.directCost)))]);

 header(kit,['Jihoz / asbob','Kimga / qamrov','Soni (xodim/bo‘lim)','Bir birlikka me’yor','Xizmat muddati, oy','Yillik ulush','Birlik','Birlik narxi, so‘m','Yillik xarajat, so‘m','IQN manbasi']);
 const roles=['yol_ishchisi','mashinist','yol_ustasi',...(policy.staff??[]).map(s=>s.role)];
 table(kit,result.ppeRows.map((p,i)=>{const r=dataStart+i,n=equipmentNorms.find(n=>n.id===p.id)!;
  const refs=roles.flatMap((role,index)=>(n.roles as string[]).includes(role)?[sref(payroll.name,`N${dataStart+index}`)]:[]);
  const countFormula=n.scope==='division'?sf(S.divisions):n.scope==='worksite'?String(policy.worksiteCount??1):n.scope==='work'?'0':refs.length?refs.join('+'):'0';
  const quantityFormula=n.scope==='work'?'0':n.months?`E${r}*F${r}*12/G${r}`:`MAX(0,E${r}*F${r}-${p.stock??0})`;
  return [c(p.name),c(n.scope==='division'?'Yo‘l bo‘limi':n.scope==='worksite'?'Ish joyi':n.scope==='work'?'Ish materiallarida':n.roles.map(r=>staffRoles[r]).join(', ')),f(countFormula,p.heads??0,'link'),c(p.basisQuantity??n.quantity,n.assumed?'input':'number'),c(p.months),f(quantityFormula,p.quantity,'formula'),c(p.unit),c(p.price,'inputMoney'),f(`IF(COUNT(J${r})=0,"",H${r}*J${r})`,p.amount),c(p.source)];
 }));totals(kit,kitEnd,[c('JAMI'),...Array(7).fill(c(null)),f(`SUM(K8:K${kitEnd-1})`,result.ppe)]);
 const fleetData=fleetRequirements(selected);header(fleet,['Texnika nomi','Tavsifi','Hisobiy birlik','Yaxlitlangan park','Asos / yetishmagan me’yor']);table(fleet,fleetData.map((x,i)=>[c(x.name),c(x.specification),c(x.quantity),f(`ROUNDUP(E${dataStart+i},0)`,Math.ceil(x.quantity),'formula'),c(`${x.source}${x.unavailable.length?`. Norma berilmagan: ${x.unavailable.join(', ')}`:''}`)]));

 const workDirect=sum(result.lines.map(l=>l.directCost));
 header(roadsSheet,['Yo‘l kodi','Yo‘l nomi','Ahamiyati','Toifasi','Holati','Uzunlik, km','1 km uchun, so‘m','Bevosita xarajat','Umumiy xarajat ulushi','Jami ehtiyoj, so‘m','Limitdan ajratma','Yetishmaydi, so‘m','Aniqlashtirishlar']);
 table(roadsSheet,allocation.roads.map((a,i)=>{const r=dataStart+i,road=roadById.get(a.id)!,ls=result.lines.filter(l=>l.roadId===a.id),direct=sum(ls.map(l=>l.directCost));
  // Explicit row references keep identically named roads separate without relying on road-code uniqueness.
  const refs=result.lines.flatMap((l,index)=>l.roadId===a.id?[sref(works.name,`N${dataStart+index}`)]:[]);
  const share=workDirect?direct/workDirect:road.lengthKm/sum(selected.map(r=>r.lengthKm));
  const remaining=`MAX(0,${sref(summary.name,'D20')}${i?`-SUM(L8:L${r-1})`:''})`;
  const totalFormula=`IF(SUM(J${r}:K${r})<=0,0,${i===allocation.roads.length-1?remaining:`IF(SUM(J${r+1}:K${roadEnd-1})<=0,${remaining},MIN(MAX(0,ROUND(SUM(J${r}:K${r}),2)),${remaining}))`})`;
  const amountFormula=`IF(COUNT(${sf(S.limit)})=0,"",MIN(L${r},MAX(0,${sf(S.limit)}${i?`-SUM(M8:M${r-1})`:''})))`;
  return [c(road.code),c(road.name),c(importanceLabels[road.importance]),c(road.category),c(conditionLabels[road.condition]),c(road.lengthKm),f(`L${r}/H${r}`,a.amount/road.lengthKm),f(refs.length?refs.join('+'):'0',direct,'linkMoney'),f(`(${sref(summary.name,'D20')}-${sref(works.name,`N${workEnd}`)})*IF(${sref(works.name,`N${workEnd}`)}=0,H${r}/SUM(H8:H${roadEnd-1}),J${r}/${sref(works.name,`N${workEnd}`)})`,(result.total-workDirect)*share,'linkMoney'),f(totalFormula,a.amount),c(a.allocated,'money'),f(`IF(COUNT(M${r})=0,"",MAX(0,L${r}-M${r}))`,a.shortfall),c(a.missing||0,'integer')];
 }));totals(roadsSheet,roadEnd,[c('JAMI'),...Array(4).fill(c(null)),f(`SUM(H8:H${roadEnd-1})`,sum(selected.map(r=>r.lengthKm)),'formula'),c(null),f(`SUM(J8:J${roadEnd-1})`,workDirect),f(`SUM(K8:K${roadEnd-1})`,result.total-workDirect),f(`SUM(L8:L${roadEnd-1})`,result.total),f(`IF(COUNT(${sf(S.limit)})=0,"",SUM(M8:M${roadEnd-1}))`,allocation.allocated),f(`IF(COUNT(${sf(S.limit)})=0,"",SUM(N8:N${roadEnd-1}))`,allocation.shortfall),c(sum(result.roads.map(r=>r.missing)))]);

 // Compact first page. The only business total lives here; road allocations read it.
 summary.rows[6]=[c(null),c(null),c(result.complete?'YILLIK MABLAG‘ EHTIYOJI':'HISOBLANGAN QISM','section')];summary.merges.push('C6:H6');summary.heights[6]=24;
 summary.rows[7]=[c(null),c(null),f('D20',result.total,'bigMoney')];summary.merges.push('C7:H8');summary.heights[7]=30;summary.heights[8]=16;
 row(summary,11,[c('Xarajat turi','header'),c('Yillik summa, so‘m','header'),c('Ulushi','header'),c(null),c('Qamrov','header'),c('Qiymat','header')],30);
 const costs=[['Ish haqi fondi',`${sref(payroll.name,`M${payrollEnd}`)}`,result.labor],['Materiallar',`SUMIFS(${sref(resources.name,`J8:J${resEnd-1}`)},${sref(resources.name,`E8:E${resEnd-1}`)},"Material")`,result.materials],['Mashina-mexanizmlar',`SUMIFS(${sref(resources.name,`J8:J${resEnd-1}`)},${sref(resources.name,`E8:E${resEnd-1}`)},"Mashina")`,result.machinery],['Jihoz va asboblar',sref(kit.name,`K${kitEnd}`),result.ppe],['Ish beruvchining ijtimoiy xarajati',`D12*${sf(S.tax)}`,result.employerTax],['Boshqa asoslangan xarajat',sf(S.other),result.other],['Ustama xarajat',`SUM(D12:D17)*${sf(S.overhead)}`,result.overhead],['Zaxira',`SUM(D12:D18)*${sf(S.reserve)}`,result.contingency]] as const;
 costs.forEach(([label,formula,value],i)=>row(summary,12+i,[c(label),f(formula,value,'money'),f(`IF($D$20=0,"",D${12+i}/$D$20)`,result.total?value/result.total:null,'percent')],32));
 totals(summary,20,[c(result.complete?'JAMI BUDJET':'JAMI HISOBLANGAN QISM'),f('ROUND(SUM(D12:D19),2)',result.total),f('IF(D20=0,"",SUM(E12:E19))',result.total?1:null,'totalPercent')]);
 const side:[string,BookCell][]=[['Yo‘llar soni',c(selected.length)],['Umumiy uzunlik, km',moneySum(roadsSheet.name,'H',result.roads.length,sum(selected.map(r=>r.lengthKm)))],['Ishchilar, nafar',f(sref(payroll.name,'F8'),result.workers,'number')],['Mashinistlar, nafar',f(sref(payroll.name,'F9'),result.operators,'number')],['Yo‘l ustalari, nafar',f(sref(payroll.name,'F10'),result.payrollRows[2]!.count,'number')],['Ish bandlari',c(result.lines.length)],['Aktivlar tekshiruvi',c(snapshot.observedAt)],['Eksport sanasi',c(createdAt.slice(0,10))]];
 side.forEach(([label,value],i)=>{const cells=summary.rows[12+i]??[];while(cells.length<6)cells.push(c(null));cells[6]=c(label);cells[7]=value;summary.rows[12+i]=cells;});
 row(summary,23,[c('Mavjud budjet'),f(`IF(COUNT(${sf(S.limit)})=0,"",${sf(S.limit)})`,limit,'money'),c(null),c(null),c('Moliyalashtiriladi'),f(`IF(COUNT(${sf(S.limit)})=0,"",${sref(roadsSheet.name,`M${roadEnd}`)})`,allocation.allocated,'money')]);
 row(summary,24,[c('Yetishmaydigan mablag‘'),f(`IF(COUNT(D23)=0,"",MAX(0,D20-D23))`,allocation.shortfall,'money'),c(null),c(null),c('Taqsimlanmagan qoldiq'),f('IF(COUNT(D23)=0,"",MAX(0,D23-H23))',allocation.unallocated,'money')]);
 row(summary,26,[c('Moliyalashtirilgan hajmlar “Budjetga mos reja” varag‘ida. Limit yoki aktivlar o‘zgarsa tizimda qayta hisoblab eksport qiling.','note')],32);summary.merges.push('C26:H26');
 row(summary,28,[c(`Eksport paytida ${result.gaps.length} ta aniqlashtirish mavjud. Tafsilotlar “Hisob shartlari” varag‘ida.`,'note')],30);summary.merges.push('C28:H28');
 row(summary,30,[c('Yo‘llar jami bilan farq'),f(`${sref(roadsSheet.name,`L${roadEnd}`)}-D20`,0,'check')],30);
 row(summary,31,[c('Tizimdagi eksport summasidan farq'),f(`D20-${sf('D26')}`,0,'check')],30);
 const coverage=sheet('IQN qamrovi','IQN QAMROVI VA QARORLAR',[15,55,20,65,60],'Har bir yo‘nalish va davriylik talabi bo‘yicha hisob bandi yoki asoslangan istisno.');
 header(coverage,['Qamrov','Talab','Holat','Qaror va bog‘langan ishlar','Manba']);
 table(coverage,coverageRows(snapshot,policy,result).map(r=>[c(r.scopeLabel),c(r.name),c(r.issue?'Aniqlashtirish':r.decision?.state==='INCLUDED'?'Kiritilgan':'Talab etilmaydi'),c(`${r.decision?.reason??''}${r.decision?.lineIds?.length?' · '+r.available.filter(l=>r.decision!.lineIds!.includes(l.id)).map(l=>l.workName).join('; '):''}${r.issue?' · '+r.issue:''}`),c(r.source)]));
 const funded=sheet('Budjetga mos reja','MOLIYALASHTIRILGAN VA QOLDIRILGAN ISHLAR',[14,30,54,14,18,18,18,14],selection.issue||'Ustuvorlik: aktiv holati va yo‘l ahamiyati. Shtat va jihozlar tanlangan hajm uchun qayta hisoblangan.',true);
 header(funded,['Yo‘l','Aktiv / uchastka','Ish','Birlik','Yillik ehtiyoj','Moliyalashtiriladi','Qoldiriladi','Ustuvorlik']);
 table(funded,selection.lines.map((l,i)=>[c(roadById.get(l.roadId)?.code??l.roadId),c(`${l.assetName} · ${l.chainageStartM??0}–${l.chainageEndM??0} m`),c(l.workName),c(l.unit),c(l.quantity),c(l.fundedQuantity),f(`G${i+8}-H${i+8}`,l.deferredQuantity,'number'),c(l.priority)]));
 const fr=totalRow(selection.lines.length)+2;
 row(funded,fr,[c('Xarajat turi','header'),c('Ajratma, so‘m','header')]);
 [['Ish haqi',selection.funded.labor],['Material',selection.funded.materials],['Texnika',selection.funded.machinery],['Jihoz',selection.funded.ppe],['Ijtimoiy xarajat',selection.funded.employerTax],['Boshqa va ustama',selection.funded.other+selection.funded.overhead],['Zaxira',selection.funded.contingency]].forEach(([name,value],i)=>row(funded,fr+1+i,[c(String(name)),c(Number(value),'money')]));
 totals(funded,fr+8,[c('JAMI MOLIYALASHTIRILADI'),f(`ROUND(SUM(D${fr+1}:D${fr+7}),2)`,selection.funded.total)]);
 row(funded,fr+10,[c('Ishchilar / mashinistlar'),c(`${selection.funded.workers} / ${selection.funded.operators}`)]);
 return {sheets,total:result.total,year:policy.year,checks:[{sheet:summary.name,cell:'D20',value:result.total},{sheet:payroll.name,cell:`M${payrollEnd}`,value:result.labor},{sheet:works.name,cell:`N${workEnd}`,value:workDirect},{sheet:resources.name,cell:`J${resEnd}`,value:result.materials+result.machinery},{sheet:kit.name,cell:`K${kitEnd}`,value:result.ppe},{sheet:roadsSheet.name,cell:`L${roadEnd}`,value:result.total}]};
}
