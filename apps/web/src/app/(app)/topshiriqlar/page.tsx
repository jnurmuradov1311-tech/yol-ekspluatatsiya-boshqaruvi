"use client";

import { Download } from "lucide-react";
import { useHasPermission } from "@/components/auth-provider";
import { api } from "@/lib/api/client";
import type { WorkOrder } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, TableFrame } from "@/components/ui";

const orderStates: Record<WorkOrder["state"], { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  DRAFT: { label: "Qoralama", tone: "neutral" },
  ASSIGNED: { label: "Biriktirilgan", tone: "info" },
  IN_PROGRESS: { label: "Bajarilmoqda", tone: "warning" },
  PAUSED: { label: "To‘xtatilgan", tone: "danger" },
  COMPLETED: { label: "Bajarilgan", tone: "success" },
  CANCELLED: { label: "Bekor qilingan", tone: "neutral" },
};

export default function WorkOrdersPage() {
  const canExport = useHasPermission("reports.read");
  const { data, error, loading, reload } = useApiResource(api.workOrders, "work-orders");
  return (
    <div className="page-stack">
      <PageHeader title="D001 topshiriqlari" description="D001 uchun tasdiqlangan rejadan yaratilgan ish topshiriqlari va ularning amaldagi holati." actions={canExport ? <a className="button button--secondary" href="/api/v1/reports/work-orders.xlsx" download><Download size={16} aria-hidden="true" /> Excel yuklash</a> : null} />
      <div className="context-strip"><div><span>Yo‘l</span><strong>D001</strong></div><div><span>To‘liq uzunligi</span><strong>0+000 — 67+000</strong></div></div>
      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? data.items.length ? (
        <Card>
          <TableFrame label="Ish topshiriqlari">
            <table><thead><tr><th>Topshiriq</th><th>Ish</th><th>Yo‘l va joy</th><th>Sana</th><th>Brigada</th><th>Aniq hajm</th><th>Holat</th></tr></thead><tbody>{data.items.map((order) => {
              const state = orderStates[order.state];
              return <tr key={order.id}><td><strong>{order.number}</strong></td><td>{order.workName}</td><td><strong>{order.road.code}</strong><small>{order.road.name}</small><small>{order.locationLabel}</small></td><td>{formatDate(order.scheduledDate)}</td><td>{order.teamName}</td><td>{order.exactQuantity.value} {order.exactQuantity.unit}</td><td><Badge tone={state.tone}>{state.label}</Badge></td></tr>;
            })}</tbody></table>
          </TableFrame>
        </Card>
      ) : <EmptyState title="Topshiriq yo‘q" detail="Reja tasdiqlanganda topshiriqlar avtomatik yaratiladi." /> : null}
    </div>
  );
}
