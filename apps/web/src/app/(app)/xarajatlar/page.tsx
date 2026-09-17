"use client";

import Link from "next/link";
import { useState } from "react";
import { formatAmountUzs } from "@/lib/money";
import { api } from "@/lib/api/client";
import type { CostLedgerLine } from "@/lib/api/cost-ledger";
import { formatMinutes } from "@/lib/execution-entry";
import { formatDate } from "@/lib/format";
import { useReportMonth } from "@/lib/report-period";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, SelectInput, TableFrame, TextInput } from "@/components/ui";
import styles from "@/components/execution-finance.module.css";

const money = formatAmountUzs;
const kindLabels = { labor: "Ish haqi", material: "Material", equipment: "Mashina-mexanizm" };
const stateLabels = { DRAFT: "Qoralama", SUBMITTED: "Tasdiq kutilmoqda", APPROVED: "Tasdiqlangan" };
const componentLabels: Record<string, string> = {
  baseWageAmountUzs: "Asosiy ish haqi", bonusAmountUzs: "Mukofot", seniorityAmountUzs: "Staj ustamasi", additionalAmountUzs: "Qo‘shimcha ustama",
  trafficAllowanceAmountUzs: "Harakat sharoiti", travelAllowanceAmountUzs: "Ko‘chma ish", payrollExtraAmountUzs: "Boshqa oylik to‘lovlari", socialAmountUzs: "Ijtimoiy ajratma",
  holidayAmountUzs: "Bayram puli", mealAmountUzs: "Ovqat puli", oneTimeAmountUzs: "Bir martalik to‘lov", terminationAmountUzs: "Bo‘shashdagi to‘lov", sickLeaveAmountUzs: "Kasallik nafaqasi", leaveAmountUzs: "Ta’til puli", materialAidAmountUzs: "Moddiy yordam",
};

function CostDetails({ line }: { line: CostLedgerLine }) {
  return <details><summary>Xarajat asosi</summary><dl className={styles.detailList}>
    <div><dt>Ish va IQN</dt><dd>{line.work.name}<small>{line.work.normReference}</small></dd></div>
    <div><dt>Narx hujjati</dt><dd>{line.rate.reference || "Hujjat ko‘rsatilmagan"}</dd></div>
    <div><dt>Stavka</dt><dd>{money(line.rate.amountUzs)} so‘m{line.rate.basis === "monthly_salary" ? " / oy" : line.rate.basis === "machine_hour" ? " / mashina-soat" : ` / ${line.quantity.unit}`}</dd></div>
    {line.kind === "labor" ? <div><dt>Oylik me’yor</dt><dd>{line.rate.denominatorQuantity} daqiqa · {line.source.normReference}</dd></div> : null}
    {line.kind === "labor" ? Object.entries(line.components).map(([key, value]) => Number(value) !== 0 ? <div key={key}><dt>{componentLabels[key] ?? key}</dt><dd>{money(value)} so‘m</dd></div> : null) : null}
    {line.payrollAllocation?.components ? <div><dt>Boshqa oylik to‘lovlari tarkibi</dt><dd><dl>{Object.entries(line.payrollAllocation.components).filter(([key, value]) => !["baseWageAmountUzs", "bonusAmountUzs", "trafficAllowanceAmountUzs", "travelAllowanceAmountUzs", "socialAmountUzs"].includes(key) && Number(value) !== 0).map(([key, value]) => <div key={`payroll-${key}`}><dt>{componentLabels[key] ?? key}</dt><dd>{money(value)} so‘m</dd></div>)}</dl></dd></div> : null}
    <div><dt>Dalolatnoma</dt><dd><Link href={`/bajarilgan-ishlar?month=${line.date.slice(0, 7)}`} className="text-link">{line.act.number}</Link> · <a href={api.monthlyCompletionActExportUrl(line.act.id)}>Excel</a></dd></div>
  </dl><details><summary>Manba yozuvlari</summary><dl className={styles.detailList}>{Object.entries(line.source).filter(([key, value]) => value && key !== "normReference").map(([key, value]) => <div key={key}><dt>{{ timeEntryId: "Tabel qaydi", materialUsageId: "Material sarfi", equipmentUsageEntryId: "Texnika qaydi", inventoryTransactionId: "Ombor harakati", payrollSnapshotId: "Oylik nusxasi", monthlyWorkTimeNormId: "Vaqt me’yori" }[key] ?? key}</dt><dd><code>{value}</code></dd></div>)}<div><dt>Stavka nusxasi</dt><dd><code>{line.rate.id}</code></dd></div>{line.act.snapshotHash ? <div><dt>Hujjat nazorat kodi</dt><dd><code style={{ overflowWrap: "anywhere" }}>{line.act.snapshotHash}</code></dd></div> : null}</dl></details></details>;
}

