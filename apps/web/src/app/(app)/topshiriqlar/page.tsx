"use client";

import Link from "next/link";
import { Download, Eye } from "lucide-react";
import { useHasPermission } from "@/components/auth-provider";
import { api } from "@/lib/api/client";
import type { WorkOrder } from "@/lib/api/types";
import { formatDate } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, TableFrame } from "@/components/ui";
import { useOperatingScope } from "@/components/scope-provider";

const orderStates: Record<WorkOrder["state"], { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  DRAFT: { label: "Qoralama", tone: "neutral" },
  ASSIGNED: { label: "Biriktirilgan", tone: "info" },
  IN_PROGRESS: { label: "Bajarilmoqda", tone: "warning" },
  PAUSED: { label: "To‘xtatilgan", tone: "danger" },
  COMPLETED: { label: "Bajarilgan", tone: "success" },
  VERIFIED: { label: "Tekshirilgan", tone: "success" },
  CANCELLED: { label: "Bekor qilingan", tone: "neutral" },
};

export default function WorkOrdersPage() {
  const canExport = useHasPermission("reports.read");
  const { data, error, loading, reload } = useApiResource(api.workOrders, "work-orders");
  const { scope } = useOperatingScope();
  return (
    <div className="page-stack">
      <PageHeader title="Ish topshiriqlari" description="Tasdiqlangan rejalardan yaratilgan ishlar, mas’ul brigadalar va bajarilish holati." actions={canExport ? <a className="button button--secondary" href="/api/v1/reports/work-orders.xlsx" download><Download size={16} aria-hidden="true" /> Excel yuklash</a> : null} />
      <div className="scope-meta"><span><strong>Qamrov</strong>{scope.shortName}</span><span><strong>Yo‘l va kesim</strong>{scope.roadLabel}</span></div>
      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? data.items.length ? (
        <Card>
          <TableFrame label="Ish topshiriqlari">
            <table><thead><tr><th>Topshiriq</th><th>Ish</th><th>Yo‘l va joy</th><th>Sana</th><th>Brigada</th><th>Aniq hajm</th><th>Holat</th><th>Amal</th></tr></thead><tbody>{data.items.map((order) => {
              const state = orderStates[order.state];
              return <tr key={order.id}><td><strong>{order.number}</strong></td><td>{order.workName}</td><td><strong>{order.road.code}</strong><small>{order.road.name}</small><small>{order.locationLabel}</small></td><td>{formatDate(order.scheduledDate)}</td><td>{order.teamName}</td><td>{order.exactQuantity.value} {order.exactQuantity.unit}</td><td><Badge tone={state.tone}>{state.label}</Badge></td><td><Link className="button button--secondary" href={`/topshiriqlar/${order.id}`}><Eye size={15} aria-hidden="true" /> Ochish</Link></td></tr>;
            })}</tbody></table>
          </TableFrame>
        </Card>
      ) : <EmptyState title="Topshiriq yo‘q" detail="Reja tasdiqlanganda topshiriqlar avtomatik yaratiladi." /> : null}
    </div>
  );
}
