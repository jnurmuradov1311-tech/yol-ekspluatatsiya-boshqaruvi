"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { useHasPermission } from "@/components/auth-provider";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, TableFrame } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { ConfirmedDefectState } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";

const states: Array<{ value: ConfirmedDefectState; label: string }> = [
  { value: "OPEN", label: "Ochiq" },
  { value: "PLANNED", label: "Rejaga kiritilgan" },
  { value: "IN_PROGRESS", label: "Bajarilmoqda" },
  { value: "RESOLVED", label: "Bartaraf etilgan" },
  { value: "CLOSED", label: "Yopilgan" },
  { value: "CANCELLED", label: "Bekor qilingan" },
];

function stateBadge(state: ConfirmedDefectState) {
  const value = states.find((item) => item.value === state);
  const tone = state === "OPEN" ? "warning" : state === "IN_PROGRESS" || state === "PLANNED" ? "info" : state === "RESOLVED" || state === "CLOSED" ? "success" : "neutral";
  return <Badge tone={tone}>{value?.label ?? state}</Badge>;
}

export default function ConfirmedDefectsPage() {
  const [state, setState] = useState<ConfirmedDefectState>("OPEN");
  const canExport = useHasPermission("reports.read");
  const { data, error, loading, reload } = useApiResource(
    () => api.confirmedDefects(state),
    `confirmed-defects:${state}`,
  );

  return (
    <div className="page-stack">
      <PageHeader
        title="D001 tasdiqlangan nuqsonlar"
        description="D001 bo‘yicha RoadVision AI yoki yo‘l ustasi ko‘rigidan keyin inson tasdiqlagan operativ nuqsonlar registri."
        actions={canExport ? <a className="button button--secondary" href="/api/v1/reports/confirmed-defects.xlsx" download><Download size={16} aria-hidden="true" /> Excel yuklash</a> : null}
      />
      <div className="context-strip"><div><span>Yo‘l</span><strong>D001</strong></div><div><span>To‘liq uzunligi</span><strong>0+000 — 67+000</strong></div><div><span>Holat</span><strong>{states.find((item) => item.value === state)?.label}</strong></div></div>
      <div className="tabs tabs--subtle" role="tablist" aria-label="Tasdiqlangan nuqson holati">
        {states.map((item) => <button key={item.value} role="tab" aria-selected={state === item.value} onClick={() => setState(item.value)}>{item.label}</button>)}
      </div>
      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? data.items.length ? (
        <Card>
          <TableFrame label="Tasdiqlangan nuqsonlar registri">
            <table><thead><tr><th>Manba</th><th>Nuqson</th><th>Yo‘l va joylashuv</th><th>Aniq hajm</th><th>Kuzatilgan vaqt</th><th>Yo‘l bo‘limi</th><th>Holat</th></tr></thead><tbody>{data.items.map((defect) => <tr key={defect.id}><td><strong>{defect.sourceReference}</strong><small>{defect.sourceKind === "ROADVISION" ? "RoadVision AI" : "Yo‘l ustasi ko‘rigi"}</small></td><td><strong>{defect.defectName}</strong></td><td><strong>{defect.locationLabel}</strong><small>{defect.road.code} · {defect.road.name}</small></td><td>{defect.exactQuantity.value} {defect.exactQuantity.unit}</td><td>{formatDateTime(defect.observedAt)}</td><td>{defect.division.name}</td><td>{stateBadge(defect.state)}</td></tr>)}</tbody></table>
          </TableFrame>
        </Card>
      ) : <EmptyState title="Bu holatda nuqson yo‘q" detail="Inson tasdiqlagan yozuv holati o‘zgarganda tegishli bo‘limda ko‘rinadi." /> : null}
    </div>
  );
}
