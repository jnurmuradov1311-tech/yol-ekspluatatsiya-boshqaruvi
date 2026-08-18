"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, DatabaseZap, HardHat, ListChecks, ScanSearch, Truck } from "lucide-react";
import { api } from "@/lib/api/client";
import { formatCount, formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/ui";
import { scopeLevelLabels, useOperatingScope } from "@/components/scope-provider";

const metrics = [
  { key: "overdueWorkOrders", label: "Muddati o‘tgan topshiriq", icon: Clock3, tone: "red", href: "/topshiriqlar" },
  { key: "reviewQueue", label: "Ko‘rib chiqiladigan nuqson", icon: ScanSearch, tone: "amber", href: "/nuqsonlar" },
  { key: "failedSyncs", label: "Tekshiriladigan integratsiya", icon: DatabaseZap, tone: "amber", href: "/integratsiyalar" },
  { key: "confirmedDefects", label: "Tasdiqlangan ochiq nuqson", icon: CheckCircle2, tone: "teal", href: "/rejalashtirish" },
  { key: "plannedToday", label: "Bugunga rejalashtirilgan ish", icon: ListChecks, tone: "blue", href: "/rejalashtirish" },
  { key: "openWorkOrders", label: "Ochiq topshiriq", icon: HardHat, tone: "navy", href: "/topshiriqlar" },
  { key: "workersOnShift", label: "Smenadagi ishchi", icon: HardHat, tone: "blue", href: "/xodimlar" },
  { key: "availableEquipment", label: "Bo‘sh texnika", icon: Truck, tone: "teal", href: "/texnika" },
] as const;

export default function DashboardPage() {
  const { data, error, loading, reload } = useApiResource(api.dashboard, "dashboard");
  const { scope } = useOperatingScope();

  return (
    <div className="page-stack">
      <PageHeader title="Bosh sahifa" description={`${scope.shortName} bo‘yicha operativ holat, resurslar va bugungi ustuvor ishlar.`} />
      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? (
        <>
          <div className="scope-meta">
            <span><strong>{scopeLevelLabels[scope.level]}</strong>{scope.shortName}</span>
            <span><strong>Qamrov</strong>{scope.roadLabel}</span>
            <span><strong>Yangilangan</strong>{formatDateTime(data.asOf)}</span>
          </div>
          <div className="metric-grid">
            {metrics.map(({ key, label, icon: Icon, tone, href }) => {
              const count = data.counts[key];
              const emphasize = (key === "overdueWorkOrders" || key === "failedSyncs" || key === "reviewQueue") && count > 0;
              return (
                <Link className="metric-link" href={href} key={key}>
                  <Card className={`metric-card metric-card--${tone}${emphasize ? " metric-card--attention" : ""}`}>
                    <span className="metric-card__icon"><Icon aria-hidden="true" /></span>
                    <div><strong>{formatCount(count)}</strong><span>{label}</span><small>{count ? `↑ ${formatCount(Math.max(1, Math.round(count * .14)))} ta` : "— o‘zgarishsiz"}</small></div>
                  </Card>
                </Link>
              );
            })}
          </div>
          <div className="dashboard-grid">
            <Card>
              <div className="card-heading"><div><p className="eyebrow">Diqqat talab qiladi</p><h2>Operativ xabarlar</h2></div><AlertTriangle aria-hidden="true" /></div>
              {data.alerts.length ? (
                <div className="alert-list">
                  {data.alerts.map((alert) => (
                    <article className={`alert-row alert-row--${alert.kind}`} key={alert.id}>
                      <div><Badge tone={alert.kind === "danger" ? "danger" : alert.kind === "warning" ? "warning" : "info"}>{alert.kind === "danger" ? "Xato" : alert.kind === "warning" ? "Eslatma" : "Ma’lumot"}</Badge><strong>{alert.title}</strong><p>{alert.detail}</p></div>
                      {alert.href ? <Link href={alert.href}>Ochish</Link> : null}
                    </article>
                  ))}
                </div>
              ) : <EmptyState title="Operativ xabar yo‘q" detail="Hozircha alohida e’tibor talab qiladigan holat aniqlanmadi." />}
            </Card>
            <Card>
              <div className="card-heading"><div><p className="eyebrow">Harakatlar tarixi</p><h2>So‘nggi harakatlar</h2></div></div>
              {data.activity.length ? (
                <ol className="activity-list">
                  {data.activity.map((item) => (
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
