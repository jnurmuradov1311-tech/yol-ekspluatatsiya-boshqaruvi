"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, HardHat, ScanSearch, ArrowRight, Plus } from "lucide-react";
import { api } from "@/lib/api/client";
import { formatCount, formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/ui";

const metrics = [
  { key: "reviewQueue", label: "Tekshiriladigan nuqson", icon: ScanSearch, tone: "amber", href: "/nuqsonlar" },
  { key: "confirmedDefects", label: "Ish belgilanmagan nuqson", icon: CheckCircle2, tone: "teal", href: "/tasdiqlangan-nuqsonlar" },
  { key: "openWorkOrders", label: "Ochiq topshiriq", icon: HardHat, tone: "blue", href: "/topshiriqlar" },
  { key: "overdueWorkOrders", label: "Muddati o‘tgan", icon: Clock3, tone: "red", href: "/topshiriqlar" },
] as const;

export default function DashboardPage() {
  const { data, error, loading, reload } = useApiResource(api.dashboard, "dashboard");

  return (
    <div className="page-stack">
      <PageHeader title="Bosh sahifa" description="" actions={<Link className="button button--primary" href="/malumot-kiritish"><Plus size={17} aria-hidden="true" /> Nuqson kiritish</Link>} />
      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? (
        <>
          <div className="quick-workflow">{[
            { href: "/tasdiqlangan-nuqsonlar", title: "Nuqsonlar", action: "AI / usta qaydini tekshirish" },
            { href: "/rejalashtirish", title: "Topshiriq yaratish", action: "Muddat va resurslarni belgilash" },
            { href: "/topshiriqlar", title: "Ijro", action: "Bajarish va tasdiqlash" },
          ].map((item, i) => <Link href={item.href} key={item.href}><span className="quick-workflow__number">{i + 1}</span><div><strong>{item.title}</strong><small>{item.action}</small></div><ArrowRight size={18} aria-hidden="true" /></Link>)}</div>
          <div className="metric-grid">
            {metrics.map(({ key, label, icon: Icon, tone, href }) => {
              const count = data.counts[key];
              const emphasize = (key === "overdueWorkOrders" || key === "reviewQueue") && count > 0;
              return (
                <Link className="metric-link" href={href} key={key}>
                  <Card className={`metric-card metric-card--${tone}${emphasize ? " metric-card--attention" : ""}`}>
                    <span className="metric-card__icon"><Icon aria-hidden="true" /></span>
                    <div><strong>{formatCount(count)}</strong><span>{label}</span></div>
                  </Card>
                </Link>
              );
            })}
          </div>
          <div className="dashboard-grid">
            <Card>
              <div className="card-heading"><div><h2>E’tibor kerak</h2></div><AlertTriangle aria-hidden="true" /></div>
              {data.alerts.length ? (
                <div className="alert-list">
                  {data.alerts.slice(0, 3).map((alert) => (
                    <article className={`alert-row alert-row--${alert.kind}`} key={alert.id}>
                      <div><Badge tone={alert.kind === "danger" ? "danger" : alert.kind === "warning" ? "warning" : "info"}>{alert.kind === "danger" ? "Xato" : alert.kind === "warning" ? "Eslatma" : "Ma’lumot"}</Badge><strong>{alert.title}</strong><details><summary>Tafsilot</summary><p>{alert.detail}</p></details></div>
                      {alert.href ? <Link href={alert.href}>Ochish</Link> : null}
                    </article>
                  ))}
                </div>
              ) : <EmptyState title="Operativ xabar yo‘q" detail="Hozircha alohida e’tibor talab qiladigan holat aniqlanmadi." />}
            </Card>
            <Card>
              <div className="card-heading"><div><h2>So‘nggi harakatlar</h2></div></div>
              {data.activity.length ? (
                <ol className="activity-list">
                  {data.activity.slice(0, 5).map((item) => (
                    <li key={item.id}><span className="activity-dot" /><div><strong>{item.action}</strong><p>{item.subject}</p><small>{item.actor} · {formatDateTime(item.occurredAt)}</small></div></li>
                  ))}
                </ol>
              ) : <EmptyState title="Harakat yo‘q" detail="Audit yozuvlari yaratilganda shu yerda ko‘rinadi." />}
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
