"use client";

import Link from "next/link";
import { useState } from "react";
import { formatAmountUzs } from "@/lib/money";
import { useHasPermission } from "@/components/auth-provider";
import { ResourceListPage } from "@/components/resource-list-page";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, TableFrame, TextInput } from "@/components/ui";
import { api } from "@/lib/api/client";
import { formatMinutes } from "@/lib/execution-entry";
import { formatDate, formatDateTime } from "@/lib/format";
import { useReportMonth } from "@/lib/report-period";
import { useApiResource } from "@/lib/use-api-resource";

const money = formatAmountUzs;
export default function EquipmentPage() {
  const [month, setMonth] = useReportMonth();
  const canReadCosts = useHasPermission("costs.read");
  const canReadExecution = useHasPermission("execution.read");
  if (!canReadCosts || !canReadExecution) return <ResourceListPage kind="equipment" title="Texnika" description="Texnika ro‘yxati va holati." emptyTitle="Texnika topilmadi" emptyDetail="Texnika ro‘yxatini administrator bilan tekshiring." />;
  return <MachineWorkspace key={month} month={month} setMonth={setMonth} />;
}
function MachineWorkspace({ month, setMonth }: { month: string; setMonth: (value: string) => void }) {
  const [page, setPage] = useState(1);
  const usage = useApiResource(() => api.machineUsage(month, page), `${month}:${page}`);
  const data = usage.data;
  return <div className="page-stack"><PageHeader title="Texnika hisobi" description="Mashina va mexanizmlarning bandligi, haqiqiy ish vaqti va tasdiqlangan xarajati." actions={<TextInput label="Hisobot oyi" name="machineMonth" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />} />
    {usage.loading ? <LoadingState /> : usage.error ? <ErrorState error={usage.error} retry={usage.reload} /> : data ? <>
      <div className="context-strip"><div><span>Band qilingan vaqt</span><strong>{formatMinutes(data.summary.reservedMinutes)}</strong></div><div><span>Qayd etilgan ish vaqti</span><strong>{formatMinutes(data.summary.recordedMinutes)}</strong></div><div><span>Tekshirilgan ish vaqti</span><strong>{formatMinutes(data.summary.verifiedMinutes)}</strong></div><div><span>Tasdiqlangan xarajat</span><strong>{money(data.summary.approvedAmountUzs)} so‘m</strong></div></div>
      {data.summary.unpricedVerifiedCount > 0 ? <p className="field__hint">{data.summary.unpricedVerifiedCount} ta tekshirilgan texnika qaydi hali tasdiqlangan dalolatnomaga kiritilmagan.</p> : null}
      {data.assets.length ? <Card><h2>Texnika bo‘yicha jami</h2><TableFrame label="Mashina-mexanizmlar ish vaqti"><table><thead><tr><th>Texnika</th><th>Band vaqt</th><th>Haqiqiy vaqt</th><th>Tekshirilgan vaqt</th><th>Tasdiqlangan xarajat, so‘m</th></tr></thead><tbody>{data.assets.map((asset) => <tr key={asset.equipmentId}><td><strong>{asset.inventoryCode}</strong><small>{asset.name}</small></td><td>{formatMinutes(asset.reservedMinutes)}</td><td>{formatMinutes(asset.recordedMinutes)}</td><td>{formatMinutes(asset.verifiedMinutes)}</td><td>{money(asset.approvedAmountUzs)}</td></tr>)}</tbody></table></TableFrame></Card> : null}
      {data.rows.length ? <Card><h2>Topshiriqlar bo‘yicha</h2><TableFrame label="Texnika foydalanish qaydlari"><table><thead><tr><th>Sana va texnika</th><th>Topshiriq</th><th>Band vaqt</th><th>Haqiqiy vaqt</th><th>Holat</th><th>Tasdiqlangan xarajat, so‘m</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td>{formatDate(row.date)}<br /><strong>{row.inventoryCode}</strong><small>{row.name}</small></td><td><Link href={`/topshiriqlar/${row.workOrderId}`} className="text-link">{row.orderNumber}</Link><small>{row.road.code}</small></td><td>{formatMinutes(row.reservedMinutes)}<small>{formatDateTime(row.reservedFrom)} — {formatDateTime(row.reservedUntil)}</small></td><td>{row.actualMinutes === null ? "Qayd kiritilmagan" : formatMinutes(row.actualMinutes)}{row.note ? <small>{row.note}</small> : null}</td><td><Badge tone={row.usageState === "VERIFIED" ? "success" : "warning"}>{row.usageState === "VERIFIED" ? "Tekshirilgan" : row.usageState === "NOT_USED" ? "Ishlatilmagan" : row.usageState === "RECORDED" ? "Tekshiruv kutilmoqda" : "Qayd kutilmoqda"}</Badge></td><td>{row.approvedAmountUzs === null ? row.usageState === "NOT_USED" ? "Sarflanmagan" : "Hisob tasdiqlanmagan" : money(row.approvedAmountUzs)}{row.rateReference ? <small>{row.rateReference}</small> : null}{row.actId ? <a href={api.monthlyCompletionActExportUrl(row.actId)} className="text-link">{row.actNumber} · Excel</a> : null}</td></tr>)}</tbody></table></TableFrame><div className="button-row"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Oldingi</Button><span>{page}-sahifa · {data.pagination.total} yozuv</span><Button variant="secondary" disabled={page * data.pagination.pageSize >= data.pagination.total} onClick={() => setPage(page + 1)}>Keyingi</Button></div></Card> : <EmptyState title="Bu oyda texnika qaydi yo‘q" detail="Topshiriqqa biriktirilgan texnika va uning haqiqiy ish vaqti shu yerda ko‘rinadi." />}
    </> : null}
    <details className="workflow-details"><summary>Barcha texnikalar ro‘yxati</summary><ResourceListPage kind="equipment" title="Texnika ro‘yxati" description="Inventar va foydalanish holati." emptyTitle="Texnika topilmadi" emptyDetail="Texnika ro‘yxatini administrator bilan tekshiring." /></details>
  </div>;
}
