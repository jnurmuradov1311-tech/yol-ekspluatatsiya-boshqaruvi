"use client";

import { Download } from "lucide-react";
import { useHasPermission } from "@/components/auth-provider";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, TableFrame } from "@/components/ui";

type ResourceKind = "workers" | "equipment" | "warehouse" | "timesheets";

export function ResourceListPage({ kind, title, description, emptyTitle, emptyDetail }: {
  kind: ResourceKind;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDetail: string;
}) {
  const canExport = useHasPermission("reports.read");
  const { data, error, loading, reload } = useApiResource(() => api.resources(kind), `resource:${kind}`);
  return (
    <div className="page-stack">
      <PageHeader title={title} description={description} actions={canExport && kind !== "timesheets" ? <a className="button button--secondary" href={`/api/v1/reports/${kind}.xlsx`} download><Download size={16} aria-hidden="true" /> Excel yuklash</a> : null} />
      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? data.items.length ? (
        <Card>
          <TableFrame label={title}>
            <table><thead><tr><th>Nomi</th><th>Manba kodi</th><th>Yo‘l bo‘limi / tafsilot</th><th>Holat</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td>{item.code ?? "—"}</td><td>{item.divisionName ? <><strong>{item.divisionName}</strong><small>{item.detail}</small></> : item.detail}</td><td><Badge tone="info">{item.stateLabel}</Badge></td></tr>)}</tbody></table>
          </TableFrame>
        </Card>
      ) : <EmptyState title={emptyTitle} detail={emptyDetail} /> : null}
    </div>
  );
}
