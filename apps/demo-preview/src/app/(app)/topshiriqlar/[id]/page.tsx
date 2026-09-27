"use client";
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
  FileCheck2,
  MapPin,
  PackageCheck,
  Play,
  Route,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react";
import { EvidenceLink } from "@/components/evidence-link";
import { ExecutionEvidenceUpload } from "@/components/execution-evidence-upload";
import { executionEvidence } from "@/lib/execution-entry";
import { DefectNavigation } from "@/components/defect-navigation";
import { useAuth, useHasPermission } from "@/components/auth-provider";
import styles from "@/components/execution-finance.module.css";
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, TextArea, TextInput } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { WorkOrderDetail, WorkOrderExecutionInput, WorkOrderEvidenceUpload } from "@/lib/api/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";

const executionSteps = [
  { label: "Biriktirildi", detail: "Brigada va resurslar", icon: ClipboardCheck },
  { label: "Ish boshlandi", detail: "Haqiqiy vaqt hisobi", icon: Play },
  { label: "Ish yakuni", detail: "Hajm va sarflar", icon: FileCheck2 },
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
        {completion.workerMinutes.map((item) => <div className={styles.resourceRow} key={item.workerId}><div><strong>{workerNames.get(item.workerId) ?? item.workerId}</strong><small>Ishchi vaqti</small></div><strong>{item.minutes} daqiqa</strong></div>)}
        {completion.materials.map((item) => <div className={styles.resourceRow} key={item.materialId}><div><strong>{materialNames.get(item.materialId) ?? item.materialId}</strong><small>Material sarfi</small></div><strong>{item.quantity} {item.unit}</strong></div>)}
        {completion.equipment.map((item) => <div className={styles.resourceRow} key={item.equipmentUnitId}><div><strong>{equipmentNames.get(item.equipmentUnitId) ?? item.equipmentUnitId}</strong><small>Mashina vaqti</small></div><strong>{item.machineMinutes} daqiqa</strong></div>)}
      </div>
      {completion.note ? <div className={styles.notice}><FileCheck2 size={18} aria-hidden="true" /><span><strong>Yakun izohi:</strong> {completion.note}</span></div> : null}
      {completion.evidence.map((item, index) => <div className={styles.evidenceLink} key={`${item.url}-${index}`}><EvidenceLink url={item.url} label={`Dalil ${index + 1}ni ko‘rish`} /></div>)}
      {completion.verifiedAt ? <div className={styles.notice}><ShieldCheck size={18} aria-hidden="true" /><span><strong>{completion.verifiedByName}</strong> · {formatDateTime(completion.verifiedAt)}{completion.verificationNote ? ` · ${completion.verificationNote}` : ""}</span></div> : null}
    </Card>
  );
}

