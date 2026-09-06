"use client";

import { useMemo, useRef, useState } from "react";
import { AlertOctagon, ArrowDown, ArrowUp, CalendarCheck, CheckCircle2, CircleX, ClipboardList, Download, Eye, GripVertical, LockKeyhole, ShieldCheck, Sparkles, Wrench, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth, useHasPermission } from "@/components/auth-provider";
import type { ManualPlanInput, PlanPreview, PlanningCandidate, PlanningOptions, PlanningRunSummary, RoadOption } from "@/lib/api/types";
import { formatChainage } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, SelectInput, TableFrame, TextInput } from "@/components/ui";
import { useOperatingScope } from "@/components/scope-provider";

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
      <div className="card-heading"><div><p className="eyebrow">Rejalar tarixi</p><h2>Saqlangan rejalar</h2><p>Tuzilgan rejalar va chiqarilgan topshiriqlar shu yerda saqlanadi.</p></div><ClipboardList aria-hidden="true" /></div>
      {plans.length ? <TableFrame label="Saqlangan rejalashtirish hisoblari"><table><thead><tr><th>Reja</th><th>Muddat</th><th>Muallif</th><th>Holat</th><th>Tekshiruv</th><th /></tr></thead><tbody>{plans.map((plan) => <tr key={plan.id}><td><strong>{plan.planningMode === "MANUAL" ? "Qo‘lda" : "Avtomatik"} reja</strong><small>{plan.itemCount} ta ish</small></td><td><strong>{plan.dateFrom}{plan.dateTo !== plan.dateFrom ? ` — ${plan.dateTo}` : ""}</strong><small>{plan.createdAt.slice(0, 16).replace("T", " ")}</small></td><td><strong>{plan.createdByName}</strong><small>{plan.createdByMe ? "Siz tuzgansiz" : "Mustaqil tekshiruv uchun"}</small></td><td><Badge tone={plan.state === "PUBLISHED" || plan.state === "APPROVED" ? "success" : plan.blockerCount ? "danger" : "warning"}>{planningStateLabel(plan.state)}</Badge></td><td>{plan.blockerCount ? <Badge tone="danger">{plan.blockerCount} ta to‘siq</Badge> : plan.canApprove ? <Badge tone="info">Tasdiqlashingiz mumkin</Badge> : plan.canPublish ? <Badge tone="success">Chiqarishga tayyor</Badge> : <Badge>Ko‘rib chiqish</Badge>}</td><td><Button variant="secondary" busy={loadingPlanId === plan.id} disabled={locked} onClick={() => onOpen(plan.id)}><Eye size={16} aria-hidden="true" /> Ko‘rish</Button></td></tr>)}</tbody></table></TableFrame> : <EmptyState title="Saqlangan reja yo‘q" detail="Hisoblangan reja shu yerda saqlanadi va vakolatli tekshiruvchiga ko‘rinadi." />}
    </Card>
  );
}

