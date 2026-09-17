"use client";
import { MonthNavigation } from "@/components/month-navigation";
import { useReportMonth } from "@/lib/use-report-month";

import { ExcelDownload } from "@/components/excel-download";

import { useCallback, useState } from "react";
import {
  BadgeCheck,
  Calculator,
  Download,
  FileCheck2,
  FileSpreadsheet,
  PackageCheck,
  Send,
  Truck,
  Users,
} from "lucide-react";
import { useHasPermission } from "@/components/auth-provider";
import styles from "@/components/execution-finance.module.css";
import { useOperatingScope } from "@/components/scope-provider";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, TextInput, TableFrame } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { MonthlyCompletionAct, MonthlyCompletionActState, Paged } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";

const actStates: Record<MonthlyCompletionActState, { label: string; tone: "neutral" | "warning" | "success" }> = {
  DRAFT: { label: "Qoralama", tone: "neutral" },
  SUBMITTED: { label: "Taqdim etilgan", tone: "warning" },
  APPROVED: { label: "Tasdiqlangan", tone: "success" },
};

const money = new Intl.NumberFormat("uz-UZ", { style: "currency", currency: "UZS", maximumFractionDigits: 0 });
const hours = new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 2 });

function formatMoney(value: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? money.format(numeric) : value;
}

function formatHours(minutes: string): string {
  const numeric = Number(minutes);
  if (!Number.isFinite(numeric)) return minutes;

  return hours.format(numeric / 60);
}

function monthLabel(value: string): string {
  const parsed = new Date(`${value.slice(0, 7)}-01T00:00:00+05:00`);
  return new Intl.DateTimeFormat("uz-UZ", { year: "numeric", month: "long", timeZone: "Asia/Tashkent" }).format(parsed);
}

function replaceAct(page: Paged<MonthlyCompletionAct> | null, act: MonthlyCompletionAct): Paged<MonthlyCompletionAct> {
  const current = page?.items ?? [];
  const exists = current.some((item) => item.id === act.id);
  const items = exists ? current.map((item) => item.id === act.id ? act : item) : [act, ...current];
  return { items, page: 1, pageSize: Math.max(items.length, 1), total: items.length };
}

function aggregateF2(items:MonthlyCompletionAct["items"]) {
  const rows=new Map<string,{key:string;name:string;norm:string;unit:string;quantity:number;normHours:number|null}>();
  for(const item of items){const basis=Number(item.iqnLaborNorm?.basisQuantity.value??1);const key=[item.workName,item.normReference,item.completedQuantity.unit,basis,item.iqnLaborNorm?.minutesPerBasis??""].join("|");const row=rows.get(key);const quantity=Number(item.completedQuantity.value)/basis;if(row)row.quantity+=quantity;else rows.set(key,{key,name:item.workName,norm:item.normReference,unit:`${basis===1?"":basis+" "}${item.completedQuantity.unit}`,quantity,normHours:item.iqnLaborNorm?Number(item.iqnLaborNorm.minutesPerBasis)/60:null});}return [...rows.values()];
}

