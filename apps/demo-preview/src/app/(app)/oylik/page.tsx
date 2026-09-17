"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ExcelDownload } from "@/components/excel-download";
import { MonthNavigation } from "@/components/month-navigation";
import { useReportMonth } from "@/lib/use-report-month";
import { api } from "@/lib/api/client";
import { useAuth, useHasPermission } from "@/components/auth-provider";
import { useApiResource } from "@/lib/use-api-resource";
import { calculatePayrollSegments, payrollDeductionFields, roundMoney } from "@/lib/api/payroll-calculation";
import type { PayrollAdjustment, PayrollSnapshot } from "@/lib/api/payroll";
import type { WageSegment } from "@/lib/api/excel-report";
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, TableFrame, TextInput } from "@/components/ui";

const money = (n: unknown) => n === null || n === undefined ? "—" : new Intl.NumberFormat("uz-UZ", {maximumFractionDigits:2}).format(Number(n));
const mainFields = [["salaryCoefficient","Koeffitsiyent"],["seniorityRateBps","Staj, %"],["additionalRateBps","Ustama, %"],["holidayAmountUzs","Bayram puli"],["mealAmountUzs","Ovqat puli"]] as const;
const otherFields = [["bonusRateBps","Mukofot, %"],["trafficAllowanceRateBps","Harakat, %"],["travelAllowanceRateBps","Ko‘chma ish, %"],["oneTimeAmountUzs","Bir martalik"],["sickLeaveAmountUzs","Kasallik"],["leaveAmountUzs","Ta’til"],["materialAidAmountUzs","Moddiy yordam"],["terminationAmountUzs","Bo‘shash to‘lovi"],["socialContributionRateBps","Ijtimoiy ajratma, %"],["trafficMonthlyBaseUzs","Harakat bazasi"],["travelMonthlyBaseUzs","Ko‘chma ish bazasi"]] as const;
const deductions = [["incomeTaxAmountUzs","Daromad solig‘i"],["unionFeeAmountUzs","Kasaba uyushmasi"],["advanceAmountUzs","Avans"],["otherDeductionAmountUzs","Boshqa ushlanma"]] as const;
const segmentFields:Record<string,keyof WageSegment> = {salaryCoefficient:"salaryCoefficient",bonusRateBps:"bonusBps",seniorityRateBps:"seniorityBps",additionalRateBps:"additionalBps",trafficAllowanceRateBps:"trafficBps",travelAllowanceRateBps:"travelBps",socialContributionRateBps:"socialBps",trafficMonthlyBaseUzs:"trafficBase",travelMonthlyBaseUzs:"travelBase"};
type Worker = {id:string;fullName:string;positionName:string};
type CalculatedRow = {row:PayrollSnapshot["rows"][number];base:number;gross:number;social:number;deduction:number;net:number|null;error:string};
type Tab = "main" | "other" | "deductions";