function PlanResult({
  preview,
  approving,
  publishing,
  publishedPlanId,
  onApprove,
  onPublish,
  onReload,
}: {
  preview: PlanPreview;
  approving: boolean;
  publishing: boolean;
  publishedPlanId: string;
  onApprove: () => void;
  onPublish: () => void;
  onReload: () => void;
}) {
  const [resourceBusy, setResourceBusy] = useState(false);
  const [resourceError, setResourceError] = useState("");
  const [resourceMessage, setResourceMessage] = useState("");
  const workersReady = preview.workersReady ?? preview.resourceChecks.filter((item) => item.kind === "WORKERS" || item.kind === "WORKER_TIME").every((item) => item.sufficient);
  async function resourceAction(kind: "request" | "recheck") {
    setResourceBusy(true); setResourceError(""); setResourceMessage("");
    try {
      if (kind === "request") await api.requestPlanResources(preview.draftId);
      else await api.recheckPlanResources(preview.draftId);
      setResourceMessage(kind === "request" ? "Talabnoma bosh muhandisga yuborildi." : "Resurslar qayta tekshirildi. Yangilangan rejani quyidagi tugma bilan oching.");
      onReload();
    } catch (error) { setResourceError(error instanceof Error ? error.message : "So‘rov bajarilmadi."); }
    finally { setResourceBusy(false); }
  }
  const resourcesReady = preview.resourcesReady
    && preview.blockers.every((blocker) => blocker.level !== "BLOCKING");
  const publishReady = resourcesReady && preview.canPublish;
  return (
    <Card className="plan-preview">
      <div className="card-heading"><div><p className="eyebrow">{workersReady ? "4-qadam · Material va texnika" : "3-qadam · Xodimlar"}</p><h2>Reja varianti</h2></div>{resourcesReady ? <Badge tone="success">Resurslar yetarli</Badge> : <Badge tone="danger">To‘siq bor</Badge>}</div>
      <div className="plan-handoff-meta"><div><span>Usul</span><strong>{preview.planningMode === "MANUAL" ? "Qo‘lda" : "Avtomatik"}</strong></div><div><span>Muallif</span><strong>{preview.createdByName}</strong></div><div><span>Muddat</span><strong>{preview.dateFrom}{preview.dateTo !== preview.dateFrom ? ` — ${preview.dateTo}` : ""}</strong></div></div>
      {preview.safetyScheme ? <div className="selected-safety"><ShieldCheck aria-hidden="true" /><div><span>Harakatni tashkil etish</span><strong>{preview.safetyScheme.name}</strong><small>{preview.safetyScheme.description}</small></div></div> : null}
      {preview.resourceChecks.length ? <div className="resource-check-grid" aria-label="Resurslar yetarliligi">{preview.resourceChecks.filter((check) => workersReady || check.kind === "WORKERS" || check.kind === "WORKER_TIME").map((check) => <article className={check.sufficient ? "resource-check resource-check--ready" : "resource-check resource-check--blocked"} key={check.kind}>{check.sufficient ? <CheckCircle2 aria-hidden="true" /> : <CircleX aria-hidden="true" />}<div><strong>{check.label}</strong><p>Talab: {check.required}</p><small>Mavjud: {check.available}</small>{check.detail ? <small>{check.detail}</small> : null}</div></article>)}</div> : null}
      {!workersReady ? <p className="inline-error" role="alert">Xodimlar yoki ularning bo‘sh vaqti yetarli emas. Material va texnika bosqichiga o‘tish bloklandi.</p> : null}
      {preview.workerMinutesRemaining.length ? <details className="workflow-details"><summary>Biriktirilgan xodimlar ({preview.workerMinutesRemaining.length})</summary><div className="worker-minute-list">{preview.workerMinutesRemaining.map((worker, index) => <article key={`${worker.workerId}-${index}`}><strong>{worker.fullName}</strong><span>{Math.floor(worker.assignedMinutes / 60)} soat {worker.assignedMinutes % 60} daqiqa</span></article>)}</div></details> : null}
      {workersReady && preview.resourceChecks.some((item) => !item.sufficient && ["MATERIALS", "EQUIPMENT", "SAFETY_EQUIPMENT"].includes(item.kind)) ? <div className="workflow-summary"><strong>Resurs yetishmayapti</strong><p>Talabnoma bosh muhandisga boradi. Ta’minlangandan so‘ng ombor qoldig‘i qayta tekshiriladi.</p><div className="button-row"><Button busy={resourceBusy} onClick={() => resourceAction("request")}>Bosh muhandisga talabnoma</Button><Button variant="secondary" busy={resourceBusy} onClick={() => resourceAction("recheck")}>Qoldiqni qayta tekshirish</Button></div></div> : workersReady && resourcesReady ? <p className="workflow-notice">Xodim, material va texnika reja uchun biriktirildi.</p> : null}
      {preview.requisitions?.length ? <p>Talabnomalar: {preview.requisitions.length} ta · <a href="/talabnomalar">Bosh muhandis ro‘yxati</a></p> : null}
      {resourceError ? <p role="alert" className="inline-error">{resourceError}</p> : null}{resourceMessage ? <p role="status">{resourceMessage}</p> : null}
      {preview.blockers.length ? <div className="blocker-list" aria-label="Rejalashtirish to‘siqlari">{preview.blockers.map((blocker) => <article key={`${blocker.code}-${blocker.candidateId ?? "all"}`}><AlertOctagon aria-hidden="true" /><div><strong>{blocker.title}</strong><p>{blocker.explanation}</p><small>Yechim: {blocker.resolution}</small></div></article>)}</div> : null}
      <div className="preview-jobs">{preview.jobs.map((job, position) => <article key={`${job.candidateId}-${position}`}><span>{position + 1}</span><div><strong>{job.workName}</strong><p>{job.scheduledDate ? `${job.scheduledDate}${job.startTime ? ` · ${job.startTime}–${job.endTime}` : ""} · ${job.teamName}` : "Sana va brigada ajratilmadi"}</p>{job.roadAccess ? <small>{job.roadAccess === "OPEN" ? "Yo‘l ochiq" : job.roadAccess === "PARTIAL" ? "Yo‘l qisman yopiladi" : "Yo‘l to‘liq yopiladi"} · {job.assignedWorkers}/{job.requiredWorkers} xodim</small> : null}<small>Mehnat: {job.laborHours} soat · Texnika: {job.equipment.length ? job.equipment.join(", ") : "ajratilmadi"}</small>{job.materials.length ? <small>Material: {job.materials.map((material) => `${material.name} — ${material.quantity} ${material.unit}`).join("; ")}</small> : null}</div></article>)}</div>
      {publishedPlanId || preview.state === "PUBLISHED" ? <div className="success-banner" role="status"><CalendarCheck aria-hidden="true" /><span>Topshiriqlar chiqarildi{publishedPlanId ? <>. Reja raqami: <strong>{publishedPlanId}</strong></> : null}</span></div> : preview.state === "APPROVED" && preview.canPublish ? <Button busy={publishing} disabled={!publishReady} onClick={onPublish}>Topshiriqlarni chiqarish</Button> : preview.state === "APPROVED" ? <div className="approval-note"><LockKeyhole aria-hidden="true" /><div><strong>Reja tasdiqlangan</strong><p>Topshiriqlarni chiqarish uchun planning.approve vakolati talab qilinadi.</p></div><Button disabled>Topshiriqlarni chiqarish</Button></div> : preview.canApprove ? <Button busy={approving} disabled={!resourcesReady} onClick={onApprove}>Rejani tasdiqlash</Button> : <div className="approval-note"><LockKeyhole aria-hidden="true" /><div><strong>Tasdiq kutilmoqda</strong><p>Rejani uni tuzgan foydalanuvchidan boshqa vakolatli xodim tasdiqlaydi.</p></div><Button disabled>Rejani tasdiqlash</Button></div>}
    </Card>
  );
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
        <div className="card-heading"><div><p className="eyebrow">1-qadam</p><h2>Tasdiqlangan ishlar</h2><p>Manbalar aralashtirilmaydi va har birining kelib chiqishi ko‘rsatiladi.</p></div><Badge tone="info">{data.total} ta</Badge></div>
        <div className="tabs tabs--subtle candidate-source-tabs" role="tablist" aria-label="Ishlar manbasi">{([
          ["ALL", "Barchasi"],
          ["ROADVISION", "RoadVision AI"],
          ["MANUAL_INSPECTION", "Yo‘l ustasi"],
          ["ANNUAL_PROGRAM", "Yillik dastur"],
        ] as const).map(([value, label]) => <button role="tab" aria-selected={sourceFilter === value} onClick={() => setSourceFilter(value)} key={value}>{label} <span>{sourceCounts[value]}</span></button>)}</div>
        {visibleCandidates.length ? <div className="candidate-list">{visibleCandidates.map((candidate) => {
          const checked = selectedIdSet.has(candidate.id);
          const requiresVariantSelection = candidate.sourceKind === "MANUAL_INSPECTION";
          return <label className={`candidate-card ${checked ? "candidate-card--selected" : ""}`} key={candidate.id}><input type="checkbox" checked={checked} disabled={requiresVariantSelection} onChange={() => toggle(candidate.id)} /><span className="check-visual" aria-hidden="true"><CheckCircle2 /></span><span className="candidate-card__content"><span><strong>{candidate.workName}</strong><Badge tone={candidate.sourceKind === "ROADVISION" ? "info" : "neutral"}>{sourceLabel(candidate)}</Badge></span><small>{candidate.road.code} · {candidate.road.name}</small><small>{candidate.locationLabel}</small><span className="norm-line">{requiresVariantSelection ? "Umumiy IQN mavzusi: aniq variantni «Nuqsondan ish yaratish» bo‘limida tanlang" : <>{candidate.exactQuantity ? `${candidate.exactQuantity.value} ${candidate.exactQuantity.unit}` : "Aniq ish hajmi kiritilmagan"} · {candidate.normReference ?? "IQN mosligi belgilanmagan"}</>}</span></span></label>;
        })}</div> : <EmptyState title="Bu manbada yozuv yo‘q" detail="Tanlangan manbadan tasdiqlangan ish kelganda shu yerda ko‘rinadi." />}
      </Card>
      <Card>
        <div className="card-heading">
          <div><p className="eyebrow">2-qadam</p><h2>Tartib va muddat</h2><p>Tizim tanlangan tartibni saqlaydi.</p></div>
          <div className="selected-summary">
            <span className="selected-count" role="status" aria-live="polite">{selected.length} ta tanlangan</span>
            {selected.length > 0 ? <Button variant="ghost" disabled={busy} onClick={clearSelection}>Tanlovni tozalash</Button> : null}
          </div>
        </div>
        {selected.length ? <ol className="selected-list">{selected.map((candidate, position) => <li key={candidate.id}><GripVertical aria-hidden="true" /><span className="selected-order">{position + 1}</span><div><strong>{candidate.workName}</strong><small>{candidate.road.code} · {candidate.locationLabel}</small></div><div className="order-actions"><button aria-label={`${candidate.workName} yozuvini yuqoriga ko‘tarish`} disabled={position === 0} onClick={() => move(position, -1)}><ArrowUp aria-hidden="true" /></button><button aria-label={`${candidate.workName} yozuvini pastga tushirish`} disabled={position === selected.length - 1} onClick={() => move(position, 1)}><ArrowDown aria-hidden="true" /></button><button aria-label={`${candidate.workName} yozuvini olib tashlash`} onClick={() => toggle(candidate.id)}><X aria-hidden="true" /></button></div></li>)}</ol> : <EmptyState title="Ish tanlanmagan" detail="Chap tomondagi ro‘yxatdan bir yoki bir nechta yozuvni belgilang." />}
        <div className="date-fields"><TextInput label="Boshlanish sanasi" name="dateFrom" type="date" value={dateFrom} onChange={(event) => { onInputChange(); setDateFrom(event.target.value); }} /><TextInput label="Tugash sanasi" name="dateTo" type="date" min={dateFrom} value={dateTo} onChange={(event) => { onInputChange(); setDateTo(event.target.value); }} /></div>
        <Button busy={busy} disabled={!selectedIds.length || !dateFrom || !dateTo || dateTo < dateFrom} onClick={() => onPreview(selectedIds, dateFrom, dateTo)}><Sparkles size={17} aria-hidden="true" /> Avtomatik rejani hisoblash</Button>
      </Card>
    </div>
  );
}

