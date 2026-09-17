"use client";

import Link from "next/link";
import { normalizeUnit, searchText, workNormMinutes } from "@/lib/iqn/catalog";
import { PlanResources } from "@/components/plan-resources";
import { DefectParameterFields } from "@/components/defect-parameters";
import { defectTypeForSource } from "@/lib/iqn/defects";
import { DefectNavigation } from "@/components/defect-navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CalendarCheck, CheckCircle2, ClipboardList, Eye, GripVertical, Sparkles, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth, useHasPermission } from "@/components/auth-provider";
import type { AIWorkRecommendation, DefectParameters, ManualResourcePlan, ManualPlanInput, PlanPreview, PlanningCandidate, PlanningOptions, PlanningRunSummary, RoadOption } from "@/lib/api/types";
import { formatChainage } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, SelectInput, TableFrame, TextArea, TextInput } from "@/components/ui";

function tashkentDay(offset = 0) {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tashkent",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const date = new Date(Date.UTC(value("year"), value("month") - 1, value("day") + offset));
  return date.toISOString().slice(0, 10);
}

function sourceLabel(candidate: PlanningCandidate) {
  if (candidate.sourceKind === "ROADVISION") return "RoadVision AI";
  if (candidate.sourceKind === "MANUAL_INSPECTION") return "Yo‘l ustasi ko‘rigi";
  return "Yillik dastur";
}

function planningStateLabel(state: PlanningRunSummary["state"]) {
  if (state === "APPROVED") return "Tasdiqlangan";
  if (state === "PUBLISHED") return "Topshiriq chiqarilgan";
  if (state === "CANCELLED") return "Bekor qilingan";
  if (state === "SUPERSEDED") return "Almashtirilgan";
  return "Tasdiq kutilmoqda";
}

function PersistedPlans({ plans, loadingPlanId, locked, onOpen }: {
  plans: PlanningRunSummary[];
  loadingPlanId: string;
  locked: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <Card className="persisted-plans">
      <div className="card-heading"><div><h2>Tayyorlanayotgan topshiriqlar</h2></div><ClipboardList aria-hidden="true" /></div>
      {plans.length ? <TableFrame label="Saqlangan rejalashtirish hisoblari"><table><thead><tr><th>Reja</th><th>Muddat</th><th>Muallif</th><th>Holat</th><th>Tekshiruv</th><th /></tr></thead><tbody>{plans.map((plan) => <tr key={plan.id}><td><strong>{plan.planningMode === "MANUAL" ? "Qo‘lda" : "Avtomatik"} reja</strong><small>{plan.itemCount} ta ish</small></td><td><strong>{plan.dateFrom}{plan.dateTo !== plan.dateFrom ? ` — ${plan.dateTo}` : ""}</strong><small>{plan.createdAt.slice(0, 16).replace("T", " ")}</small></td><td><strong>{plan.createdByName}</strong><small>{plan.createdByMe ? "Siz tuzgansiz" : "Mustaqil tekshiruv uchun"}</small></td><td><Badge tone={plan.state === "PUBLISHED" || plan.state === "APPROVED" ? "success" : plan.blockerCount ? "danger" : "warning"}>{planningStateLabel(plan.state)}</Badge></td><td>{plan.blockerCount ? <Badge tone="danger">{plan.blockerCount} ta to‘siq</Badge> : plan.canApprove ? <Badge tone="info">Tasdiqlashingiz mumkin</Badge> : plan.canPublish ? <Badge tone="success">Chiqarishga tayyor</Badge> : <Badge>Ko‘rib chiqish</Badge>}</td><td><Button variant="secondary" busy={loadingPlanId === plan.id} disabled={locked} onClick={() => onOpen(plan.id)}><Eye size={16} aria-hidden="true" /> Ko‘rish</Button></td></tr>)}</tbody></table></TableFrame> : <EmptyState title="Saqlangan reja yo‘q" detail="Yangi ish yaratishdan boshlang." />}
    </Card>
  );
}

function staffReady(preview: PlanPreview) {
  return preview.workersReady ?? preview.resourceChecks.filter((check) => ["WORKERS", "WORKER_TIME"].includes(check.kind)).every((check) => check.sufficient);
}

function WorkflowSteps({ step }: { step: number }) {
  return <ol className="workflow-steps workflow-steps--five" aria-label="Ish yaratish bosqichlari">{["Nuqson", "Ish va muddat", "Xodimlar", "Resurslar", "Topshiriq"].map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={step === index + 1 ? "is-current" : step > index + 1 ? "is-complete" : ""}><span>{step > index + 1 ? <CheckCircle2 size={16} aria-hidden="true" /> : index + 1}</span>{label}</li>)}</ol>;
}