export default function CostLedgerPage() {
  const [month, setMonth] = useReportMonth();
  return <LedgerWorkspace key={month} month={month} setMonth={setMonth} />;
}
function LedgerWorkspace({ month, setMonth }: { month: string; setMonth: (value: string) => void }) {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState("");
  const [state, setState] = useState("");
  const result = useApiResource(() => api.costLedger(month, page, kind, state), `${month}:${page}:${kind}:${state}`);
  const data = result.data;
  return <div className="page-stack"><PageHeader title="Xarajatlar hisobi" description="Har bir summa: topshiriq, sarf, stavka va tasdiqlangan hujjatgacha." actions={<TextInput label="Hisobot oyi" name="ledgerMonth" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />} />
    <Card><div className="data-form"><SelectInput label="Xarajat turi" name="ledgerKind" value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }}><option value="">Barcha turlar</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectInput><SelectInput label="Hujjat holati" name="ledgerState" value={state} onChange={(event) => { setState(event.target.value); setPage(1); }}><option value="">Barcha holatlar</option>{Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectInput></div><p className="field__hint">Bu — hujjatlashtirilgan xarajatlar. Bank yoki g‘aznachilik to‘lovlari hali ulanmagan.</p></Card>
    {result.loading ? <LoadingState /> : result.error ? <ErrorState error={result.error} retry={result.reload} /> : data ? <>
      <div className={styles.summaryGrid}>{[["Tasdiqlangan", data.summary.approvedAmountUzs], ["Tasdiq kutilmoqda", data.summary.submittedAmountUzs], ["Qoralama", data.summary.draftAmountUzs]].map(([label, value]) => <Card key={label}><span>{label}</span><h2>{money(value!)} so‘m</h2></Card>)}<Card><span>Hali hisoblanmagan ishlar</span><h2>{data.summary.verifiedUncostedOrderCount}</h2><Link href={`/bajarilgan-ishlar?month=${month}`} className="text-link">Dalolatnomaga o‘tish</Link></Card></div>
      <div className="context-strip">{[["Ish haqi",data.summary.laborAmountUzs],["Ijtimoiy ajratma",data.summary.socialAmountUzs],["Material",data.summary.materialAmountUzs],["Texnika",data.summary.equipmentAmountUzs]].map(([label,value])=><div key={label}><span>{label} · tasdiqlangan</span><strong>{money(value!)} so‘m</strong></div>)}</div>
      {data.rows.length ? <Card><TableFrame label="Xarajatlar reyestri"><table><thead><tr><th>Sana va topshiriq</th><th>Yo‘l</th><th>Xarajat</th><th>Haqiqiy miqdor</th><th>Summa, so‘m</th><th>Holat va asos</th></tr></thead><tbody>{data.rows.map((line) => <tr key={line.id}><td>{formatDate(line.date)}<br /><Link className="text-link" href={`/topshiriqlar/${line.workOrderId}`}>{line.orderNumber}</Link></td><td>{line.road.code}<small>{line.road.name}</small></td><td><strong>{line.resource.name}</strong><small>{kindLabels[line.kind]} · {line.resource.code}</small></td><td>{["person_minute", "machine_minute"].includes(line.quantity.unit) ? formatMinutes(Number(line.quantity.value)) : `${line.quantity.value} ${line.quantity.unit}`}</td><td><strong>{money(line.amountUzs)}</strong></td><td><Badge tone={line.state === "APPROVED" ? "success" : "warning"}>{stateLabels[line.state]}</Badge><CostDetails line={line} /></td></tr>)}</tbody></table></TableFrame><div className="button-row"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Oldingi</Button><span>{page}-sahifa · {data.pagination.total} yozuv</span><Button variant="secondary" disabled={page * data.pagination.pageSize >= data.pagination.total} onClick={() => setPage(page + 1)}>Keyingi</Button></div></Card> : <EmptyState title="Xarajat qaydi yo‘q" detail="Tanlangan oy va filtrlar bo‘yicha dalolatnoma sarflari mavjud emas." />}
    </> : null}
  </div>;
}
