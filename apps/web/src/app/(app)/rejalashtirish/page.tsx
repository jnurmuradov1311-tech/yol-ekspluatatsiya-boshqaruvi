"use client";

import { useMemo, useState } from "react";
import { AlertOctagon, ArrowDown, ArrowUp, CalendarCheck, CheckCircle2, CircleX, ClipboardList, Download, Eye, GripVertical, LockKeyhole, ShieldCheck, Sparkles, Users, Wrench, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/components/auth-provider";
import type { ManualPlanInput, PlanPreview, PlanningCandidate, PlanningOptions, PlanningRunSummary, RoadOption } from "@/lib/api/types";
import { formatChainage } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, SelectInput, TableFrame, TextInput } from "@/components/ui";

function isoDay(offset = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
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

function PersistedPlans({ plans, loadingPlanId, onOpen }: {
  plans: PlanningRunSummary[];
  loadingPlanId: string;
  onOpen: (id: string) => void;
}) {
  return (
    <Card className="persisted-plans">
      <div className="card-heading"><div><p className="eyebrow">Maker-checker</p><h2>Saqlangan rejalar</h2><p>Boshqa vakolatli xodim reja tarkibi va barcha resurs to‘siqlarini ochib, so‘ng tasdiqlaydi.</p></div><ClipboardList aria-hidden="true" /></div>
      {plans.length ? <TableFrame label="Saqlangan rejalashtirish hisoblari"><table><thead><tr><th>Reja</th><th>Muddat</th><th>Muallif</th><th>Holat</th><th>Tekshiruv</th><th /></tr></thead><tbody>{plans.map((plan) => <tr key={plan.id}><td><strong>{plan.planningMode === "MANUAL" ? "Qo‘lda" : "Avtomatik"} reja</strong><small>{plan.itemCount} ta ish</small></td><td><strong>{plan.dateFrom}{plan.dateTo !== plan.dateFrom ? ` — ${plan.dateTo}` : ""}</strong><small>{plan.createdAt.slice(0, 16).replace("T", " ")}</small></td><td><strong>{plan.createdByName}</strong><small>{plan.createdByMe ? "Siz tuzgansiz" : "Mustaqil tekshiruv uchun"}</small></td><td><Badge tone={plan.state === "PUBLISHED" || plan.state === "APPROVED" ? "success" : plan.blockerCount ? "danger" : "warning"}>{planningStateLabel(plan.state)}</Badge></td><td>{plan.blockerCount ? <Badge tone="danger">{plan.blockerCount} ta to‘siq</Badge> : plan.canApprove ? <Badge tone="info">Tasdiqlashingiz mumkin</Badge> : plan.canPublish ? <Badge tone="success">Chiqarishga tayyor</Badge> : <Badge>Ko‘rib chiqish</Badge>}</td><td><Button variant="secondary" busy={loadingPlanId === plan.id} onClick={() => onOpen(plan.id)}><Eye size={16} aria-hidden="true" /> Ko‘rish</Button></td></tr>)}</tbody></table></TableFrame> : <EmptyState title="Saqlangan reja yo‘q" detail="Hisoblangan reja shu yerda saqlanadi va vakolatli tekshiruvchiga ko‘rinadi." />}
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
}: {
  preview: PlanPreview;
  approving: boolean;
  publishing: boolean;
  publishedPlanId: string;
  onApprove: () => void;
  onPublish: () => void;
}) {
  const resourcesReady = preview.resourcesReady
    && preview.blockers.every((blocker) => blocker.level !== "BLOCKING");
  const publishReady = resourcesReady && preview.canPublish;
  return (
    <Card className="plan-preview">
      <div className="card-heading"><div><p className="eyebrow">Hisob natijasi</p><h2>Reja varianti</h2></div>{resourcesReady ? <Badge tone="success">Resurslar yetarli</Badge> : <Badge tone="danger">To‘siq bor</Badge>}</div>
      <div className="plan-handoff-meta"><div><span>Usul</span><strong>{preview.planningMode === "MANUAL" ? "Qo‘lda" : "Avtomatik"}</strong></div><div><span>Muallif</span><strong>{preview.createdByName}</strong></div><div><span>Muddat</span><strong>{preview.dateFrom}{preview.dateTo !== preview.dateFrom ? ` — ${preview.dateTo}` : ""}</strong></div></div>
      {preview.safetyScheme ? <div className="selected-safety"><ShieldCheck aria-hidden="true" /><div><span>Harakatni tashkil etish</span><strong>{preview.safetyScheme.name}</strong><small>{preview.safetyScheme.description}</small></div></div> : null}
      {preview.resourceChecks.length ? <div className="resource-check-grid" aria-label="Resurslar yetarliligi">{preview.resourceChecks.map((check) => <article className={check.sufficient ? "resource-check resource-check--ready" : "resource-check resource-check--blocked"} key={check.kind}>{check.sufficient ? <CheckCircle2 aria-hidden="true" /> : <CircleX aria-hidden="true" />}<div><strong>{check.label}</strong><p>Talab: {check.required}</p><small>Mavjud: {check.available}</small>{check.detail ? <small>{check.detail}</small> : null}</div></article>)}</div> : null}
      {preview.workerMinutesRemaining.length ? <div className="worker-minute-list"><h3>Xodimlarning kunlik vaqti</h3>{preview.workerMinutesRemaining.map((worker) => <article key={worker.workerId}><div><strong>{worker.fullName}</strong><small>Ajratildi: {worker.assignedMinutes} daqiqa</small></div><div className={worker.remainingMinutes >= 0 ? "minute-value minute-value--ready" : "minute-value minute-value--blocked"}><span>{worker.remainingMinutes}</span><small>daqiqa qoldi</small></div></article>)}</div> : null}
      {preview.blockers.length ? <div className="blocker-list" aria-label="Rejalashtirish to‘siqlari">{preview.blockers.map((blocker) => <article key={`${blocker.code}-${blocker.candidateId ?? "all"}`}><AlertOctagon aria-hidden="true" /><div><strong>{blocker.title}</strong><p>{blocker.explanation}</p><small>Yechim: {blocker.resolution}</small></div></article>)}</div> : null}
      <div className="preview-jobs">{preview.jobs.map((job, position) => <article key={job.candidateId}><span>{position + 1}</span><div><strong>{job.workName}</strong><p>{job.scheduledDate ? `${job.scheduledDate} · ${job.teamName}` : "Sana va brigada ajratilmadi"}</p><small>Mehnat: {job.laborHours} soat · Texnika: {job.equipment.length ? job.equipment.join(", ") : "ajratilmadi"}</small>{job.materials.length ? <small>Material: {job.materials.map((material) => `${material.name} — ${material.quantity} ${material.unit}`).join("; ")}</small> : null}</div></article>)}</div>
      {publishedPlanId || preview.state === "PUBLISHED" ? <div className="success-banner" role="status"><CalendarCheck aria-hidden="true" /><span>Topshiriqlar chiqarildi{publishedPlanId ? <>. Reja raqami: <strong>{publishedPlanId}</strong></> : null}</span></div> : preview.state === "APPROVED" && preview.canPublish ? <Button busy={publishing} disabled={!publishReady} onClick={onPublish}>Topshiriqlarni chiqarish</Button> : preview.state === "APPROVED" ? <div className="approval-note"><LockKeyhole aria-hidden="true" /><div><strong>Reja tasdiqlangan</strong><p>Topshiriqlarni chiqarish uchun planning.approve vakolati talab qilinadi.</p></div><Button disabled>Topshiriqlarni chiqarish</Button></div> : preview.canApprove ? <Button busy={approving} disabled={!resourcesReady} onClick={onApprove}>Rejani tasdiqlash</Button> : <div className="approval-note"><LockKeyhole aria-hidden="true" /><div><strong>Tasdiq kutilmoqda</strong><p>Rejani uni tuzgan foydalanuvchidan boshqa vakolatli xodim tasdiqlaydi.</p></div><Button disabled>Rejani tasdiqlash</Button></div>}
    </Card>
  );
}

function AutomaticPlanner({
  data,
  onPreview,
  busy,
}: {
  data: { items: PlanningCandidate[]; total: number };
  onPreview: (candidateIds: string[], dateFrom: string, dateTo: string) => Promise<void>;
  busy: boolean;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState<"ALL" | PlanningCandidate["sourceKind"]>("ALL");
  const [dateFrom, setDateFrom] = useState(() => isoDay());
  const [dateTo, setDateTo] = useState(() => isoDay(7));
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
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function move(position: number, shift: -1 | 1) {
    setSelectedIds((current) => {
      const target = position + shift;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      [copy[position], copy[target]] = [copy[target]!, copy[position]!];
      return copy;
    });
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
          return <label className={`candidate-card ${checked ? "candidate-card--selected" : ""}`} key={candidate.id}><input type="checkbox" checked={checked} onChange={() => toggle(candidate.id)} /><span className="check-visual" aria-hidden="true"><CheckCircle2 /></span><span className="candidate-card__content"><span><strong>{candidate.workName}</strong><Badge tone={candidate.sourceKind === "ROADVISION" ? "info" : "neutral"}>{sourceLabel(candidate)}</Badge></span><small>{candidate.road.code} · {candidate.road.name}</small><small>{candidate.locationLabel}</small><span className="norm-line">{candidate.exactQuantity ? `${candidate.exactQuantity.value} ${candidate.exactQuantity.unit}` : "Aniq ish hajmi kiritilmagan"} · {candidate.normReference ?? "IQN mosligi belgilanmagan"}</span></span></label>;
        })}</div> : <EmptyState title="Bu manbada yozuv yo‘q" detail="Tanlangan manbadan tasdiqlangan ish kelganda shu yerda ko‘rinadi." />}
      </Card>
      <Card>
        <div className="card-heading"><div><p className="eyebrow">2-qadam</p><h2>Tartib va muddat</h2><p>Tizim tanlangan tartibni saqlaydi.</p></div></div>
        {selected.length ? <ol className="selected-list">{selected.map((candidate, position) => <li key={candidate.id}><GripVertical aria-hidden="true" /><span className="selected-order">{position + 1}</span><div><strong>{candidate.workName}</strong><small>{candidate.road.code} · {candidate.locationLabel}</small></div><div className="order-actions"><button aria-label={`${candidate.workName} yozuvini yuqoriga ko‘tarish`} disabled={position === 0} onClick={() => move(position, -1)}><ArrowUp aria-hidden="true" /></button><button aria-label={`${candidate.workName} yozuvini pastga tushirish`} disabled={position === selected.length - 1} onClick={() => move(position, 1)}><ArrowDown aria-hidden="true" /></button><button aria-label={`${candidate.workName} yozuvini olib tashlash`} onClick={() => toggle(candidate.id)}><X aria-hidden="true" /></button></div></li>)}</ol> : <EmptyState title="Ish tanlanmagan" detail="Chap tomondagi ro‘yxatdan bir yoki bir nechta yozuvni belgilang." />}
        <div className="date-fields"><TextInput label="Boshlanish sanasi" name="dateFrom" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /><TextInput label="Tugash sanasi" name="dateTo" type="date" min={dateFrom} value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div>
        <Button busy={busy} disabled={!selectedIds.length || !dateFrom || !dateTo || dateTo < dateFrom} onClick={() => onPreview(selectedIds, dateFrom, dateTo)}><Sparkles size={17} aria-hidden="true" /> Avtomatik rejani hisoblash</Button>
      </Card>
    </div>
  );
}

