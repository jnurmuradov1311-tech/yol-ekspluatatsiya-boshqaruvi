"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { Check, Copy, Download, ExternalLink, MapPin, ScanSearch, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth, useHasPermission } from "@/components/auth-provider";
import type { FindingState } from "@/lib/api/types";
import { formatChainage, formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, TableFrame, TextArea, TextInput } from "@/components/ui";

const stateTabs: Array<{ value: FindingState; label: string }> = [
  { value: "PENDING_REVIEW", label: "Ko‘rib chiqilmagan" },
  { value: "VERIFIED", label: "Tasdiqlangan" },
  { value: "REJECTED", label: "Rad etilgan" },
  { value: "DUPLICATE", label: "Takror yozuv" },
];

function stateBadge(state: FindingState) {
  const labels: Record<FindingState, { label: string; tone: "warning" | "success" | "danger" | "neutral" }> = {
    PENDING_REVIEW: { label: "Ko‘rib chiqilmagan", tone: "warning" },
    VERIFIED: { label: "Tasdiqlangan", tone: "success" },
    REJECTED: { label: "Rad etilgan", tone: "danger" },
    DUPLICATE: { label: "Takror yozuv", tone: "neutral" },
  };
  return <Badge tone={labels[state].tone}>{labels[state].label}</Badge>;
}

