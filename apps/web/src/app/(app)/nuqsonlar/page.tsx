"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Download, ExternalLink, Images, Layers3, MapPin, ScanSearch, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth, useHasPermission } from "@/components/auth-provider";
import type { FindingState } from "@/lib/api/types";
import { formatChainage, formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, TableFrame, TextArea, TextInput } from "@/components/ui";
import { useOperatingScope } from "@/components/scope-provider";

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
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [measuredValue, setMeasuredValue] = useState("");
  const [measuredUnit, setMeasuredUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const drawerRef = useRef<HTMLElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { data, error, loading, reload, setData } = useApiResource(() => api.findings(filter), `findings:${filter}`);
  const selected = useMemo(() => data?.items.find((item) => item.id === selectedId) ?? null, [data, selectedId]);
  const { scope } = useOperatingScope();
  const groups = useMemo(() => {
    const byName = new Map<string, NonNullable<typeof data>["items"]>();
    for (const finding of data?.items ?? []) byName.set(finding.attributeName, [...(byName.get(finding.attributeName) ?? []), finding]);
    return [...byName.entries()].map(([name, items]) => {
      const measured = items.flatMap((item) => item.measuredQuantity ? [item.measuredQuantity] : []);
      const units = new Set(measured.map((quantity) => quantity.unit));
      const canAggregate = measured.length === items.length && units.size === 1;
      return {
        name,
        items,
        count: items.length,
        quantity: canAggregate
          ? Math.round(measured.reduce((sum, quantity) => sum + Number(quantity.value), 0) * 100) / 100
          : null,
        unit: canAggregate ? measured[0]?.unit ?? null : null,
        latest: items.map((item) => item.observedAt).sort().at(-1) ?? "",
        roads: new Set(items.map((item) => item.road.code)).size,
      };
    });
  }, [data]);
  const visibleItems = selectedGroup ? data?.items.filter((item) => item.attributeName === selectedGroup) ?? [] : [];

  function openFinding(id: string, trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    const finding = data?.items.find((item) => item.id === id);
    setSelectedId(id);
    setNote(finding?.reviewerNote ?? "");
    setMeasuredValue(finding?.measuredQuantity?.value ?? "");
    setMeasuredUnit(finding?.measuredQuantity?.unit ?? "");
    setActionError("");
  }

  function closeFinding() {
    setSelectedId(null);
  }

  useEffect(() => {
    if (!selectedId) return;
    const returnTarget = returnFocusRef.current;
    window.requestAnimationFrame(() => drawerCloseRef.current?.focus());
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedId(null);
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
  }, [selectedId]);

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
      closeFinding();
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
      <PageHeader title="RoadVision AI topilmalari" description="Avtomatik topilmalar avval nuqson turi bo‘yicha jamlanadi, keyin har bir yozuv dalillari bilan inson tomonidan tekshiriladi." actions={canExport ? <a className="button button--secondary" href="/api/v1/reports/roadvision-findings.xlsx" download><Download size={16} aria-hidden="true" /> Excel yuklash</a> : null} />
      <div className="scope-meta"><span><strong>Qamrov</strong>{scope.shortName}</span><span><strong>Yo‘l va kesim</strong>{scope.roadLabel}</span><span><strong>Qaror</strong>Inson tasdig‘i majburiy</span></div>
      <div className="tabs" role="tablist" aria-label="Nuqson holati">
        {stateTabs.map((tab) => <button key={tab.value} role="tab" aria-selected={filter === tab.value} onClick={() => { setFilter(tab.value); setSelectedGroup(null); closeFinding(); setMeasuredValue(""); setMeasuredUnit(""); }}>{tab.label}</button>)}
      </div>
      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? (
        data.items.length ? (
          selectedGroup ? <>
            <div className="drilldown-heading"><Button variant="ghost" onClick={() => setSelectedGroup(null)}><ArrowLeft size={17} /> Jamlanmaga qaytish</Button><div><span>Nuqson turi</span><strong>{selectedGroup}</strong><small>{visibleItems.length} ta individual topilma</small></div></div>
            <Card className="data-table-card"><TableFrame label={`${selectedGroup} topilmalari`}><table><thead><tr><th>ID / topilma</th><th>Yo‘l / manzil</th><th>Defekt / hajm</th><th>Aniqlangan vaqt</th><th>Holat</th><th>Amallar</th></tr></thead><tbody>{visibleItems.map((finding) => <tr key={finding.id}><td><span className="finding-identity"><i><Images aria-hidden="true" /></i><span><strong>{finding.vendorReference}</strong><small>RoadVision topilmasi</small></span></span></td><td><strong>{finding.road.code}</strong><small>{finding.road.name}</small><small>{formatChainage(finding.chainageStartM)}{finding.chainageEndM ? ` — ${formatChainage(finding.chainageEndM)}` : ""}</small></td><td><strong>{finding.attributeName}</strong>{finding.measuredQuantity ? <small>{finding.measuredQuantity.value} {finding.measuredQuantity.unit}</small> : <small>O‘lchov kiritilmagan</small>}</td><td>{formatDateTime(finding.observedAt)}</td><td>{stateBadge(finding.state)}</td><td><Button variant="secondary" onClick={(event) => openFinding(finding.id, event.currentTarget)}>Ko‘rib chiqish</Button></td></tr>)}</tbody></table></TableFrame><footer className="table-footer"><span>Jami: {visibleItems.length} ta topilma</span><span>1 / 1 sahifa</span></footer></Card>
          </> : <div className="finding-groups">{groups.map((group) => <Card className="finding-group-card" key={group.name}><span className="finding-group-icon"><Layers3 aria-hidden="true" /></span><div className="finding-group-main"><strong>{group.name}</strong><small>{group.roads} ta yo‘l kesimida · so‘nggi: {formatDateTime(group.latest)}</small></div><dl><div><dt>Topilmalar</dt><dd>{group.count}</dd></div><div><dt>Jami hajm</dt><dd>{group.quantity === null ? "—" : `${group.quantity} ${group.unit}`}</dd></div><div><dt>Holat</dt><dd>{stateBadge(filter)}</dd></div></dl><Button variant="secondary" onClick={() => setSelectedGroup(group.name)}>Batafsil <ExternalLink size={15} /></Button></Card>)}</div>
        ) : <EmptyState title="Bu holatda yozuv yo‘q" detail="RoadVision oqimidan kelgan yangi yozuvlar avtomatik shu ro‘yxatda paydo bo‘ladi." />
      ) : null}

      {selected ? (
        <div className="drawer-layer" role="dialog" aria-modal="true" aria-labelledby="review-title">
          <button className="drawer-scrim" aria-label="Ko‘rib chiqishni yopish" onClick={closeFinding} />
          <section className="drawer" ref={drawerRef}>
            <header><div><p className="eyebrow">{selected.vendorReference}</p><h2 id="review-title">RoadVision dalilini ko‘rib chiqish</h2></div><button ref={drawerCloseRef} className="icon-button" aria-label="Yopish" onClick={closeFinding}><X aria-hidden="true" /></button></header>
            {selected.evidence.length ? <div className="evidence-gallery" aria-label={`${selected.evidence.length} ta dalil`}>
              {selected.evidence.map((media) => <article className="evidence-item" key={`${media.index}-${media.sha256}`}>
                <div className="evidence-frame">
                  {media.contentType === "video/mp4" ? (
                    <video controls preload="metadata" aria-label={`${selected.road.code} yo‘lining ${formatChainage(selected.chainageStartM)} qismidagi ${media.index + 1}-video dalil`}>
                      <source src={media.url} type="video/mp4" />
                      Brauzeringiz video dalilni ko‘rsata olmaydi.
                    </video>
                  ) : <Image src={media.url} width={960} height={540} sizes="(max-width: 720px) 100vw, 620px" alt={`${selected.road.code} yo‘lining ${formatChainage(selected.chainageStartM)} qismidagi ${media.index + 1}-kuzatuv dalili`} unoptimized />}
                </div>
                <footer><span>{media.index + 1}-dalil · {formatDateTime(media.capturedAt)}</span><a className="text-link" href={media.url} target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden="true" /> Alohida ochish</a></footer>
              </article>)}
            </div> : <div className="evidence-frame"><div className="evidence-empty"><ScanSearch aria-hidden="true" /><p>Dalil fayli biriktirilmagan.</p></div></div>}
            <dl className="detail-grid"><div><dt>Aniqlangan belgi</dt><dd>{selected.attributeName}</dd></div><div><dt>Yo‘l bo‘limi</dt><dd>{selected.division.name}</dd></div><div><dt>Yo‘l</dt><dd>{selected.road.code} · {selected.road.name}</dd></div><div><dt>Joy</dt><dd><MapPin aria-hidden="true" size={16} /> {formatChainage(selected.chainageStartM)}{selected.chainageEndM ? ` — ${formatChainage(selected.chainageEndM)}` : ""}</dd></div><div><dt>O‘lchov</dt><dd>{selected.measuredQuantity ? `${selected.measuredQuantity.value} ${selected.measuredQuantity.unit}` : "Kiritilmagan"}</dd></div><div><dt>Kuzatuv vaqti</dt><dd>{formatDateTime(selected.observedAt)}</dd></div></dl>
            {selected.state === "PENDING_REVIEW" && canVerify ? (
              <div className="review-actions">
                <div className="date-fields">
                  <TextInput label="Aniq ish hajmi" name="measuredValue" type="number" min="0.000001" step="any" inputMode="decimal" value={measuredValue} onChange={(event) => setMeasuredValue(event.target.value)} hint="RoadVision dalilini joyida tekshirib, musbat natural birlikda kiriting." />
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
