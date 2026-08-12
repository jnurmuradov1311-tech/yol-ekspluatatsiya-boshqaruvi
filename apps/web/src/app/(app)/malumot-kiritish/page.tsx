"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Check, CheckCircle2, ClipboardPenLine, Download, ListChecks, Send, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth, useHasPermission } from "@/components/auth-provider";
import type { ManualInspection, ManualInspectionInput, ManualInspectionState } from "@/lib/api/types";
import { formatChainage, formatDate, formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, SelectInput, TableFrame, TextArea, TextInput } from "@/components/ui";

const inspectionStates: Array<{ value: ManualInspectionState; label: string }> = [
  { value: "DRAFT", label: "Qoralama" },
  { value: "PENDING_REVIEW", label: "Ko‘rib chiqilmoqda" },
  { value: "VERIFIED", label: "Tasdiqlangan" },
  { value: "REJECTED", label: "Rad etilgan" },
];

function stateBadge(state: ManualInspectionState) {
  const labels: Record<ManualInspectionState, { label: string; tone: "neutral" | "warning" | "success" | "danger" }> = {
    DRAFT: { label: "Qoralama", tone: "neutral" },
    PENDING_REVIEW: { label: "Ko‘rib chiqilmoqda", tone: "warning" },
    VERIFIED: { label: "Tasdiqlangan", tone: "success" },
    REJECTED: { label: "Rad etilgan", tone: "danger" },
  };
  return <Badge tone={labels[state].tone}>{labels[state].label}</Badge>;
}