function ManualPlanner({ options, scheduledDate, onScheduledDateChange, onPreview, onInputChange, busy }: {
  options: PlanningOptions;
  scheduledDate: string;
  onScheduledDateChange: (date: string) => void;
  onPreview: (payload: ManualPlanInput) => Promise<void>;
  onInputChange: () => void;
  busy: boolean;
}) {
  const [step, setStep] = useState(1);
  const [selectedDefectId, setSelectedDefectId] = useState("");
  const [workVariantId, setWorkVariantId] = useState("");
  const [exactQuantity, setExactQuantity] = useState("");
  const [scheduledEndDate, setScheduledEndDate] = useState(scheduledDate);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("15:00");
  const [roadAccess, setRoadAccess] = useState<"OPEN" | "PARTIAL" | "CLOSED">("OPEN");
  const [workerMode, setWorkerMode] = useState<"auto" | "manual">("auto");
  const [workerIds, setWorkerIds] = useState<string[]>([]);
  const [permitNumber, setPermitNumber] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const selectedDefect = options.sourceDefects.find((item) => item.id === selectedDefectId);
  const work = options.workVariants.find((item) => item.id === workVariantId);
  const scheme = options.safetySchemes.find((item) => roadAccess === "OPEN" ? item.code === "ROAD_SHOULDER_WORK" : roadAccess === "CLOSED" ? item.code === "FULL_CLOSURE" : item.code === "SINGLE_LANE_CLOSURE");
  const compatibleWorkVariants = options.workVariants.filter((item) => !selectedDefect?.iqnTopic.id || item.iqnTopicId === selectedDefect.iqnTopic.id);
  const selectedWorkers = options.workers.filter((item) => workerIds.includes(item.id));
  const readyForWorkers = Boolean(selectedDefect && work && Number(exactQuantity) > 0 && scheduledDate && scheduledEndDate >= scheduledDate && startTime < endTime);
  const dayCount = Math.max(1, Math.round((Date.parse(`${scheduledEndDate}T00:00:00Z`) - Date.parse(`${scheduledDate}T00:00:00Z`)) / 86400000) + 1);
  const timeMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const availablePerDay = Math.max(1, Math.min(420, timeMinutes(endTime) - timeMinutes(startTime)));
  const requiredWorkers = work ? Math.max(work.requiredWorkers, Math.ceil(Number(exactQuantity || 0) * work.laborMinutesPerUnit / (dayCount * availablePerDay))) : 0;
  const roadWorkers = selectedWorkers.filter((item) => item.skills.includes("road_worker") && item.availableMinutes > 0).length;
  const safetyWorkers = selectedWorkers.filter((item) => item.skills.includes("safety") && item.availableMinutes > 0).length;
  const localStaffReady = workerMode === "auto" || (roadWorkers >= requiredWorkers && safetyWorkers >= (scheme?.requiredSafetyWorkers ?? 0));

  function change(setter: (value: string) => void, value: string) {
    onInputChange(); setter(value);
  }
  function selectDefect(id: string) {
    onInputChange(); setSelectedDefectId(id); setWorkVariantId(""); setRecommendation("");
    setExactQuantity(options.sourceDefects.find((item) => item.id === id)?.measuredQuantity.value ?? "");
  }
  function recommend() {
    const approved = selectedDefect?.suggestedWorkVariantIds ?? [];
    const matches = compatibleWorkVariants.filter((item) => approved.includes(item.id));
    const exact = matches.length ? matches : compatibleWorkVariants.filter((item) => selectedDefect?.iqnTopic.id && item.unit === selectedDefect.measuredQuantity.unit);
    if (exact.length === 1) {
      onInputChange(); setWorkVariantId(exact[0]!.id);
      setRecommendation("Nuqson turi va IQN mosligi bo‘yicha ish tavsiya qilindi. Hajm va muddatni tekshiring.");
    } else {
      setRecommendation(exact.length ? "Bir necha mos ish bor. Kerakli IQN variantini tanlang." : "Bu nuqson uchun yagona tasdiqlangan moslik yo‘q. IQN ishini qo‘lda tanlang.");
    }
  }
  function calculate() {
    if (!selectedDefect || !readyForWorkers || !localStaffReady) return;
    void onPreview({ sourceDefectId: selectedDefect.id, roadId: options.road.id, workVariantId, exactQuantity,
      chainageStartM: selectedDefect.location.chainageStartM, chainageEndM: selectedDefect.location.chainageEndM,
      scheduledDate, scheduledEndDate, startTime, endTime, roadAccess,
      ...(scheme ? { safetySchemeId: scheme.id } : {}),
      ...(workerMode === "manual" ? { workerIds } : {}), ...(permitNumber ? { permitNumber } : {}) });
  }
  return <div className="manual-planner simple-workflow">
    <ol className="workflow-steps" aria-label="Ishni rejalashtirish bosqichlari">{["Nuqson", "Ish va muddat", "Xodimlar", "Material va texnika"].map((label, index) => <li key={label} className={step === index + 1 ? "is-current" : step > index + 1 ? "is-complete" : ""}><span>{index + 1}</span>{label}</li>)}</ol>
    <Card><div className="card-heading"><div><p className="eyebrow">{step}-qadam</p><h2>{step === 1 ? "Qaysi nuqson bartaraf etiladi?" : step === 2 ? "Ish turi va bajarish muddati" : "Ishga xodim biriktirish"}</h2></div></div>
    {step === 1 ? <>
      <SelectInput label="Nuqsonni tanlang" name="sourceDefectId" value={selectedDefectId} onChange={(event) => selectDefect(event.target.value)}><option value="">Road AI yoki yo‘l ustasi qaydi</option>{options.sourceDefects.map((item) => <option key={item.id} value={item.id}>{item.sourceReference} · {item.iqnTopic.name}</option>)}</SelectInput>
      {selectedDefect ? <div className="workflow-summary"><strong>{selectedDefect.iqnTopic.name}</strong><p>{options.road.code} · {formatChainage(Number(selectedDefect.location.chainageStartM))} — {formatChainage(Number(selectedDefect.location.chainageEndM))}</p><p>{selectedDefect.measuredQuantity.value} {selectedDefect.measuredQuantity.unit} · {selectedDefect.sourceKind === "ROADVISION" ? "Road AI" : "Yo‘l ustasi"}</p></div> : <p className="field__hint">Nuqsonlar Road AI yoki yo‘l ustasi kiritgan qaydlardan keladi.</p>}
      <Button disabled={!selectedDefect} onClick={() => setStep(2)}>Ishni belgilash</Button>
    </> : null}
    {step === 2 ? <>
      <div className="workflow-summary"><strong>{selectedDefect?.iqnTopic.name}</strong><small>{options.road.code} · {selectedDefect?.sourceReference}</small></div>
      <div className="button-row"><Button variant="secondary" onClick={recommend}><Sparkles size={16} aria-hidden="true" /> Algoritm tavsiyasi</Button><span className="field__hint">Ishni ro‘yxatdan qo‘lda ham tanlashingiz mumkin.</span></div>
      {recommendation ? <p role="status" className="field__hint">{recommendation}</p> : null}
      <div className="data-form">
        <SelectInput label="IQN 02-24 bo‘yicha ish turi" name="workVariantId" value={workVariantId} onChange={(event) => change(setWorkVariantId, event.target.value)}><option value="">Ish turini tanlang</option>{compatibleWorkVariants.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.normReference}</option>)}</SelectInput>
        <TextInput label={`Ish hajmi${work ? `, ${work.unit}` : ""}`} name="exactQuantity" type="number" min="0.000001" step="any" value={exactQuantity} onChange={(event) => change(setExactQuantity, event.target.value)} hint={work && selectedDefect?.measuredQuantity.unit !== work.unit ? `Qayd birligi: ${selectedDefect?.measuredQuantity.unit}. Hajmni tanlangan ish birligida kiriting.` : undefined} />
        <TextInput label="Boshlanish sanasi" name="manualDate" type="date" value={scheduledDate} onChange={(event) => onScheduledDateChange(event.target.value)} />
        <TextInput label="Tugash sanasi" name="scheduledEndDate" type="date" min={scheduledDate} value={scheduledEndDate} onChange={(event) => change(setScheduledEndDate, event.target.value)} />
        <TextInput label="Har kuni boshlanish vaqti" name="startTime" type="time" value={startTime} onChange={(event) => change(setStartTime, event.target.value)} />
        <TextInput label="Har kuni tugash vaqti" name="endTime" type="time" value={endTime} onChange={(event) => change(setEndTime, event.target.value)} />
        <SelectInput label="Ish vaqtida yo‘l harakati" name="roadAccess" value={roadAccess} onChange={(event) => { onInputChange(); setRoadAccess(event.target.value as typeof roadAccess); }}><option value="OPEN">Yo‘l ochiq qoladi</option><option value="PARTIAL">Qisman yopiladi</option><option value="CLOSED">To‘liq yopiladi</option></SelectInput>
        {scheme?.requiresPermit ? <TextInput label="Yopish ruxsatnomasi raqami" name="permitNumber" value={permitNumber} onChange={(event) => change(setPermitNumber, event.target.value)} required /> : null}
      </div>
      {roadAccess !== "OPEN" ? <p className="workflow-notice">Topshiriq chiqarilganda yopilish joyi va muddati yo‘l ta’mirlash punkti tizimiga avtomatik yuboriladi.</p> : null}
      <div className="button-row"><Button variant="secondary" onClick={() => setStep(1)}>Orqaga</Button><Button disabled={!readyForWorkers} onClick={() => setStep(3)}>Xodimlarni biriktirish</Button></div>
    </> : null}
    {step === 3 ? <>
      <div className="workflow-summary"><strong>{work?.name}</strong><p>{exactQuantity} {work?.unit} · {scheduledDate} — {scheduledEndDate} · {startTime}–{endTime}</p><p>IQN va muddat bo‘yicha: kamida <strong>{requiredWorkers} ishchi</strong>{scheme?.requiredSafetyWorkers ? ` va ${scheme.requiredSafetyWorkers} xavfsizlik xodimi` : ""}.</p><small>Yakuniy tarkib malaka, bandlik va har bir kunning bo‘sh vaqti bo‘yicha tekshiriladi.</small></div>
      <div className="tabs" role="tablist" aria-label="Xodim biriktirish usuli"><button role="tab" aria-selected={workerMode === "auto"} onClick={() => { onInputChange(); setWorkerMode("auto"); }}>Avtomatik biriktirish</button><button role="tab" aria-selected={workerMode === "manual"} onClick={() => { onInputChange(); setWorkerMode("manual"); }}>Qo‘lda biriktirish</button></div>
      {workerMode === "manual" ? <div className="worker-selection">{options.workers.map((worker) => <label className={`worker-choice ${workerIds.includes(worker.id) ? "worker-choice--selected" : ""}`} key={worker.id}><input type="checkbox" checked={workerIds.includes(worker.id)} disabled={!worker.availableMinutes} onChange={() => { onInputChange(); setWorkerIds((ids) => ids.includes(worker.id) ? ids.filter((id) => id !== worker.id) : [...ids, worker.id]); }} /><div><strong>{worker.fullName}</strong><small>{worker.positionName} · {worker.availableMinutes ? `${Math.floor(worker.availableMinutes / 60)} soat ${worker.availableMinutes % 60} daqiqa bo‘sh` : "Band"}</small></div></label>)}</div> : <p>Tizim shu muddatda bo‘sh va ishga malakasi mos xodimlarni tanlaydi.</p>}
      {!localStaffReady ? <p className="inline-error" role="alert">Xodimlar yetarli emas: {roadWorkers}/{requiredWorkers} ishchi. Yetarli xodim biriktirilmaguncha keyingi bosqichga o‘tib bo‘lmaydi.</p> : null}
      <div className="button-row"><Button variant="secondary" onClick={() => setStep(2)}>Orqaga</Button><Button busy={busy} disabled={!readyForWorkers || !localStaffReady} onClick={calculate}>Xodimlarni tekshirish va resurslarni hisoblash</Button></div>
    </> : null}
    </Card>
  </div>;
}

