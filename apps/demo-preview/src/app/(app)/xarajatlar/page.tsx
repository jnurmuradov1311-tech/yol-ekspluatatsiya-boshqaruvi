"use client";
import Link from 'next/link';
import {useMemo,useState} from 'react';
import {api} from '@/lib/api/client';
import {useApiResource} from '@/lib/use-api-resource';
import {useReportMonth} from '@/lib/use-report-month';
import {MonthNavigation} from '@/components/month-navigation';
import {ExcelDownload} from '@/components/excel-download';
import {Badge,Card,EmptyState,ErrorState,LoadingState,PageHeader,SelectInput,TableFrame,TextInput} from '@/components/ui';
const labels={labor:'Ish haqi',social:'Ijtimoiy ajratma',material:'Material',equipment:'Texnika'};
const money=(n:string|number)=>new Intl.NumberFormat('uz-UZ',{maximumFractionDigits:2}).format(Number(n));
export default function CostLedgerPage(){
  const [period,setPeriod]=useReportMonth(),[kind,setKind]=useState(''),[query,setQuery]=useState('');
  const {data,loading,error,reload}=useApiResource(()=>api.costLedger(period),`cost-ledger:${period}`);
  const rows=useMemo(()=>data?.rows.filter(r=>(!kind||r.kind===kind)&&`${r.orderNumber} ${r.resourceName} ${r.roadCode} ${r.source}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))??[],[data,kind,query]);
  const filtered=rows.reduce((n,r)=>n+Math.round(Number(r.amount)*100),0)/100;
  return <div className="page-stack"><MonthNavigation month={period}/><PageHeader title="Xarajatlar" description="Tasdiqlangan ishlar bo‘yicha hisob. To‘lov hujjatlari hali ulanmagan." actions={<><TextInput label="Oy" type="month" value={period} onChange={e=>setPeriod(e.target.value)}/>{data?.rows.length?<ExcelDownload period={period} kind="act"/>:null}</>}/>
    {loading?<LoadingState/>:error?<ErrorState error={error} retry={reload}/>:data?<>
      <div className="context-strip">{Object.entries(labels).map(([key,label])=><div key={key}><span>{label}</span><strong>{money(data.totals[key as keyof typeof labels])} so‘m</strong></div>)}<div><span>Jami hisoblangan</span><strong>{money(data.totals.total)} so‘m</strong></div></div>
      <div className="filters"><SelectInput label="Xarajat turi" value={kind} onChange={e=>setKind(e.target.value)}><option value="">Barchasi</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</SelectInput><TextInput label="Qidirish" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Topshiriq, yo‘l yoki resurs"/></div>
      {rows.length?<Card><TableFrame label="Har bir xarajatning asosi"><table><thead><tr><th>Sana va topshiriq</th><th>Resurs</th><th>Hajm / vaqt</th><th>Hisob asosi</th><th>Summa, so‘m</th><th>Dalolatnoma</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.workDate}<br/><Link href={`/topshiriqlar/${r.workOrderId}`}>{r.orderNumber}</Link><small>{r.roadCode} · {r.workName}</small></td><td><strong>{r.resourceName}</strong><small>{labels[r.kind]} · {r.resourceCode}</small></td><td>{money(r.quantity)} {r.unit}</td><td><details><summary>Hisobni ko‘rish</summary><p>{r.formula}</p><p>{r.source}</p><p>Tarif: {r.rateVersion || 'avvalgi nusxa'} · {r.rateId}</p><p>Tasdiqlagan: {r.verifiedBy}</p></details></td><td><strong>{money(r.amount)}</strong></td><td>{r.actNumber?<><strong>{r.actNumber}</strong><Badge tone={r.actState==='APPROVED'?'success':'warning'}>{r.actState==='APPROVED'?'Tasdiqlangan':'Tasdiqqa yuborilgan'}</Badge></>:<Link href={`/bajarilgan-ishlar?month=${period}`}>Dalolatnoma tuzish</Link>}</td></tr>)}</tbody><tfoot><tr><th colSpan={4}>Tanlangan xarajatlar</th><th>{money(filtered)}</th><td/></tr></tfoot></table></TableFrame></Card>:<EmptyState title="Xarajat qaydi yo‘q" detail="Bajarilgan ish tasdiqlangach uning hisobi shu yerda ko‘rinadi."/>}
      <Card><details><summary>Amallar tarixi ({data.audit.length})</summary><TableFrame label="Hisob va ijro tarixi"><table><thead><tr><th>Vaqt</th><th>Mas’ul</th><th>Amal</th><th>Asos</th></tr></thead><tbody>{[...data.audit].reverse().map(a=><tr key={a.id}><td>{new Date(a.at).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'})}</td><td>{a.actor}</td><td>{a.action}</td><td>{a.reference}</td></tr>)}</tbody></table></TableFrame></details></Card>
    </>:null}</div>;
}
