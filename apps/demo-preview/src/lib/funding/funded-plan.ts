import {calculateFunding} from './calculate';
import {parseBudgetLimit} from './allocation';
import {normalizeUnit} from '../iqn/catalog';
import type {AssetSnapshot,FundingPolicy} from './types';

// Recalculate staffing and IQN 03 equipment after every quantity change.
// Proportional money allocation cannot model whole-worker and fixed costs.
export function fundedPlan(snapshot:AssetSnapshot,policy:FundingPolicy,limitInput:unknown,minimums:Record<string,number>={}) {
 const need=calculateFunding(snapshot,policy),limit=parseBudgetLimit(limitInput);
 const quantities:Record<string,number>={};
 for(const line of need.lines){const min=minimums[line.id]??0;if(!Number.isFinite(min)||min<0||min>line.quantity+1e-6)throw new Error(`${line.assetName}: yangi yillik hajm bajarilgan va band hajmdan kam.`);quantities[line.id]=min;}
 for(const [id,quantity] of Object.entries(minimums))if(quantity>0&&!need.lines.some(l=>l.id===id))throw new Error('Bajarilgan yoki band ishni yillik rejadan o‘chirib bo‘lmaydi.');
 const recalc=()=>calculateFunding(snapshot,policy,quantities);
 let funded=limit===null||limit>=need.total?need:recalc();
 let issue='';
 if(limit!==null&&funded.total>limit+.005&&funded!==need)issue='Mablag‘ doimiy xarajatlar va bajarilgan yoki band ishlarga ham yetmaydi. Shtat/xarajatlarni asos bilan qayta ko‘ring yoki budjetni oshiring.';
 if(limit!==null&&limit<need.total&&!issue){
  const ordered=[...need.lines].sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
  const setPrefix=(count:number)=>{ordered.forEach((line,i)=>{quantities[line.id]=i<count?line.quantity:minimums[line.id]??0;});return recalc();};
  let low=0,high=ordered.length;
  while(low<high){const mid=Math.ceil((low+high)/2);if(setPrefix(mid).total<=limit+.005)low=mid;else high=mid-1;}
  funded=setPrefix(low);
  const line=ordered[low];
  if(line){
   const initial=quantities[line.id]??0,step=normalizeUnit(line.unit)==='dona'?1:0.000001;
   let lo=0,hi=Math.floor((line.quantity-initial)/step+1e-7);
   while(lo<hi){const mid=Math.ceil((lo+hi)/2);quantities[line.id]=initial+mid*step;if(recalc().total<=limit+.005)lo=mid;else hi=mid-1;}
   quantities[line.id]=Math.round((initial+lo*step)*1e6)/1e6;funded=recalc();
  }
 }
 const lines=need.lines.map(line=>{const selected=funded.lines.find(l=>l.id===line.id)!;return {...line,fundedQuantity:issue?0:selected.quantity,deferredQuantity:issue?line.quantity:Math.max(0,Math.round((line.quantity-selected.quantity)*1e6)/1e6)};});
 if(!issue&&!funded.lines.some(l=>l.quantity>0))issue='Mablag‘ ish hajmini moliyalashtirishga yetmaydi.';
 return {need,funded,lines,issue,limit,remaining:limit===null?null:Math.max(0,Math.round((limit-funded.total)*100)/100),shortfall:limit===null?0:Math.max(0,Math.round((need.total-limit)*100)/100)};
}