function PlanResult({ preview, step, approving, publishing, onApprove, onPublish, onReload, onBack, onNext, onEdit }: {
  preview: PlanPreview; step: number; approving: boolean; publishing: boolean;
  onEdit?: () => void; onApprove: () => void; onPublish: () => void; onReload: () => Promise<void>; onBack: () => void; onNext: () => Promise<void>;
}) {
  const [resourceBusy, setResourceBusy] = useState(false);
  const [resourceError, setResourceError] = useState("");
  const workersReady = staffReady(preview);
  const resourcesReady = workersReady && preview.resourcesReady && !preview.blockers.some((blocker) => blocker.level === "BLOCKING");
  const checks = preview.resourceChecks.filter((check) => workersReady ? !["WORKERS", "WORKER_TIME"].includes(check.kind) : ["WORKERS", "WORKER_TIME"].includes(check.kind));
  const shortage = checks.some((check) => !check.sufficient && ["MATERIALS", "EQUIPMENT", "SAFETY_EQUIPMENT"].includes(check.kind));
  const pendingRequest = preview.requisitions?.some((request) => ["SUBMITTED", "APPROVED"].includes(request.status));
  async function resourceAction(kind: "request" | "recheck") {
    setResourceBusy(true); setResourceError("");
    try {
      if (kind === "request") await api.requestPlanResources(preview.draftId);
      else await api.recheckPlanResources(preview.draftId);
      await onReload();
    } catch (error) { setResourceError(error instanceof Error ? error.message : "So‘rov bajarilmadi."); }
    finally { setResourceBusy(false); }
  }
  return <Card className="wizard-card">
    <div className="card-heading"><h2>{step === 5 ? "Ijroga berish" : workersReady ? "Material va texnika" : "Xodimlar yetishmayapti"}</h2><Badge tone={preview.state === "PUBLISHED" || resourcesReady ? "success" : "warning"}>{preview.state === "PUBLISHED" ? "Ijroga berilgan" : resourcesReady ? "Tayyor" : "Kutilmoqda"}</Badge></div>
    {step < 5 ? <>
      <TableFrame label="Resurslar hisobi"><table><thead><tr><th>Resurs</th><th>Kerak</th><th>Mavjud</th><th>Holat</th></tr></thead><tbody>{checks.map((check, i) => <tr key={`${check.kind}-${i}`}><td>{check.label}</td><td>{check.required}</td><td>{check.available}</td><td><Badge tone={check.sufficient ? "success" : "danger"}>{check.sufficient ? "Yetarli" : "Yetishmaydi"}</Badge></td></tr>)}</tbody></table></TableFrame>
      {!workersReady && preview.state !== "PUBLISHED" ? <div className="button-row"><Button variant="secondary" busy={resourceBusy} onClick={() => resourceAction("recheck")}>Xodimlarni qayta tekshirish</Button></div> : null}
      {shortage ? <div className="wizard-callout"><strong>{pendingRequest ? "Bosh muhandis ta’minoti kutilmoqda" : "Yetishmagan resursga talabnoma kerak"}</strong>{pendingRequest ? <Link href="/talabnomalar">Talabnomani ochish</Link> : null}<div className="button-row">{!pendingRequest ? <Button busy={resourceBusy} onClick={() => resourceAction("request")}>Bosh muhandisga yuborish</Button> : null}<Button variant="secondary" busy={resourceBusy} onClick={() => resourceAction("recheck")}>Qayta tekshirish</Button></div></div> : null}
      {!resourcesReady && preview.blockers.length ? <div className="wizard-blockers" role="alert">{preview.blockers.filter((blocker) => blocker.level === "BLOCKING").map((blocker, i) => <p key={`${blocker.code}-${i}`}><strong>{blocker.title}</strong><span>{blocker.resolution}</span></p>)}</div> : null}
      {!checks.some(c=>["MATERIALS","EQUIPMENT"].includes(c.kind))&&resourcesReady ? <p className="field__hint">Boshliq hisobiga ko‘ra qo‘shimcha material va texnika talab qilinmaydi.</p>:null}
      {resourcesReady ? <p className="field__hint">Topshiriq chiqarilganda ro‘yxatdagi resurslar biriktiriladi.</p> : null}
    </> : <>
      <p><Badge tone="success">Boshliq qarori</Badge></p><dl className="wizard-review"><div><dt>Ish</dt><dd>{Array.from(new Set(preview.jobs.map((job) => job.workName))).join(", ")}</dd></div><div><dt>Muddat</dt><dd>{preview.dateFrom}{preview.dateTo !== preview.dateFrom ? ` — ${preview.dateTo}` : ""}</dd></div><div><dt>Xodimlar</dt><dd>{new Set(preview.workerMinutesRemaining.map((worker) => worker.workerId)).size} kishi</dd></div><div><dt>Yo‘l harakati</dt><dd>{preview.roadAccess === "CLOSED" ? "Yopiladi" : preview.roadAccess === "PARTIAL" ? "Qisman yopiladi" : "Ochiq"}</dd></div></dl><p className="field__hint">Brigada: {Array.from(new Set(preview.workerMinutesRemaining.map(w=>w.fullName))).join(", ")}</p>
      <details className="workflow-details"><summary>Ishlar tafsiloti ({preview.jobs.length})</summary><div className="preview-jobs">{preview.jobs.map((job, i) => <article key={`${job.candidateId}-${i}`}><span>{i + 1}</span><div><strong>{job.workName}</strong><p>{job.scheduledDate} · {job.startTime}–{job.endTime} · {job.exactQuantity} {job.unit}</p><small>{job.teamName} · {job.laborHours} mehnat soati</small>{job.materials.length ? <small>{job.materials.map((m) => `${m.name}: ${m.quantity} ${m.unit}`).join("; ")}</small> : null}</div></article>)}</div></details>
      {preview.state === "PUBLISHED" ? <div className="success-banner" role="status"><CalendarCheck aria-hidden="true" /><span>Topshiriq yo‘l ustasiga berildi. Endi ijro boshlanadi.</span></div> : !preview.canApprove && preview.state !== "APPROVED" ? <p className="wizard-callout">Topshiriqni yo‘l bo‘limi boshlig‘i ijroga beradi.</p> : null}
    </>}
    {resourceError ? <p role="alert" className="inline-error">{resourceError}</p> : null}
    <div className="wizard-footer">{onEdit ? <Button variant="secondary" disabled={resourceBusy || approving || publishing} onClick={onEdit}>{preview.blockers.some(b=>b.code==="RESOURCE_RECIPE_MISSING")?"Resurs tarkibini belgilash":"Tahrirlash"}</Button> : null}<Button variant="secondary" disabled={resourceBusy || approving || publishing} onClick={onBack}>{preview.state === "PUBLISHED" ? "Rejalar" : "Orqaga"}</Button>
      {step < 5 ? <Button disabled={!resourcesReady || resourceBusy} busy={resourceBusy} onClick={async()=>{setResourceBusy(true);setResourceError("");try{await onNext();}catch(e){setResourceError(e instanceof Error?e.message:"Tekshiruv bajarilmadi.");}finally{setResourceBusy(false);}}}>Yakuniy tekshiruv</Button> : preview.state === "PUBLISHED" ? <Link className="button button--primary" href={`/topshiriqlar?plan=${encodeURIComponent(preview.draftId)}`}>Ijroga o‘tish</Link> : preview.state === "APPROVED" ? <Button busy={publishing} disabled={!resourcesReady || !preview.canPublish} onClick={onPublish}>Ijroga berish</Button> : preview.canApprove ? <Button busy={approving} disabled={!resourcesReady} onClick={onApprove}>Tasdiqlash va ijroga berish</Button> : <Badge tone="warning">Tasdiq kutilmoqda</Badge>}
    </div>
  </Card>;
}

