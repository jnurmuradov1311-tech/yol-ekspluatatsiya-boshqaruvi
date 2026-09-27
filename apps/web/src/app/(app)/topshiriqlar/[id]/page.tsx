"use client";
import { ExecutionEvidenceUpload } from "@/components/execution-evidence-upload";
import {WorkGuides} from "@/components/work-guides";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  FileCheck2,
  MapPin,
  PackageCheck,
  Play,
  Route,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";
import { useHasPermission } from "@/components/auth-provider";
import styles from "@/components/execution-finance.module.css";
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, TextArea, TextInput } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { WorkOrderDetail, WorkOrderEvidenceUpload } from "@/lib/api/types";
import { executionPayload, formatMinutes, scheduledMinutes } from "@/lib/execution-entry";
import { formatDate, formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";

const executionSteps = [
  { label: "Biriktirildi", detail: "Brigada va resurslar", icon: ClipboardCheck },
  { label: "Ish boshlandi", detail: "Haqiqiy vaqt hisobi", icon: Play },
  { label: "Yakun qaydi", detail: "Hajm va sarflar", icon: FileCheck2 },
  { label: "Tekshirildi", detail: "Dalolatnomaga tayyor", icon: ShieldCheck },
] as const;

function currentStep(order: WorkOrderDetail): number {
  if (order.completion?.state === "VERIFIED") return 3;
  if (order.state === "COMPLETED") return 2;
  if (order.state === "IN_PROGRESS") return 1;
  return 0;
}

function tashkentToday(): string {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tashkent",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

function CompletionSummary({ order }: { order: WorkOrderDetail }) {
  const completion = order.completion;
  if (!completion) return null;
  const workerNames = new Map(order.executionResources.workers.map((worker) => [worker.id, worker.fullName]));
  const materialNames = new Map(order.executionResources.materials.map((material) => [material.id, material.name]));
  const equipmentNames = new Map(order.executionResources.equipment.map((unit) => [unit.id, unit.name]));

  return (
    <Card>
      <div className={styles.sectionHeader}>
        <div><h2>Haqiqiy bajarilish qaydi</h2><p>{formatDateTime(completion.recordedAt)} · {completion.recordedByName}</p></div>
        <Badge tone={completion.state === "VERIFIED" ? "success" : "warning"}>
          {completion.state === "VERIFIED" ? "Tekshirilgan" : "Tekshiruv kutilmoqda"}
        </Badge>
      </div>
      <dl className={styles.detailList}>
        <div><dt>Bajarilgan hajm</dt><dd>{completion.actualQuantity.value} {completion.actualQuantity.unit}</dd></div>
        <div><dt>Jami ishchi vaqti</dt><dd>{completion.workerMinutes.reduce((sum, item) => sum + item.minutes, 0)} daqiqa</dd></div>
        <div><dt>Sarflangan material</dt><dd>{completion.materials.length} tur</dd></div>
        <div><dt>Mashina-mexanizm</dt><dd>{completion.equipment.reduce((sum, item) => sum + item.machineMinutes, 0)} mashina-daqiqa</dd></div>
      </dl>
      <div className={styles.resourceList}>
        {completion.workerMinutes.map((item) => <div className={styles.resourceRow} key={item.workerId}><div><strong>{workerNames.get(item.workerId) ?? item.workerId}</strong><small>Ishchi vaqti</small></div><strong>{formatMinutes(item.minutes)}</strong></div>)}
        {completion.materials.map((item) => <div className={styles.resourceRow} key={item.materialId}><div><strong>{materialNames.get(item.materialId) ?? item.materialId}</strong><small>Material sarfi</small></div><strong>{item.quantity} {item.unit}</strong></div>)}
        {completion.equipment.map((item) => <div className={styles.resourceRow} key={item.equipmentUnitId}><div><strong>{equipmentNames.get(item.equipmentUnitId) ?? item.equipmentUnitId}</strong><small>Mashina vaqti</small></div><strong>{formatMinutes(item.machineMinutes)}</strong></div>)}
      </div>
      {completion.unusedResources?.length ? <div className={styles.notice}><span><strong>Ishlatilmagan resurslar</strong>{completion.unusedResources.map((item, index) => <p key={`${item.kind}-${item.resourceId}-${index}`}>{(item.kind === "worker" ? workerNames : item.kind === "material" ? materialNames : equipmentNames).get(item.resourceId) ?? item.resourceId}: {item.reason}</p>)}</span></div> : null}
      {completion.note ? <div className={styles.notice}><FileCheck2 size={18} aria-hidden="true" /><span><strong>Yakun izohi:</strong> {completion.note}</span></div> : null}
      {completion.evidence.map((item, index) => <a className={styles.evidenceLink} href={item.url} target="_blank" rel="noreferrer" key={`${item.url}-${index}`}><ExternalLink size={16} aria-hidden="true" /> Dalil {index + 1}ni ko‘rish</a>)}
      {completion.verifiedAt ? <div className={styles.notice}><ShieldCheck size={18} aria-hidden="true" /><span><strong>{completion.verifiedByName}</strong> · {formatDateTime(completion.verifiedAt)}{completion.verificationNote ? ` · ${completion.verificationNote}` : ""}</span></div> : null}
    </Card>
  );
}

export default function WorkOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const loadOrder = useCallback(() => api.workOrder(orderId), [orderId]);
  const { data, error, loading, reload, setData } = useApiResource(loadOrder, orderId);
  const canManage = useHasPermission("execution.manage");
  const initializedOrder = useRef("");
  const [actualQuantity, setActualQuantity] = useState("");
  const [workerMinutes, setWorkerMinutes] = useState<Record<string, string>>({});
  const [materialQuantities, setMaterialQuantities] = useState<Record<string, string>>({});
  const [equipmentMinutes, setEquipmentMinutes] = useState<Record<string, string>>({});
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [uploadedEvidence, setUploadedEvidence] = useState<WorkOrderEvidenceUpload | null>(null);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const [completionNote, setCompletionNote] = useState("");
  const [unusedReason, setUnusedReason] = useState("");
  const [verificationNote, setVerificationNote] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState(tashkentToday);
  const [busyAction, setBusyAction] = useState<"reschedule" | "start" | "complete" | "verify" | "return" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!data || initializedOrder.current === data.id) return;
    initializedOrder.current = data.id;
    setActualQuantity("");
    setEvidenceUrl("");
    setUploadedEvidence(null);
    setEvidenceUploading(false);
    setCompletionNote("");
    setUnusedReason("");
    setVerificationNote("");
    setWorkerMinutes(Object.fromEntries(data.executionResources.workers.map((worker) => [worker.id, ""])));
    setMaterialQuantities(Object.fromEntries(data.executionResources.materials.map((material) => [material.reservationId, ""])));
    setEquipmentMinutes(Object.fromEntries(data.executionResources.equipment.map((unit) => [unit.reservationId, ""])));
  }, [data]);

  async function startOrder() {
    setBusyAction("start");
    setActionError(null);
    setSuccess(null);
    try {
      setData(await api.startWorkOrder(orderId));
      setSuccess("Topshiriq ishga olindi. Haqiqiy sarflarni ish yakunida kiriting.");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Topshiriqni boshlab bo‘lmadi.");
    } finally {
      setBusyAction(null);
    }
  }

  async function rescheduleOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyAction("reschedule");
    setActionError(null);
    setSuccess(null);
    try {
      const updated = await api.rescheduleWorkOrder(orderId, rescheduleDate);
      setData(updated);
      setSuccess(`Topshiriq ${formatDate(updated.scheduledDate)} sanasiga qayta rejalashtirildi.`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Topshiriq sanasini o‘zgartirib bo‘lmadi.");
    } finally {
      setBusyAction(null);
    }
  }

  async function completeOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || evidenceUploading) return;
    setBusyAction("complete");
    setActionError(null);
    setSuccess(null);
    try {
      const payload = executionPayload(data, {
        quantity: actualQuantity, workerMinutes, materialQuantities, equipmentMinutes,
        unusedReason, evidenceUrl: uploadedEvidence?.url ?? evidenceUrl, authorizedEvidenceUrls: uploadedEvidence ? [uploadedEvidence.url] : [], note: completionNote,
      }, new Date().toISOString());
      setData(await api.completeWorkOrder(orderId, payload));
      setSuccess("Bajarilgan ish qaydi saqlandi va mustaqil tekshiruvga yuborildi.");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Yakun qaydini saqlab bo‘lmadi.");
    } finally {
      setBusyAction(null);
    }
  }

  async function returnOrder() {
    if (verificationNote.trim().length < 3) { setActionError("Qaytarish sababini yozing (kamida 3 belgi)."); return; }
    setBusyAction("return"); setActionError(null); setSuccess(null);
    try {
      const updated = await api.returnWorkOrder(orderId, verificationNote.trim());
      initializedOrder.current = "";
      setData(updated); setVerificationNote("");
      setSuccess("Ish tuzatishga qaytarildi. Oldingi qayd tarixda saqlandi.");
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : "Ishni qaytarib bo‘lmadi."); }
    finally { setBusyAction(null); }
  }

  async function verifyOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verificationNote.trim().length < 3) { setActionError("Tekshiruv izohini kiriting (kamida 3 belgi)."); return; }
    setBusyAction("verify");
    setActionError(null);
    setSuccess(null);
    try {
      setData(await api.verifyWorkOrder(orderId, verificationNote.trim()));
      setSuccess("Bajarilgan ish tekshirildi. Ish vaqti tabelga, sarflar dalolatnomaga o‘tadi.");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Tekshiruvni yakunlab bo‘lmadi.");
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) return <LoadingState label="Topshiriq tafsilotlari yuklanmoqda" />;
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return null;
  const countedWork = ["unit", "dona", "ta"].includes(data.exactQuantity.unit.toLowerCase());
  const activeStep = currentStep(data);
  const canStartToday = data.scheduledDate === tashkentToday();

  return (
    <div className="page-stack">
      <PageHeader
        title={`${data.number} · ${data.workName}`}
        description="Bajarilgan hajm, ish vaqti va haqiqiy sarflar."
        actions={<div className={styles.headerActions}><Link className="button button--secondary" href="/topshiriqlar"><ArrowLeft size={16} aria-hidden="true" /> Topshiriqlarga qaytish</Link>{(data.state === "ASSIGNED" || data.state === "PAUSED") && canManage && canStartToday ? <Button disabled={Boolean(busyAction)} busy={busyAction === "start"} onClick={startOrder}><Play size={16} aria-hidden="true" /> {data.state === "PAUSED" ? "Ishni davom ettirish" : "Ishni boshlash"}</Button> : null}</div>}
      />

      {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
      {success ? <div className="success-banner" role="status"><CheckCircle2 size={18} aria-hidden="true" /> {success}</div> : null}

      <Card className={styles.progressTrack}>
        {executionSteps.map((step, index) => {
          const Icon = step.icon;
          const className = index < activeStep ? styles.progressDone : index === activeStep ? styles.progressActive : "";
          return <div className={`${styles.progressStep} ${className}`.trim()} key={step.label}><Icon size={20} aria-hidden="true" /><div><strong>{step.label}</strong><small>{step.detail}</small></div></div>;
        })}
      </Card>

      <div className={styles.summaryGrid}>
        <Card className={styles.summaryCard}><span className={styles.summaryIcon}><Route size={20} aria-hidden="true" /></span><div><strong>{data.road.code}</strong><span>{data.road.name}</span><small>{data.locationLabel}</small></div></Card>
        <Card className={styles.summaryCard}><span className={styles.summaryIcon}><CalendarDays size={20} aria-hidden="true" /></span><div><strong>{formatDate(data.scheduledDate)}</strong><span>Rejalashtirilgan sana</span>{data.scheduledStartAt && data.scheduledEndAt ? <small>{formatDateTime(data.scheduledStartAt)} — {formatDateTime(data.scheduledEndAt)}</small> : null}<small>{data.teamName}</small></div></Card>
        <Card className={styles.summaryCard}><span className={styles.summaryIcon}><PackageCheck size={20} aria-hidden="true" /></span><div><strong>{data.exactQuantity.value} {data.exactQuantity.unit}</strong><span>Rejadagi hajm</span><small>{data.normReference}</small></div></Card>
        <Card className={styles.summaryCard}><span className={styles.summaryIcon}><Clock3 size={20} aria-hidden="true" /></span><div><strong>{data.startedAt ? formatDateTime(data.startedAt) : "Boshlanmagan"}</strong><span>Ishning boshlanishi</span><small>{data.startedByName ?? "Mas’ul kutilmoqda"}</small></div></Card>
      </div>

      <div className={styles.twoColumn}>
        <div className={styles.stack}>
          {data.state === "IN_PROGRESS" && canManage ? (
            <form onSubmit={completeOrder}>
              <Card>
                <div className={styles.sectionHeader}><div><h2>Haqiqiy bajarilish va sarflar</h2><p>Haqiqiy qiymatlarni kiriting. Ishlatilmagan resurs uchun 0 yozing.</p></div><Badge tone="warning">Bajarilmoqda</Badge></div>
                <div className={styles.formGrid}>
                  <TextInput label={`Haqiqiy bajarilgan hajm, ${data.exactQuantity.unit}`} name="actualQuantity" type="number" inputMode="decimal" min={countedWork ? "1" : "0.000001"} max={data.exactQuantity.value} step={countedWork ? "1" : "0.000001"} disabled={Boolean(busyAction)} required value={actualQuantity} onChange={(event) => setActualQuantity(event.target.value)} />
                  <ExecutionEvidenceUpload key={orderId} orderId={orderId} disabled={Boolean(busyAction)} onChange={setUploadedEvidence} onUploadingChange={setEvidenceUploading} />
                  <details className="workflow-details"><summary>Mavjud tashqi dalil havolasi</summary><TextInput label="Foto yoki hujjat manzili" name="evidenceUrl" type="url" disabled={Boolean(busyAction) || Boolean(uploadedEvidence) || evidenceUploading} value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} hint="Tashkilot tasdiqlagan HTTPS manzil. Yuklangan fayl bo‘lsa shu fayl ishlatiladi." /></details>
                </div>

                <div className={styles.resourceList}>
                  <div className={styles.sectionHeader}><div><h3><Users size={16} aria-hidden="true" /> Ishchilar</h3><p>Har bir xodimning haqiqiy ishlagan daqiqasi.</p></div></div>
                  {data.executionResources.workers.map((worker) => <label className={styles.resourceRow} key={worker.id}><span><strong>{worker.fullName}</strong><small>{worker.positionName} · reja {worker.plannedMinutes} daqiqa</small></span><input className={styles.compactInput} type="number" min="0" max={Math.min(420, worker.reservedMinutes ?? scheduledMinutes(data), scheduledMinutes(data))} step="1" required disabled={Boolean(busyAction)} aria-label={`${worker.fullName} ishlagan daqiqa`} value={workerMinutes[worker.id] ?? ""} onChange={(event) => setWorkerMinutes((current) => ({ ...current, [worker.id]: event.target.value }))} /></label>)}
                </div>

                <div className={styles.resourceList}>
                  <div className={styles.sectionHeader}><div><h3><PackageCheck size={16} aria-hidden="true" /> Materiallar</h3><p>Ombordan ishga haqiqatda sarflangan miqdor.</p></div></div>
                  {data.executionResources.materials.length ? data.executionResources.materials.map((material) => <label className={styles.resourceRow} key={material.reservationId}><span><strong>{material.code} · {material.name}</strong><small>Reja {material.plannedQuantity} {material.unit}</small></span><input className={styles.compactInput} type="number" min="0" max={material.plannedQuantity} step="0.000001" required disabled={Boolean(busyAction)} aria-label={`${material.name} sarfi`} value={materialQuantities[material.reservationId] ?? ""} onChange={(event) => setMaterialQuantities((current) => ({ ...current, [material.reservationId]: event.target.value }))} /></label>) : <div className={styles.notice}>Bu ish uchun material rejalashtirilmagan.</div>}
                </div>

                <div className={styles.resourceList}>
                  <div className={styles.sectionHeader}><div><h3><Truck size={16} aria-hidden="true" /> Mashina va mexanizmlar</h3><p>Haqiqiy mashina-daqiqa; dalolatnomada mashina-soatga aylantiriladi.</p></div></div>
                  {data.executionResources.equipment.map((unit) => <label className={styles.resourceRow} key={unit.reservationId}><span><strong>{unit.inventoryCode} · {unit.name}</strong><small>Reja {unit.plannedMachineMinutes} mashina-daqiqa</small></span><input className={styles.compactInput} type="number" min="0" max={Math.min(1440, unit.reservedMinutes ?? scheduledMinutes(data), scheduledMinutes(data))} step="1" required disabled={Boolean(busyAction)} aria-label={`${unit.name} mashina daqiqasi`} value={equipmentMinutes[unit.reservationId] ?? ""} onChange={(event) => setEquipmentMinutes((current) => ({ ...current, [unit.reservationId]: event.target.value }))} /></label>)}
                </div>

                <TextArea label="Ishlamagan xodim yoki ishlatilmagan resurs sababi" name="unusedReason" maxLength={1000} disabled={Boolean(busyAction)} value={unusedReason} onChange={(event) => setUnusedReason(event.target.value)} hint="0 kiritilgan xodim yoki resurs bo‘lsa to‘ldiring." />
                <div className={styles.spanTwo}><TextArea label="Bajarilgan ish bo‘yicha izoh" name="completionNote" required value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} hint="Joydagi sharoit, o‘zgarish yoki o‘lchash usulini qisqacha yozing." /></div>
                <div className={styles.actionBar}><p>Yakun qaydi boshliqqa tekshirish uchun yuboriladi.</p><Button type="submit" disabled={evidenceUploading || Boolean(busyAction && busyAction !== "complete")} busy={busyAction === "complete"}><FileCheck2 size={16} aria-hidden="true" /> Ishni yakunlash</Button></div>
              </Card>
            </form>
          ) : data.state === "ASSIGNED" ? (
            <Card>
              <div className={styles.notice}><Play size={18} aria-hidden="true" /><span>{!canManage ? <>Topshiriqni boshlash uchun ijro vakolati kerak.</> : canStartToday ? <>Haqiqiy ish vaqti va sarflarni kiritish uchun avval topshiriqni <strong>ishga oling</strong>.</> : <>Topshiriq {formatDate(data.scheduledDate)} sanasiga biriktirilgan. Ishchilar va texnika bandlovini birga ko‘chirish uchun yangi sanani tanlang.</>}</span></div>
              {canManage ? (
                <form className={styles.actionBar} onSubmit={rescheduleOrder}>
                  <TextInput
                    label="Yangi ish sanasi"
                    name="rescheduleDate"
                    type="date"
                    min={tashkentToday()}
                    required
                    value={rescheduleDate}
                    onChange={(event) => setRescheduleDate(event.target.value)}
                  />
                  <Button type="submit" busy={busyAction === "reschedule"}>
                    <CalendarDays size={16} aria-hidden="true" /> Sanani o‘zgartirish
                  </Button>
                </form>
              ) : null}
            </Card>
          ) : data.state === "PAUSED" ? <Card><div className={styles.notice}><Play size={18} aria-hidden="true" /><span>{canStartToday ? <>Ish vaqtincha to‘xtatilgan. Yuqoridagi tugma orqali uni <strong>davom ettiring</strong>.</> : <>Tanaffusdagi ish {formatDate(data.scheduledDate)} sanasiga tegishli. Tarixiy resurs qaydlarini o‘zgartirmasdan davom ettirish uchun mas’ul rejalashtiruvchiga murojaat qiling.</>}</span></div></Card> : data.state === "IN_PROGRESS" ? <Card><div className={styles.notice}><FileCheck2 size={18} aria-hidden="true" /><span>Haqiqiy bajarilish va sarflarni kiritish uchun ijro vakolati kerak.</span></div></Card> : null}

          {data.workVariantId?<WorkGuides workVariantId={data.workVariantId} workName={data.workName} readOnly/>:null}
      <CompletionSummary order={data} />
          {data.correctionHistory?.length ? <details className="workflow-details"><summary>Tuzatishlar tarixi ({data.correctionHistory.length})</summary>{data.correctionHistory.map((revision) => <Card key={revision.revision}><strong>{revision.revision}-qayd · {revision.returnedByName}</strong><p>{formatDateTime(revision.returnedAt)} · {revision.reason}</p></Card>)}</details> : null}
          {data.completion?.state === "VERIFIED" ? <div className={styles.headerActions}><Link className="button button--secondary" href={`/tabel?month=${data.scheduledDate.slice(0, 7)}`}>Tabelni ko‘rish</Link><Link className="button button--secondary" href={`/bajarilgan-ishlar?month=${data.scheduledDate.slice(0, 7)}`}>Dalolatnomani ko‘rish</Link></div> : null}
        </div>

        <div className={styles.stack}>
          <Card>
            <div className={styles.sectionHeader}><div><h2>Topshiriq asosi</h2><p>IQN normasi, joy va mas’ul brigada.</p></div><MapPin size={20} aria-hidden="true" /></div>
            <dl className={styles.detailList}>
              <div><dt>Yo‘l</dt><dd>{data.road.code} · {data.road.name}</dd></div>
              <div><dt>Joylashuv</dt><dd>{data.locationLabel}</dd></div>
              <div><dt>Brigada</dt><dd>{data.teamName}</dd></div>
              <div><dt>IQN asosi</dt><dd>{data.normReference}</dd></div>
            </dl>
          </Card>

          {data.completion?.state === "PENDING_VERIFICATION" ? (
            <Card>
              <div className={styles.sectionHeader}><div><h2>Mustaqil tekshiruv</h2><p>Hajm, ishchi vaqti, ombor sarfi, texnika qaydi va dalilni solishtiring.</p></div><ShieldCheck size={20} aria-hidden="true" /></div>
              {data.completion.canVerify ? <form onSubmit={verifyOrder}><TextArea label="Tekshiruv izohi yoki qaytarish sababi" name="verificationNote" minLength={3} maxLength={1000} required value={verificationNote} onChange={(event) => setVerificationNote(event.target.value)} /><div className={styles.actionBar}><p>Tasdiqlangach ish ushbu oyning dalolatnomasiga kiritilishi mumkin.</p><Button type="button" variant="secondary" disabled={Boolean(busyAction)} busy={busyAction === "return"} onClick={returnOrder}>Tuzatishga qaytarish</Button><Button type="submit" disabled={Boolean(busyAction)} busy={busyAction === "verify"}><ShieldCheck size={16} aria-hidden="true" /> Tasdiqlash</Button></div></form> : <div className={styles.notice}>Bu qaydni uni kiritgan xodimdan boshqa tekshirish vakolatiga ega xodim tekshiradi.</div>}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
