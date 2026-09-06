"use client";

import { useState } from "react";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import { useHasPermission } from "@/components/auth-provider";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/use-api-resource";
import { useOperatingScope } from "@/components/scope-provider";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, SelectInput, TableFrame } from "@/components/ui";

export default function AnnualProgramPage() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const { scope } = useOperatingScope();
  const canGenerate = useHasPermission("planning.write");
  const canApprove = useHasPermission("planning.approve");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const { data, error, loading, reload } = useApiResource(() => api.annualProgram(year), `annual-program:${year}`);
  async function generate() {
    setBusy(true); setMessage(""); setActionError("");
    try { const result = await api.generateAnnualProgram(year); await reload(); setMessage(`${result.reused ? "Mavjud reja ochildi" : "Yillik reja tuzildi"}. ${result.lineCount} ta ish bandi. Qoidasi topilmagan element: ${result.coverage.unmappedElements} ta.`); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : "Yillik reja tuzilmadi."); }
    finally { setBusy(false); }
  }
  async function approve(id: string) {
    setBusy(true); setActionError("");
    try { await api.approveAnnualProgram(id); await reload(); setMessage("Yillik reja tasdiqlandi. Ishlarni belgilangan oyda topshiriqqa o‘tkazish mumkin."); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : "Reja tasdiqlanmadi."); }
    finally { setBusy(false); }
  }
  const draftPrograms = [...new Set(data?.items.filter((item) => item.approvalState === "DRAFT").map((item) => item.programId) ?? [])];
  return (
    <div className="page-stack">
      <PageHeader title="Yillik saqlash rejasi" description="Yo‘l elementlari va IQN bo‘yicha takrorlanuvchi ishlar asosida yillik saqlash rejasini avtomatik tuzing." actions={<><SelectInput label="Dastur yili" name="programYear" value={year} onChange={(event) => setYear(Number(event.target.value))}><option value={year - 1}>{year - 1}</option><option value={year}>{year}</option><option value={year + 1}>{year + 1}</option></SelectInput><a className="button button--secondary" href={`/api/v1/reports/annual-program.xlsx?year=${year}`} download><Download size={16} aria-hidden="true" /> Excel</a></>} />
      <div className="scope-meta"><span><strong>Qamrov</strong>{scope.shortName}</span><span><strong>Yo‘l va kesim</strong>{scope.roadLabel}</span><span><strong>Dastur yili</strong>{year}</span></div>

      <Card className="admin-scope-note"><ShieldCheck aria-hidden="true" /><div><strong>Elementlar → takrorlanuvchi ishlar → yillik reja</strong><p>Algoritm yo‘l elementlari miqdori, IQN davriyligi va ish mavsumini hisobga oladi. Nuqsonlardan yaratilgan tezkor ishlar alohida rejalashtiriladi.</p><div className="button-row">{canGenerate ? <Button busy={busy} onClick={generate}>Yillik rejani avtomatik tuzish</Button> : null}{canApprove ? draftPrograms.map((id) => <Button key={id} variant="secondary" busy={busy} onClick={() => approve(id)}>Yillik rejani tasdiqlash</Button>) : null}</div></div></Card>
      {message ? <p className="success-banner" role="status">{message}</p> : null}{actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}

      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? data.items.length ? <Card className="data-table-card"><div className="card-heading card-heading--padded"><div><p className="eyebrow">Hisob bandlari</p><h2>Yo‘l elementlari bo‘yicha yillik ishlar</h2></div><span className="revision-chip"><RefreshCw size={15} /> {data.items.length} band</span></div><TableFrame label={`${year}-yil saqlash ishlari dasturi`}><table><thead><tr><th>Yo‘l</th><th>Ish turi</th><th>Manba</th><th>Muddat</th><th>Reja hajmi</th><th>Bajarilgan</th><th>Odam-soat</th><th>Holat</th></tr></thead><tbody>{data.items.map((line) => <tr key={line.id}><td><strong>{line.road.code}</strong><small>{line.road.name}</small></td><td><strong>{line.workName}</strong><small>Yo‘l elementi / takroriy saqlash</small></td><td>{line.normReference}</td><td>{line.plannedFrom ?? "Yil davomida"}<small>{line.plannedUntil ?? ""}</small></td><td>{line.quantity.planned} {line.quantity.unit}</td><td>{line.quantity.completed} {line.quantity.unit}</td><td>{line.laborHours.required} soat</td><td><Badge tone={line.approvalState === "APPROVED" ? "success" : line.approvalState === "CLOSED" ? "neutral" : "warning"}>{line.approvalState === "APPROVED" ? "Tasdiqlangan" : line.approvalState === "CLOSED" ? "Yopilgan" : "Qoralama"}</Badge></td></tr>)}</tbody></table></TableFrame></Card> : <EmptyState title="Dastur bandi yo‘q" detail={`${year}-yil uchun saqlash ishlari dasturi hali kiritilmagan.`} /> : null}
    </div>
  );
}
