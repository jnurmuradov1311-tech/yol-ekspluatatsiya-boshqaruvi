"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Camera, Check, CheckCircle2, ClipboardPenLine, Download, ExternalLink, ListChecks, MapPin, Send, X } from "lucide-react";
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
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("m2");
  const [selectedRoadId, setSelectedRoadId] = useState("");
  const [selectedInspection, setSelectedInspection] = useState<ManualInspection | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const drawerRef = useRef<HTMLElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { data: options, error: optionsError, loading: optionsLoading, reload: reloadOptions } = useApiResource(api.manualInspectionOptions, "manual-inspection-options");
  const { data: inspections, error: listError, loading: listLoading, reload: reloadList, setData: setInspections } = useApiResource(
    () => api.manualInspections(filter),
    `manual-inspections:${filter}`,
  );
  const selectedTopic = useMemo(
    () => options?.workTopics.find((item) => item.id === selectedTopicId),
    [options, selectedTopicId],
  );
  const selectedUnitLabel = options?.measurementUnits.find((item) => item.value === selectedUnit)?.label;
  const road = options?.roads.find((item) => item.id === selectedRoadId) ?? options?.roads[0];

  function openInspection(inspection: ManualInspection, trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    setSelectedInspection(inspection);
    setReviewNote("");
    setActionError("");
  }

  function closeInspection() {
    setSelectedInspection(null);
  }

  useEffect(() => {
    if (!selectedInspection) return;
    const returnTarget = returnFocusRef.current;
    window.requestAnimationFrame(() => drawerCloseRef.current?.focus());
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedInspection(null);
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => {
        if (returnTarget?.isConnected) returnTarget.focus();
      });
    };
  }, [selectedInspection]);

  async function createInspection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!road || !selectedTopic) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const evidenceUri = String(form.get("evidenceObjectUri") ?? "").trim();
    const evidenceSha256 = String(form.get("evidenceSha256") ?? "").trim();
    const capturedAt = String(form.get("capturedAt") ?? "").trim();
    if (evidenceUri && !capturedAt) {
      setActionError("Foto yoki video biriktirilsa, dalil olingan vaqtni ham kiriting.");
      return;
    }
    if (evidenceUri && !/^[a-f0-9]{64}$/.test(evidenceSha256)) {
      setActionError("Dalil uchun kichik harfdagi 64 belgili SHA-256 nazorat qiymatini kiriting.");
      return;
    }
    const payload: ManualInspectionInput = {
      roadId: road.id,
      iqnTopicId: selectedTopic.id,
      observedDate: String(form.get("observedDate") ?? ""),
      chainageStartM: String(form.get("locationM") ?? ""),
      exactQuantity: String(form.get("exactQuantity") ?? ""),
      unit: selectedUnit,
      note: String(form.get("note") ?? "") || undefined,
      evidence: evidenceUri ? [{
        objectUri: evidenceUri,
        contentType: String(form.get("evidenceContentType") ?? "image/jpeg"),
        sha256: evidenceSha256,
        capturedAt,
      }] : undefined,
    };
    setBusy(true);
    setMessage("");
    setActionError("");
    try {
      const result = await api.submitInspection(payload);
      setMessage(`Ko‘rik qoralamasi yaratildi: ${result.id}`);
      formElement.reset();
      setSelectedTopicId("");
      setSelectedUnit("m2");
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
      closeInspection();
      setReviewNote("");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Qarorni saqlab bo‘lmadi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="Yo‘l ustasi ko‘rigi" description="Biriktirilgan yo‘lda aniqlangan holatni IQN 02-24 umumiy ish mavzusi va yagona lokatsiya bilan qayd eting." actions={canExport ? <a className="button button--secondary" href="/api/v1/reports/manual-inspections.xlsx" download><Download size={16} aria-hidden="true" /> Excel yuklash</a> : null} />
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
            <SelectInput label="Biriktirilgan yo‘l" name="roadId" required value={road.id} onChange={(event) => setSelectedRoadId(event.target.value)}>
              {options.roads.map((item) => <option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}
            </SelectInput>
            <SelectInput label="IQN 02-24 umumiy ish mavzusi" name="iqnTopicId" required value={selectedTopicId} onChange={(event) => setSelectedTopicId(event.target.value)}>
              <option value="" disabled>Ish mavzusini tanlang</option>
              {options.workTopics.map((topic) => <option value={topic.id} key={topic.id}>{topic.topicNumber}. {topic.name}</option>)}
            </SelectInput>
            <TextInput label="Ko‘rik sanasi" name="observedDate" type="date" required />
            <div className="location-picker"><label htmlFor="inspection-location"><MapPin aria-hidden="true" /> Lokatsiya</label><input id="inspection-location" className="input" name="locationM" type="number" min="0" max={road.lengthM} step="1" required placeholder="Piketajni metrda kiriting" /><small>{road.code} · 0+000 — {formatChainage(road.lengthM)}. Bitta aniq nuqtani metrda belgilang.</small></div>
            <TextInput label={`Aniq ish hajmi${selectedUnitLabel ? `, ${selectedUnitLabel}` : ""}`} name="exactQuantity" type="number" min="0.000001" step="any" required />
            <SelectInput label="O‘lchov birligi" name="unit" required value={selectedUnit} onChange={(event) => setSelectedUnit(event.target.value)}>
              {options.measurementUnits.map((unit) => <option value={unit.value} key={unit.value}>{unit.label}</option>)}
            </SelectInput>
            <div className="evidence-dropzone"><Camera aria-hidden="true" /><div><strong>Foto yoki video dalil</strong><small>Tashkilotning yopiq S3 omboriga oldindan yuklangan fayl manzilini kiriting.</small></div><input className="input" name="evidenceObjectUri" placeholder="s3://…" aria-label="Foto yoki video fayl manzili" /></div>
            <SelectInput label="Dalil turi" name="evidenceContentType" defaultValue="image/jpeg"><option value="image/jpeg">JPEG rasm</option><option value="image/png">PNG rasm</option><option value="video/mp4">MP4 video</option></SelectInput>
            <TextInput label="Dalil SHA-256" name="evidenceSha256" pattern="[a-f0-9]{64}" maxLength={64} autoComplete="off" placeholder="64 belgili kichik harfdagi checksum" hint="S3 obyektining to‘liq fayl SHA-256 qiymati." />
            <TextInput label="Dalil olingan vaqt" name="capturedAt" type="datetime-local" />
            <div className="form-span"><TextArea label="Ko‘rik izohi" name="note" rows={3} hint="Harakat xavfsizligiga ta’sir qiladigan muhim holatni yozing." /></div>
            <div className="form-span"><Button type="submit" busy={busy} disabled={!selectedTopicId}>Qoralamani saqlash</Button></div>
          </form>
        </Card>
      ) : <EmptyState title="Biriktirilgan yo‘l topilmadi" detail="Yo‘l bo‘limiga kamida bitta faol yo‘l yoki yo‘l kesimi biriktirilishi kerak." /> : (
        <>
          <div className="tabs tabs--subtle" role="tablist" aria-label="Ko‘rik holati">
            {inspectionStates.map((state) => <button key={state.value} role="tab" aria-selected={filter === state.value} onClick={() => { setFilter(state.value); closeInspection(); }}>{state.label}</button>)}
          </div>
          {listLoading ? <LoadingState /> : listError ? <ErrorState error={listError} retry={reloadList} /> : inspections ? inspections.items.length ? (
            <Card>
              <TableFrame label="Yo‘l ustasi ko‘riklari">
                <table><thead><tr><th>Ko‘rik</th><th>Yo‘l va sana</th><th>IQN ish mavzusi</th><th>Joy va hajm</th><th>Holat</th><th><span className="sr-only">Amal</span></th></tr></thead><tbody>{inspections.items.map((inspection) => {
                  const observation = inspection.observations[0];
                  return <tr key={inspection.id}><td><strong>{inspection.inspectionNumber}</strong><small>{inspection.inspectorName}</small></td><td><strong>{inspection.road.code}</strong><small>{inspection.road.name}</small><small>{formatDate(inspection.observedDate)}</small></td><td><strong>{observation?.observedIssue ?? "—"}</strong><small>{inspection.observations.length} ta kuzatuv</small></td><td><strong>{observation?.locationLabel ?? "—"}</strong><small>{observation ? `${observation.exactQuantity.value} ${observation.exactQuantity.unit}` : "—"}</small></td><td>{stateBadge(inspection.state)}{inspection.submittedAt ? <small>Yuborildi: {formatDateTime(inspection.submittedAt)}</small> : null}</td><td>{inspection.state === "DRAFT" ? <Button variant="secondary" busy={busy} onClick={() => submitForReview(inspection)}><Send size={15} aria-hidden="true" /> Ko‘rib chiqishga yuborish</Button> : inspection.state === "PENDING_REVIEW" && canVerify ? <Button variant="secondary" onClick={(event) => openInspection(inspection, event.currentTarget)}>Ko‘rib chiqish</Button> : null}</td></tr>;
                })}</tbody></table>
              </TableFrame>
            </Card>
          ) : <EmptyState title="Bu holatda ko‘rik yo‘q" detail="Yangi ko‘riklar tegishli bosqichga o‘tganda shu yerda ko‘rinadi." /> : null}
        </>
      )}

      {selectedInspection ? <div className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="inspection-review-title">
        <button className="drawer-scrim" aria-label="Ko‘rib chiqishni yopish" onClick={closeInspection} />
        <section className="drawer" ref={drawerRef}><header><div><p className="eyebrow">{selectedInspection.inspectionNumber}</p><h2 id="inspection-review-title">Yo‘l ustasi ko‘rigini tekshirish</h2></div><button ref={drawerCloseRef} className="icon-button" aria-label="Yopish" onClick={closeInspection}><X aria-hidden="true" /></button></header>
          <div className="inspection-observations">{selectedInspection.observations.map((observation) => <article key={observation.id}><strong>{observation.observedIssue}</strong><p>{observation.locationLabel}</p><small>{observation.exactQuantity.value} {observation.exactQuantity.unit}</small>{observation.evidence.length ? <div className="inspection-evidence-list">{observation.evidence.map((media) => <div className="inspection-evidence" key={`${media.index}-${media.sha256}`}><div className="evidence-frame">{media.contentType === "video/mp4" ? <video controls preload="metadata" aria-label={`${observation.observedIssue} bo‘yicha ${media.index + 1}-video dalil`}><source src={media.url} type="video/mp4" />Brauzeringiz video dalilni ko‘rsata olmaydi.</video> : <Image src={media.url} width={640} height={360} sizes="(max-width: 720px) 100vw, 580px" alt={`${observation.observedIssue} bo‘yicha ${media.index + 1}-foto dalil`} unoptimized />}</div><p>{formatDateTime(media.capturedAt)}</p><a className="text-link" href={media.url} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" /> Dalilni ochish</a></div>)}</div> : <p>Dalil biriktirilmagan.</p>}</article>)}</div>
          <TextArea label="Qaror izohi" name="inspectionReviewNote" rows={3} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} hint="Rad etishda sabab majburiy." />
          {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          <div className="button-row"><Button busy={busy} onClick={() => decide("VERIFIED")}><Check size={16} aria-hidden="true" /> Tasdiqlash</Button><Button busy={busy} variant="danger" onClick={() => decide("REJECTED")}><X size={16} aria-hidden="true" /> Rad etish</Button></div>
        </section>
      </div> : null}
    </div>
  );
}
