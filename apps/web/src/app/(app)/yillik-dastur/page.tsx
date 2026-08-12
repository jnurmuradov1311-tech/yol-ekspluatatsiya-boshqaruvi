"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, SelectInput, TableFrame } from "@/components/ui";

export default function AnnualProgramPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, error, loading, reload } = useApiResource(() => api.annualProgram(year), `annual-program:${year}`);
  return (
    <div className="page-stack">
      <PageHeader title="D001 yillik saqlash ishlari dasturi" description="D001 yo‘lining 0+000–67+000 oralig‘idagi tasdiqlangan yillik ish hajmlari va bajarilish holati." actions={<><SelectInput label="Dastur yili" name="programYear" value={year} onChange={(event) => setYear(Number(event.target.value))}><option value={year - 1}>{year - 1}</option><option value={year}>{year}</option><option value={year + 1}>{year + 1}</option></SelectInput><a className="button button--secondary" href={`/api/v1/reports/annual-program.xlsx?year=${year}`} download><Download size={16} aria-hidden="true" /> Excel yuklash</a></>} />
      <div className="context-strip"><div><span>Yo‘l</span><strong>D001</strong></div><div><span>To‘liq uzunligi</span><strong>0+000 — 67+000</strong></div><div><span>Dastur yili</span><strong>{year}</strong></div></div>
      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? data.items.length ? (
        <Card>
          <TableFrame label={`${year}-yil saqlash ishlari dasturi`}>
            <table><thead><tr><th>Yo‘l</th><th>Ish turi</th><th>Norma manbasi</th><th>Yillik hajm</th><th>Bajarilgan hajm</th><th>Talab etilgan mehnat</th><th>Bajarilgan mehnat</th><th>Tasdiq holati</th></tr></thead><tbody>{data.items.map((line) => <tr key={line.id}><td><strong>{line.road.code}</strong><small>{line.road.name}</small></td><td>{line.workName}</td><td>{line.normReference}</td><td>{line.quantity.planned} {line.quantity.unit}</td><td>{line.quantity.completed} {line.quantity.unit}</td><td>{line.laborHours.required} soat</td><td>{line.laborHours.completed} soat</td><td><Badge tone={line.approvalState === "APPROVED" ? "success" : line.approvalState === "CLOSED" ? "neutral" : "warning"}>{line.approvalState === "APPROVED" ? "Tasdiqlangan" : line.approvalState === "CLOSED" ? "Yopilgan" : "Qoralama"}</Badge></td></tr>)}</tbody></table>
          </TableFrame>
        </Card>
      ) : <EmptyState title="Dastur bandi yo‘q" detail={`${year}-yil uchun saqlash ishlari dasturi hali kiritilmagan.`} /> : null}
    </div>
  );
}