export default function PayrollPage() {
  const [period,setPeriod] = useReportMonth();
  return <PayrollLoader key={period} period={period} setPeriod={setPeriod} />;
}
function PayrollLoader({period,setPeriod}:{period:string;setPeriod:(v:string)=>void}) {
  const data = useApiResource(async()=>{
    const [worksheet,history] = await Promise.all([api.payrollWorksheet(period),api.payrollHistory(period)]);
    const saved = history.items[0] ? await api.payrollSnapshot(history.items[0].id) : null;
    const basis=(s:PayrollSnapshot|null)=>JSON.stringify(s?.rows.map(r=>[r.workerId,r.segments?.map(v=>[v.workOrderId,v.workDate,v.minutes,v.normMinutes,v.monthlySalary])])??[]);
    const changed=Boolean(saved)&&basis(saved)!==basis(worksheet.snapshot);
    const current=changed&&worksheet.snapshot?{...worksheet.snapshot,policyReference:saved!.policyReference,rows:worksheet.snapshot.rows.map(r=>({...r,adjustments:saved!.rows.find(old=>old.workerId===r.workerId)?.adjustments}))}:saved??worksheet.snapshot;
    return {workers:worksheet.workers, snapshot:current, saved:Boolean(saved)&&!changed};
  },period);
  if(data.loading)return <LoadingState label="Oylik jadvali ochilmoqda" />;
  if(data.error)return <ErrorState error={data.error} retry={data.reload} />;
  return data.data ? <PayrollWorkspace period={period} setPeriod={setPeriod} {...data.data} /> : null;
}
function PayrollWorkspace({period,setPeriod,workers,snapshot:initial,saved:initialSaved}:{period:string;setPeriod:(v:string)=>void;workers:Worker[];snapshot:PayrollSnapshot|null;saved:boolean}) {
  const {user} = useAuth();
  const canEdit = useHasPermission("costs.manage");
  const [snapshot,setSnapshot] = useState(initial);
  const [saved,setSaved] = useState(initialSaved);
  const [dirty,setDirty] = useState(false);
  const [reference,setReference] = useState(initial?.policyReference??"Tasdiqlangan tabel va stavkalar");
  const [adjustments,setAdjustments] = useState<Record<string,PayrollAdjustment>>(()=>Object.fromEntries((initial?.rows??[]).map(row=>[row.workerId,{...row.adjustments,workerId:row.workerId}])));
  const [tab,setTab] = useState<Tab>("main");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const history = useApiResource(()=>api.payrollHistory(period),period);
  const months = useApiResource(api.reportMonths,"payroll-months");
  const calculated = useMemo(()=>new Map<string,CalculatedRow>((snapshot?.rows??[]).map(row=>{
    const adjustment=adjustments[row.workerId]??{workerId:row.workerId};
    try {
      const segments=calculatePayrollSegments(row.segments??[],adjustment);
      const sum=(key:keyof WageSegment)=>roundMoney(segments.reduce((n,s)=>n+Number(s[key]),0));
      const deduction=roundMoney(payrollDeductionFields.reduce((n,k)=>n+Number(adjustment[k]??0),0));
      const confirmed=adjustment.deductionsConfirmed===true&&payrollDeductionFields.every(k=>adjustment[k]!==undefined&&adjustment[k]!=="");
      return [row.workerId,{row,base:sum("base"),gross:sum("gross"),social:sum("social"),deduction,net:confirmed?roundMoney(sum("gross")-deduction):null,error:""}] as const;
    } catch(e) {return [row.workerId,{row,base:0,gross:0,social:0,deduction:0,net:null,error:e instanceof Error?e.message:"Hisob yaroqsiz"}] as const;}
  })),[snapshot,adjustments]);
  const rows=[...calculated.values()];
  const invalid=rows.some(r=>r.error);
  const gross=roundMoney(rows.reduce((n,r)=>n+r.gross,0));
  const net=rows.length&&rows.every(r=>r.net!==null)?roundMoney(rows.reduce((n,r)=>n+(r.net??0),0)):null;
  function update(id:string,key:string,value:string|boolean) {
    setDirty(true);setError("");
    setAdjustments(current=>({...current,[id]:{...current[id],workerId:id,...(payrollDeductionFields.includes(key as typeof payrollDeductionFields[number])?{deductionsConfirmed:false}:{}),[key]:typeof value==="string"&&key.endsWith("Bps")?(value===""?undefined:Math.round(Number(value)*100)):value}}));
  }
  function input(worker:Worker,key:string,label:string) {
    const row=calculated.get(worker.id)?.row;
    const values=[...new Set((row?.segments??[]).map(s=>s[segmentFields[key]!]))];
    const fallback=key==="salaryCoefficient"?1:segmentFields[key]?(values.length===1?values[0]:undefined):0;
    const raw=adjustments[worker.id]?.[key]??fallback;
    const value=raw===undefined||raw===""?"":key.endsWith("Bps")?Number(raw)/100:String(raw);
    return <input className="input payroll-cell" aria-label={`${worker.fullName}: ${label}`} type="number" inputMode="decimal" min={key==="salaryCoefficient"?"0.01":"0"} max={key==="salaryCoefficient"?"100":key.endsWith("Bps")?"1000":undefined} step="0.01" value={value} placeholder={row?"Stavka bo‘yicha":"—"} disabled={busy||!canEdit||!row} onChange={e=>update(worker.id,key,e.target.value)} />;
  }
  async function save() {
    if(!user?.division||invalid)return;
    setBusy(true);setError("");
    try {
      const result=await api.payrollPreview(user.division.id,period,reference,Object.values(adjustments).map(a=>Object.fromEntries(Object.entries(a).filter(([,v])=>v!==""&&v!==undefined)) as PayrollAdjustment));
      setSnapshot(result);setSaved(true);setDirty(false);void history.reload();
    } catch(e) {setError(e instanceof Error?e.message:"Hisob saqlanmadi.");}
    finally {setBusy(false);}
  }
  async function open(id:string) {
    setBusy(true);setError("");
    try {const s=await api.payrollSnapshot(id);setSnapshot(s);setReference(s.policyReference);setAdjustments(Object.fromEntries(s.rows.map(r=>[r.workerId,{...r.adjustments,workerId:r.workerId}])));setSaved(true);setDirty(false);}
    catch(e){setError(e instanceof Error?e.message:"Hisob ochilmadi.");}finally{setBusy(false);}
  }
  const fields=tab==="main"?mainFields:tab==="other"?otherFields:deductions;
  return <div className="page-stack payroll-workspace">
    <MonthNavigation month={period} />
    <PageHeader title="Oylik jadvali" description="Kataklarni to‘ldiring — jami avtomatik hisoblanadi." actions={<Link className="button button--secondary" href={`/tabel?month=${period}`}>Tabel</Link>} />
    <form onSubmit={e=>{e.preventDefault();void save();}}>
      <Card><div className="payroll-toolbar"><TextInput label="Hisob oyi" name="payrollMonth" type="month" value={period} disabled={busy} onChange={e=>setPeriod(e.target.value)} /><div className="payroll-total"><span>Jami hisoblandi</span><strong>{invalid?"—":money(gross)} <small>so‘m</small></strong></div><div className="payroll-total"><span>Qo‘lga tegadi</span><strong>{invalid?"—":money(net)} <small>so‘m</small></strong></div><Badge tone={dirty||!saved?"warning":"success"}>{dirty||!saved?"Saqlanmagan":"Saqlangan"}</Badge></div>
        <div className="tabs" role="tablist" aria-label="Oylik ustunlari">{([["main","Oylik va ustamalar"],["other","Boshqa to‘lovlar"],["deductions","Ushlanmalar"]] as const).map(([id,label])=><button key={id} type="button" role="tab" aria-selected={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</div>
        <TableFrame label="Tahrirlanadigan xodimlar oyligi"><table className="payroll-grid"><thead><tr><th scope="col">Xodim</th>{tab==="main"?<><th scope="col">Tabel, soat</th><th scope="col">Oylik stavka</th></>:null}{fields.map(([key,label])=><th scope="col" key={key}>{label}{!key.endsWith("Bps")&&key!=="salaryCoefficient"?<small>so‘m</small>:null}</th>)}{tab==="main"?<th scope="col">Asosiy ish haqi</th>:null}<th scope="col">Jami hisoblandi</th>{tab==="deductions"?<><th scope="col">Tekshirildi</th><th scope="col">Qo‘lga tegadi</th></>:null}</tr></thead><tbody>{workers.map(worker=>{
          const result=calculated.get(worker.id),row=result?.row;
          const salaries=[...new Set(row?.segments?.map(s=>s.monthlySalary)??[])];
          const a=adjustments[worker.id];
          return <tr key={worker.id} className={!row?"payroll-no-time":result?.error?"payroll-error":""}><th scope="row"><strong>{worker.fullName}</strong><small>{worker.positionName}</small>{!row?<small>Tasdiqlangan tabel yo‘q</small>:result?.error?<small role="alert">{result.error}</small>:null}</th>{tab==="main"?<><td>{money((row?.actualMinutes??0)/60)}<small>{row?.actualDays??0} kun</small></td><td>{salaries.length===1?money(salaries[0]):salaries.length?"Sanalar bo‘yicha":"—"}</td></>:null}{fields.map(([key,label])=><td key={key}>{input(worker,key,label)}</td>)}{tab==="main"?<td>{result?.error?"—":money(result?.base)}</td>:null}<td className="payroll-result"><strong>{result?.error?"—":money(result?.gross)}</strong></td>{tab==="deductions"?<><td><input type="checkbox" aria-label={`${worker.fullName}: ushlanmalar tekshirildi`} checked={Boolean(a?.deductionsConfirmed)} disabled={busy||!canEdit||!row} onChange={e=>{setDirty(true);setAdjustments(current=>({...current,[worker.id]:{...current[worker.id],workerId:worker.id,...Object.fromEntries(payrollDeductionFields.map(key=>[key,current[worker.id]?.[key]||"0"])),deductionsConfirmed:e.target.checked}}));}} /></td><td><strong>{result?.error?"—":money(result?.net)}</strong></td></>:null}</tr>;
        })}</tbody></table></TableFrame>
        <p className="field__hint">{tab==="main"?"Asosiy ish haqi = oylik stavka × koeffitsiyent × tabel / oy normasi. 1,00 — stavka o‘zgarmaydi.":tab==="deductions"?"Ushlanmalarni kiriting va har bir qatorni tekshiring. Belgilashda bo‘sh kataklar 0 hisoblanadi.":"Foizlar asosiy ish haqidan olinadi. Harakat va ko‘chma ish uchun alohida oylik bazalar qo‘llanadi."}</p>
      </Card>
      {!rows.length?<p className="wizard-callout">Bu oyda tasdiqlangan tabel yo‘q. <Link href="/topshiriqlar">Bajarilgan ishni tasdiqlashga o‘tish</Link></p>:null}
      {error?<p role="alert" className="inline-error">{error}</p>:null}
      <div className="payroll-savebar"><TextInput label="Buyruq / hisoblash asosi" name="payrollReference" required value={reference} disabled={busy||!canEdit} onChange={e=>{setReference(e.target.value);setDirty(true);}} /><Button type="submit" busy={busy} disabled={!canEdit||!rows.length||invalid||!reference.trim()}>Hisobni saqlash</Button>{saved&&!dirty&&snapshot?<ExcelDownload id={snapshot.id} kind="payroll" />:null}</div>
    </form>
    {months.data?.items.length?<p className="available-months">Tabel bor oylar: {months.data.items.map(m=><button key={m.period} disabled={busy} onClick={()=>setPeriod(m.period)}>{m.period}</button>)}</p>:null}
    <details className="workflow-details"><summary>Hisob tarixi</summary>{history.error?<ErrorState error={history.error} retry={history.reload}/>:history.data?.items.length?<TableFrame label="Oylik tarixi"><table><thead><tr><th>Sana</th><th>Asos</th><th/></tr></thead><tbody>{history.data.items.map(h=><tr key={h.id}><td>{h.createdAt.slice(0,16).replace("T"," ")}</td><td>{h.policyReference}</td><td><Button disabled={busy} variant="secondary" onClick={()=>open(h.id)}>Ochish</Button></td></tr>)}</tbody></table></TableFrame>:<p>Saqlangan hisob yo‘q.</p>}</details>
  </div>;
}
