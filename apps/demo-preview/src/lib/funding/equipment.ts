import {equipmentNorms} from './norms';
import type {FundingPolicy} from './types';
export const staffRoles:Record<string,string>={yol_ishchisi:'Yo‘l ishchisi',mashinist:'Mashinist / haydovchi',haydovchi:'Haydovchi',yol_ustasi:'Yo‘l ustasi',energetik:'Energetik',mexanik:'Mexanik',hht_muhandisi:'Harakat xavfsizligi muhandisi',ytb_boshligi:'Bo‘lim boshlig‘i',other:'Hisobchi va boshqa xodimlar'};
export function equipmentHeadcounts(policy:FundingPolicy,workers:number,operators:number,supervisors:number){
 const heads:Record<string,number>={yol_ishchisi:workers,mashinist:operators,yol_ustasi:supervisors};
 for(const s of policy.staff??[])heads[s.role]=(heads[s.role]??0)+s.heads;
 return heads;
}
export function equipmentBudget(policy:FundingPolicy,workers:number,operators:number,supervisors:number){
 const counts=equipmentHeadcounts(policy,workers,operators,supervisors);
 return equipmentNorms.map(n=>{
  const heads=n.scope==='division'?policy.divisionCount:n.scope==='worksite'?policy.worksiteCount??1:n.scope==='personal'?n.roles.reduce((s,r)=>s+(counts[r]??0),0):0;
  const basisQuantity=n.assumed?policy.equipmentIssueQuantity?.[n.id]??1:n.quantity;
  const stock=policy.equipmentStock?.[n.id]??0;
  const quantity=n.scope==='work'?0:n.months?heads*basisQuantity*12/n.months:Math.max(0,heads*basisQuantity-stock);
  const price=n.scope==='work'?0:policy.equipmentPrices[n.id]??null;
  return {id:n.id,name:n.name,heads,basisQuantity,stock,scope:n.scope,quantity,unit:n.unit,months:n.months,price,amount:price===null?null:quantity*price,
   source:`IQN 03-24 · 3-jadval, ${n.row}-qator · ${n.scope==='work'?'ish hajmidan; materiallar hisobida, takror qo‘shilmaydi':n.scope==='division'?'bo‘lim hisobida':n.scope==='worksite'?'ish joyi hisobida':n.roles.map(r=>staffRoles[r]).join(', ')}${n.assumed?' · berish miqdori — tasdiqlanadigan hisob sharti':''}${!n.months&&n.scope!=='work'?' · xizmat muddati berilmagan; ehtiyoj minus yaroqli qoldiq':''}`};
 });
}