function ManualPlanner({ options, scheduledDate, onScheduledDateChange, onPreview, busy }: {
  options: PlanningOptions;
  scheduledDate: string;
  onScheduledDateChange: (date: string) => void;
  onPreview: (payload: ManualPlanInput) => Promise<void>;
  busy: boolean;
}) {
  const [workVariantId, setWorkVariantId] = useState("");
  const [exactQuantity, setExactQuantity] = useState("");
  const [chainageStartM, setChainageStartM] = useState("");
  const [chainageEndM, setChainageEndM] = useState("");
  const [laneLabel, setLaneLabel] = useState("");
  const [direction, setDirection] = useState("ichki halqa");
  const [safetySchemeId, setSafetySchemeId] = useState("");
  const [workerIds, setWorkerIds] = useState<string[]>([]);
  const [permitNumber, setPermitNumber] = useState("");
  const work = options.workVariants.find((item) => item.id === workVariantId);
  const scheme = options.safetySchemes.find((item) => item.id === safetySchemeId);
  const selectedWorkers = options.workers.filter((worker) => workerIds.includes(worker.id));
  const selectedRoadWorkers = selectedWorkers.filter((worker) => worker.skills.includes("road_worker") && worker.availableMinutes > 0).length;
  const selectedSafetyWorkers = selectedWorkers.filter((worker) => worker.skills.includes("safety") && worker.availableMinutes > 0).length;
  const staffingReady = Boolean(work && scheme)
    && selectedRoadWorkers >= (work?.requiredWorkers ?? 0)
    && selectedSafetyWorkers >= (scheme?.requiredSafetyWorkers ?? 0);
  const zoneReady = Number(chainageStartM) >= 0
    && Number(chainageEndM) > Number(chainageStartM)
    && Number(chainageEndM) <= options.road.lengthM;
  const inputReady = Boolean(work && scheme && Number(exactQuantity) > 0 && zoneReady && scheduledDate);

  function toggleWorker(id: string) {
    setWorkerIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  return (
    <div className="manual-planner">
      <Card>
        <div className="road-context"><div><span>Yo‘l</span><strong>{options.road.code} · {options.road.name}</strong></div><div><span>Butun uzunligi</span><strong>0+000 — {formatChainage(options.road.lengthM)}</strong></div><div><span>Yo‘l bo‘limi</span><strong>{options.road.divisionName}</strong></div></div>
        <div className="data-form">
          <SelectInput label="IQN bo‘yicha ish turi" name="workVariantId" value={workVariantId} onChange={(event) => setWorkVariantId(event.target.value)}><option value="">Ishni tanlang</option>{options.workVariants.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.normReference}</option>)}</SelectInput>
          <TextInput label={`Ish hajmi${work ? `, ${work.unit}` : ""}`} name="exactQuantity" type="number" min="0" step="any" value={exactQuantity} onChange={(event) => setExactQuantity(event.target.value)} />
          <TextInput label="Boshlanish nuqtasi, metr" name="manualChainageStart" type="number" min="0" max={options.road.lengthM - 1} value={chainageStartM} onChange={(event) => setChainageStartM(event.target.value)} />
          <TextInput label="Tugash nuqtasi, metr" name="manualChainageEnd" type="number" min="1" max={options.road.lengthM} value={chainageEndM} onChange={(event) => setChainageEndM(event.target.value)} error={chainageEndM && !zoneReady ? `Nuqtalar 0–${options.road.lengthM.toLocaleString("uz-UZ")} metr oralig‘ida va ketma-ket bo‘lishi kerak.` : undefined} />
          <SelectInput label="Yo‘nalish" name="manualDirection" value={direction} onChange={(event) => setDirection(event.target.value)}><option value="ichki halqa">Ichki halqa</option><option value="tashqi halqa">Tashqi halqa</option></SelectInput>
          <TextInput label="Tasma yoki yoqa" name="manualLane" value={laneLabel} onChange={(event) => setLaneLabel(event.target.value)} placeholder="Masalan: 1-tasma" />
          <TextInput label="Ish sanasi" name="manualDate" type="date" value={scheduledDate} onChange={(event) => onScheduledDateChange(event.target.value)} />
          {scheme?.requiresPermit ? <TextInput label="Yopish ruxsatnomasi raqami" name="permitNumber" value={permitNumber} onChange={(event) => setPermitNumber(event.target.value)} required /> : <div />}
        </div>
      </Card>

      <Card>
        <div className="card-heading"><div><p className="eyebrow">Harakat xavfsizligi</p><h2>Ish zonasi sxemasi</h2><p>Ish joyiga mos bitta sxemani tanlang.</p></div><ShieldCheck aria-hidden="true" /></div>
        <div className="safety-scheme-grid">{options.safetySchemes.map((item) => <label className={`safety-scheme ${safetySchemeId === item.id ? "safety-scheme--selected" : ""}`} key={item.id}><input type="radio" name="safetyScheme" value={item.id} checked={safetySchemeId === item.id} onChange={() => setSafetySchemeId(item.id)} /><span className="safety-scheme__check"><CheckCircle2 aria-hidden="true" /></span><strong>{item.name}</strong><p>{item.description}</p><small>{item.requiredSafetyWorkers} xavfsizlik xodimi · {item.requiredSigns} belgi · {item.requiredCones} konus{item.requiresPermit ? " · ruxsatnoma shart" : ""}</small></label>)}</div>
      </Card>

      <Card>
        <div className="card-heading"><div><p className="eyebrow">Brigada</p><h2>Xodimlarni tanlash</h2><p>Bir xodimga bir kunda ko‘pi bilan 420 daqiqa ish ajratiladi.</p></div><Users aria-hidden="true" /></div>
        <div className={staffingReady ? "staffing-status staffing-status--ready" : "staffing-status staffing-status--blocked"}>{staffingReady ? <CheckCircle2 aria-hidden="true" /> : <CircleX aria-hidden="true" />}<div><strong>{staffingReady ? "Brigada yetarli" : "Brigada yetarli emas"}</strong><p>{work ? `${selectedRoadWorkers}/${work.requiredWorkers} ishchi` : "Ish turi tanlanmagan"} · {scheme ? `${selectedSafetyWorkers}/${scheme.requiredSafetyWorkers} xavfsizlik xodimi` : "sxema tanlanmagan"}</p></div></div>
        <div className="worker-selection">{options.workers.map((worker) => {
          const selected = workerIds.includes(worker.id);
          return <label className={`worker-choice ${selected ? "worker-choice--selected" : ""} ${worker.availableMinutes === 0 ? "worker-choice--unavailable" : ""}`} key={worker.id}><input type="checkbox" checked={selected} disabled={worker.availableMinutes === 0} onChange={() => toggleWorker(worker.id)} /><span className="check-visual"><CheckCircle2 aria-hidden="true" /></span><div><strong>{worker.fullName}</strong><small>{worker.positionName}</small></div><div className={worker.availableMinutes > 0 ? "minute-value minute-value--ready" : "minute-value minute-value--blocked"}><span>{worker.availableMinutes}</span><small>daqiqa bo‘sh</small></div></label>;
        })}</div>
        <Button busy={busy} disabled={!inputReady} onClick={() => onPreview({ roadId: options.road.id, workVariantId, exactQuantity, chainageStartM, chainageEndM, laneLabel, direction, scheduledDate, safetySchemeId, workerIds, ...(permitNumber ? { permitNumber } : {}) })}><Wrench size={17} aria-hidden="true" /> Qo‘lda rejani tekshirish</Button>
      </Card>
    </div>
  );
}