export default function MonthlyCompletionActsPage() {
  const [month, setMonth] = useReportMonth();
  return <MonthlyActsWorkspace key={month} month={month} setMonth={setMonth} />;
}
function MonthlyActsWorkspace({month,setMonth}:{month:string;setMonth:(value:string)=>void}) {
  const months = useApiResource(api.reportMonths, "act-months");
  const loadActs = useCallback(async () => {
    const summaries = await api.monthlyCompletionActs(`${month}-01`);
    const items = await Promise.all(summaries.items.map((act) => api.monthlyCompletionAct(act.id)));
    return { ...summaries, items };
  }, [month]);
  const { data, error, loading, reload, setData } = useApiResource(loadActs, month);
  const canManage = useHasPermission("costs.manage");
  const { scope } = useOperatingScope();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function generateAct() {
    setBusyId("generate");
    setActionError(null);
    setSuccess(null);
    try {
      const act = await api.generateMonthlyCompletionAct(scope.id, `${month}-01`);
      setData((current) => replaceAct(current, act));
      setSuccess(`${act.actNumber} tekshirilgan ishlar va tasdiqlangan narxlar asosida hisoblandi.`);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Dalolatnomani shakllantirib bo‘lmadi.");
    } finally {
      setBusyId(null);
    }
  }

  async function changeAct(id: string, action: "submit" | "approve") {
    setBusyId(`${action}-${id}`);
    setActionError(null);
    setSuccess(null);
    try {
      const act = action === "submit"
        ? await api.submitMonthlyCompletionAct(id)
        : await api.approveMonthlyCompletionAct(id);
      setData((current) => replaceAct(current, act));
      setSuccess(action === "submit" ? "Dalolatnoma tasdiqlovchiga taqdim etildi." : "Dalolatnoma tasdiqlandi va Excel nusxasi yakuniy holatga o‘tdi.");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Amalni bajarib bo‘lmadi.");
    } finally {
      setBusyId(null);
    }
  }

  const acts = data?.items ?? [];
  const monthlyTotal = acts.reduce((sum, act) => sum + Number(act.totalAmountUzs), 0);
  const workCount = acts.reduce((sum, act) => sum + act.itemCount, 0);
  const approvedCount = acts.filter((act) => act.state === "APPROVED").length;

  return (
    <div className="page-stack"><MonthNavigation month={month} />
      <PageHeader
        title="Oylik dalolatnoma"
        description="Tasdiqlangan ishlar va ularning xarajatlari."
        actions={<div className={styles.toolbar}><TextInput label="Hisobot oyi" type="month" name="actMonth" disabled={Boolean(busyId)} value={month} onChange={(event) => setMonth(event.target.value)} />{canManage ? <Button disabled={Boolean(busyId)} busy={busyId === "generate"} onClick={generateAct}><Calculator size={16} aria-hidden="true" /> Dalolatnomani shakllantirish</Button> : null}</div>}
      />

      {months.data?.items.length ? <p className="available-months">Bajarilgan ish bor: {months.data.items.map((item) => <button key={item.period} disabled={Boolean(busyId)} onClick={() => { setMonth(item.period); setActionError(null); setSuccess(null); }}>{item.period} ({item.count} ta)</button>)}</p> : null}
      {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
      {success ? <div className="success-banner" role="status"><BadgeCheck size={18} aria-hidden="true" /> {success}</div> : null}

      <div className={styles.summaryGrid}>
        <Card className={styles.summaryCard}><span className={styles.summaryIcon}><FileCheck2 size={20} aria-hidden="true" /></span><div><strong>{workCount}</strong><span>Dalolatnomadagi ish</span><small>{monthLabel(month)}</small></div></Card>
        <Card className={styles.summaryCard}><span className={styles.summaryIcon}><Calculator size={20} aria-hidden="true" /></span><div><strong>{formatMoney(String(monthlyTotal))}</strong><span>Bir oylik mablag‘</span><small>Ish haqi, ijtimoiy ajratma, material va texnika</small></div></Card>
        <Card className={styles.summaryCard}><span className={styles.summaryIcon}><FileSpreadsheet size={20} aria-hidden="true" /></span><div><strong>{acts.length}</strong><span>Shakllangan dalolatnoma</span><small>Tanlangan oy doirasida</small></div></Card>
        <Card className={styles.summaryCard}><span className={styles.summaryIcon}><BadgeCheck size={20} aria-hidden="true" /></span><div><strong>{approvedCount}</strong><span>Tasdiqlangan</span><small>Yakuniy Excelga tayyor</small></div></Card>
      </div>

      {loading ? <LoadingState label="Oylik dalolatnomalar yuklanmoqda" /> : error ? <ErrorState error={error} retry={reload} /> : acts.length ? acts.map((act) => {
        const state = actStates[act.state];
        return (
          <Card className={styles.actCard} key={act.id}>
            <div className={styles.actHeading}>
              <div><h2>{act.actNumber} · {monthLabel(act.actMonth)}</h2><p>{act.divisionName} · {act.roadLabel} · {formatDateTime(act.createdAt)} da shakllangan</p></div>
              <Badge tone={state.tone}>{state.label}</Badge>
            </div>

            <div className={styles.costGrid}>
              <div className={styles.costCell}><span>Ish haqi</span><strong>{formatMoney(act.laborAmountUzs)}</strong></div>
              <div className={styles.costCell}><span>Ijtimoiy ajratma</span><strong>{formatMoney(act.socialAmountUzs)}</strong></div>
              <div className={styles.costCell}><span>Materiallar</span><strong>{formatMoney(act.materialAmountUzs)}</strong></div>
              <div className={styles.costCell}><span>Mashina-mexanizm</span><strong>{formatMoney(act.equipmentAmountUzs)}</strong></div>
              <div className={`${styles.costCell} ${styles.costTotal}`}><span>Dalolatnoma jami</span><strong>{formatMoney(act.totalAmountUzs)}</strong></div>
            </div>

            <h3>Ф2-Сақлаш</h3>
            <TableFrame label={`${act.actNumber} Ф2-Сақлаш`}><table><thead><tr><th>№</th><th>Bajarilgan ish</th><th>Asos</th><th>O‘lchov birligi</th><th>Miqdor</th><th>Mehnat me’yori, soat</th><th>Jami me’yoriy soat</th></tr></thead><tbody>{aggregateF2(act.items).map((item,index) => <tr key={item.key}><td>{index+1}</td><td>{item.name}</td><td>{item.norm}</td><td>{item.unit}</td><td>{item.quantity.toLocaleString("uz-UZ",{maximumFractionDigits:6})}</td><td>{item.normHours===null ? "—" : item.normHours.toLocaleString("uz-UZ",{maximumFractionDigits:6})}</td><td>{item.normHours===null ? "—" : (item.quantity*item.normHours).toLocaleString("uz-UZ",{maximumFractionDigits:6})}</td></tr>)}</tbody></table></TableFrame>
            <details className="workflow-details"><summary>Topshiriqlar va xarajatlar</summary><TableFrame label="Topshiriq xarajatlari"><table><thead><tr><th>Topshiriq</th><th>Ish haqi</th><th>Ijtimoiy ajratma</th><th>Material</th><th>Texnika</th><th>Jami</th></tr></thead><tbody>{act.items.map(item=><tr key={item.id}><td>{item.orderNumber}</td><td>{formatMoney(item.laborAmountUzs)}</td><td>{formatMoney(item.socialAmountUzs)}</td><td>{formatMoney(item.materialAmountUzs)}</td><td>{formatMoney(item.equipmentAmountUzs)}</td><td>{formatMoney(item.totalAmountUzs)}</td></tr>)}</tbody></table></TableFrame></details>

            <div className={styles.actionBar}>
              <div className={styles.approvalMeta}>
                <span>{act.itemCount} ta tekshirilgan ish</span>
                {act.createdByMe ? <span>Siz shakllantirgansiz</span> : null}
                {act.submittedByMe ? <span>Siz taqdim etgansiz</span> : null}
                {act.submittedAt ? <span>Taqdim: {formatDateTime(act.submittedAt)}</span> : null}
                {act.approvedAt ? <span>Tasdiq: {formatDateTime(act.approvedAt)}</span> : null}
              </div>
              <div className={styles.headerActions}>
                <ExcelDownload id={act.id} kind="act" />
                {act.canSubmit ? <Button disabled={Boolean(busyId)} busy={busyId === `submit-${act.id}`} onClick={() => changeAct(act.id, "submit")}><Send size={16} aria-hidden="true" /> Taqdim etish</Button> : null}
                {act.canApprove ? <Button disabled={Boolean(busyId)} busy={busyId === `approve-${act.id}`} onClick={() => changeAct(act.id, "approve")}><BadgeCheck size={16} aria-hidden="true" /> Tasdiqlash</Button> : null}
                {act.state === "DRAFT" && !act.canSubmit ? <small>Taqdim etish vakolati mavjud emas.</small> : null}
                {act.state === "SUBMITTED" && !act.canApprove ? <small>{act.createdByMe || act.submittedByMe ? "Mustaqil tasdiqlovchi kutilmoqda." : "Tasdiqlash vakolati mavjud emas."}</small> : null}
              </div>
            </div>
          </Card>
        );
      }) : <EmptyState title="Dalolatnoma hali shakllanmagan" detail="Avval topshiriqlardagi bajarilgan ishlar tekshiriladi, so‘ng tanlangan oy uchun dalolatnoma yaratiladi." action={canManage ? <Button disabled={Boolean(busyId)} busy={busyId==="generate"} onClick={generateAct}><Calculator size={16} aria-hidden="true" /> Shakllantirish</Button> : undefined} />}

      <details className="workflow-details"><summary>Hisoblash tartibi</summary><Card>
        <div className={styles.summaryGrid}>
          <div className={styles.notice}><Users size={18} aria-hidden="true" /><span><strong>Ish haqi</strong><br />Oylik maosh × haqiqiy daqiqa ÷ tasdiqlangan oylik norma, ustama va ijtimoiy ajratmalar bilan.</span></div>
          <div className={styles.notice}><PackageCheck size={18} aria-hidden="true" /><span><strong>Material</strong><br />Tasdiqlangan birlik narxi × ombordan tasdiqlangan haqiqiy sarf.</span></div>
          <div className={styles.notice}><Truck size={18} aria-hidden="true" /><span><strong>Mashina-mexanizm</strong><br />Mashina-soat narxi × haqiqiy mashina-daqiqa ÷ 60.</span></div>
          <div className={styles.notice}><FileSpreadsheet size={18} aria-hidden="true" /><span><strong>Excel</strong><br />Dalolatnoma, ish haqi, tabel, materiallar, mashina-mexanizm va umumiy xarajat varaqlari.</span></div>
        </div>
      </Card></details>
    </div>
  );
}
