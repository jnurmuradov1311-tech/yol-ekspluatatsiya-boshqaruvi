"use client";

import { ExportLink } from "@/components/export-link";

import Link from "next/link";
import { useState } from "react";
import { DefectNavigation } from "@/components/defect-navigation";
import { Download, Eye } from "lucide-react";
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
  VERIFIED: { label: "Tekshirilgan", tone: "success" },
  CANCELLED: { label: "Bekor qilingan", tone: "neutral" },
};

export default function WorkOrdersPage() {
  const [filter,setFilter]=useState("active");
  const [context]=useState(()=>typeof window!=="undefined"?{defect:new URLSearchParams(window.location.search).get("defect"),plan:new URLSearchParams(window.location.search).get("plan")}:{defect:null,plan:null});
  const canExport = useHasPermission("reports.read");
  const { data, error, loading, reload } = useApiResource(api.workOrders, "work-orders");

  const items=(data?.items??[]).filter(o=>(!context.defect||o.sourceDefectId===context.defect)&&(!context.plan||o.planId===context.plan)).filter(o=>filter==="all"||(filter==="done"?o.state==="VERIFIED":filter==="review"?o.state==="COMPLETED":!["VERIFIED","CANCELLED"].includes(o.state)));
  return (
    <div className="page-stack">
      <DefectNavigation/><PageHeader title="Ijro" description="Yo‘l ustasi bajaradi · boshliq tekshiradi." actions={canExport ? <ExportLink className="button button--secondary" href="/api/v1/reports/work-orders.xlsx" download><Download size={16} aria-hidden="true" /> Excel yuklash</ExportLink> : null} />
      <div className="tabs" role="tablist" aria-label="Ijro holati">{[["active","Bajarish"],["review","Boshliq tekshiruvi"],["done","Yakunlangan"],["all","Barchasi"]].map(([key,label])=><button key={key} role="tab" aria-selected={filter===key} onClick={()=>setFilter(key!)}>{label}</button>)}</div>
      {context.defect||context.plan?<p className="field__hint">Tanlangan nuqson yoki rejaga tegishli topshiriqlar. <Link href="/topshiriqlar">Barcha topshiriqlar</Link></p>:null}
      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? items.length ? (
        <Card>
          <TableFrame label="Ish topshiriqlari">
            <table><thead><tr><th>Topshiriq</th><th>Ish</th><th>Yo‘l va joy</th><th>Sana</th><th>Brigada</th><th>Aniq hajm</th><th>Holat</th><th>Amal</th></tr></thead><tbody>{items.map((order) => {
              const state = orderStates[order.state];
              return <tr key={order.id}><td><strong>{order.number}</strong></td><td>{order.workName}</td><td><strong>{order.road.code}</strong><small>{order.road.name}</small><small>{order.locationLabel}</small></td><td>{formatDate(order.scheduledDate)}</td><td>{order.teamName}</td><td>{order.exactQuantity.value} {order.exactQuantity.unit}</td><td><Badge tone={state.tone}>{state.label}</Badge></td><td><Link className="button button--secondary" href={`/topshiriqlar/${order.id}`}><Eye size={15} aria-hidden="true" /> {order.state==="COMPLETED"?"Tekshirish":order.state==="ASSIGNED"?"Ishga olish":order.state==="VERIFIED"?"Natija":"Davom etish"}</Link></td></tr>;
            })}</tbody></table>
          </TableFrame>
        </Card>
      ) : <EmptyState title="Topshiriq yo‘q" detail="Bu holatda topshiriq yo‘q. Boshliq yaratgan topshiriq ijroga berilgach shu yerda chiqadi." /> : null}
    </div>
  );
}