function ManualPlannerWorkspace({
  roads,
  onPreview,
  onRoadChange,
  busy,
}: {
  roads: RoadOption[];
  onPreview: (payload: ManualPlanInput) => Promise<void>;
  onRoadChange: () => void;
  busy: boolean;
}) {
  const [selectedRoadId, setSelectedRoadId] = useState(roads[0]!.id);
  const [scheduledDate, setScheduledDate] = useState(() => isoDay());
  const options = useApiResource(
    () => api.planningOptions(selectedRoadId, scheduledDate),
    `planning-options:${selectedRoadId}:${scheduledDate}`,
  );

  function selectRoad(roadId: string) {
    setSelectedRoadId(roadId);
    onRoadChange();
  }

  function selectDate(date: string) {
    setScheduledDate(date);
    onRoadChange();
  }

  return (
    <>
      <Card>
        <SelectInput label="Rejalashtiriladigan yo‘l" name="planningRoadId" value={selectedRoadId} disabled onChange={(event) => selectRoad(event.target.value)}>
          {roads.map((road) => <option value={road.id} key={road.id}>{road.code} · {road.name}</option>)}
        </SelectInput>
      </Card>
      {options.loading ? <LoadingState /> : options.error ? <ErrorState error={options.error} retry={options.reload} /> : options.data ? <ManualPlanner options={options.data} scheduledDate={scheduledDate} onScheduledDateChange={selectDate} onPreview={onPreview} busy={busy} /> : null}
    </>
  );
}