function ManualPlannerWorkspace({
  roads,
  replacesDraftId,
  onPreview,
  onInputChange,
  busy,
}: {
  roads: RoadOption[];
  replacesDraftId: string | null;
  onPreview: (payload: ManualPlanInput) => Promise<void>;
  onInputChange: () => void;
  busy: boolean;
}) {
  const [selectedRoadId, setSelectedRoadId] = useState(roads[0]!.id);
  const [scheduledDate, setScheduledDate] = useState(() => tashkentDay());
  const options = useApiResource(
    () => api.planningOptions(selectedRoadId, scheduledDate, replacesDraftId ?? undefined),
    `planning-options:${selectedRoadId}:${scheduledDate}:${replacesDraftId ?? ""}`,
  );

  function selectRoad(roadId: string) {
    setSelectedRoadId(roadId);
    onInputChange();
  }

  function selectDate(date: string) {
    setScheduledDate(date);
    onInputChange();
  }

  return (
    <>
      <Card>
        <SelectInput label="Rejalashtiriladigan yo‘l" name="planningRoadId" value={selectedRoadId} onChange={(event) => selectRoad(event.target.value)}>
          {roads.map((road) => <option value={road.id} key={road.id}>{road.code} · {road.name}</option>)}
        </SelectInput>
      </Card>
      {options.loading && !options.data ? <LoadingState /> : options.error ? <ErrorState error={options.error} retry={options.reload} /> : options.data && options.data.road.id === selectedRoadId ? <ManualPlanner key={selectedRoadId} options={options.data} scheduledDate={scheduledDate} onScheduledDateChange={selectDate} onPreview={onPreview} onInputChange={onInputChange} busy={busy || options.loading} /> : null}
    </>
  );
}

