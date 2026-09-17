"use client";
import Link from 'next/link';
import {api} from '@/lib/api/client';
import {useApiResource} from '@/lib/use-api-resource';
import {useReportMonth} from '@/lib/use-report-month';
import {Badge,Card,EmptyState,ErrorState,LoadingState,PageHeader,TableFrame,TextInput} from '@/components/ui';
const hours=(n:number)=>new Intl.NumberFormat('uz-UZ',{maximumFractionDigits:3}).format(n/60);
export default function EquipmentPage(){
 const [period,setPeriod]=useReportMonth();const {data,error,loading,reload}=useApiResource(()=>api.costLedger(period),`machine-ledger:${period}`);
 return <div className="page-stack"><PageHeader title="Texnika hisobi" description="Har bir mashinaning topshiriq bo‘yicha rejasi va haqiqiy ishlagan vaqti." actions={<><TextInput label="Oy" type="month" value={period} onChange={e=>setPeriod(e.target.value)}/><Link className="button button--secondary" href={`/xarajatlar?month=${period}`}>Xarajatlarni ko‘rish</Link></>}/>
 {loading?<LoadingState/>:error?<ErrorState error={error} retry={reload}/>:data?<>
 <div className="context-strip"><div><span>Rejada</span><strong>{hours(data.machines.reduce((n,r)=>n+r.plannedMinutes,0))} mashina-soat</strong></div><div><span>Tasdiqlangan vaqt</span><strong>{hours(data.machines.filter(r=>r.state==='VERIFIED').reduce((n,r)=>n+(r.actualMinutes??0),0))} mashina-soat</strong></div><div><span>Tekshiruvdagi vaqt</span><strong>{hours(data.machines.filter(r=>r.state==='COMPLETED').reduce((n,r)=>n+(r.actualMinutes??0),0))} mashina-soat</strong></div><div><span>Hisoblangan xarajat</span><strong>{new Intl.NumberFormat('uz-UZ').format(Number(data.totals.equipment))} so‘m</strong></div></div>
 {data.machines.length?<Card><TableFrame label="Mashina va mexanizmlarning ishlashi"><table><thead><tr><th>Texnika</th><th>Sana / topshiriq</th><th>Reja, soat</th><th>Haqiqiy, soat</th><th>Xarajat, so‘m</th><th>Holat</th></tr></thead><tbody>{data.machines.map(r=><tr key={`${r.workOrderId}:${r.equipmentId}`}><td><strong>{r.name}</strong><small>{r.code}</small></td><td>{r.workDate} · {r.roadCode}<br/><Link href={`/topshiriqlar/${r.workOrderId}`}>{r.orderNumber}</Link></td><td>{hours(r.plannedMinutes)}</td><td>{r.actualMinutes===null?'Kiritilmagan':hours(r.actualMinutes)}</td><td>{r.amount===null?'Hisobga olinmagan':new Intl.NumberFormat('uz-UZ').format(Number(r.amount))}</td><td><Badge tone={r.state==='VERIFIED'?'success':'warning'}>{r.state==='VERIFIED'?'Tasdiqlangan':r.state==='COMPLETED'?'Tekshiruvda':'Ijroda'}</Badge><small>{r.verifiedBy}</small></td></tr>)}</tbody></table></TableFrame></Card>:<EmptyState title="Texnika ishlashi qayd etilmagan" detail="Topshiriqqa biriktirilgan texnika va uning haqiqiy vaqti shu yerda ko‘rinadi."/>}</>:null}</div>;
}
