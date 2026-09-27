"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Check, CheckCircle2, ClipboardPenLine, Download, ExternalLink, ListChecks, Send, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth, useHasPermission } from "@/components/auth-provider";
import type { ManualInspection, ManualInspectionInput, ManualInspectionState } from "@/lib/api/types";
import { formatChainage, formatDate, formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";
import { inspectionCapacity, inspectionInventoryError, matchingInspectionElements } from "@/lib/inspection-inventory";
import { DefectTypePicker } from "@/components/defect-type-picker";
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
  const [filter, setFilter] = useState<ManualInspectionState>("PENDING_REVIEW");
  const [selectedDefectTypeId, setSelectedDefectTypeId] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("m2");
  const [selectedRoadId, setSelectedRoadId] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [reviewElementId, setReviewElementId] = useState("");
  const [chainageStart, setChainageStart] = useState("");
  const [chainageEnd, setChainageEnd] = useState("");
  const [selectedInspection, setSelectedInspection] = useState<ManualInspection | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [verifiedNotice, setVerifiedNotice] = useState(false);
  const [actionError, setActionError] = useState("");
  const drawerRef = useRef<HTMLElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { data: options, error: optionsError, loading: optionsLoading, reload: reloadOptions } = useApiResource(api.manualInspectionOptions, "manual-inspection-options");
  const { data: inspections, error: listError, loading: listLoading, reload: reloadList, setData: setInspections } = useApiResource(
    () => api.manualInspections(filter),
    `manual-inspections:${filter}`,
  );
  const selectedDefectType = options?.defectTypes?.find((item) => item.id === selectedDefectTypeId);
  const selectedUnitLabel = options?.measurementUnits.find((item) => item.value === selectedUnit)?.label;
  const road = options?.roads.find((item) => item.id === selectedRoadId) ?? options?.roads[0];
  const startM = chainageStart.trim() ? String(Math.round(Number(chainageStart) * 1000)) : "";
  const endM = chainageEnd.trim() ? String(Math.round(Number(chainageEnd) * 1000)) : "";
  const matches = matchingInspectionElements(options?.roadElements ?? [], road?.id ?? "", selectedDefectType?.code ?? "", startM, endM);
  const matchedElement = matches.length === 1 ? matches[0] : undefined;
  const quantityLimit = inspectionCapacity(matchedElement, selectedUnit, startM, endM);
  const unresolvedObservation = selectedInspection?.observations.find((item) => item.inventoryResolution === "REVIEW_REQUIRED");
  const reviewRoadId = selectedInspection?.road.id ?? options?.roads.find((item) => item.code === selectedInspection?.road.code)?.id ?? "";
  const reviewElements = unresolvedObservation ? matchingInspectionElements(options?.roadElements ?? [], reviewRoadId, unresolvedObservation.defectTypeCode ?? "", String(unresolvedObservation.chainageStartM ?? ""), String(unresolvedObservation.chainageEndM ?? "")) : [];


  function openInspection(inspection: ManualInspection, trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    setSelectedInspection(inspection);
    setReviewNote("");
    setReviewElementId("");
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
    if (!road || !selectedDefectType) {
      setActionError("Ro‘yxatdan nuqson turini tanlang.");
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const payload: ManualInspectionInput = {
      roadId: road.id,
      defectTypeId: selectedDefectType.id,
      observedIssue: selectedDefectType.name,
      observedDate: String(form.get("observedDate") ?? ""),
      chainageStartM: startM,
      chainageEndM: endM || undefined,
      exactQuantity: String(form.get("exactQuantity") ?? ""),
      unit: selectedUnit,
      note: String(form.get("note") ?? "").trim() || undefined,
      submitForReview: true,
    };
    const inventoryError = inspectionInventoryError({ ...payload, roadElementId: matchedElement?.id }, options?.roadElements ?? [], road.lengthM);
    if (inventoryError) { setActionError(inventoryError); return; }
    if (evidenceFile && (!["image/jpeg", "image/png", "video/mp4"].includes(evidenceFile.type) || evidenceFile.size > 20 * 1024 * 1024)) {
      setActionError("JPEG, PNG yoki MP4 fayl tanlang. Hajmi 20 MB dan oshmasin.");
      return;
    }
    setBusy(true);
    setMessage("");
    setVerifiedNotice(false);
    setActionError("");
    try {
      if (evidenceFile) payload.evidence = [await api.uploadInspectionEvidence(evidenceFile)];
      const result = await api.submitInspection(payload);
      setMessage(result.inventoryResolution === "REVIEW_REQUIRED" ? "Nuqson boshliqqa yuborildi. Joylashuv bazasi tasdiqlashda aniqlashtiriladi." : "Nuqson boshliqqa yuborildi.");
      formElement.reset();
      setSelectedDefectTypeId("");
      setSelectedUnit("m2");
      setEvidenceFile(null);
      setChainageStart("");
      setChainageEnd("");
      setFilter("PENDING_REVIEW");
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
      await api.decideManualInspection(selectedInspection.id, decision, reviewNote.trim(), reviewElementId || undefined);
      setInspections((current) => current ? {
        ...current,
        items: current.items.filter((item) => item.id !== selectedInspection.id),
        total: Math.max(0, current.total - 1),
      } : current);
      closeInspection();
      setReviewNote("");
      setVerifiedNotice(decision === "VERIFIED");
      setMessage(decision === "VERIFIED" ? "Nuqson tasdiqlandi." : "Nuqson rad etildi.");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Qarorni saqlab bo‘lmadi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="Nuqson kiritish" description="Ko‘rik natijasini kiriting va boshliqqa yuboring." actions={canExport ? <a className="button button--secondary" href="/api/v1/reports/manual-inspections.xlsx" download><Download size={16} aria-hidden="true" /> Excel yuklash</a> : null} />
      <div className="tabs" role="tablist" aria-label="Qo‘lda ko‘rik bo‘limlari">
        <button role="tab" aria-selected={view === "create"} onClick={() => setView("create")}><ClipboardPenLine size={16} aria-hidden="true" /> Yangi ko‘rik</button>
        <button role="tab" aria-selected={view === "register"} onClick={() => setView("register")}><ListChecks size={16} aria-hidden="true" /> Ko‘riklar ro‘yxati</button>
      </div>
      {message ? <div className="success-banner" role="status"><CheckCircle2 aria-hidden="true" /><span>{message}</span>{verifiedNotice ? <Link className="button button--secondary" href="/tasdiqlangan-nuqsonlar">Nuqsonlardan topshiriq yaratish</Link> : null}</div> : null}
      {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}

      {view === "create" ? optionsLoading ? <LoadingState /> : optionsError ? <ErrorState error={optionsError} retry={reloadOptions} /> : options && road ? (
        <Card className="form-card">
          <form className="data-form" onSubmit={createInspection}>
            <SelectInput label="Yo‘l" name="roadId" required value={road.id} onChange={(event) => { setSelectedRoadId(event.target.value); setChainageStart(""); setChainageEnd(""); }}>
              {options.roads.map((item) => <option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}
            </SelectInput>
            <TextInput label="Ko‘rik sanasi" name="observedDate" type="date" required defaultValue={new Date().toLocaleDateString("en-CA")} />
            <TextInput label="Boshlanish, km" name="locationKm" type="number" min="0" max={(road.lengthM - 1) / 1000} step="0.001" inputMode="decimal" required value={chainageStart} onChange={(event) => setChainageStart(event.target.value)} placeholder="Masalan, 12.350" hint={`0 — ${road.lengthM / 1000} km`} />
            {selectedDefectType && selectedUnit !== "unit" ? <TextInput label="Tugash, km" name="chainageEndKm" required type="number" min={chainageStart ? Number(chainageStart) + 0.001 : 0} max={road.lengthM / 1000} step="0.001" inputMode="decimal" value={chainageEnd} onChange={(event) => setChainageEnd(event.target.value)} placeholder="Masalan, 12.360" /> : null}
            <DefectTypePicker options={options.defectTypes ?? []} value={selectedDefectTypeId} onChange={(id) => { setSelectedDefectTypeId(id); setSelectedUnit(options.defectTypes?.find((item) => item.id === id)?.unit ?? "m2"); if (options.defectTypes?.find((item) => item.id === id)?.unit === "unit") setChainageEnd(""); }} />
            <TextInput label={`Hajm${selectedUnitLabel ? `, ${selectedUnitLabel}` : ""}`} name="exactQuantity" type="number" min={selectedUnit === "unit" ? 1 : "0.000001"} max={quantityLimit} step={selectedUnit === "unit" ? 1 : "any"} inputMode="decimal" required hint={quantityLimit !== undefined ? `Bu joyda eng ko‘pi ${quantityLimit} ${selectedUnitLabel ?? selectedUnit}.` : undefined} />
            {!selectedDefectType?.unit ? <SelectInput label="O‘lchov birligi" name="unit" required value={selectedUnit} onChange={(event) => setSelectedUnit(event.target.value)}>{options.measurementUnits.map((unit) => <option value={unit.value} key={unit.value}>{unit.label}</option>)}</SelectInput> : null}
            <div className="form-span"><label className="field" htmlFor="inspection-photo"><span className="field__label"><Camera size={16} aria-hidden="true" /> Foto yoki video (ixtiyoriy)</span><input id="inspection-photo" className="input" type="file" accept="image/jpeg,image/png,video/mp4" onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)} /><span className="field__hint">JPEG, PNG yoki MP4 · 20 MB gacha</span></label></div>
            <div className="form-span"><TextArea label="Izoh (ixtiyoriy)" name="note" rows={2} placeholder="Masalan, o‘ng tasmada, harakatga xalaqit beryapti" /></div>
            <div className="form-span"><Button type="submit" busy={busy} disabled={!selectedDefectTypeId}><Send size={16} aria-hidden="true" /> Boshliqqa yuborish</Button></div>
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
                <table><thead><tr><th>Ko‘rik</th><th>Yo‘l va sana</th><th>Aniqlangan nuqson</th><th>Joy va hajm</th><th>Holat</th><th><span className="sr-only">Amal</span></th></tr></thead><tbody>{inspections.items.map((inspection) => {
                  const observation = inspection.observations[0];
                  return <tr key={inspection.id}><td><strong>{inspection.inspectionNumber}</strong><small>{inspection.inspectorName}</small></td><td><strong>{inspection.road.code}</strong><small>{inspection.road.name}</small><small>{formatDate(inspection.observedDate)}</small></td><td><strong>{observation?.observedIssue ?? "—"}</strong>{inspection.note ? <small>{inspection.note}</small> : null}</td><td><strong>{observation?.locationLabel ?? "—"}</strong><small>{observation ? `${observation.exactQuantity.value} ${observation.exactQuantity.unit}` : "—"}</small></td><td>{stateBadge(inspection.state)}{inspection.submittedAt ? <small>Yuborildi: {formatDateTime(inspection.submittedAt)}</small> : null}</td><td>{inspection.state === "DRAFT" ? <Button variant="secondary" busy={busy} onClick={() => submitForReview(inspection)}><Send size={15} aria-hidden="true" /> Ko‘rib chiqishga yuborish</Button> : <Button variant="secondary" onClick={(event) => openInspection(inspection, event.currentTarget)}>{inspection.state === "PENDING_REVIEW" && canVerify ? "Ko‘rib chiqish" : "Ko‘rish"}</Button>}</td></tr>;
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
          {selectedInspection.note ? <p>{selectedInspection.note}</p> : null}
          {selectedInspection.state === "PENDING_REVIEW" && canVerify ? <>
          {unresolvedObservation ? <div className="workflow-summary"><strong>Joylashuvni aniqlashtirish kerak</strong>{reviewElements.length ? <SelectInput label="Bazadagi mos joy" name="reviewElementId" value={reviewElementId} onChange={(event) => setReviewElementId(event.target.value)}><option value="">Mos yozuvni tanlang</option>{reviewElements.map((element) => <option key={element.id} value={element.id}>{element.name} · {formatChainage(element.chainageStartM)}</option>)}</SelectInput> : <p>Bu joyga mos yozuv bazada yo‘q. Aktivlar bazasini to‘ldirgandan keyin tasdiqlash mumkin.</p>}</div> : null}
          <TextArea label="Qaror izohi" name="inspectionReviewNote" rows={3} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} hint="Rad etishda sabab majburiy." />
          {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
          <div className="button-row"><Button busy={busy} disabled={Boolean(unresolvedObservation && !reviewElementId)} onClick={() => decide("VERIFIED")}><Check size={16} aria-hidden="true" /> Tasdiqlash</Button><Button busy={busy} variant="danger" onClick={() => decide("REJECTED")}><X size={16} aria-hidden="true" /> Rad etish</Button></div>
          </> : <div>{stateBadge(selectedInspection.state)}{selectedInspection.reviewerNote ? <p>{selectedInspection.reviewerNote}</p> : null}</div>}
        </section>
      </div> : null}
    </div>
  );
}
