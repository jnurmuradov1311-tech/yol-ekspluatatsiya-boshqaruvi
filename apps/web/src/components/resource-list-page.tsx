"use client";

import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { useHasPermission } from "@/components/auth-provider";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, TableFrame, TextInput } from "@/components/ui";

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
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!data?.items) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.items;
    return data.items.filter((item) =>
      [item.name, item.code, item.divisionName, item.detail, item.stateLabel]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [data, query]);

  return (
    <div className="page-stack">
      <PageHeader
        title={title}
        description={description}
        actions={
          canExport && kind !== "timesheets" ? (
            <a className="button button--secondary" href={`/api/v1/reports/${kind}.xlsx`} download>
              <Download size={16} aria-hidden="true" /> Excel yuklash
            </a>
          ) : null
        }
      />
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} retry={reload} />
      ) : data ? (
        data.items.length ? (
          <>
            <div className="resource-filter">
              <TextInput
                label="Qidirish"
                name="resourceSearch"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ism, kod yoki bo‘lim bo‘yicha qidirish"
                aria-label="Resurslarni qidirish"
              />
              {query.trim() ? (
                <p className="resource-filter__count">
                  {filtered.length} / {data.items.length} ta yozuv
                </p>
              ) : null}
            </div>
            {filtered.length ? (
              <Card>
                <TableFrame label={title}>
                  <table>
                    <thead>
                      <tr>
                        <th>Nomi</th>
                        <th>Manba kodi</th>
                        <th>Yo‘l bo‘limi / tafsilot</th>
                        <th>Holat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((item) => (
                        <tr key={item.id}>
                          <td><strong>{item.name}</strong></td>
                          <td>{item.code ?? "—"}</td>
                          <td>
                            {item.divisionName ? (
                              <>
                                <strong>{item.divisionName}</strong>
                                <small>{item.detail}</small>
                              </>
                            ) : (
                              item.detail
                            )}
                          </td>
                          <td><Badge tone="info">{item.stateLabel}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableFrame>
              </Card>
            ) : (
              <EmptyState
                title="Mos yozuv topilmadi"
                detail={`“${query.trim()}” so‘roviga mos ${title.toLowerCase()} yo‘q. Boshqa so‘z bilan qidirib ko‘ring.`}
              />
            )}
          </>
        ) : (
          <EmptyState title={emptyTitle} detail={emptyDetail} />
        )
      ) : null}
    </div>
  );
}