export default function PlanningPage() {
  const { user } = useAuth();
  const canExport = Boolean(user?.permissions.includes("system.all") || user?.permissions.includes("reports.read"));
  const canWrite = useHasPermission("planning.write");
  const [mode, setMode] = useState<"automatic" | "manual">("manual");
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [publishedPlanId, setPublishedPlanId] = useState("");
  const [loadingPlanId, setLoadingPlanId] = useState("");
  const previewRequestVersion = useRef(0);
  const [manualDraftId, setManualDraftId] = useState<string | null>(null);
  const candidates = useApiResource(api.planningCandidates, "planning-candidates");
  const roads = useApiResource(api.roads, "planning-roads");
  const plans = useApiResource(api.plans, "planning-plans");
  const { scope } = useOperatingScope();

  function resetPreview() {
    previewRequestVersion.current += 1;
    setPreview(null);
    setActionError("");
    setPublishedPlanId("");
  }

  function changeMode(nextMode: "automatic" | "manual") {
    setMode(nextMode);
    resetPreview();
  }

  async function automaticPreview(candidateIds: string[], dateFrom: string, dateTo: string) {
    const requestVersion = ++previewRequestVersion.current;
    setBusy(true);
    setActionError("");
    setPublishedPlanId("");
    setPreview(null);
    try {
      const nextPreview = await api.previewPlan(candidateIds, dateFrom, dateTo);
      if (requestVersion === previewRequestVersion.current) {
        setPreview(nextPreview);
        void plans.reload();
      }
    } catch (caught) {
      if (requestVersion === previewRequestVersion.current) {
        setActionError(caught instanceof Error ? caught.message : "Avtomatik rejani hisoblab bo‘lmadi.");
      }
    } finally {
      if (requestVersion === previewRequestVersion.current) setBusy(false);
    }
  }

  async function manualPreview(payload: ManualPlanInput) {
    const requestVersion = ++previewRequestVersion.current;
    setBusy(true);
    setActionError("");
    setPublishedPlanId("");
    setPreview(null);
    try {
      const nextPreview = await api.previewManualPlan({ ...payload, ...(manualDraftId ? { replacesDraftId: manualDraftId } : {}) });
      setManualDraftId(nextPreview.draftId);
      if (requestVersion === previewRequestVersion.current) {
        setPreview(nextPreview);
        void plans.reload();
      }
    } catch (caught) {
      if (requestVersion === previewRequestVersion.current) {
        setActionError(caught instanceof Error ? caught.message : "Qo‘lda rejani tekshirib bo‘lmadi.");
      }
    } finally {
      if (requestVersion === previewRequestVersion.current) setBusy(false);
    }
  }

  async function openPlan(id: string) {
    const requestVersion = ++previewRequestVersion.current;
    setLoadingPlanId(id);
    setActionError("");
    setPublishedPlanId("");
    setPreview(null);
    try {
      const nextPreview = await api.plan(id);
      if (requestVersion === previewRequestVersion.current) setPreview(nextPreview);
    } catch (caught) {
      if (requestVersion === previewRequestVersion.current) {
        setActionError(caught instanceof Error ? caught.message : "Saqlangan rejani ochib bo‘lmadi.");
      }
    } finally {
      if (requestVersion === previewRequestVersion.current) setLoadingPlanId("");
    }
  }

  async function approve() {
    if (!preview) return;
    setApproving(true);
    setActionError("");
    try {
      await api.approvePlan(preview.draftId);
      if (manualDraftId === preview.draftId) setManualDraftId(null);
      setPreview(await api.plan(preview.draftId));
      void plans.reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Rejani tasdiqlab bo‘lmadi.");
    } finally {
      setApproving(false);
    }
  }

  async function publish() {
    if (!preview) return;
    setPublishing(true);
    setActionError("");
    try {
      const result = await api.publishPlan(preview.draftId);
      setPublishedPlanId(result.planId);
      setPreview(await api.plan(preview.draftId));
      void plans.reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Topshiriqlarni chiqarib bo‘lmadi.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="Saqlash ishlarini rejalashtirish" description="Nuqsonni tanlang, IQN bo‘yicha ish va muddatni belgilang. Tizim xodimlar, material va texnikani hisoblaydi." actions={canExport ? <a className="button button--secondary" href="/api/v1/reports/plans.xlsx" download><Download size={16} aria-hidden="true" /> Excel yuklash</a> : null} />
      <div className="scope-meta"><span><strong>Qamrov</strong>{scope.shortName}</span><span><strong>Yo‘l va kesim</strong>{scope.roadLabel}</span><span><strong>Hisob usuli</strong>IQN 02-24</span></div>

      {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
      {canWrite ? <>
        <div className="tabs planner-mode-tabs" role="tablist" aria-label="Rejalashtirish usuli"><button role="tab" aria-selected={mode === "automatic"} disabled={busy || approving || publishing || Boolean(loadingPlanId)} onClick={() => changeMode("automatic")}><Sparkles size={16} aria-hidden="true" /> Bir nechta ishni rejalashtirish</button><button role="tab" aria-selected={mode === "manual"} disabled={busy || approving || publishing || Boolean(loadingPlanId)} onClick={() => changeMode("manual")}><Wrench size={16} aria-hidden="true" /> Nuqsondan ish yaratish</button></div>
        <fieldset className="planner-workspace" disabled={busy || approving || publishing || Boolean(loadingPlanId)}>
          {mode === "automatic" ? candidates.loading ? <LoadingState /> : candidates.error ? <ErrorState error={candidates.error} retry={candidates.reload} /> : candidates.data ? <AutomaticPlanner data={candidates.data} onPreview={automaticPreview} onInputChange={resetPreview} busy={busy} /> : null : roads.loading ? <LoadingState /> : roads.error ? <ErrorState error={roads.error} retry={roads.reload} /> : roads.data?.items.length ? <ManualPlannerWorkspace roads={roads.data.items} replacesDraftId={manualDraftId} onPreview={manualPreview} onInputChange={resetPreview} busy={busy} /> : <EmptyState title="Biriktirilgan yo‘l topilmadi" detail="Yo‘l bo‘limiga kamida bitta faol yo‘l yoki kesim biriktirilishi kerak." />}
        </fieldset>
      </> : <Card><div className="approval-note"><LockKeyhole aria-hidden="true" /><div><strong>Faqat ko‘rish rejimi</strong><p>Yangi reja hisoblash uchun <strong>planning.write</strong> vakolati talab qilinadi. Saqlangan rejalarni yuqoridagi ro‘yxatdan ochishingiz mumkin.</p></div></div></Card>}
      {preview ? <PlanResult preview={preview} approving={approving} publishing={publishing} publishedPlanId={publishedPlanId} onApprove={approve} onPublish={publish} onReload={() => { if (preview) void openPlan(preview.draftId); void plans.reload(); }} /> : null}
      <details className="workflow-details"><summary>Saqlangan rejalar va tarix</summary>
      {plans.loading ? <LoadingState label="Saqlangan rejalar yuklanmoqda" /> : plans.error ? <ErrorState error={plans.error} retry={plans.reload} /> : <PersistedPlans plans={plans.data?.items ?? []} loadingPlanId={loadingPlanId} locked={busy || approving || publishing || Boolean(loadingPlanId)} onOpen={openPlan} />}
      </details>
    </div>
  );
}