export default function WorkOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;
  const loadOrder = useCallback(() => api.workOrder(orderId), [orderId]);
  const { data, error, loading, reload, setData } = useApiResource(loadOrder, orderId);
  const {user}=useAuth();
  const hasManage=useHasPermission("execution.manage");
  const canManage=hasManage&&(!api.fixturesEnabled||user?.id==="demo-foreman");
  const canReschedule=hasManage&&(!api.fixturesEnabled||user?.id==="demo-chief");
  const initializedOrder = useRef("");
  const [actualQuantity, setActualQuantity] = useState("");
  const [workerMinutes, setWorkerMinutes] = useState<Record<string, string>>({});
  const [materialQuantities, setMaterialQuantities] = useState<Record<string, string>>({});
  const [equipmentMinutes, setEquipmentMinutes] = useState<Record<string, string>>({});
  const [evidenceReceipt, setEvidenceReceipt] = useState<WorkOrderEvidenceUpload | null>(null);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const [completionNote, setCompletionNote] = useState("");
  const [verificationNote, setVerificationNote] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState(tashkentToday);
  const [busyAction, setBusyAction] = useState<"return" | "cancel" | "reschedule" | "start" | "complete" | "verify" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const revision=`${data.id}:${data.correctionHistory?.length??0}`;
    if(initializedOrder.current===revision)return;
    initializedOrder.current=revision;
    setEvidenceReceipt(null);
    setEvidenceUploading(false);
    const previous=data.correctionHistory?.at(-1)?.completion;
    setActualQuantity(previous?.actualQuantity.value??"");
    setWorkerMinutes(Object.fromEntries(data.executionResources.workers.map((worker) => [worker.id, previous?.workerMinutes.find(w=>w.workerId===worker.id)?.minutes.toString()??""])));
    setMaterialQuantities(Object.fromEntries(data.executionResources.materials.map((material) => [material.id, previous?.materials.find(m=>m.materialId===material.id)?.quantity??""])));
    setEquipmentMinutes(Object.fromEntries(data.executionResources.equipment.map((unit) => [unit.id, previous?.equipment.find(e=>e.equipmentUnitId===unit.id)?.machineMinutes.toString()??""])));
  }, [data]);

  async function cancelOrder(){setBusyAction('cancel');setActionError(null);try{setData(await api.cancelWorkOrder(orderId));setSuccess('Topshiriq bekor qilindi. Band hajm va resurslar bo‘shatildi.');}catch(e){setActionError((e as Error).message);}finally{setBusyAction(null);}}
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
    if (!data) return;
    let evidence: string[];
    try {
      if (evidenceUploading) throw new Error("Fayl yuklanishini kuting.");
      evidence = executionEvidence(orderId, evidenceReceipt?.url ?? "", evidenceReceipt ? [evidenceReceipt.url] : []);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Foto yoki hujjat yuklang.");
      return;
    }
    setBusyAction("complete");
    setActionError(null);
    setSuccess(null);
    const payload: WorkOrderExecutionInput = {
      completedQuantity: actualQuantity,
      unit: data.exactQuantity.unit,
      laborEntries: data.executionResources.workers.flatMap((worker) => {
        const minutes = Number(workerMinutes[worker.id]);
        return [{ workerId: worker.id, workDate: worker.workDate, actualMinutes: minutes }];
      }),
      materialUsages: data.executionResources.materials.flatMap((material) => {
        const quantity = Number(materialQuantities[material.id]);
        return [{ materialReservationId: material.reservationId, quantity: String(quantity), usedAt: `${data.scheduledDate}T${data.scheduledStartAt?.slice(11,16) ?? "08:00"}:00+05:00` }];
      }),
      equipmentUsages: data.executionResources.equipment.flatMap((unit) => {
        const machineMinutes = Number(equipmentMinutes[unit.id]);
        return [{ equipmentReservationId: unit.reservationId, usageDate: unit.usageDate, actualMachineMinutes: machineMinutes }];
      }),
      evidence,
      note: completionNote.trim(),
    };
    try {
      setData(await api.completeWorkOrder(orderId, payload));
      setSuccess("Bajarilgan ish qaydi saqlandi va mustaqil tekshiruvga yuborildi.");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Ish yakunini saqlab bo‘lmadi.");
    } finally {
      setBusyAction(null);
    }
  }

  async function returnOrder(){
    if(verificationNote.trim().length<3){setActionError('Qaytarish sababini kiriting.');return;}
    setBusyAction('return');setActionError(null);
    try{setData(await api.returnWorkOrder(orderId,verificationNote.trim()));setSuccess('Qayd ustaga qaytarildi. Avvalgi nusxa tarixda saqlandi.');}
    catch(e){setActionError((e as Error).message);}finally{setBusyAction(null);}
  }
  async function verifyOrder() {
    if(!verificationNote.trim()){setActionError('Tekshiruv izohini kiriting.');return;}
    setBusyAction("verify");
    setActionError(null);
    setSuccess(null);
    try {
      setData(await api.verifyWorkOrder(orderId, verificationNote.trim()));
      setSuccess("Bajarilgan ish tekshirildi. Endi u oylik dalolatnomaga kiradi.");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Tekshiruvni yakunlab bo‘lmadi.");
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) return <LoadingState label="Topshiriq tafsilotlari yuklanmoqda" />;
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return null;
  const activeStep = currentStep(data);
  const canStartToday = data.scheduledDate === tashkentToday();
  const windowMinutes = Math.min(420, data.scheduledStartAt && data.scheduledEndAt ? Math.max(0,(Date.parse(data.scheduledEndAt)-Date.parse(data.scheduledStartAt))/60000) : 420);

  return (
    <div className="page-stack">
      <DefectNavigation/>
      <PageHeader
        title={`${data.number} · ${data.workName}`}
        description=""
        actions={<div className={styles.headerActions}>{data.state==="ASSIGNED"&&canReschedule?<Button variant="secondary" busy={busyAction==="cancel"} onClick={cancelOrder}>Boshlanmagan topshiriqni bekor qilish</Button>:null}<Link className="button button--secondary" href="/topshiriqlar"><ArrowLeft size={16} aria-hidden="true" /> Topshiriqlarga qaytish</Link>{(data.state === "ASSIGNED" || data.state === "PAUSED") && canManage && canStartToday ? <Button busy={busyAction === "start"} onClick={startOrder}><Play size={16} aria-hidden="true" /> {data.state === "PAUSED" ? "Ishni davom ettirish" : "Ishni boshlash"}</Button> : null}</div>}
      />

      {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
      {success ? <div className="success-banner" role="status"><CheckCircle2 size={18} aria-hidden="true" /> {success}</div> : null}

      {data.state === "VERIFIED" ? <div className="button-row"><Link className="button button--primary" href={`/tabel?month=${data.scheduledDate.slice(0,7)}`}>Tabelni ko‘rish</Link><Link className="button button--secondary" href={`/bajarilgan-ishlar?month=${data.scheduledDate.slice(0,7)}`}>Dalolatnomaga o‘tish</Link></div> : null}
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
        <Card className={styles.summaryCard}><span className={styles.summaryIcon}><PackageCheck size={20} aria-hidden="true" /></span><div><strong>{data.exactQuantity.value} {data.exactQuantity.unit}</strong><span>Rejadagi aniq hajm</span><small>{data.normReference}</small></div></Card>
        <Card className={styles.summaryCard}><span className={styles.summaryIcon}><Clock3 size={20} aria-hidden="true" /></span><div><strong>{data.startedAt ? formatDateTime(data.startedAt) : "Boshlanmagan"}</strong><span>Ishning boshlanishi</span><small>{data.startedByName ?? "Mas’ul kutilmoqda"}</small></div></Card>
      </div>

      {data.roadAccessDetails ? <Card>
        <div className={styles.sectionHeader}><div><h2>Yo‘l harakati</h2><p>{data.trafficOpenedAt ? `Harakat ${formatDateTime(data.trafficOpenedAt)} da tiklandi.` : "Topshiriq uchun belgilangan tartib"}</p></div><Badge tone={data.roadAccessDetails.roadAccess === "OPEN" || data.trafficOpenedAt ? "success" : "warning"}>{data.trafficOpenedAt || data.roadAccessDetails.roadAccess === "OPEN" ? "Yo‘l ochiq" : data.roadAccessDetails.roadAccess === "CLOSED" ? "To‘liq yopish" : "Qisman yopish"}</Badge></div>
        <dl className={styles.detailList}>
          <div><dt>Uchastka</dt><dd>{data.road.code} · {data.locationLabel}</dd></div>
          <div><dt>Vaqt</dt><dd>{data.scheduledStartAt && data.scheduledEndAt ? `${formatDateTime(data.scheduledStartAt)} — ${formatDateTime(data.scheduledEndAt)}` : formatDate(data.scheduledDate)}</dd></div>
          {data.roadAccessDetails.roadAccess !== "OPEN" ? <>
            <div><dt>Yo‘nalish</dt><dd>{data.roadAccessDetails.direction || "Ko‘rsatilmagan"}</dd></div>
            <div><dt>Tasma</dt><dd>{data.roadAccessDetails.roadAccess === "CLOSED" ? "Barcha tasmalar" : data.roadAccessDetails.laneLabel || "Ko‘rsatilmagan"}</dd></div>
          </> : null}
          {data.roadAccessDetails.permitReference ? <div><dt>Ruxsatnoma</dt><dd>{data.roadAccessDetails.permitReference}</dd></div> : null}
        </dl>
      </Card> : null}

      <div className={styles.twoColumn}>
        <div className={styles.stack}>
          {data.state === "IN_PROGRESS" && canManage ? (
            <form onSubmit={completeOrder}>
              <Card>
                <div className={styles.sectionHeader}><div><h2>Ishni yakunlash</h2><p>Bajarilgan hajm va haqiqiy sarflarni kiriting.</p></div><Badge tone="warning">Bajarilmoqda</Badge></div>
                <div className={styles.formGrid}>
                  <TextInput label={`Haqiqiy bajarilgan hajm, ${data.exactQuantity.unit}`} name="actualQuantity" type="number" inputMode="decimal" min="0.001" max={data.exactQuantity.value} step="any" required value={actualQuantity} onChange={(event) => setActualQuantity(event.target.value)} />
                  <ExecutionEvidenceUpload key={`${data.id}:${data.correctionHistory?.length ?? 0}`} orderId={data.id} disabled={busyAction !== null} onChange={setEvidenceReceipt} onUploadingChange={setEvidenceUploading} />
                </div>

                <div className={styles.resourceList}>
                  <div className={styles.sectionHeader}><div><h3><Users size={16} aria-hidden="true" /> Ishchilar</h3><p>Haqiqiy daqiqalar; qatnashmagan xodimga 0 kiriting.</p></div></div>
                  {data.executionResources.workers.map((worker) => <label className={styles.resourceRow} key={worker.id}><span><strong>{worker.fullName}</strong><small>{worker.positionName} · reja {worker.plannedMinutes} daqiqa</small></span><input className={styles.compactInput} type="number" min="0" max={windowMinutes} step="1" required aria-label={`${worker.fullName} ishlagan daqiqa`} value={workerMinutes[worker.id] ?? ""} onChange={(event) => setWorkerMinutes((current) => ({ ...current, [worker.id]: event.target.value }))} /></label>)}
                </div>

                <div className={styles.resourceList}>
                  <div className={styles.sectionHeader}><div><h3><PackageCheck size={16} aria-hidden="true" /> Materiallar</h3><p>Ombordan ishga haqiqatda sarflangan miqdor.</p></div></div>
                  {data.executionResources.materials.length ? data.executionResources.materials.map((material) => <label className={styles.resourceRow} key={material.id}><span><strong>{material.code} · {material.name}</strong><small>Reja {material.plannedQuantity} {material.unit}</small></span><input className={styles.compactInput} type="number" min="0" max={material.plannedQuantity} step="any" required aria-label={`${material.name} sarfi`} value={materialQuantities[material.id] ?? ""} onChange={(event) => setMaterialQuantities((current) => ({ ...current, [material.id]: event.target.value }))} /></label>) : <div className={styles.notice}>Bu ish uchun material rejalashtirilmagan.</div>}
                </div>

                <div className={styles.resourceList}>
                  <div className={styles.sectionHeader}><div><h3><Truck size={16} aria-hidden="true" /> Mashina va mexanizmlar</h3><p>Haqiqiy mashina-daqiqa; dalolatnomada mashina-soatga aylantiriladi.</p></div></div>
                  {data.executionResources.equipment.map((unit) => <label className={styles.resourceRow} key={unit.id}><span><strong>{unit.inventoryCode} · {unit.name}</strong><small>Reja {unit.plannedMachineMinutes} mashina-daqiqa</small></span><input className={styles.compactInput} type="number" min="0" max={windowMinutes} step="1" required aria-label={`${unit.name} mashina daqiqasi`} value={equipmentMinutes[unit.id] ?? ""} onChange={(event) => setEquipmentMinutes((current) => ({ ...current, [unit.id]: event.target.value }))} /></label>)}
                </div>

                <div className={styles.spanTwo}><TextArea label="Izoh (ixtiyoriy)" name="completionNote" value={completionNote} onChange={(event) => setCompletionNote(event.target.value)}  /></div>
                <div className={styles.actionBar}><p>Yakunlangan ish boshliqqa tasdiqlash uchun o‘tadi.</p><Button type="submit" busy={busyAction === "complete"} disabled={evidenceUploading || !evidenceReceipt}><FileCheck2 size={16} aria-hidden="true" /> Yakunlash va boshliqqa yuborish</Button></div>
              </Card>
            </form>
          ) : data.state === "ASSIGNED" ? (
            <Card>
              <div className={styles.notice}><Play size={18} aria-hidden="true" /><span>{!canManage ? <>Ishni yo‘l ustasi boshlaydi.</> : canStartToday ? <>Ishchi va material sarfini kiritish uchun avval topshiriqni <strong>ishga oling</strong>.</> : <>Topshiriq {formatDate(data.scheduledDate)} sanasiga biriktirilgan. Ishchilar va texnika bandlovini birga ko‘chirish uchun yangi sanani tanlang.</>}</span></div>
              {canReschedule ? (
                <details className="workflow-details"><summary>Sanani o‘zgartirish</summary><form className={styles.actionBar} onSubmit={rescheduleOrder}>
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
                </form></details>
              ) : null}
            </Card>
          ) : data.state === "PAUSED" ? <Card><div className={styles.notice}><Play size={18} aria-hidden="true" /><span>{canStartToday ? <>Ish vaqtincha to‘xtatilgan. Yuqoridagi tugma orqali uni <strong>davom ettiring</strong>.</> : <>Tanaffusdagi ish {formatDate(data.scheduledDate)} sanasiga tegishli. Tarixiy resurs qaydlarini o‘zgartirmasdan davom ettirish uchun mas’ul rejalashtiruvchiga murojaat qiling.</>}</span></div></Card> : data.state === "IN_PROGRESS" ? <Card><div className={styles.notice}><FileCheck2 size={18} aria-hidden="true" /><span>Haqiqiy sarflarni yo‘l ustasi kiritadi.</span></div></Card> : null}

          {data.workVariantId?<WorkGuides workVariantId={data.workVariantId} workName={data.workName} readOnly/>:null}
      <CompletionSummary order={data} />
          {data.correctionHistory?.length?<Card><details><summary>Tuzatishlar tarixi ({data.correctionHistory.length})</summary>{data.correctionHistory.map((h,i)=><div key={i}><strong>{h.returnedBy} · {formatDateTime(h.returnedAt)}</strong><p>{h.reason}</p><p>Avvalgi hajm: {h.completion.actualQuantity.value} {h.completion.actualQuantity.unit}. Ishchi vaqti: {h.completion.workerMinutes.reduce((n,w)=>n+w.minutes,0)} daqiqa.</p></div>)}</details></Card>:null}
        </div>

        <div className={styles.stack}>
          <Card>
            <div className={styles.sectionHeader}><div><h2>Topshiriq asosi</h2><p>IQN normasi, joy va mas’ul brigada.</p></div><MapPin size={20} aria-hidden="true" /></div>
            <dl className={styles.detailList}>
              <div><dt>Yo‘l</dt><dd>{data.road.code} · {data.road.name}</dd></div>
              <div><dt>Lokatsiya</dt><dd>{data.locationLabel}</dd></div>
              <div><dt>Brigada</dt><dd>{data.teamName}</dd></div>
              <div><dt>IQN asosi</dt><dd>{data.normReference}</dd></div>
            </dl>
          </Card>

          {data.completion?.state === "PENDING_VERIFICATION" ? (
            <Card>
              <div className={styles.sectionHeader}><div><h2>Bajarilgan ishni tasdiqlash</h2><p>Hajm, ishchi vaqti, ombor sarfi, texnika qaydi va dalilni solishtiring.</p></div><ShieldCheck size={20} aria-hidden="true" /></div>
              {data.completion.canVerify ? <><TextArea label="Tekshiruv izohi" name="verificationNote" required value={verificationNote} onChange={(event) => setVerificationNote(event.target.value)} /><div className={styles.actionBar}><p>Tasdiqlangach ish ushbu oyning dalolatnomasiga kiritilishi mumkin.</p><Button variant="secondary" busy={busyAction === "return"} onClick={returnOrder}>Tuzatishga qaytarish</Button><Button busy={busyAction === "verify"} onClick={verifyOrder}><ShieldCheck size={16} aria-hidden="true" /> Tasdiqlash va tabelga o‘tkazish</Button></div></> : <div className={styles.notice}>Bajarilgan ishni boshqa mas’ul tasdiqlaydi. Demoda boshliq roliga o‘ting.</div>}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
