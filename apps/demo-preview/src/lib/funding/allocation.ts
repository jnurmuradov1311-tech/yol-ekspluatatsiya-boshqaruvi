import type {FundingResult} from './types';

export function parseBudgetLimit(value:unknown):number|null {
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='number'&&typeof value!=='string')throw new Error('Mavjud budjet summasini tekshiring.');
 const amount=Number(value);
 if(!Number.isFinite(amount)||amount<0||amount>1e15)throw new Error('Mavjud budjet manfiy bo‘lmagan son bo‘lsin.');
 return Math.round(amount*100)/100;
}

export function allocateBudget(result:FundingResult,limit:number|null) {
 let remaining=parseBudgetLimit(limit);
 const roads=result.roads.map(road=>{
  const allocated=remaining===null?null:Math.min(road.amount,remaining);
  if(allocated!==null)remaining=Math.max(0,Math.round((remaining!-allocated)*100)/100);
  return {...road,allocated,shortfall:allocated===null?null:Math.round((road.amount-allocated)*100)/100};
 });
 return {roads,unallocated:remaining,allocated:limit===null?null:Math.round((limit-remaining!)*100)/100,shortfall:limit===null?null:Math.max(0,Math.round((result.total-limit)*100)/100)};
}
