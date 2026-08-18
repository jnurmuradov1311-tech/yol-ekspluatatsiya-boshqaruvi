"use client";

import { useState } from "react";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/use-api-resource";
import { useOperatingScope } from "@/components/scope-provider";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, SelectInput, TableFrame } from "@/components/ui";

export default function AnnualProgramPage() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const { scope } = useOperatingScope();
  const { data, error, loading, reload } = useApiResource(() => api.annualProgram(year), `annual-program:${year}`);
  return (
    <div className="page-stack">
      <PageHeader title="Yillik saqlash rejasi" description="Yo‘l elementlari, takrorlanuvchi ishlar va aniqlangan nuqsonlar asosida yil davomida qayta ko‘rib chiqiladigan mablag‘ rejasi." actions={<><SelectInput label="Dastur yili" name="programYear" value={year} onChange={(event) => setYear(Number(event.target.value))}><option value={year - 1}>{year - 1}</option><option value={year}>{year}</option><option value={year + 1}>{year + 1}</option></SelectInput><a className="button button--secondary" href={`/api/v1/reports/annual-program.xlsx?year=${year}`} download><Download size={16} aria-hidden="true" /> Excel</a></>} />
      <div className="scope-meta"><span><strong>Qamrov</strong>{scope.shortName}</span><span><strong>Yo‘l va kesim</strong>{scope.roadLabel}</span><span><strong>Dastur yili</strong>{year}</span></div>

      <Card className="admin-scope-note">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>Tekshiriladigan hisob</strong>
          <p>Bu sahifada faqat bazadagi yillik dastur hajmlari ko‘rsatiladi. Mablag‘ summasi IQN resurslari va amaldagi tasdiqlangan ish haqi, material hamda mashina-soat tariflari bilan serverda hisoblangandan keyingina chiqariladi.</p>
        </div>
      </Card>

      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? data.items.length ? <Card className="data-table-card"><div className="card-heading card-heading--padded"><div><p className="eyebrow">Hisob bandlari</p><h2>Elementlar va aniqlangan nuqsonlar</h2></div><span className="revision-chip"><RefreshCw size={15} /> {data.items.length} band</span></div><TableFrame label={`${year}-yil saqlash ishlari dasturi`}><table><thead><tr><th>Yo‘l</th><th>Ish turi</th><th>Manba</th><th>Yillik hajm</th><th>Bajarilgan</th><th>Odam-soat</th><th>Holat</th></tr></thead><tbody>{data.items.map((line) => <tr key={line.id}><td><strong>{line.road.code}</strong><small>{line.road.name}</small></td><td><strong>{line.workName}</strong><small>Yo‘l elementi / aniqlangan ehtiyoj</small></td><td>{line.normReference}</td><td>{line.quantity.planned} {line.quantity.unit}</td><td>{line.quantity.completed} {line.quantity.unit}</td><td>{line.laborHours.required} soat</td><td><Badge tone={line.approvalState === "APPROVED" ? "success" : line.approvalState === "CLOSED" ? "neutral" : "warning"}>{line.approvalState === "APPROVED" ? "Tasdiqlangan" : line.approvalState === "CLOSED" ? "Yopilgan" : "Qoralama"}</Badge></td></tr>)}</tbody></table></TableFrame></Card> : <EmptyState title="Dastur bandi yo‘q" detail={`${year}-yil uchun saqlash ishlari dasturi hali kiritilmagan.`} /> : null}
    </div>
  );
}