function AutomaticPlanner({
  data,
  onPreview,
  onInputChange,
  busy,
}: {
  data: { items: PlanningCandidate[]; total: number };
  onPreview: (candidateIds: string[], dateFrom: string, dateTo: string) => Promise<void>;
  onInputChange: () => void;
  busy: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState<"ALL" | PlanningCandidate["sourceKind"]>("ALL");
  const [dateFrom, setDateFrom] = useState(() => tashkentDay());
  const [dateTo, setDateTo] = useState(() => tashkentDay(7));
  const candidateById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selected = useMemo(() => selectedIds.flatMap((id) => {
    const item = candidateById.get(id);
    return item ? [item] : [];
  }), [candidateById, selectedIds]);
  const sourceCounts = useMemo(() => ({
    ALL: data.items.length,
    ROADVISION: data.items.filter((item) => item.sourceKind === "ROADVISION").length,
    MANUAL_INSPECTION: data.items.filter((item) => item.sourceKind === "MANUAL_INSPECTION").length,
    ANNUAL_PROGRAM: data.items.filter((item) => item.sourceKind === "ANNUAL_PROGRAM").length,
  }), [data.items]);
  const visibleCandidates = useMemo(() => sourceFilter === "ALL"
    ? data.items
    : data.items.filter((item) => item.sourceKind === sourceFilter), [data.items, sourceFilter]);

  function toggle(id: string) {
    onInputChange();
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function move(position: number, shift: -1 | 1) {
    onInputChange();
    setSelectedIds((current) => {
      const target = position + shift;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      [copy[position], copy[target]] = [copy[target]!, copy[position]!];
      return copy;
    });
  }

  function clearSelection() {
    onInputChange();
    setSelectedIds([]);
  }

  return (
    <div className="planner-layout">
      <Card className="planner-candidates">
        <div className="card-heading"><div><p className="eyebrow">1-qadam</p><h2>Tasdiqlangan ishlar</h2></div><Badge tone="info">{data.total} ta</Badge></div>
        <div className="tabs tabs--subtle candidate-source-tabs" role="tablist" aria-label="Ishlar manbasi">{([
          ["ALL", "Barchasi"],
          ["ROADVISION", "RoadVision AI"],
          ["MANUAL_INSPECTION", "Yo‘l ustasi"],
          ["ANNUAL_PROGRAM", "Yillik dastur"],
        ] as const).map(([value, label]) => <button role="tab" aria-selected={sourceFilter === value} onClick={() => setSourceFilter(value)} key={value}>{label} <span>{sourceCounts[value]}</span></button>)}</div>
        {visibleCandidates.length ? <div className="candidate-list">{visibleCandidates.map((candidate) => {
          const checked = selectedIdSet.has(candidate.id);
          const requiresVariantSelection = candidate.sourceKind === "MANUAL_INSPECTION";
          return <label className={`candidate-card ${checked ? "candidate-card--selected" : ""}`} key={candidate.id}><input type="checkbox" checked={checked} disabled={requiresVariantSelection} onChange={() => toggle(candidate.id)} /><span className="check-visual" aria-hidden="true"><CheckCircle2 /></span><span className="candidate-card__content"><span><strong>{candidate.workName}</strong><Badge tone={candidate.sourceKind === "ROADVISION" ? "info" : "neutral"}>{sourceLabel(candidate)}</Badge></span><small>{candidate.road.code} · {candidate.road.name}</small><small>{candidate.locationLabel}</small><span className="norm-line">{requiresVariantSelection ? "Aniq ishni «Nuqson bo‘yicha» tanlang" : <>{candidate.exactQuantity ? `${candidate.exactQuantity.value} ${candidate.exactQuantity.unit}` : "Aniq ish hajmi kiritilmagan"} · {candidate.normReference ?? "IQN mosligi belgilanmagan"}</>}</span></span></label>;
        })}</div> : <EmptyState title="Bu manbada yozuv yo‘q" detail="Tanlangan manbadan tasdiqlangan ish kelganda shu yerda ko‘rinadi." />}
      </Card>
      <Card>
        <div className="card-heading">
          <div><p className="eyebrow">2-qadam</p><h2>Tartib va muddat</h2></div>
          <div className="selected-summary">
            <span className="selected-count" role="status" aria-live="polite">{selected.length} ta tanlangan</span>
            {selected.length > 0 ? <Button variant="ghost" disabled={busy} onClick={clearSelection}>Tanlovni tozalash</Button> : null}
          </div>
        </div>
        {selected.length ? <ol className="selected-list">{selected.map((candidate, position) => <li key={candidate.id}><GripVertical aria-hidden="true" /><span className="selected-order">{position + 1}</span><div><strong>{candidate.workName}</strong><small>{candidate.road.code} · {candidate.locationLabel}</small></div><div className="order-actions"><button aria-label={`${candidate.workName} yozuvini yuqoriga ko‘tarish`} disabled={position === 0} onClick={() => move(position, -1)}><ArrowUp aria-hidden="true" /></button><button aria-label={`${candidate.workName} yozuvini pastga tushirish`} disabled={position === selected.length - 1} onClick={() => move(position, 1)}><ArrowDown aria-hidden="true" /></button><button aria-label={`${candidate.workName} yozuvini olib tashlash`} onClick={() => toggle(candidate.id)}><X aria-hidden="true" /></button></div></li>)}</ol> : <EmptyState title="Ish tanlanmagan" detail="Chap tomondagi ro‘yxatdan bir yoki bir nechta yozuvni belgilang." />}
        <div className="date-fields">
        <TextInput label="Boshlanish sanasi" name="dateFrom" type="date" value={dateFrom} onChange={(event) => { onInputChange(); setDateFrom(event.target.value); }} /><TextInput label="Tugash sanasi" name="dateTo" type="date" min={dateFrom} value={dateTo} onChange={(event) => { onInputChange(); setDateTo(event.target.value); }} /></div>
        <Button busy={busy} disabled={!selectedIds.length || !dateFrom || !dateTo || dateTo < dateFrom} onClick={() => onPreview(selectedIds, dateFrom, dateTo)}><Sparkles size={17} aria-hidden="true" /> Avtomatik rejani hisoblash</Button>
      </Card>
    </div>
  );
}

function ManualPlanner({ initialInput, options, roads, onRoadChange, step, setStep, preview, scheduledDate, onScheduledDateChange, onPreview, onInputChange, busy }: {
  initialInput?: ManualPlanInput;
  options: PlanningOptions;
  roads: RoadOption[];
  onRoadChange: (id: string) => void;
  step: number;
  setStep: (step: number) => void;
  preview: PlanPreview | null;
  scheduledDate: string;
  onScheduledDateChange: (date: string) => void;
  onPreview: (payload: ManualPlanInput) => Promise<void>;
  onInputChange: () => void;
  busy: boolean;
}) {

  const [selectedDefectId, setSelectedDefectId] = useState(() => initialInput?.sourceDefectId ?? (typeof window !== "undefined" ? options.sourceDefects.find((item) => item.id === new URLSearchParams(window.location.search).get("defect"))?.id ?? "" : ""));
  const [workVariantId, setWorkVariantId] = useState(initialInput?.workVariantId ?? options.sourceDefects.find(s=>s.id===selectedDefectId&&s.annualLineId)?.suggestedWorkVariantIds?.[0] ?? "");
  const [operatorHours,setOperatorHours]=useState(initialInput?.operatorHoursPerUnit===undefined?'':String(initialInput.operatorHoursPerUnit));
  const [operatorBasis,setOperatorBasis]=useState(initialInput?.operatorBasis??'');
  const [resourcePlan,setResourcePlan]=useState<ManualResourcePlan|undefined>(initialInput?.resourcePlan??options.sourceDefects.find(s=>s.id===selectedDefectId&&s.annualLineId)?.resourcePlan);
  const [workSearch, setWorkSearch] = useState("");
  const [workTopic, setWorkTopic] = useState("");
  const [selectedNormHours, setSelectedNormHours] = useState((initialInput?.selectedNormHours??options.sourceDefects.find(s=>s.id===selectedDefectId)?.selectedNormHours)===undefined?"":String(initialInput?.selectedNormHours??options.sourceDefects.find(s=>s.id===selectedDefectId)?.selectedNormHours));
  const [exactQuantity, setExactQuantity] = useState(() => initialInput?.exactQuantity ?? options.sourceDefects.find((item) => item.id === selectedDefectId)?.measuredQuantity.value ?? "");
  const [scheduledEndDate, setScheduledEndDate] = useState(initialInput?.scheduledEndDate ?? scheduledDate);
  const [startTime, setStartTime] = useState(initialInput?.startTime ?? "08:00");
  const [endTime, setEndTime] = useState(initialInput?.endTime ?? "15:00");
  const [roadAccess, setRoadAccess] = useState<"OPEN" | "PARTIAL" | "CLOSED">(initialInput?.roadAccess ?? "OPEN");
  const [workerMode, setWorkerMode] = useState<"auto" | "manual">(initialInput?.workerIds ? "manual" : "auto");
  const [workerIds, setWorkerIds] = useState<string[]>(initialInput?.workerIds ?? []);
  const [permitNumber, setPermitNumber] = useState(initialInput?.permitNumber ?? "");
  const [aiRecommendation,setAIRecommendation]=useState<AIWorkRecommendation|null>(null);
  const [inspectionNote,setInspectionNote]=useState(initialInput?.aiInspectionNote??"");
  const [aiAnalysis,setAIAnalysis]=useState(initialInput?.aiAnalysis);
  const activeRecommendation=useRef<AbortController|null>(null);
  const [recommendBusy,setRecommendBusy]=useState(false),[recommendError,setRecommendError]=useState("");
  const [parameters,setParameters]=useState<DefectParameters>(initialInput?.defectParameters??options.sourceDefects.find(s=>s.id===selectedDefectId)?.parameters??{});
  const recommendationVersion=useRef(0);
  const [selectionSource,setSelectionSource]=useState<NonNullable<ManualPlanInput["workSelectionSource"]>>(initialInput?.workSelectionSource??"MANUAL");
  const selectedDefect = options.sourceDefects.find((item) => item.id === selectedDefectId);
  const [annualLineId,setAnnualLineId]=useState(initialInput?.annualLineId??selectedDefect?.annualLineId??'');
  const annualChoices=(options.annualBudgetLines??[]).filter(l=>l.workId===workVariantId);
  useEffect(()=>{const chosen=annualChoices.find(l=>l.id===selectedDefect?.annualLineId)||annualChoices.find(l=>l.id===annualLineId)||(annualChoices.length===1?annualChoices[0]:undefined);if(chosen){setAnnualLineId(chosen.id);setResourcePlan(chosen.resourcePlan);setSelectedNormHours(chosen.selectedNormHours===undefined?'':String(chosen.selectedNormHours));}else setAnnualLineId('');},[workVariantId,selectedDefectId,options.annualBudgetLines]);
  const work = options.workVariants.find((item) => item.id === workVariantId);
  const scheme = options.safetySchemes.find((item) => roadAccess === "OPEN" ? item.code === "ROAD_SHOULDER_WORK" : roadAccess === "CLOSED" ? item.code === "FULL_CLOSURE" : item.code === "SINGLE_LANE_CLOSURE");
  const defectType=selectedDefect?defectTypeForSource(selectedDefect):undefined;
  const topicOptions = Array.from(new Map(options.workVariants.filter(w=>w.catalogSeries).map(w=>[w.iqnTopicId!,w.iqnTopicName!])).entries());
  const visibleWorkVariants = options.workVariants.filter(item=>(!workTopic || item.iqnTopicId===workTopic) && (!workSearch || searchText(`${item.code} ${item.name} ${item.sourceName??""}`).includes(searchText(workSearch))));
  const normMinutes = work ? workNormMinutes(work,{selectedNormHours:selectedNormHours===""?undefined:Number(selectedNormHours)}) : NaN;
  const unitMatches = !work || !selectedDefect || normalizeUnit(selectedDefect.measuredQuantity.unit)===normalizeUnit(work.unit);
  const stepIssue = !selectedDefect ? "Avval nuqson yoki yillik reja bandini tanlang." : !work ? "Ish turini tanlang." : work.normIssue ? work.normIssue : !Number.isFinite(normMinutes) ? `Me’yorni ${work.normRange?.join("–")} kishi-soat oralig‘ida belgilang.` : !unitMatches ? `Nuqson ${selectedDefect.measuredQuantity.unit} da o‘lchangan. Shu birlikdagi ishni tanlang.` : !Number.isFinite(Number(exactQuantity)) || Number(exactQuantity)<=0 ? "Ish hajmini kiriting." : Number(exactQuantity)>Number(selectedDefect.measuredQuantity.value)+1e-6 ? `Qolgan hajm: ${selectedDefect.measuredQuantity.value} ${selectedDefect.measuredQuantity.unit}. Hajmni kamaytiring.` : !scheduledDate || !scheduledEndDate || scheduledEndDate<scheduledDate ? "Ish sanalarini to‘g‘ri belgilang." : !startTime || !endTime || startTime>=endTime ? "Tugash vaqti boshlanishdan keyin bo‘lsin." : scheme?.requiresPermit && !permitNumber.trim() ? "Yo‘lni yopish ruxsatnomasi raqamini kiriting." : "";
  const selectedWorkers = options.workers.filter((item) => workerIds.includes(item.id));
  const readyForWorkers = !stepIssue;
  const dayCount = Math.max(1, Math.round((Date.parse(`${scheduledEndDate}T00:00:00Z`) - Date.parse(`${scheduledDate}T00:00:00Z`)) / 86400000) + 1);
  const timeMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const availablePerDay = Math.max(1, Math.min(420, timeMinutes(endTime) - timeMinutes(startTime)));
  const requiredWorkers = work ? Math.max(work.requiredWorkers, Math.ceil(Number(exactQuantity || 0) * (Number.isFinite(normMinutes) ? normMinutes : 0) / (dayCount * availablePerDay))) : 0;
  const roadWorkers = selectedWorkers.filter((item) => item.skills.includes("road_worker") && item.availableMinutes > 0).length;
  const safetyWorkers = selectedWorkers.filter((item) => item.skills.includes("safety") && item.availableMinutes > 0).length;
  const localStaffReady = workerMode === "auto" || workerIds.length>0;

  function change(setter: (value: string) => void, value: string) {
    recommendationVersion.current++;setRecommendBusy(false);setAIRecommendation(null);onInputChange(); setter(value);if(setter===setWorkVariantId){setOperatorHours('');setOperatorBasis('');}
  }
  function selectDefect(id: string) {
    activeRecommendation.current?.abort();setInspectionNote("");setAIAnalysis(undefined);
    recommendationVersion.current++;onInputChange();setResourcePlan(undefined);setOperatorHours('');setOperatorBasis('');setSelectedDefectId(id);setWorkVariantId("");setWorkSearch("");setWorkTopic("");setSelectedNormHours("");setAIRecommendation(null);setRecommendError("");setSelectionSource("MANUAL");
    const source=options.sourceDefects.find(item=>item.id===id);
    setExactQuantity(source?.measuredQuantity.value??"");setParameters(source?.parameters??{});if(source?.annualLineId){setWorkVariantId(source.suggestedWorkVariantIds?.[0]??"");setResourcePlan(source.resourcePlan);setSelectedNormHours(source.selectedNormHours===undefined?"":String(source.selectedNormHours));}
  }
  async function recommend(values:DefectParameters=parameters) {
    if(!selectedDefectId||selectedDefect?.annualLineId)return;
    activeRecommendation.current?.abort();
    const controller=new AbortController();activeRecommendation.current=controller;
    const version=++recommendationVersion.current;
    setRecommendBusy(true);setRecommendError("");setAIRecommendation(null);
    try{
      const result=await api.aiWorkRecommendation(selectedDefectId,scheduledDate,values,resourcePlan,inspectionNote,controller.signal);
      if(version!==recommendationVersion.current)return;
      setAIRecommendation(result);
      if(!result.input){setWorkVariantId("");setSelectedNormHours("");setAIAnalysis(undefined);setSelectionSource("MANUAL");}
      if(result.input){
        const input=result.input;onInputChange();setOperatorHours(input.operatorHoursPerUnit===undefined?'':String(input.operatorHoursPerUnit));setOperatorBasis(input.operatorBasis??'');if(input.workVariantId!==workVariantId)setResourcePlan(undefined);onScheduledDateChange(input.scheduledDate);setWorkVariantId(input.workVariantId);setExactQuantity(input.exactQuantity);
        setSelectedNormHours(input.selectedNormHours===undefined?"":String(input.selectedNormHours));
        setScheduledEndDate(input.scheduledEndDate??input.scheduledDate);setStartTime(input.startTime??"08:00");setEndTime(input.endTime??"15:00");
        setRoadAccess(input.roadAccess??"OPEN");setWorkerMode("auto");setWorkerIds([]);setSelectionSource(input.workSelectionSource??"MANUAL");setAIAnalysis(input.aiAnalysis);
      }
    }catch(e){if(version===recommendationVersion.current)setRecommendError(e instanceof Error?e.message:"AI tavsiyasi tayyorlanmadi.");}
    finally{if(version===recommendationVersion.current)setRecommendBusy(false);}
  }
  useEffect(()=>{
    if(selectedDefectId&&!selectedDefect?.annualLineId&&api.fixturesEnabled&&(!initialInput||initialInput.sourceDefectId!==selectedDefectId))void recommend(options.sourceDefects.find(s=>s.id===selectedDefectId)?.parameters??{});
    return ()=>{recommendationVersion.current++;activeRecommendation.current?.abort();};
    // The source change starts a proposal once; date edits must retain the chief's choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selectedDefectId]);
  function calculate() {
    if (!selectedDefect || !readyForWorkers || !localStaffReady) return;
    void onPreview({ sourceDefectId: selectedDefect.id, annualLineId:annualLineId||selectedDefect.annualLineId, workSelectionSource:selectionSource,aiInspectionNote:inspectionNote,aiAnalysis:selectionSource==="AI"?aiAnalysis:undefined, resourcePlan, operatorHoursPerUnit:operatorHours===''?undefined:Number(operatorHours),operatorBasis, defectParameters:parameters, roadId: options.road.id, workVariantId, exactQuantity,
      ...(selectedNormHours!=="" ? {selectedNormHours:Number(selectedNormHours)} : {}),
      chainageStartM: selectedDefect.location.chainageStartM, chainageEndM: selectedDefect.location.chainageEndM,
      scheduledDate, scheduledEndDate, startTime, endTime, roadAccess,
      ...(scheme ? { safetySchemeId: scheme.id } : {}),
      ...(workerMode === "manual" ? { workerIds } : {}), ...(permitNumber ? { permitNumber } : {}) });
  }
  return <div className="manual-planner simple-workflow">
    <Card className="wizard-card"><div className="card-heading"><h2>{step === 1 ? "Nuqsonni tanlang" : step === 2 ? "Ish va muddatni belgilang" : "Xodimlarni biriktiring"}</h2></div>
    {step === 1 ? <>
      <SelectInput label="Yo‘l" name="planningRoadId" value={options.road.id} onChange={(event) => onRoadChange(event.target.value)}>{roads.map((road) => <option key={road.id} value={road.id}>{road.code} · {road.name}</option>)}</SelectInput>
      <SelectInput label="Nuqson yoki yillik reja bandi" name="sourceDefectId" value={selectedDefectId} onChange={(event) => selectDefect(event.target.value)}><option value="">Road AI yoki yo‘l ustasi qaydi</option>{options.sourceDefects.map((item) => <option key={item.id} value={item.id}>{item.sourceReference} · {item.iqnTopic.name}</option>)}</SelectInput>
      {selectedDefect ? <div className="workflow-summary"><strong>{selectedDefect.iqnTopic.name}</strong><p>{options.road.code} · {formatChainage(Number(selectedDefect.location.chainageStartM))} — {formatChainage(Number(selectedDefect.location.chainageEndM))}</p><p>{selectedDefect.measuredQuantity.value} {selectedDefect.measuredQuantity.unit} · {selectedDefect.annualLineId?"Tasdiqlangan yillik reja":selectedDefect.sourceKind === "ROADVISION" ? "Road AI" : "Yo‘l ustasi"}</p></div> : <Link className="inline-link" href="/malumot-kiritish">+ Yangi nuqson kiritish</Link>}
      <div className="wizard-footer wizard-footer--end"><Button disabled={!selectedDefect} onClick={() => setStep(2)}>Ish turiga o‘tish</Button></div>
    </> : null}
    {step === 2 ? <>
      <div className="workflow-summary"><strong>{selectedDefect?.iqnTopic.name}</strong><small>{options.road.code} · {selectedDefect?.sourceReference}</small></div>
      {api.fixturesEnabled&&!selectedDefect?.annualLineId?<div className="wizard-callout decision-panel" aria-label="AI tavsiyasi">
        <div className="card-heading"><h3>AI tavsiyasi</h3><Badge tone={aiRecommendation?.mode==="OPENAI"?"success":"warning"}>{recommendBusy?"Tahlil qilinmoqda":aiRecommendation?.mode==="OPENAI"?"Haqiqiy AI":aiRecommendation?.mode==="VALIDATION"?"Ma’lumot kerak":aiRecommendation?.mode==="DEMO_RULES"?"Namuna rejimi":"Ulanish tekshiriladi"}</Badge></div>
        {recommendBusy?<p role="status">Ish, muddat va brigada tayyorlanmoqda…</p>:null}
        {defectType?.patchParameters?<DefectParameterFields value={parameters} onChange={value=>{activeRecommendation.current?.abort();recommendationVersion.current++;setRecommendBusy(false);setParameters(value);setResourcePlan(undefined);setWorkVariantId("");setAIRecommendation(null);setAIAnalysis(undefined);setSelectionSource("MANUAL");setRecommendError("");onInputChange();}}/>:null}
        <TextArea label="Qo‘shimcha ko‘rik ma’lumoti" hint="AI savollariga shu yerda javob yozing. O‘lchovlar tegishli kataklarda belgilanadi." name="aiInspectionNote" rows={2} maxLength={2000} value={inspectionNote} placeholder={defectType?.requiredContext??"Masalan: shikast holati, material va ta’mir usuli"} onChange={event=>{activeRecommendation.current?.abort();recommendationVersion.current++;setRecommendBusy(false);setInspectionNote(event.target.value);setWorkVariantId("");setSelectedNormHours("");setResourcePlan(undefined);setAIRecommendation(previous=>previous?{...previous,mode:"VALIDATION",input:null,preview:null,explanation:"Ma’lumot o‘zgardi. AI tavsiyasini yangilang.",serviceIssue:undefined,checks:[],model:undefined}:null);setAIAnalysis(undefined);setSelectionSource("MANUAL");setRecommendError("");onInputChange();}}/>
        {aiRecommendation?.missingFields.length?<div role="status"><strong>Aniqlashtirish kerak</strong><ul>{aiRecommendation.missingFields.map(field=><li key={field}>{field}</li>)}</ul></div>:null}
        {aiRecommendation?.missingFields.length&&aiRecommendation.alternatives.length?<details className="workflow-details"><summary>Mos ishlarni boshliq tanlashi mumkin</summary>{aiRecommendation.alternatives.map(item=><div key={item.id}><p>{item.name}</p><small>{item.normReference}</small><Button variant="secondary" onClick={()=>{change(setWorkVariantId,item.id);setResourcePlan(undefined);setSelectedNormHours("");setSelectionSource("MANUAL");}}>Shu ishni tanlash</Button></div>)}</details>:null}
        {aiRecommendation?.input&&work?<div className="workflow-summary"><strong>{work.name}</strong><p>{exactQuantity} {work.unit} · {scheduledDate} — {scheduledEndDate}</p><p>{aiRecommendation.preview?.workerMinutesRemaining.map(w=>w.fullName).join(", ")}</p>{aiRecommendation.preview?.blockers.length?<p>{aiRecommendation.preview.blockers.some(b=>b.code==="RESOURCE_RECIPE_MISSING")?"Resurs tarkibi aniqlashtirilishi kerak.":"Kamomad bor — loyihada ko‘rib, talabnoma yuboring yoki muddatni o‘zgartiring."}</p>:null}</div>:null}
        <p className="field__hint">{aiRecommendation?.serviceIssue??aiRecommendation?.explanation??"AI ishni tanlaydi; IQN me’yori, brigada va resurslar tizimda tekshiriladi. Yakuniy qarorni boshliq beradi."}</p>
        {aiRecommendation?.mode==="OPENAI"?<details className="workflow-details"><summary>Tavsiya asosi</summary><p>{work?.normReference}</p>{aiRecommendation.checks?.length?<ul>{aiRecommendation.checks.map(check=><li key={check}>{check}</li>)}</ul>:null}<small>{aiRecommendation.createdAt?new Date(aiRecommendation.createdAt).toLocaleString("uz-UZ"):""} · {aiRecommendation.model}</small></details>:null}
        {recommendError?<p className="inline-error" role="alert">{recommendError}</p>:null}
        <div className="button-row"><Button variant="secondary" busy={recommendBusy} onClick={()=>void recommend()}><Sparkles size={16}/> AI tavsiyasini yangilash</Button><Button busy={busy} disabled={recommendBusy||!readyForWorkers} onClick={calculate}>Loyihani ko‘rish</Button></div>
      </div>:null}
      <details className="workflow-details" open={!workVariantId}><summary>Ish va muddatni o‘zgartirish</summary>
      <div className="data-form">
        <TextInput label="Ish nomi yoki kodi" name="workSearch" type="search" placeholder="Masalan: belgi, asfalt, 12-12-1" value={workSearch} onChange={event=>setWorkSearch(event.target.value)} />
        <SelectInput label="IQN bo‘limi" name="workTopic" value={workTopic} onChange={event=>setWorkTopic(event.target.value)}><option value="">Barcha bo‘limlar</option>{topicOptions.map(([id,name])=><option key={id} value={id}>{name}</option>)}</SelectInput>
        <SelectInput label="IQN 02-24 bo‘yicha ish turi" name="workVariantId" value={workVariantId} onChange={(event) => {change(setWorkVariantId, event.target.value);setResourcePlan(undefined);setSelectedNormHours("");setSelectionSource("MANUAL");setAIRecommendation(null);}}><option value="">Ish turini tanlang ({visibleWorkVariants.length})</option>{work && !visibleWorkVariants.some(w=>w.id===work.id)?<option value={work.id}>{work.code} · {work.name}</option>:null}{visibleWorkVariants.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}{!item.catalogSeries ? " · namuna" : item.normIssue ? " · aniqlashtirish kerak" : ""}</option>)}</SelectInput>
        {work ? <div className="workflow-summary"><strong>{work.name}</strong><small>{work.normReference}</small><p>{work.normBasisQuantity ?? 1} {work.unit} uchun {work.normHoursRaw || (work.laborMinutesPerUnit/60).toFixed(3)} kishi-soat</p>{work.normIssue?<p className="inline-error" role="alert">{work.normIssue}</p>:null}</div>:null}
        {work?.normRange ? <TextInput label="Me’yor, kishi-soat" name="selectedNormHours" type="number" min={work.normRange[0]} max={work.normRange[1]} step="any" value={selectedNormHours} onChange={event=>change(setSelectedNormHours,event.target.value)} hint={`Manbadagi oraliq: ${work.normRange.join("–")} / ${work.normBasisQuantity} ${work.unit}`} />:null}
        <TextInput label={`Ish hajmi${work ? `, ${work.unit}` : ""}`} name="exactQuantity" type="number" min="0.000001" step="any" value={exactQuantity} onChange={(event) => change(setExactQuantity, event.target.value)} hint={work && selectedDefect?.measuredQuantity.unit !== work.unit ? `Qayd birligi: ${selectedDefect?.measuredQuantity.unit}. Hajmni tanlangan ish birligida kiriting.` : undefined} />
        {options.annualBudgetLines&&!selectedDefect?.annualLineId?<SelectInput label="Yillik budjet bandi" name="annualBudgetLine" value={annualLineId} onChange={e=>{const l=annualChoices.find(l=>l.id===e.target.value);setAnnualLineId(l?.id??'');if(l){setResourcePlan(l.resourcePlan);setSelectedNormHours(l.selectedNormHours===undefined?'':String(l.selectedNormHours));}onInputChange();}}><option value="">Mos bandni tanlang</option>{annualChoices.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</SelectInput>:null}
        <TextInput label="Boshlanish sanasi" name="manualDate" type="date" value={scheduledDate} onChange={(event) => { recommendationVersion.current++;setRecommendBusy(false);setAIRecommendation(null);const date = event.target.value; if (scheduledEndDate < date) setScheduledEndDate(date); onScheduledDateChange(date); }} />
        <TextInput label="Tugash sanasi" name="scheduledEndDate" type="date" min={scheduledDate} value={scheduledEndDate} onChange={(event) => change(setScheduledEndDate, event.target.value)} />
        <TextInput label="Boshlanish vaqti" name="startTime" type="time" value={startTime} onChange={(event) => change(setStartTime, event.target.value)} />
        <TextInput label="Tugash vaqti" name="endTime" type="time" value={endTime} onChange={(event) => change(setEndTime, event.target.value)} />
        <SelectInput label="Ish vaqtida yo‘l harakati" name="roadAccess" value={roadAccess} onChange={(event) => { recommendationVersion.current++;setRecommendBusy(false);setAIRecommendation(null);onInputChange(); setRoadAccess(event.target.value as typeof roadAccess); }}><option value="OPEN">Yo‘l ochiq qoladi</option><option value="PARTIAL">Qisman yopiladi</option><option value="CLOSED">To‘liq yopiladi</option></SelectInput>
        {scheme?.requiresPermit ? <TextInput label="Yopish ruxsatnomasi raqami" name="permitNumber" value={permitNumber} onChange={(event) => change(setPermitNumber, event.target.value)} required /> : null}
      </div>
      </details>
      {work&&api.fixturesEnabled?<PlanResources work={work} catalog={options.workVariants} quantity={exactQuantity} value={resourcePlan} onChange={value=>{recommendationVersion.current++;setRecommendBusy(false);setAIRecommendation(null);setResourcePlan(value);onInputChange();}}/>:null}
      {roadAccess !== "OPEN" ? <p className="workflow-notice">Yopilish YTP ro‘yxatida aks etadi (demo).</p> : null}
      {stepIssue?<p className="inline-error" role="alert">{stepIssue}</p>:null}
      <div className="wizard-footer"><Button variant="secondary" onClick={() => setStep(1)}>Orqaga</Button><Button disabled={recommendBusy||!readyForWorkers} onClick={() => setStep(3)}>Xodimlarni tanlash</Button></div>
    </> : null}
    {step === 3 ? <>
      {work?.catalogSeries==='TIME'&&!annualLineId?<details><summary>Operator hisobi (manbada yetishmasa)</summary><div className="form-grid"><TextInput label={`Operator-soat / 1 ${work.unit}`} type="number" min="0" step="0.000001" value={operatorHours} onChange={e=>{onInputChange();setOperatorHours(e.target.value);}}/><TextInput label="Hisob asosi" value={operatorBasis} onChange={e=>{onInputChange();setOperatorBasis(e.target.value);}}/></div></details>:null}
      <div className="workflow-summary"><strong>{work?.name}</strong><p>{exactQuantity} {work?.unit} · {scheduledDate} — {scheduledEndDate} · {startTime}–{endTime}</p><p>Ishchi, operator va xavfsizlik xodimlari malakasi alohida tekshiriladi.</p></div>
      <div className="tabs" role="tablist" aria-label="Xodim biriktirish usuli"><button role="tab" aria-selected={workerMode === "auto"} onClick={() => { recommendationVersion.current++;setRecommendBusy(false);setAIRecommendation(null);onInputChange(); setWorkerMode("auto"); }}>Tizim xodim tanlasin</button><button role="tab" aria-selected={workerMode === "manual"} onClick={() => { recommendationVersion.current++;setRecommendBusy(false);setAIRecommendation(null);onInputChange(); setWorkerMode("manual"); }}>Qo‘lda biriktirish</button></div>
      {workerMode === "manual" ? <div className="worker-selection">{options.workers.map((worker) => <label className={`worker-choice ${workerIds.includes(worker.id) ? "worker-choice--selected" : ""}`} key={worker.id}><input type="checkbox" checked={workerIds.includes(worker.id)} disabled={!worker.availableMinutes} onChange={() => { recommendationVersion.current++;setRecommendBusy(false);setAIRecommendation(null);onInputChange(); setWorkerIds((ids) => ids.includes(worker.id) ? ids.filter((id) => id !== worker.id) : [...ids, worker.id]); }} /><div><strong>{worker.fullName}</strong><small>{worker.positionName} · {worker.availableMinutes ? `${Math.floor(worker.availableMinutes / 60)} soat ${worker.availableMinutes % 60} daqiqa bo‘sh` : "Band"}</small></div></label>)}</div> : <p>Malakasi mos, bo‘sh xodimlar tanlanadi.</p>}
      {!localStaffReady ? <p className="inline-error" role="alert">Brigada a’zolarini tanlang.</p> : null}
      {preview && (!staffReady(preview)) ? <div className="wizard-blockers" role="alert"><strong>Xodim yetishmayapti. Tarkib yoki muddatni o‘zgartiring.</strong>{preview.resourceChecks.filter((check) => ["WORKERS", "WORKER_TIME"].includes(check.kind) && !check.sufficient).map((check, i) => <p key={i}>{check.label}: {check.available} / {check.required}</p>)}</div> : null}
      <div className="wizard-footer"><Button variant="secondary" onClick={() => setStep(2)}>Orqaga</Button><Button busy={busy} disabled={!readyForWorkers || !localStaffReady} onClick={calculate}>Resurslarni tekshirish</Button></div>
    </> : null}
    </Card>
  </div>;
}

function ManualPlannerWorkspace({ initialInput, roads, step, setStep, preview, replacesDraftId, onPreview, onInputChange, busy }: {
  initialInput?: ManualPlanInput; roads: RoadOption[]; step: number; setStep: (step: number) => void; preview: PlanPreview | null;
  replacesDraftId: string | null; onPreview: (payload: ManualPlanInput) => Promise<void>; onInputChange: () => void; busy: boolean;
}) {
  const [selectedRoadId, setSelectedRoadId] = useState(() => initialInput?.roadId ?? (typeof window !== "undefined" ? roads.find((road) => road.id === new URLSearchParams(window.location.search).get("roadId") || road.code === new URLSearchParams(window.location.search).get("roadCode"))?.id ?? roads[0]!.id : roads[0]!.id));
  const [scheduledDate, setScheduledDate] = useState(() => initialInput?.scheduledDate ?? (typeof window!=="undefined"?new URLSearchParams(window.location.search).get("scheduledDate"):null) ?? tashkentDay());
  const options = useApiResource(() => api.planningOptions(selectedRoadId, scheduledDate, replacesDraftId ?? undefined), `planning-options:${selectedRoadId}:${scheduledDate}:${replacesDraftId ?? ""}`);
  return <div hidden={step > 3}>{options.loading && !options.data ? <LoadingState /> : options.error ? <ErrorState error={options.error} retry={options.reload} /> : options.data && options.data.road.id === selectedRoadId ? <ManualPlanner initialInput={initialInput} key={selectedRoadId} options={options.data} roads={roads} step={step} setStep={setStep} preview={preview} onRoadChange={(id) => { setSelectedRoadId(id); onInputChange(); }} scheduledDate={scheduledDate} onScheduledDateChange={(date) => { setScheduledDate(date); onInputChange(); }} onPreview={onPreview} onInputChange={onInputChange} busy={busy || options.loading} /> : null}</div>;
}

export default function PlanningPage() {

  const { user } = useAuth();
  const canWrite = useHasPermission("planning.write") && (!api.fixturesEnabled || user?.id === "demo-chief");
  const [editingInput, setEditingInput] = useState<ManualPlanInput>();
  const [mode, setMode] = useState<"automatic" | "manual">("manual");
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [step, setStep] = useState(()=>typeof window!=="undefined"&&new URLSearchParams(window.location.search).has("defect")?2:1);
  const [view, setView] = useState<"new" | "saved">("new");
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("plan")) { setView("saved"); void openPlan(params.get("plan")!); }
    else if (params.get("view") === "plans") setView("saved");
  }, []);
  function keepPlanInUrl(id: string) { window.history.replaceState(window.history.state, "", `/rejalashtirish?plan=${encodeURIComponent(id)}`); }
  function selectView(next: "new" | "saved") {
    if (next === "new" && view === "new") return;
    setView(next); setEditingInput(undefined); resetPreview(); setStep(1); setManualDraftId(null); setFormKey((key) => key + 1);
    window.history.replaceState(window.history.state, "", next === "saved" ? "/rejalashtirish?view=plans" : "/rejalashtirish");
  }
  useEffect(() => { document.getElementById("wizard-content")?.focus({ preventScroll: true }); }, [step]);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [loadingPlanId, setLoadingPlanId] = useState("");
  const previewRequestVersion = useRef(0);
  const [manualDraftId, setManualDraftId] = useState<string | null>(null);
  const candidates = useApiResource(api.planningCandidates, "planning-candidates");
  const roads = useApiResource(api.roads, "planning-roads");
  const plans = useApiResource(api.plans, "planning-plans");


  function resetPreview() {
    previewRequestVersion.current += 1;
    setPreview(null);
    setActionError("");
  }

  function changeMode(nextMode: "automatic" | "manual") {
    setMode(nextMode);
    setStep(1); setManualDraftId(null);
    resetPreview();
  }

  async function automaticPreview(candidateIds: string[], dateFrom: string, dateTo: string) {
    const requestVersion = ++previewRequestVersion.current;
    setBusy(true);
    setActionError("");
    setPreview(null);
    try {
      const nextPreview = await api.previewPlan(candidateIds, dateFrom, dateTo);
      if (requestVersion === previewRequestVersion.current) {
        setPreview(nextPreview);
        setStep(staffReady(nextPreview) ? 4 : 3); keepPlanInUrl(nextPreview.draftId);
        void plans.reload();
      }
    } catch (caught) {
      if (requestVersion === previewRequestVersion.current) {
        setActionError(caught instanceof Error ? caught.message : "Avtomatik rejani hisoblab bo‘lmadi.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function manualPreview(payload: ManualPlanInput) {
    const requestVersion = ++previewRequestVersion.current;
    setBusy(true);
    setActionError("");
    setPreview(null);
    try {
      const nextPreview = await api.previewManualPlan({ ...payload, ...(manualDraftId ? { replacesDraftId: manualDraftId } : {}) });
      setManualDraftId(nextPreview.draftId);
      if (requestVersion === previewRequestVersion.current) {
        setPreview(nextPreview);
        setStep(staffReady(nextPreview) ? 4 : 3); keepPlanInUrl(nextPreview.draftId);
        void plans.reload();
      }
    } catch (caught) {
      if (requestVersion === previewRequestVersion.current) {
        setActionError(caught instanceof Error ? caught.message : "Qo‘lda rejani tekshirib bo‘lmadi.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function openPlan(id: string) {
    const requestVersion = ++previewRequestVersion.current;
    setLoadingPlanId(id);
    setActionError("");
    setPreview(null);
    try {
      const nextPreview = await api.plan(id);
      if (requestVersion === previewRequestVersion.current) { setPreview(nextPreview); setStep(nextPreview.state === "PUBLISHED" || nextPreview.state === "APPROVED" ? 5 : 4); keepPlanInUrl(id); }
    } catch (caught) {
      if (requestVersion === previewRequestVersion.current) {
        setActionError(caught instanceof Error ? caught.message : "Saqlangan rejani ochib bo‘lmadi.");
      }
    } finally {
      setLoadingPlanId("");
    }
  }

  async function editPlan() {
    if(!preview)return;setBusy(true);setActionError("");
    try{const input=await api.planInput(preview.draftId);setEditingInput(input);setManualDraftId(preview.draftId);setMode("manual");setView("new");setStep(2);setFormKey(key=>key+1);setPreview(null);}catch(e){setActionError(e instanceof Error?e.message:"Reja ochilmadi.");}finally{setBusy(false);}
  }
  async function approve() {
    if (!preview) return;
    setApproving(true);
    setActionError("");
    try {
      await api.approvePlan(preview.draftId);
      if (manualDraftId === preview.draftId) setManualDraftId(null);
      await api.publishPlan(preview.draftId);
      setPreview(await api.plan(preview.draftId));
      void plans.reload();
    } catch (caught) {
      try{const current=await api.plan(preview.draftId);setPreview(current);if(!current.resourcesReady)setStep(4);}catch{}
      setActionError(caught instanceof Error ? caught.message : "Topshiriq ijroga berilmadi.");
    } finally {
      setApproving(false);
    }
  }

  async function publish() {
    if (!preview) return;
    setPublishing(true);
    setActionError("");
    try {
      await api.publishPlan(preview.draftId);
      setManualDraftId(null);
      setPreview(await api.plan(preview.draftId));
      void plans.reload();
    } catch (caught) {
      try { const updated = await api.plan(preview.draftId); setPreview(updated); if (!updated.resourcesReady || !staffReady(updated)) setStep(4); } catch { /* Preserve the original action error. */ }
      setActionError(caught instanceof Error ? caught.message : "Topshiriqlarni chiqarib bo‘lmadi.");
    } finally {
      setPublishing(false);
    }
  }

  const locked = busy || approving || publishing || Boolean(loadingPlanId);
  return <div className="page-stack planning-page">
    <DefectNavigation/><PageHeader title="Topshiriq yaratish" description="Boshliq belgilaydi · tizim resurslarni hisoblaydi." />
    <div className="tabs" role="tablist" aria-label="Rejalar"><button role="tab" aria-selected={view === "new"} disabled={locked} onClick={() => selectView("new")}>Yangi topshiriq</button><button role="tab" aria-selected={view === "saved"} disabled={locked} onClick={() => selectView("saved")}>Tayyorlanayotgan topshiriqlar{plans.data?.items.length ? ` (${plans.data.items.length})` : ""}</button></div>
    {view === "new" && step === 1 ? <div className="button-row"><Button variant={mode === "manual" ? "primary" : "secondary"} disabled={locked} onClick={() => changeMode("manual")}>Nuqson bo‘yicha</Button><Button variant={mode === "automatic" ? "primary" : "secondary"} disabled={locked} onClick={() => changeMode("automatic")}>Bir nechta ish</Button></div> : null}
    {view === "new" && mode === "manual" ? <WorkflowSteps step={step} /> : view === "saved" && preview ? <Button variant="ghost" disabled={locked} onClick={() => selectView("saved")}>← Rejalar ro‘yxati</Button> : null}
    {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
    <div id="wizard-content" tabIndex={-1}>
      {view === "new" && canWrite ? <fieldset className="planner-workspace" disabled={locked}>
        {mode === "manual" ? roads.loading ? <LoadingState /> : roads.error ? <ErrorState error={roads.error} retry={roads.reload} /> : roads.data?.items.length ? <ManualPlannerWorkspace initialInput={editingInput} key={formKey} roads={roads.data.items} step={step} setStep={setStep} preview={preview} replacesDraftId={manualDraftId} onPreview={manualPreview} onInputChange={resetPreview} busy={busy} /> : <EmptyState title="Yo‘l biriktirilmagan" detail="Yo‘l bo‘limiga yo‘l biriktiring." /> : <div hidden={Boolean(preview)}>{candidates.loading ? <LoadingState /> : candidates.error ? <ErrorState error={candidates.error} retry={candidates.reload} /> : candidates.data ? <AutomaticPlanner data={candidates.data} onPreview={automaticPreview} onInputChange={resetPreview} busy={busy} /> : null}</div>}
      </fieldset> : view === "new" ? <p>Yangi ish yaratish uchun boshliq hisobidan kiring.</p> : null}
      {preview && (step >= 4 || mode === "automatic" || view === "saved") ? <PlanResult onEdit={canWrite && preview.planningMode === "MANUAL" && preview.state === "AWAITING_APPROVAL" ? editPlan : undefined} preview={preview} step={step} approving={approving} publishing={publishing} onApprove={approve} onPublish={publish} onReload={async () => { const next = await api.plan(preview.draftId); setPreview(next); void plans.reload(); }} onBack={() => { if (preview.state === "PUBLISHED") selectView("saved"); else if (step === 5) setStep(4); else if (view === "saved") selectView("saved"); else { setStep(3); if (mode === "automatic") resetPreview(); } }} onNext={async () => { await api.recheckPlanResources(preview.draftId); const next=await api.plan(preview.draftId); setPreview(next); setStep(next.resourcesReady ? 5 : staffReady(next) ? 4 : 3); }} /> : null}
      {view === "saved" && !preview ? loadingPlanId || plans.loading ? <LoadingState /> : plans.error ? <ErrorState error={plans.error} retry={plans.reload} /> : <PersistedPlans plans={plans.data?.items ?? []} loadingPlanId={loadingPlanId} locked={locked} onOpen={openPlan} /> : null}
    </div>
  </div>;
}