export default function ManualEntryPage() {
  const { user } = useAuth();
  const canReadDefects = useHasPermission("defects.read");
  const canExport = useHasPermission("reports.read") && canReadDefects;
  const canVerify = Boolean(user?.permissions.includes("system.all") || user?.permissions.includes("defects.verify"));
  const [view, setView] = useState<"create" | "register">("create");
  const [filter, setFilter] = useState<ManualInspectionState>("DRAFT");
  const [selectedDefectId, setSelectedDefectId] = useState("");
  const [selectedInspection, setSelectedInspection] = useState<ManualInspection | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const { data: options, error: optionsError, loading: optionsLoading, reload: reloadOptions } = useApiResource(api.manualInspectionOptions, "manual-inspection-options");
  const { data: inspections, error: listError, loading: listLoading, reload: reloadList, setData: setInspections } = useApiResource(
    () => api.manualInspections(filter),
    `manual-inspections:${filter}`,
  );
  const selectedDefect = useMemo(
    () => options?.defectTypes.find((item) => item.id === selectedDefectId),
    [options, selectedDefectId],
  );
  const road = options?.roads[0];

  async function createInspection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!road || !selectedDefect) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const evidenceUri = String(form.get("evidenceObjectUri") ?? "").trim();
    const capturedAt = String(form.get("capturedAt") ?? "").trim();
    if (evidenceUri && !capturedAt) {
      setActionError("Foto yoki video biriktirilsa, dalil olingan vaqtni ham kiriting.");
      return;
    }
    const payload: ManualInspectionInput = {
      roadId: road.id,
      defectTypeId: selectedDefect.id,
      observedDate: String(form.get("observedDate") ?? ""),
      chainageStartM: String(form.get("chainageStartM") ?? ""),
      chainageEndM: String(form.get("chainageEndM") ?? "") || undefined,
      direction: String(form.get("direction") ?? "") || undefined,
      laneLabel: String(form.get("laneLabel") ?? "") || undefined,
      observedIssue: selectedDefect.name,
      exactQuantity: String(form.get("exactQuantity") ?? ""),
      unit: selectedDefect.unit,
      note: String(form.get("note") ?? "") || undefined,
      evidence: evidenceUri ? [{
        objectUri: evidenceUri,
        contentType: String(form.get("evidenceContentType") ?? "image/jpeg"),
        capturedAt,
        latitude: String(form.get("latitude") ?? "") || undefined,
        longitude: String(form.get("longitude") ?? "") || undefined,
      }] : undefined,
    };
    setBusy(true);
    setMessage("");
    setActionError("");
    try {
      const result = await api.submitInspection(payload);
      setMessage(`Ko‘rik qoralamasi yaratildi: ${result.id}`);
      formElement.reset();
      setSelectedDefectId("");
      setFilter("DRAFT");
      setView("register");
      await reloadList();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Ko‘rik yozuvini saqlab bo‘lmadi.");
    } finally {
      setBusy(false);
    }
  }

  async function submitForReview(inspection: ManualInspection) {
    setBusy(true);
    setActionError("");
    try {
      await api.submitManualInspection(inspection.id);
      setInspections((current) => current ? {
        ...current,
        items: current.items.filter((item) => item.id !== inspection.id),
        total: Math.max(0, current.total - 1),
      } : current);
      setMessage(`${inspection.inspectionNumber} ko‘rib chiqishga yuborildi.`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Ko‘rikni yuborib bo‘lmadi.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "VERIFIED" | "REJECTED") {
    if (!selectedInspection) return;
    if (decision === "REJECTED" && !reviewNote.trim()) {
      setActionError("Rad etish sababini yozing.");
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      await api.decideManualInspection(selectedInspection.id, decision, reviewNote.trim());
      setInspections((current) => current ? {
        ...current,
        items: current.items.filter((item) => item.id !== selectedInspection.id),
        total: Math.max(0, current.total - 1),
      } : current);
      setSelectedInspection(null);
      setReviewNote("");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Qarorni saqlab bo‘lmadi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="D001 yo‘l ustasi ko‘rigi" description="D001 yo‘lining 0+000–67+000 oralig‘ida joyida aniqlangan nuqsonlarni kiriting va tasdiqlashga yuboring." actions={canExport ? <a className="button button--secondary" href="/api/v1/reports/manual-inspections.xlsx" download><Download size={16} aria-hidden="true" /> Excel yuklash</a> : null} />
      <div className="tabs" role="tablist" aria-label="Qo‘lda ko‘rik bo‘limlari">
        <button role="tab" aria-selected={view === "create"} onClick={() => setView("create")}><ClipboardPenLine size={16} aria-hidden="true" /> Yangi ko‘rik</button>
        <button role="tab" aria-selected={view === "register"} onClick={() => setView("register")}><ListChecks size={16} aria-hidden="true" /> Ko‘riklar ro‘yxati</button>
      </div>
      {message ? <div className="success-banner" role="status"><CheckCircle2 aria-hidden="true" /><span>{message}</span></div> : null}
      {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}

      {view === "create" ? optionsLoading ? <LoadingState /> : optionsError ? <ErrorState error={optionsError} retry={reloadOptions} /> : options && road ? (
        <Card className="form-card">
          <div className="road-context"><div><span>Yo‘l</span><strong>{road.code} · {road.name}</strong></div><div><span>Uzunligi</span><strong>0+000 — {formatChainage(road.lengthM)}</strong></div><div><span>Yo‘l bo‘limi</span><strong>{road.divisionName}</strong></div></div>
          <form className="data-form" onSubmit={createInspection}>
            <SelectInput label="Yo‘l (YTPdan biriktirilgan)" name="roadId" required disabled value={road.id}>
              {options.roads.map((item) => <option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}
            </SelectInput>
            <SelectInput label="Nuqson turi" name="defectTypeId" required value={selectedDefectId} onChange={(event) => setSelectedDefectId(event.target.value)}>
              <option value="" disabled>Nuqsonni tanlang</option>
              {options.defectTypes.map((defect) => <option value={defect.id} key={defect.id}>{defect.name}</option>)}
            </SelectInput>
            <TextInput label="Ko‘rik sanasi" name="observedDate" type="date" required />
            <TextInput label="Boshlanish nuqtasi, metr" name="chainageStartM" type="number" min="0" max={road.lengthM - 1} step="1" required hint={`${road.code} boshidan: 0–${(road.lengthM - 1).toLocaleString("uz-UZ")} metr. Tugash nuqtasi ${road.lengthM.toLocaleString("uz-UZ")} metrgacha bo‘lishi mumkin.`} />
            <TextInput label="Tugash nuqtasi, metr" name="chainageEndM" type="number" min="1" max={road.lengthM} step="1" />
            <SelectInput label="Yo‘nalish" name="direction" defaultValue=""><option value="">Tanlanmagan</option><option value="ichki halqa">Ichki halqa</option><option value="tashqi halqa">Tashqi halqa</option></SelectInput>
            <TextInput label="Tasma yoki yoqa" name="laneLabel" placeholder="Masalan: o‘ng tasma" />
            <TextInput label={`Aniq ish hajmi${selectedDefect ? `, ${selectedDefect.unit}` : ""}`} name="exactQuantity" type="number" min="0" step="any" required />
            <TextInput label="Foto/video fayl manzili" name="evidenceObjectUri" placeholder="s3://…" hint="Ixtiyoriy. Rasmiy yuklash xizmatidan olingan manzil." />
            <SelectInput label="Dalil turi" name="evidenceContentType" defaultValue="image/jpeg"><option value="image/jpeg">JPEG rasm</option><option value="image/png">PNG rasm</option><option value="video/mp4">MP4 video</option></SelectInput>
            <TextInput label="Dalil olingan vaqt" name="capturedAt" type="datetime-local" />
            <TextInput label="Kenglik" name="latitude" type="number" min="-90" max="90" step="any" placeholder="41.311" />
            <TextInput label="Uzunlik" name="longitude" type="number" min="-180" max="180" step="any" placeholder="69.279" />
            <div className="form-span"><TextArea label="Ko‘rik izohi" name="note" rows={3} hint="Harakat xavfsizligiga ta’sir qiladigan muhim holatni yozing." /></div>
            <div className="form-span"><Button type="submit" busy={busy} disabled={!selectedDefectId}>Qoralamani saqlash</Button></div>
          </form>
        </Card>
      ) : <EmptyState title="D001 topilmadi" detail="YTP integratsiyasida yagona faol D001 yo‘li 67 000 metr uzunlikda bo‘lishi kerak." /> : (
        <>
          <div className="tabs tabs--subtle" role="tablist" aria-label="Ko‘rik holati">
            {inspectionStates.map((state) => <button key={state.value} role="tab" aria-selected={filter === state.value} onClick={() => { setFilter(state.value); setSelectedInspection(null); }}>{state.label}</button>)}
          </div>
          {listLoading ? <LoadingState /> : listError ? <ErrorState error={listError} retry={reloadList} /> : inspections ? inspections.items.length ? (
            <Card>
              <TableFrame label="Yo‘l ustasi ko‘riklari">
                <table><thead><tr><th>Ko‘rik</th><th>Yo‘l va sana</th><th>Aniqlangan nuqson</th><th>Joy va hajm</th><th>Holat</th><th><span className="sr-only">Amal</span></th></tr></thead><tbody>{inspections.items.map((inspection) => {
                  const observation = inspection.observations[0];
                  return <tr key={inspection.id}><td><strong>{inspection.inspectionNumber}</strong><small>{inspection.inspectorName}</small></td><td><strong>{inspection.road.code}</strong><small>{inspection.road.name}</small><small>{formatDate(inspection.observedDate)}</small></td><td><strong>{observation?.observedIssue ?? "—"}</strong><small>{inspection.observations.length} ta kuzatuv</small></td><td><strong>{observation?.locationLabel ?? "—"}</strong><small>{observation ? `${observation.exactQuantity.value} ${observation.exactQuantity.unit}` : "—"}</small></td><td>{stateBadge(inspection.state)}{inspection.submittedAt ? <small>Yuborildi: {formatDateTime(inspection.submittedAt)}</small> : null}</td><td>{inspection.state === "DRAFT" ? <Button variant="secondary" busy={busy} onClick={() => submitForReview(inspection)}><Send size={15} aria-hidden="true" /> Ko‘rib chiqishga yuborish</Button> : inspection.state === "PENDING_REVIEW" && canVerify ? <Button variant="secondary" onClick={() => { setSelectedInspection(inspection); setReviewNote(""); setActionError(""); }}>Ko‘rib chiqish</Button> : null}</td></tr>;
                })}</tbody></table>
              </TableFrame>
            </Card>
          ) : <EmptyState title="Bu holatda ko‘rik yo‘q" detail="Yangi ko‘riklar tegishli bosqichga o‘tganda shu yerda ko‘rinadi." /> : null}
        </>
      )}

      {selectedInspection ? <div className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="inspection-review-title">
        <button className="drawer-scrim" aria-label="Ko‘rib chiqishni yopish" onClick={() => setSelectedInspection(null)} />
        <section className="drawer"><header><div><p className="eyebrow">{selectedInspection.inspectionNumber}</p><h2 id="inspection-review-title">Yo‘l ustasi ko‘rigini tekshirish</h2></div><button className="icon-button" aria-label="Yopish" onClick={() => setSelectedInspection(null)}><X aria-hidden="true" /></button></header>
          <div className="inspection-observations">{selectedInspection.observations.map((observation) => <article key={observation.id}><strong>{observation.observedIssue}</strong><p>{observation.locationLabel}</p><small>{observation.exactQuantity.value} {observation.exactQuantity.unit}</small></article>)}</div>
          <TextArea label="Qaror izohi" name="inspectionReviewNote" rows={3} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} hint="Rad etishda sabab majburiy." />
          {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          <div className="button-row"><Button busy={busy} onClick={() => decide("VERIFIED")}><Check size={16} aria-hidden="true" /> Tasdiqlash</Button><Button busy={busy} variant="danger" onClick={() => decide("REJECTED")}><X size={16} aria-hidden="true" /> Rad etish</Button></div>
        </section>
      </div> : null}
    </div>
  );
}
