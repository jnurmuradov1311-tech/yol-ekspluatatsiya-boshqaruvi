"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DefectParameterFields } from "@/components/defect-parameters";
import { RoadVisionIntake } from "@/components/roadvision-intake";
import { iqnTopicId } from "@/lib/iqn/defects";
import { searchText } from "@/lib/iqn/catalog";
import { DefectNavigation } from "@/components/defect-navigation";

import { ExportLink } from "@/components/export-link";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Check, CheckCircle2, ClipboardPenLine, Download, ExternalLink, ListChecks, MapPin, Send, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth, useHasPermission } from "@/components/auth-provider";
import type { DefectParameters, ManualInspection, ManualInspectionInput, ManualInspectionState } from "@/lib/api/types";
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
  const router = useRouter();
  const canReadDefects = useHasPermission("defects.read");
  const canExport = useHasPermission("reports.read") && canReadDefects;
  const canVerify = (!api.fixturesEnabled || user?.id === "demo-chief") && Boolean(user?.permissions.includes("system.all") || user?.permissions.includes("defects.verify"));
  const [view, setView] = useState<"create" | "register">("create");
  const [filter, setFilter] = useState<ManualInspectionState>("DRAFT");
  const [selectedDefectTypeId, setSelectedDefectTypeId] = useState("");
  const [captureSource,setCaptureSource]=useState<"HUMAN"|"AI">("HUMAN");
  const [captureKind,setCaptureKind]=useState<"DEFECT"|"SERVICE_REQUEST">("DEFECT");
  const [defectSearch,setDefectSearch]=useState("");
  const [defectTopic,setDefectTopic]=useState("");
  const [observedIssue,setObservedIssue]=useState("");
  const [parameters,setParameters]=useState<DefectParameters>({});
  const [selectedUnit, setSelectedUnit] = useState("m2");
  const [elementId,setElementId]=useState("");
  const [locationStart,setLocationStart]=useState("");
  const [locationEnd,setLocationEnd]=useState("");
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
  const selectedDefectType = options?.defectTypes?.find((item) => item.id === selectedDefectTypeId);
  const visibleDefectTypes=options?.defectTypes?.filter(t=>t.observationKind===captureKind&&(!defectTopic||String(t.iqnTopicNumber)===defectTopic)&&(!defectSearch||searchText(t.name).includes(searchText(defectSearch))))??[];
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
    if (!road || !selectedDefectType) return;
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
      roadId: road.id,roadElementId:elementId||undefined,chainageEndM:locationEnd||undefined,
      defectTypeId: selectedDefectType.id,
      iqnTopicId:iqnTopicId(selectedDefectType.iqnTopicNumber),
      parameters:selectedDefectType.patchParameters?parameters:undefined,
      observedIssue: String(form.get("observedIssue") ?? "").trim(),
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
      setMessage("Nuqson saqlandi.");
      await api.submitManualInspection(result.id);
      formElement.reset();
      setObservedIssue("");setParameters({});
      setSelectedDefectTypeId("");
      setSelectedUnit("m2");
      setFilter("DRAFT");
      setView("register");
      await reloadList();
      router.push("/tasdiqlangan-nuqsonlar?stage=review");
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
      <DefectNavigation />
      <PageHeader title="Nuqson kiritish" description="Yo‘l ustasi qaydi · boshliq tekshiradi." actions={canExport ? <ExportLink className="button button--secondary" href="/api/v1/reports/manual-inspections.xlsx" download><Download size={16} aria-hidden="true" /> Excel yuklash</ExportLink> : null} />
      <div className="tabs" role="tablist" aria-label="Qo‘lda ko‘rik bo‘limlari">
        <button role="tab" aria-selected={view === "create"} onClick={() => setView("create")}><ClipboardPenLine size={16} aria-hidden="true" /> Yangi nuqson</button>
        <button role="tab" aria-selected={view === "register"} onClick={() => setView("register")}><ListChecks size={16} aria-hidden="true" /> Kiritilgan nuqsonlar</button>
      </div>
      {message ? <div className="success-banner" role="status"><CheckCircle2 aria-hidden="true" /><span>{message}</span></div> : null}
      {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}

      {view==="create"?<div className="tabs" role="tablist" aria-label="Nuqson manbasi"><button role="tab" aria-selected={captureSource==="HUMAN"} onClick={()=>setCaptureSource("HUMAN")}>Yo‘l ustasi</button><button role="tab" aria-selected={captureSource==="AI"} onClick={()=>setCaptureSource("AI")}>RoadVision AI</button></div>:null}
      {view === "create" ? captureSource==="AI"?<RoadVisionIntake/>:optionsLoading ? <LoadingState /> : optionsError ? <ErrorState error={optionsError} retry={reloadOptions} /> : options && road ? (
        <Card className="form-card">
          <div className="road-context"><div><span>Yo‘l</span><strong>{road.code} · {road.name}</strong></div><div><span>Uzunligi</span><strong>0+000 — {formatChainage(road.lengthM)}</strong></div><div><span>Yo‘l bo‘limi</span><strong>{road.divisionName}</strong></div></div>
          <form className="data-form" onSubmit={createInspection}>
            <SelectInput label="Biriktirilgan yo‘l" name="roadId" required value={road.id} onChange={(event) => {setSelectedRoadId(event.target.value);setElementId("");setLocationStart("");setLocationEnd("");}}>
              {options.roads.map((item) => <option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}
            </SelectInput>
            <SelectInput label="Yo‘l elementi / uchastka" name="roadElementId" required value={elementId} onChange={e=>{setElementId(e.target.value);const a=options.roadElements?.find(v=>v.id===e.target.value&&v.roadId===road.id);if(a){setLocationStart(String(a.chainageStartM));setLocationEnd(String(a.chainageEndM));}}}><option value="">Bazadagi elementni tanlang</option>{options.roadElements?.filter(a=>a.roadId===road.id).map(a=><option key={a.id} value={a.id}>{a.name} · {a.quantity} {a.unit} · {formatChainage(a.chainageStartM)} — {formatChainage(a.chainageEndM)}</option>)}</SelectInput>
            <div className="form-span tabs" role="tablist" aria-label="Qayd turi"><button type="button" role="tab" aria-selected={captureKind==="DEFECT"} onClick={()=>{setCaptureKind("DEFECT");setSelectedDefectTypeId("");setDefectTopic("");setObservedIssue("");setParameters({});}}>Nuqson</button><button type="button" role="tab" aria-selected={captureKind==="SERVICE_REQUEST"} onClick={()=>{setCaptureKind("SERVICE_REQUEST");setSelectedDefectTypeId("");setDefectTopic("");setObservedIssue("");setParameters({});}}>Ko‘rik yoki xizmat ehtiyoji</button></div>
            <TextInput label="Nuqson nomini qidirish" name="defectSearch" type="search" value={defectSearch} onChange={e=>setDefectSearch(e.target.value)} placeholder="Masalan: belgi, quvur, chuqurcha"/>
            <SelectInput label="IQN bo‘limi" name="defectTopic" value={defectTopic} onChange={e=>setDefectTopic(e.target.value)}><option value="">Barcha bo‘limlar</option>{options.workTopics.filter(t=>options.defectTypes?.some(d=>d.iqnTopicNumber===t.topicNumber&&d.observationKind===captureKind)).map(t=><option key={t.id} value={t.topicNumber}>{t.topicNumber}. {t.name}</option>)}</SelectInput>
            <SelectInput label={captureKind==="DEFECT"?"Nuqson turi":"Xizmat turi"} name="defectTypeId" required value={selectedDefectTypeId} onChange={event=>{setSelectedDefectTypeId(event.target.value);setParameters({});const type=options.defectTypes?.find(t=>t.id===event.target.value);if(type){setSelectedUnit(type.unit);setObservedIssue(type.name);}}}>
              <option value="">Turni tanlang ({visibleDefectTypes.length})</option>
              {selectedDefectType&&!visibleDefectTypes.some(t=>t.id===selectedDefectType.id)?<option value={selectedDefectType.id}>{selectedDefectType.name}</option>:null}
              {visibleDefectTypes.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
            </SelectInput>
            {selectedDefectType?<div className="workflow-summary"><Badge tone="info">IQN 02-24 · {selectedDefectType.iqnTopicNumber}-jadval ishlari</Badge><p>{selectedDefectType.roadvision==="VISIBLE_CANDIDATE"?"RoadVision qaydi boshliq tekshiruvidan o‘tadi.":"Joyida ko‘rik yoki o‘lchov talab qilinadi."}</p></div>:null}
            <div className="form-span"><TextArea label="Aniqlangan nuqson" name="observedIssue" required rows={2} value={observedIssue} onChange={e=>setObservedIssue(e.target.value)}/></div>
            {selectedDefectType?.patchParameters?<details className="form-span workflow-details"><summary>Ta’mir uchun o‘lchovlar (ma’lum bo‘lsa)</summary><DefectParameterFields value={parameters} onChange={setParameters}/></details>:null}
            <TextInput label="Ko‘rik sanasi" name="observedDate" type="date" defaultValue={new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tashkent"})} max={new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tashkent"})} required />
            <div className="location-picker"><label htmlFor="inspection-location"><MapPin aria-hidden="true" /> Lokatsiya</label><input id="inspection-location" className="input" name="locationM" type="number" min="0" max={road.lengthM} step="1" required value={locationStart} onChange={e=>setLocationStart(e.target.value)} placeholder="Masalan, 12500 = 12 km 500 m" /><small>{road.code} · 0+000 — {formatChainage(road.lengthM)}. </small></div>
            <TextInput label="Uchastka oxiri, m" name="chainageEndM" type="number" min={locationStart||0} max={road.lengthM} value={locationEnd} onChange={e=>setLocationEnd(e.target.value)} required/>
            <TextInput label={`O‘lchangan nuqson hajmi${selectedUnitLabel ? `, ${selectedUnitLabel}` : ""}`} name="exactQuantity" type="number" min="0.000001" step="any" required />
            <SelectInput label="O‘lchov birligi" name="unit" required value={selectedUnit} disabled={Boolean(selectedDefectType?.unit)} onChange={(event) => setSelectedUnit(event.target.value)}>
              {options.measurementUnits.map((unit) => <option value={unit.value} key={unit.value}>{unit.label}</option>)}
            </SelectInput>
            {!api.fixturesEnabled ? <details className="form-span workflow-details"><summary>Oldindan yuklangan dalil (ixtiyoriy)</summary><div className="data-form"><div className="evidence-dropzone"><Camera aria-hidden="true" /><div><strong>Foto yoki video dalil</strong><small>Tashkilotning yopiq S3 omboriga oldindan yuklangan fayl manzilini kiriting.</small></div><input className="input" name="evidenceObjectUri" placeholder="s3://…" aria-label="Foto yoki video fayl manzili" /></div>
            <SelectInput label="Dalil turi" name="evidenceContentType" defaultValue="image/jpeg"><option value="image/jpeg">JPEG rasm</option><option value="image/png">PNG rasm</option><option value="video/mp4">MP4 video</option></SelectInput>
            <TextInput label="Dalil SHA-256" name="evidenceSha256" pattern="[a-f0-9]{64}" maxLength={64} autoComplete="off" placeholder="64 belgili kichik harfdagi checksum" hint="S3 obyektining to‘liq fayl SHA-256 qiymati." />
            <TextInput label="Dalil olingan vaqt" name="capturedAt" type="datetime-local" /></div></details> : null}

            <div className="form-span button-row"><Link className="button button--secondary" href="/tasdiqlangan-nuqsonlar">Nuqsonlarga qaytish</Link><Button type="submit" busy={busy} disabled={!selectedDefectTypeId}>Saqlash va boshliqqa yuborish</Button></div>
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
                  return <tr key={inspection.id}><td><strong>{inspection.inspectionNumber}</strong><small>{inspection.inspectorName}</small></td><td><strong>{inspection.road.code}</strong><small>{inspection.road.name}</small><small>{formatDate(inspection.observedDate)}</small></td><td><strong>{observation?.observedIssue ?? "—"}</strong><small>{inspection.observations.length} ta kuzatuv</small></td><td><strong>{observation?.locationLabel ?? "—"}</strong><small>{observation ? `${observation.exactQuantity.value} ${observation.exactQuantity.unit}` : "—"}</small></td><td>{stateBadge(inspection.state)}{inspection.submittedAt ? <small>Yuborildi: {formatDateTime(inspection.submittedAt)}</small> : null}</td><td>{inspection.state === "DRAFT" ? <Button variant="secondary" busy={busy} onClick={() => submitForReview(inspection)}><Send size={15} aria-hidden="true" /> Boshliqqa yuborish</Button> : inspection.state === "PENDING_REVIEW" && canVerify ? <Button variant="secondary" onClick={(event) => openInspection(inspection, event.currentTarget)}>Ko‘rib chiqish</Button> : null}</td></tr>;
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