export default function FindingsPage() {
  const { user } = useAuth();
  const canExport = useHasPermission("reports.read");
  const canVerify = Boolean(user?.permissions.includes("system.all") || user?.permissions.includes("defects.verify"));
  const [filter, setFilter] = useState<FindingState>("PENDING_REVIEW");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [measuredValue, setMeasuredValue] = useState("");
  const [measuredUnit, setMeasuredUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const { data, error, loading, reload, setData } = useApiResource(() => api.findings(filter), `findings:${filter}`);
  const selected = useMemo(() => data?.items.find((item) => item.id === selectedId) ?? null, [data, selectedId]);

  async function decide(decision: "VERIFIED" | "REJECTED" | "DUPLICATE") {
    if (!selected) return;
    if (decision !== "VERIFIED" && !note.trim()) {
      setActionError("Rad etish yoki takror deb belgilash sababini yozing.");
      return;
    }
    if (decision === "VERIFIED" && (!measuredValue.trim() || !measuredUnit.trim() || Number(measuredValue) <= 0)) {
      setActionError("Tasdiqlash uchun aniq musbat ish hajmi va o‘lchov birligini kiriting.");
      return;
    }
    setSaving(true);
    setActionError("");
    try {
      await api.decideFinding(
        selected.id,
        decision,
        note.trim(),
        decision === "VERIFIED" ? { value: measuredValue.trim(), unit: measuredUnit.trim() } : undefined,
      );
      setData((current) => current ? { ...current, items: current.items.filter((item) => item.id !== selected.id), total: Math.max(0, current.total - 1) } : current);
      setSelectedId(null);
      setNote("");
      setMeasuredValue("");
      setMeasuredUnit("");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Qarorni saqlab bo‘lmadi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="D001 RoadVision AI topilmalari" description="D001 bo‘yicha avtomatik aniqlangan topilmalarni dalil bilan tekshiring. Faqat inson tasdiqlagan yozuv rejalashtirishga o‘tadi." actions={canExport ? <a className="button button--secondary" href="/api/v1/reports/roadvision-findings.xlsx" download><Download size={16} aria-hidden="true" /> Excel yuklash</a> : null} />
      <div className="context-strip"><div><span>Yo‘l</span><strong>D001</strong></div><div><span>To‘liq uzunligi</span><strong>0+000 — 67+000</strong></div><div><span>Jarayon</span><strong>Inson qarori majburiy</strong></div></div>
      <div className="tabs" role="tablist" aria-label="Nuqson holati">
        {stateTabs.map((tab) => <button key={tab.value} role="tab" aria-selected={filter === tab.value} onClick={() => { setFilter(tab.value); setSelectedId(null); setMeasuredValue(""); setMeasuredUnit(""); }}>{tab.label}</button>)}
      </div>
      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? (
        data.items.length ? (
          <Card>
            <TableFrame label="RoadVision yozuvlari">
              <table>
                <thead><tr><th>Manba yozuvi</th><th>Yo‘l va joy</th><th>Aniqlangan belgi</th><th>Kuzatilgan vaqt</th><th>Holat</th><th><span className="sr-only">Amal</span></th></tr></thead>
                <tbody>{data.items.map((finding) => <tr key={finding.id}><td><strong>{finding.vendorReference}</strong><small>Qabul: {formatDateTime(finding.receivedAt)}</small></td><td><strong>{finding.road.code}</strong><small>{finding.road.name}</small><small>{formatChainage(finding.chainageStartM)}{finding.chainageEndM ? ` — ${formatChainage(finding.chainageEndM)}` : ""}{finding.laneLabel ? ` · ${finding.laneLabel}` : ""}</small></td><td><strong>{finding.attributeName}</strong>{finding.measuredQuantity ? <small>{finding.measuredQuantity.value} {finding.measuredQuantity.unit}</small> : <small>O‘lchov kiritilmagan</small>}</td><td>{formatDateTime(finding.observedAt)}</td><td>{stateBadge(finding.state)}</td><td><Button variant="secondary" onClick={() => { setSelectedId(finding.id); setNote(finding.reviewerNote ?? ""); setMeasuredValue(finding.measuredQuantity?.value ?? ""); setMeasuredUnit(finding.measuredQuantity?.unit ?? ""); setActionError(""); }}>Ko‘rish</Button></td></tr>)}</tbody>
              </table>
            </TableFrame>
          </Card>
        ) : <EmptyState title="Bu holatda yozuv yo‘q" detail="RoadVision oqimidan kelgan yangi yozuvlar avtomatik shu ro‘yxatda paydo bo‘ladi." />
      ) : null}

      {selected ? (
        <div className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="review-title">
          <button className="drawer-scrim" aria-label="Ko‘rib chiqishni yopish" onClick={() => setSelectedId(null)} />
          <section className="drawer">
            <header><div><p className="eyebrow">{selected.vendorReference}</p><h2 id="review-title">RoadVision dalilini ko‘rib chiqish</h2></div><button className="icon-button" aria-label="Yopish" onClick={() => setSelectedId(null)}><X aria-hidden="true" /></button></header>
            <div className="evidence-frame">
              {selected.evidenceUrl ? selected.evidenceMediaType === "video/mp4" ? (
                <video controls preload="metadata" aria-label={`${selected.road.code} yo‘lining ${formatChainage(selected.chainageStartM)} qismidagi video dalil`}>
                  <source src={selected.evidenceUrl} type="video/mp4" />
                  Brauzeringiz video dalilni ko‘rsata olmaydi.
                </video>
              ) : <Image src={selected.evidenceUrl} width={960} height={540} sizes="(max-width: 720px) 100vw, 620px" alt={`${selected.road.code} yo‘lining ${formatChainage(selected.chainageStartM)} qismidagi kuzatuv dalili`} unoptimized /> : <div className="evidence-empty"><ScanSearch aria-hidden="true" /><p>Dalil fayli biriktirilmagan.</p></div>}
            </div>
            <dl className="detail-grid"><div><dt>Aniqlangan belgi</dt><dd>{selected.attributeName}</dd></div><div><dt>Yo‘l bo‘limi</dt><dd>{selected.division.name}</dd></div><div><dt>Yo‘l</dt><dd>{selected.road.code} · {selected.road.name}</dd></div><div><dt>Joy</dt><dd><MapPin aria-hidden="true" size={16} /> {formatChainage(selected.chainageStartM)}{selected.chainageEndM ? ` — ${formatChainage(selected.chainageEndM)}` : ""}</dd></div><div><dt>O‘lchov</dt><dd>{selected.measuredQuantity ? `${selected.measuredQuantity.value} ${selected.measuredQuantity.unit}` : "Kiritilmagan"}</dd></div><div><dt>Kuzatuv vaqti</dt><dd>{formatDateTime(selected.observedAt)}</dd></div></dl>
            {selected.evidenceUrl ? <a className="text-link" href={selected.evidenceUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden="true" /> Dalilni alohida ochish</a> : null}
            {selected.state === "PENDING_REVIEW" && canVerify ? (
              <div className="review-actions">
                <div className="date-fields">
                  <TextInput label="Aniq ish hajmi" name="measuredValue" type="number" min="0" step="any" inputMode="decimal" value={measuredValue} onChange={(event) => setMeasuredValue(event.target.value)} hint="RoadVision dalilini joyida tekshirib, natural birlikda kiriting." />
                  <TextInput label="O‘lchov birligi" name="measuredUnit" maxLength={30} value={measuredUnit} onChange={(event) => setMeasuredUnit(event.target.value)} placeholder="masalan, m² yoki dona" />
                </div>
                <TextArea label="Ko‘rib chiqish izohi" name="reviewNote" rows={3} value={note} onChange={(event) => setNote(event.target.value)} hint="Rad etish yoki takror deb belgilashda sabab majburiy." />
                {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
                <div className="button-row"><Button busy={saving} onClick={() => decide("VERIFIED")}><Check size={17} aria-hidden="true" /> Tasdiqlash</Button><Button busy={saving} variant="secondary" onClick={() => decide("DUPLICATE")}><Copy size={17} aria-hidden="true" /> Takror yozuv</Button><Button busy={saving} variant="danger" onClick={() => decide("REJECTED")}><X size={17} aria-hidden="true" /> Rad etish</Button></div>
              </div>
            ) : <div className="decision-summary">{stateBadge(selected.state)}<p>{selected.state === "PENDING_REVIEW" ? "Bu topilma bo‘yicha qaror berish vakolatingiz yo‘q." : selected.reviewerNote ?? "Qaror izohi kiritilmagan."}</p></div>}
          </section>
        </div>
      ) : null}
    </div>
  );
}