export default function PlanningPage() {
  const { user } = useAuth();
  const canExport = Boolean(user?.permissions.includes("system.all") || user?.permissions.includes("reports.read"));
  const [mode, setMode] = useState<"automatic" | "manual">("automatic");
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [publishedPlanId, setPublishedPlanId] = useState("");
  const [loadingPlanId, setLoadingPlanId] = useState("");
  const candidates = useApiResource(api.planningCandidates, "planning-candidates");
  const roads = useApiResource(api.roads, "planning-roads");
  const plans = useApiResource(api.plans, "planning-plans");

  function changeMode(nextMode: "automatic" | "manual") {
    setMode(nextMode);
    setPreview(null);
    setActionError("");
    setPublishedPlanId("");
  }

  async function automaticPreview(candidateIds: string[], dateFrom: string, dateTo: string) {
    setBusy(true);
    setActionError("");
    setPublishedPlanId("");
    try {
      setPreview(await api.previewPlan(candidateIds, dateFrom, dateTo));
      void plans.reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Avtomatik rejani hisoblab bo‘lmadi.");
    } finally {
      setBusy(false);
    }
  }

  async function manualPreview(payload: ManualPlanInput) {
    setBusy(true);
    setActionError("");
    setPublishedPlanId("");
    try {
      setPreview(await api.previewManualPlan(payload));
      void plans.reload();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Qo‘lda rejani tekshirib bo‘lmadi.");
    } finally {
      setBusy(false);
    }
  }

  async function openPlan(id: string) {
    setLoadingPlanId(id);
    setActionError("");
    setPublishedPlanId("");
    try {
      setPreview(await api.plan(id));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Saqlangan rejani ochib bo‘lmadi.");
    } finally {
      setLoadingPlanId("");
    }
  }

  async function approve() {
    if (!preview) return;
    setApproving(true);
    setActionError("");
    try {
      await api.approvePlan(preview.draftId);
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
      <PageHeader title="D001 rejalashtirish" description="D001 yo‘lining 0+000–67+000 oralig‘idagi saqlash ishlarini avtomatik hisoblang yoki IQN bandi bo‘yicha qo‘lda tuzing." actions={canExport ? <a className="button button--secondary" href="/api/v1/reports/plans.xlsx" download><Download size={16} aria-hidden="true" /> Excel yuklash</a> : null} />
      <div className="context-strip"><div><span>Yo‘l</span><strong>D001</strong></div><div><span>To‘liq uzunligi</span><strong>0+000 — 67+000</strong></div><div><span>Yo‘l bo‘limi</span><strong>{roads.data?.items[0]?.divisionName ?? "YTP bo‘limi"}</strong></div></div>
      {plans.loading ? <LoadingState label="Saqlangan rejalar yuklanmoqda" /> : plans.error ? <ErrorState error={plans.error} retry={plans.reload} /> : <PersistedPlans plans={plans.data?.items ?? []} loadingPlanId={loadingPlanId} onOpen={openPlan} />}
      <div className="tabs planner-mode-tabs" role="tablist" aria-label="Rejalashtirish usuli"><button role="tab" aria-selected={mode === "automatic"} onClick={() => changeMode("automatic")}><Sparkles size={16} aria-hidden="true" /> Avtomatik reja</button><button role="tab" aria-selected={mode === "manual"} onClick={() => changeMode("manual")}><Wrench size={16} aria-hidden="true" /> Qo‘lda reja</button></div>
      {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
      {mode === "automatic" ? candidates.loading ? <LoadingState /> : candidates.error ? <ErrorState error={candidates.error} retry={candidates.reload} /> : candidates.data ? <AutomaticPlanner data={candidates.data} onPreview={automaticPreview} busy={busy} /> : null : roads.loading ? <LoadingState /> : roads.error ? <ErrorState error={roads.error} retry={roads.reload} /> : roads.data?.items.length ? <ManualPlannerWorkspace roads={roads.data.items} onPreview={manualPreview} onRoadChange={() => { setPreview(null); setActionError(""); setPublishedPlanId(""); }} busy={busy} /> : <EmptyState title="D001 topilmadi" detail="YTP integratsiyasida yagona faol D001 yo‘li 67 000 metr uzunlikda bo‘lishi kerak." />}
      {preview ? <PlanResult preview={preview} approving={approving} publishing={publishing} publishedPlanId={publishedPlanId} onApprove={approve} onPublish={publish} /> : null}
    </div>
  );
}
