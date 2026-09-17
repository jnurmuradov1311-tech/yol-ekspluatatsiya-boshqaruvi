import type { ExcelReport } from './excel-report';
import type { WorkOrderDetail, MonthlyCompletionAct } from './types';

export type CostLedgerRow = {
  id: string; kind: 'labor'|'social'|'material'|'equipment'; workOrderId: string; orderNumber: string;
  workDate: string; roadCode: string; workName: string; resourceId: string; resourceName: string;
  resourceCode: string; quantity: number; unit: string; unitRate: number; amount: string;
  rateId: string; rateVersion: number; source: string; formula: string; verifiedBy: string;
  actNumber: string|null; actState: string|null;
};
export type MachineUsageRow = {workOrderId:string;orderNumber:string;workDate:string;roadCode:string;name:string;code:string;equipmentId:string;plannedMinutes:number;actualMinutes:number|null;state:string;amount:string|null;verifiedBy:string};
export type CostLedger = {period:string;rows:CostLedgerRow[];machines:MachineUsageRow[];totals:Record<'labor'|'social'|'material'|'equipment'|'total',string>;audit:Array<{id:string;at:string;actor:string;action:string;recordId:string;reference:string}>};
const cents = (v:number) => Math.round((v+Number.EPSILON)*100);

export function buildCostLedger(period:string, report:ExcelReport|null, orders:WorkOrderDetail[], acts:MonthlyCompletionAct[]):CostLedger {
  const rows:CostLedgerRow[]=[];
  const context=(workOrderId:string)=>{
    const order=orders.find(o=>o.id===workOrderId)!;
    const act=acts.find(a=>a.state!=='DRAFT'&&a.items.some(i=>i.workOrderId===workOrderId));
    return {workOrderId,orderNumber:order.number,workDate:order.scheduledDate,roadCode:order.road.code,workName:order.workName,verifiedBy:order.completion?.verifiedByName??'',actNumber:act?.actNumber??null,actState:act?.state??null};
  };
  for(const worker of report?.payroll.rows??[])for(const s of worker.segments??[]){
    const common={...context(s.workOrderId),resourceId:worker.workerId,resourceName:worker.fullName,resourceCode:worker.workerId,rateId:s.rateId??'snapshot',rateVersion:s.rateVersion??0,source:s.rateSource??report!.payroll.policyReference};
    rows.push({...common,id:`labor:${worker.workerId}:${s.workOrderId}`,kind:'labor',quantity:s.minutes/60,unit:'soat',unitRate:s.monthlySalary,amount:s.gross.toFixed(2),formula:`${s.monthlySalary} × ${s.salaryCoefficient} × ${s.minutes}/${s.normMinutes} + ustama va to‘lovlar`});
    rows.push({...common,id:`social:${worker.workerId}:${s.workOrderId}`,kind:'social',quantity:s.gross,unit:'so‘m',unitRate:s.socialBps/100,amount:s.social.toFixed(2),formula:`${s.gross.toFixed(2)} × ${s.socialBps/100}%`});
  }
  for(const [kind,usages] of [['material',report?.materials??[]],['equipment',report?.equipment??[]]] as const)for(const [index,u] of usages.entries()){
    const t=u.trace;if(!t)throw new Error('Xarajatning topshiriq manbasi topilmadi. Hisobni qayta shakllantiring.');
    const quantity='quantity' in u?u.quantity:u.hours,unit='unit' in u?u.unit:'mashina-soat';
    rows.push({...context(t.workOrderId),id:`${kind}:${t.workOrderId}:${t.resourceId}:${index}`,kind,resourceId:t.resourceId,resourceName:u.name,resourceCode:t.resourceCode,quantity,unit,unitRate:u.price,amount:u.amount.toFixed(2),rateId:t.rateId,rateVersion:t.rateVersion,source:t.rateSource,formula:`${quantity} × ${u.price}`});
  }
  const machines=orders.filter(o=>o.state!=='CANCELLED').flatMap(o=>o.executionResources.equipment.map(e=>{
    const actual=o.completion?.equipment.find(u=>u.equipmentUnitId===e.id);
    const cost=rows.find(r=>r.kind==='equipment'&&r.workOrderId===o.id&&r.resourceId===e.id);
    return {workOrderId:o.id,orderNumber:o.number,workDate:o.scheduledDate,roadCode:o.road.code,name:e.name,code:e.inventoryCode,equipmentId:e.id,plannedMinutes:e.plannedMachineMinutes,actualMinutes:actual?.machineMinutes??null,state:o.state,amount:cost?.amount??(o.completion?.state==='VERIFIED'&&actual?.machineMinutes===0?'0.00':null),verifiedBy:o.completion?.verifiedByName??''};
  }));
  const totals={labor:'0.00',social:'0.00',material:'0.00',equipment:'0.00',total:'0.00'};
  for(const kind of ['labor','social','material','equipment'] as const)totals[kind]=(rows.filter(r=>r.kind===kind).reduce((n,r)=>n+cents(Number(r.amount)),0)/100).toFixed(2);
  totals.total=(rows.reduce((n,r)=>n+cents(Number(r.amount)),0)/100).toFixed(2);
  return {period,rows,machines,totals,audit:[]};
}
