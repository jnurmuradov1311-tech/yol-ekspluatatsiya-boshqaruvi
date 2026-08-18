"use client";

import { useCallback, useState, type FormEvent } from "react";
import {
  BadgeCheck,
  Banknote,
  CalendarClock,
  CircleDollarSign,
  Clock3,
  PackageCheck,
  Plus,
  Truck,
  Users,
} from "lucide-react";
import { useHasPermission } from "@/components/auth-provider";
import styles from "@/components/execution-finance.module.css";
import { useOperatingScope } from "@/components/scope-provider";
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, SelectInput, TableFrame, TextInput } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { CostRate, CostRateInput, CostRateKind, MonthlyWorkTimeNorm, ResourceRow } from "@/lib/api/types";
import { formatDate, formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";

const money = new Intl.NumberFormat("uz-UZ", { style: "currency", currency: "UZS", maximumFractionDigits: 0 });

const kindMeta: Record<CostRateKind, { label: string; basis: CostRate["rateBasis"]; unit: string; icon: typeof Users }> = {
  labor: { label: "Ishchi oyligi", basis: "monthly_salary", unit: "month", icon: Users },
  material: { label: "Material narxi", basis: "material_unit", unit: "", icon: PackageCheck },
  equipment: { label: "Mashina-soat", basis: "machine_hour", unit: "machine_hour", icon: Truck },
};

function replaceRate(items: CostRate[], rate: CostRate): CostRate[] {
  return items.some((item) => item.id === rate.id)
    ? items.map((item) => item.id === rate.id ? rate : item)
    : [rate, ...items];
}

function replaceNorm(items: MonthlyWorkTimeNorm[], norm: MonthlyWorkTimeNorm): MonthlyWorkTimeNorm[] {
  return items.some((item) => item.id === norm.id)
    ? items.map((item) => item.id === norm.id ? norm : item)
    : [norm, ...items];
}

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat("en", { year: "numeric", month: "2-digit", timeZone: "Asia/Tashkent" }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "2026";
  const month = parts.find((part) => part.type === "month")?.value ?? "08";
  return `${year}-${month}`;
}

function oneYearAfter(date: string): string {
  return `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;
}

export default function CostRatesPage() {
  const [month, setMonth] = useState(currentMonth);
  const [activeTab, setActiveTab] = useState<"rates" | "norms">("rates");
  const canManage = useHasPermission("costs.manage");
  const canReadResources = useHasPermission("resources.read");
  const loadData = useCallback(async () => {
    const [rates, norms] = await Promise.all([
      api.costRates(),
      api.monthlyWorkTimeNorms(month),
    ]);
    if (!canManage || !canReadResources) {
      return { rates: rates.items, norms: norms.items, workers: [], materials: [], equipment: [] };
    }
    const [workers, materials, equipment] = await Promise.all([
      api.resources("workers"),
      api.resources("materials"),
      api.resources("equipment"),
    ]);
    return { rates: rates.items, norms: norms.items, workers: workers.items, materials: materials.items, equipment: equipment.items };
  }, [canManage, canReadResources, month]);
  const { data, error, loading, reload, setData } = useApiResource(loadData, `${month}:${canManage}:${canReadResources}`);
  const canCreateRate = canManage && canReadResources;
  const { scope } = useOperatingScope();
  const [rateKind, setRateKind] = useState<CostRateKind>("labor");
  const [targetId, setTargetId] = useState("");
  const [pricingUnit, setPricingUnit] = useState(kindMeta.labor.unit);
  const [rateAmount, setRateAmount] = useState("");
  const [scheduleCode, setScheduleCode] = useState("ROAD_7H");
  const [bonusPercent, setBonusPercent] = useState("0");
  const [trafficPercent, setTrafficPercent] = useState("0");
  const [travelPercent, setTravelPercent] = useState("0");
  const [socialPercent, setSocialPercent] = useState("12");
  const [effectiveFrom, setEffectiveFrom] = useState(() => `${currentMonth()}-01`);
  const [effectiveUntil, setEffectiveUntil] = useState(() => oneYearAfter(`${currentMonth()}-01`));
  const [rateSource, setRateSource] = useState("");
  const [normScheduleCode, setNormScheduleCode] = useState("ROAD_7H");
  const [workingDays, setWorkingDays] = useState("22");
  const [normMinutes, setNormMinutes] = useState("9240");
  const [normSource, setNormSource] = useState("2026-yil ishlab chiqarish taqvimi");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const resources: Record<CostRateKind, ResourceRow[]> = {
    labor: data?.workers ?? [],
    material: data?.materials ?? [],
    equipment: data?.equipment ?? [],
  };
  const selectedTargetId = targetId || resources[rateKind][0]?.id || "";

  function changeRateKind(value: CostRateKind) {
    setRateKind(value);
    setTargetId(resources[value][0]?.id ?? "");
    setPricingUnit(resources[value][0]?.unit ?? kindMeta[value].unit);
    setScheduleCode(value === "labor" ? "ROAD_7H" : "");
  }

  function changeTarget(value: string) {
    setTargetId(value);
    if (rateKind === "material") {
      setPricingUnit(resources.material.find((resource) => resource.id === value)?.unit ?? "");
    }
  }

  async function createRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId("create-rate");
    setActionError(null);
    setSuccess(null);
    const meta = kindMeta[rateKind];
    const payload: CostRateInput = {
      divisionId: scope.id,
      rateKind,
      targetId: selectedTargetId,
      rateBasis: meta.basis,
      pricingUnit,
      rateAmountUzs: rateAmount,
      effectiveFrom,
      effectiveUntil,
      versionNo: rates.filter((item) => item.rateKind === rateKind && item.target.id === selectedTargetId).length + 1,
      sourceReference: rateSource.trim(),
      ...(rateKind === "labor" ? {
        scheduleCode,
        bonusRateBps: Math.round(Number(bonusPercent) * 100),
        trafficAllowanceRateBps: Math.round(Number(trafficPercent) * 100),
        travelAllowanceRateBps: Math.round(Number(travelPercent) * 100),
        socialContributionRateBps: Math.round(Number(socialPercent) * 100),
      } : {}),
    };
    try {
      const created = await api.createCostRate(payload);
      setData((current) => current ? { ...current, rates: replaceRate(current.rates, created) } : current);
      setRateAmount("");
      setRateSource("");
      setSuccess("Narxning yangi qoralama versiyasi yaratildi. Hisobda ishlatilishi uchun boshqa vakolatli xodim tasdiqlaydi.");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Narxni yaratib bo‘lmadi.");
    } finally {
      setBusyId(null);
    }
  }

  async function approveRate(id: string) {
    setBusyId(`approve-rate-${id}`);
    setActionError(null);
    setSuccess(null);
    try {
      const approved = await api.approveCostRate(id);
      setData((current) => current ? { ...current, rates: replaceRate(current.rates, approved) } : current);
      setSuccess("Narx tasdiqlandi va amal davridagi yangi dalolatnomalarda ishlatiladi.");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Narxni tasdiqlab bo‘lmadi.");
    } finally {
      setBusyId(null);
    }
  }

  async function createNorm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyId("create-norm");
    setActionError(null);
    setSuccess(null);
    try {
      const created = await api.createMonthlyWorkTimeNorm({
        divisionId: scope.id,
        workMonth: `${month}-01`,
        scheduleCode: normScheduleCode,
        workingDays: Number(workingDays),
        normMinutes: Number(normMinutes),
        versionNo: norms.filter((item) => item.workMonth === `${month}-01` && item.scheduleCode === normScheduleCode).length + 1,
        sourceReference: normSource.trim(),
      });
      setData((current) => current ? { ...current, norms: replaceNorm(current.norms, created) } : current);
      setSuccess("Oylik ish vaqti normasi qoralama holatda yaratildi.");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Vaqt normasini yaratib bo‘lmadi.");
    } finally {
      setBusyId(null);
    }
  }

  async function approveNorm(id: string) {
    setBusyId(`approve-norm-${id}`);
    setActionError(null);
    setSuccess(null);
    try {
      const approved = await api.approveMonthlyWorkTimeNorm(id);
      setData((current) => current ? { ...current, norms: replaceNorm(current.norms, approved) } : current);
      setSuccess("Oylik ish vaqti normasi tasdiqlandi.");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Vaqt normasini tasdiqlab bo‘lmadi.");
    } finally {
      setBusyId(null);
    }
  }

  const rates = data?.rates ?? [];
  const norms = data?.norms ?? [];
  const approvedRates = rates.filter((item) => item.state === "APPROVED").length;
  const draftRates = rates.length - approvedRates;

  return (
    <div className="page-stack">
      <PageHeader title="Narxlar va oylik vaqt normasi" description="Ishchilarning oylik stavkasi, material birlik narxi va mashina-soat tarifini versiyalab tasdiqlang." actions={<TextInput label="Ish davri" type="month" name="costMonth" value={month} onChange={(event) => setMonth(event.target.value)} />} />

      {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
      {success ? <div className="success-banner" role="status"><BadgeCheck size={18} aria-hidden="true" /> {success}</div> : null}

      <div className={styles.summaryGrid}>
        <Card className={styles.summaryCard}><span className={styles.summaryIcon}><CircleDollarSign size={20} aria-hidden="true" /></span><div><strong>{rates.length}</strong><span>Narx versiyasi</span><small>Barcha resurs turlari</small></div></Card>
        <Card className={styles.summaryCard}><span className={styles.summaryIcon}><BadgeCheck size={20} aria-hidden="true" /></span><div><strong>{approvedRates}</strong><span>Tasdiqlangan narx</span><small>Dalolatnomada ishlatiladi</small></div></Card>
        <Card className={styles.summaryCard}><span className={styles.summaryIcon}><Clock3 size={20} aria-hidden="true" /></span><div><strong>{norms.filter((item) => item.state === "APPROVED").length}</strong><span>Tasdiqlangan vaqt normasi</span><small>{month} oyi</small></div></Card>
        <Card className={styles.summaryCard}><span className={styles.summaryIcon}><CalendarClock size={20} aria-hidden="true" /></span><div><strong>{draftRates}</strong><span>Tasdiq kutilmoqda</span><small>Narx qoralamalari</small></div></Card>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Narx va vaqt normasi bo‘limlari">
        <button role="tab" aria-selected={activeTab === "rates"} onClick={() => setActiveTab("rates")}>Resurs narxlari</button>
        <button role="tab" aria-selected={activeTab === "norms"} onClick={() => setActiveTab("norms")}>Oylik vaqt normasi</button>
      </div>

      {loading ? <LoadingState label="Narxlar va vaqt normalari yuklanmoqda" /> : error ? <ErrorState error={error} retry={reload} /> : activeTab === "rates" ? (
        <div className={`${styles.twoColumn} ${!canCreateRate ? styles.singleColumn : ""}`.trim()}>
          {canCreateRate ? (
            <form onSubmit={createRate}>
              <Card>
                <div className={styles.sectionHeader}><div><h2>Yangi narx versiyasi</h2><p>Narx qoralama yaratiladi; tasdiqlanmaguncha hisobga kirmaydi.</p></div><Plus size={20} aria-hidden="true" /></div>
                <div className={styles.formGrid}>
                  <SelectInput label="Narx turi" name="rateKind" value={rateKind} onChange={(event) => changeRateKind(event.target.value as CostRateKind)}><option value="labor">Ishchi oyligi</option><option value="material">Material narxi</option><option value="equipment">Mashina-soat</option></SelectInput>
                  <SelectInput label="Resurs" name="targetId" required value={selectedTargetId} onChange={(event) => changeTarget(event.target.value)}>{resources[rateKind].map((resource) => <option value={resource.id} key={resource.id}>{resource.code ? `${resource.code} · ` : ""}{resource.name}</option>)}</SelectInput>
                  <TextInput label="Narx, so‘m" name="rateAmount" type="number" min="0.01" step="0.01" required value={rateAmount} onChange={(event) => setRateAmount(event.target.value)} />
                  <TextInput label="Narxlash birligi" name="pricingUnit" required value={pricingUnit} onChange={(event) => setPricingUnit(event.target.value)} hint={rateKind === "labor" ? "month" : rateKind === "equipment" ? "machine_hour" : "Materialning ombor birligi"} />
                  <TextInput label="Amal boshlanishi" name="effectiveFrom" type="date" required value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
                  <TextInput label="Amal tugashi" name="effectiveUntil" type="date" required value={effectiveUntil} onChange={(event) => setEffectiveUntil(event.target.value)} hint="Bu sana narx davriga kirmaydi." />
                  {rateKind === "labor" ? <><TextInput label="Ish grafigi kodi" name="scheduleCode" required value={scheduleCode} onChange={(event) => setScheduleCode(event.target.value)} /><TextInput label="Mukofot, %" name="bonusPercent" type="number" min="0" max="200" step="0.01" value={bonusPercent} onChange={(event) => setBonusPercent(event.target.value)} /><TextInput label="Yo‘l sharoiti ustamasi, %" name="trafficPercent" type="number" min="0" max="200" step="0.01" value={trafficPercent} onChange={(event) => setTrafficPercent(event.target.value)} /><TextInput label="Safar ustamasi, %" name="travelPercent" type="number" min="0" max="200" step="0.01" value={travelPercent} onChange={(event) => setTravelPercent(event.target.value)} /><TextInput label="Ijtimoiy ajratma, %" name="socialPercent" type="number" min="0" max="100" step="0.01" value={socialPercent} onChange={(event) => setSocialPercent(event.target.value)} /></> : null}
                  <div className={styles.spanTwo}><TextInput label="Narx asosi" name="rateSource" required value={rateSource} onChange={(event) => setRateSource(event.target.value)} hint="Shartnoma, shtat jadvali yoki tasdiqlangan kalkulyatsiya raqami." /></div>
                </div>
                <div className={styles.actionBar}><p>IQN faqat resurs miqdorini beradi. Pul narxlari ushbu alohida, tasdiqlangan reyestrdan olinadi.</p><Button type="submit" busy={busyId === "create-rate"}><Plus size={16} aria-hidden="true" /> Qoralama yaratish</Button></div>
              </Card>
            </form>
          ) : null}

          <Card>
            <div className={styles.sectionHeader}><div><h2>Narxlar reyestri</h2><p>Amal davri bo‘yicha versiyalangan tasdiqlangan va qoralama narxlar.</p></div><Banknote size={20} aria-hidden="true" /></div>
            {canManage && !canReadResources ? <div className={styles.notice}>Yangi narx yaratish uchun resurslar reyestrini ko‘rish (<strong>resources.read</strong>) vakolati ham kerak.</div> : null}
            <TableFrame label="Resurs narxlari">
              <table><thead><tr><th>Tur / Resurs</th><th>Narx</th><th>Amal davri</th><th>Asos</th><th>Holat</th><th>Amal</th></tr></thead><tbody>{rates.map((rate) => {
                const meta = kindMeta[rate.rateKind];
                const Icon = meta.icon;
                return <tr key={rate.id}><td><span className={styles.rateKind}><Icon size={15} aria-hidden="true" /> {meta.label}</span><strong>{rate.target.code ? `${rate.target.code} · ` : ""}{rate.target.name}</strong><small>v{rate.versionNo} · {rate.rateBasis}</small></td><td><strong>{money.format(Number(rate.rateAmountUzs))}</strong><small>1 {rate.pricingUnit} uchun</small></td><td>{formatDate(rate.effectiveFrom)}<small>{formatDate(rate.effectiveUntil)} gacha</small></td><td>{rate.sourceReference}</td><td><Badge tone={rate.state === "APPROVED" ? "success" : "warning"}>{rate.state === "APPROVED" ? "Tasdiqlangan" : "Qoralama"}</Badge></td><td>{rate.state === "DRAFT" ? rate.canApprove ? <Button variant="secondary" busy={busyId === `approve-rate-${rate.id}`} onClick={() => approveRate(rate.id)}><BadgeCheck size={15} aria-hidden="true" /> Tasdiqlash</Button> : <small>{rate.createdByMe ? "Siz yaratgansiz · mustaqil tasdiq kutilmoqda" : "Mustaqil tasdiq kutilmoqda"}</small> : <small>{formatDateTime(rate.approvedAt)}</small>}</td></tr>;
              })}</tbody></table>
            </TableFrame>
          </Card>
        </div>
      ) : (
        <div className={`${styles.twoColumn} ${!canManage ? styles.singleColumn : ""}`.trim()}>
          {canManage ? (
            <form onSubmit={createNorm}>
              <Card>
                <div className={styles.sectionHeader}><div><h2>Oylik vaqt normasi</h2><p>Ish haqini haqiqiy daqiqadan hisoblash uchun tasdiqlangan maxraj.</p></div><CalendarClock size={20} aria-hidden="true" /></div>
                <div className={styles.formGrid}>
                  <TextInput label="Oy" name="normMonth" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
                  <TextInput label="Ish grafigi kodi" name="normScheduleCode" required value={normScheduleCode} onChange={(event) => setNormScheduleCode(event.target.value)} />
                  <TextInput label="Ish kunlari" name="workingDays" type="number" min="1" max="31" required value={workingDays} onChange={(event) => setWorkingDays(event.target.value)} />
                  <TextInput label="Oylik norma, daqiqa" name="normMinutes" type="number" min="1" max="44640" required value={normMinutes} onChange={(event) => setNormMinutes(event.target.value)} hint={`${Math.round(Number(normMinutes || 0) / 60 * 10) / 10} soat`} />
                  <div className={styles.spanTwo}><TextInput label="Norma asosi" name="normSource" required value={normSource} onChange={(event) => setNormSource(event.target.value)} /></div>
                </div>
                <div className={styles.actionBar}><p>Har bir grafik va oy uchun faqat bitta tasdiqlangan versiya amal qiladi.</p><Button type="submit" busy={busyId === "create-norm"}><Plus size={16} aria-hidden="true" /> Qoralama yaratish</Button></div>
              </Card>
            </form>
          ) : null}

          <Card>
            <div className={styles.sectionHeader}><div><h2>Vaqt normalari reyestri</h2><p>Tanlangan oydagi ish grafiklari va hisoblash maxraji.</p></div><Clock3 size={20} aria-hidden="true" /></div>
            <TableFrame label="Oylik vaqt normalari">
              <table><thead><tr><th>Oy / Grafik</th><th>Ish kuni</th><th>Norma</th><th>Asos</th><th>Holat</th><th>Amal</th></tr></thead><tbody>{norms.map((norm) => <tr key={norm.id}><td><strong>{formatDate(norm.workMonth)}</strong><small>{norm.scheduleCode} · v{norm.versionNo}</small></td><td>{norm.workingDays} kun</td><td><strong>{norm.normMinutes} daqiqa</strong><small>{Math.round(norm.normMinutes / 60 * 10) / 10} soat</small></td><td>{norm.sourceReference}</td><td><Badge tone={norm.state === "APPROVED" ? "success" : "warning"}>{norm.state === "APPROVED" ? "Tasdiqlangan" : "Qoralama"}</Badge></td><td>{norm.state === "DRAFT" ? norm.canApprove ? <Button variant="secondary" busy={busyId === `approve-norm-${norm.id}`} onClick={() => approveNorm(norm.id)}><BadgeCheck size={15} aria-hidden="true" /> Tasdiqlash</Button> : <small>{norm.createdByMe ? "Siz yaratgansiz · mustaqil tasdiq kutilmoqda" : "Mustaqil tasdiq kutilmoqda"}</small> : <small>{formatDateTime(norm.approvedAt)}</small>}</td></tr>)}</tbody></table>
            </TableFrame>
          </Card>
        </div>
      )}
    </div>
  );
}
