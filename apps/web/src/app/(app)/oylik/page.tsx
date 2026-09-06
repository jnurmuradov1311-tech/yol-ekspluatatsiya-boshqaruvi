"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { useAuth, useHasPermission } from "@/components/auth-provider";
import { useApiResource } from "@/lib/use-api-resource";
import type { PayrollAdjustment, PayrollSnapshot } from "@/lib/api/payroll";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, TableFrame, TextInput } from "@/components/ui";
const money = (value: unknown) => value === null || value === undefined ? "—" : new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 }).format(Number(value));
const allowanceFields = [["bonusRateBps","Mukofot, %"],["seniorityRateBps","Ish staji uchun, %"],["additionalRateBps","Qo‘shimcha ustama, %"],["trafficAllowanceRateBps","Harakat sharoiti uchun, %"],["travelAllowanceRateBps","Ko‘chma ish uchun, %"],["socialContributionRateBps","Ijtimoiy ajratma, %"]] as const;
const fixedFields = [["holidayAmountUzs","Bayram puli"],["oneTimeAmountUzs","Bir martalik to‘lov"],["terminationAmountUzs","Bo‘shashdagi to‘lov"],["sickLeaveAmountUzs","Kasallik nafaqasi"],["leaveAmountUzs","Ta’til puli"],["materialAidAmountUzs","Moddiy yordam"]] as const;
const deductionFields = [["incomeTaxAmountUzs","Daromad solig‘i"],["unionFeeAmountUzs","Kasaba uyushmasi"],["advanceAmountUzs","Avans"],["otherDeductionAmountUzs","Boshqa ushlanma"]] as const;
export default function PayrollPage() {
  const { user } = useAuth();
  const canCalculate = useHasPermission("costs.manage");
  const [period, setPeriod] = useState(() => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tashkent" }).slice(0,7));
  const [reference, setReference] = useState("");
  const [snapshot, setSnapshot] = useState<PayrollSnapshot | null>(null);
  const [selectedWorker, setSelectedWorker] = useState("");
  const [adjustments, setAdjustments] = useState<Record<string,PayrollAdjustment>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const history = useApiResource(() => api.payrollHistory(period), `payroll-history:${period}`);
  const adjustment = adjustments[selectedWorker];
  function update(name: string, value: string | boolean) {
    setAdjustments((current) => ({ ...current, [selectedWorker]: { ...current[selectedWorker], workerId: selectedWorker, ...(deductionFields.some(([field]) => field === name) ? { deductionsConfirmed: false } : {}), [name]: typeof value === "string" && name.endsWith("Bps") ? (value === "" ? undefined : Math.round(Number(value) * 100)) : value } }));
  }
  async function calculate() {
    if (!user?.division) return;
    setBusy(true); setActionError("");
    try { const result = await api.payrollPreview(user.division.id, period, reference, Object.values(adjustments).map((item) => Object.fromEntries(Object.entries(item).filter(([,value]) => value !== "" && value !== undefined)) as PayrollAdjustment)); setSnapshot(result); void history.reload(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : "Oylik hisoblanmadi."); }
    finally { setBusy(false); }
  }
  async function openSnapshot(id: string) {
    setBusy(true); setActionError("");
    try { const saved = await api.payrollSnapshot(id); setSnapshot(saved); setPeriod(saved.period); setReference(saved.policyReference); setAdjustments(Object.fromEntries(saved.rows.map((row) => [row.workerId, { ...row.adjustments, workerId: row.workerId }]))); setSelectedWorker(""); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : "Hisobni ochib bo‘lmadi."); }
    finally { setBusy(false); }
  }
  return <div className="page-stack"><PageHeader title="Oylik hisoblash" description="Tasdiqlangan tabel va amaldagi stavkalardan ish haqi hisoblanadi. Har bir hisob nusxasi tarixda saqlanadi." actions={<Link className="button button--secondary" href="/tabel">Tabelni ko‘rish</Link>} />
    <Card><div className="data-form"><TextInput label="Hisob oyi" name="payrollPeriod" type="month" value={period} onChange={(event) => { setPeriod(event.target.value); setSnapshot(null); setAdjustments({}); setSelectedWorker(""); }} /><TextInput label="Hisoblash asosi" name="payrollReference" placeholder="Buyruq yoki tasdiqlangan stavkalar hujjati" value={reference} onChange={(event) => setReference(event.target.value)} /></div><div className="button-row"><Button busy={busy} disabled={!canCalculate || !period || !reference.trim()} onClick={calculate}>Oylikni hisoblash</Button><Link href="/narxlar" className="text-link">Stavkalarni ko‘rish</Link></div></Card>
    {actionError ? <p role="alert" className="inline-error">{actionError}</p> : null}
    {snapshot ? <><Card><div className="card-heading"><h2>{snapshot.period} uchun hisob</h2><Badge tone="info">Hisob-kitob nusxasi</Badge></div><TableFrame label="Xodimlar oyligi"><table><thead><tr><th>Xodim</th><th>Vaqt</th><th>Asosiy ish haqi</th><th>Jami hisoblandi</th><th>Ushlanmalar</th><th>Qo‘lga tegadi</th></tr></thead><tbody>{snapshot.rows.map((row) => <tr key={row.workerId}><td><strong>{row.fullName}</strong>{canCalculate ? <Button variant="ghost" onClick={() => setSelectedWorker(row.workerId)}>Ustama va ushlanma</Button> : null}</td><td>{row.actualDays} kun<small>{money(row.actualMinutes / 60)} soat</small></td><td>{money(row.baseWageAmountUzs)}</td><td>{money(row.grossAmountUzs)}</td><td>{money(row.deductionsAmountUzs)}</td><td><strong>{money(row.payableAmountUzs)}</strong>{row.payableAmountUzs === null ? <small>Ushlanmalarni tekshiring</small> : null}</td></tr>)}</tbody><tfoot><tr><th colSpan={3}>Jami, so‘m</th><td>{money(snapshot.totals.grossAmountUzs)}</td><td /><td>{money(snapshot.totals.payableAmountUzs)}</td></tr></tfoot></table></TableFrame><p className="field__hint">Ijtimoiy ajratmalar xodimning oyligidan ushlanmaydi. Hisob natijasi bankka to‘lov yubormaydi.</p></Card>
    {selectedWorker && canCalculate ? <Card><h2>{snapshot.rows.find((item) => item.workerId === selectedWorker)?.fullName}: qo‘shimcha hisob</h2><p>Foiz va summalarni amaldagi hujjatga asosan kiriting. Eski Excel stavkalari avtomatik qo‘llanmaydi.</p><div className="data-form">{allowanceFields.map(([name,label]) => <TextInput key={name} label={label} name={name} type="number" min="0" step="0.01" value={adjustment?.[name] === undefined ? "" : Number(adjustment[name]) / 100} onChange={(event) => update(name,event.target.value)} />)}</div><details className="workflow-details"><summary>Qo‘shimcha summalar va alohida hisoblash bazasi</summary><div className="data-form">{[...fixedFields,["trafficMonthlyBaseUzs","Harakat ustamasi oylik bazasi"],["travelMonthlyBaseUzs","Ko‘chma ish oylik bazasi"]].map(([name,label]) => <TextInput key={name} label={`${label}, so‘m`} name={name} type="number" min="0" step="0.01" value={String(adjustment?.[name!] ?? "")} onChange={(event) => update(name!,event.target.value)} />)}</div></details><h3>Ushlanmalar, so‘m</h3><div className="data-form">{deductionFields.map(([name,label]) => <TextInput key={name} label={label} name={name} type="number" min="0" step="0.01" value={String(adjustment?.[name] ?? "")} onChange={(event) => update(name,event.target.value)} />)}</div><label className="worker-choice"><input type="checkbox" checked={Boolean(adjustment?.deductionsConfirmed)} disabled={deductionFields.some(([name]) => adjustment?.[name] === undefined || adjustment?.[name] === "")} onChange={(event) => update("deductionsConfirmed", event.target.checked)} /><span>Ushlanmalar tekshirildi, yo‘q bo‘lsa 0 kiritildi</span></label><div className="button-row"><Button busy={busy} onClick={calculate}>Yangi nusxani hisoblash</Button><Button variant="secondary" onClick={() => setSelectedWorker("")}>Yopish</Button></div></Card> : null}</> : <EmptyState title="Oylik hali hisoblanmagan" detail="Hisob oyi va asosni ko‘rsating. Tizim tasdiqlangan ish vaqtlarini avtomatik yig‘adi." />}
    <details className="workflow-details"><summary>Oldingi hisob-kitoblar</summary>{history.loading ? <LoadingState /> : history.error ? <ErrorState error={history.error} retry={history.reload} /> : history.data?.items.length ? <Card><TableFrame label="Oylik hisoblash tarixi"><table><thead><tr><th>Oy</th><th>Asos</th><th>Sana</th><th /></tr></thead><tbody>{history.data.items.map((item) => <tr key={item.id}><td>{item.period}</td><td>{item.policyReference}</td><td>{item.createdAt}</td><td><Button variant="secondary" busy={busy} onClick={() => openSnapshot(item.id)}>Ochish</Button></td></tr>)}</tbody></table></TableFrame></Card> : <p>Bu oy uchun oldingi hisob yo‘q.</p>}</details>
  </div>;
}
