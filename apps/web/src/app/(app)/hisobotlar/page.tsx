"use client";

import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Card, PageHeader } from "@/components/ui";

const reports = [
  { code: "roadvision-findings", title: "RoadVision AI topilmalari", detail: "Vakolat doirasidagi AI kuzatuvlari va inson qarorlari.", format: "xlsx", icon: FileSpreadsheet, permissions: ["defects.read"] },
  { code: "manual-inspections", title: "Yo‘l ustasi ko‘riklari", detail: "Joyida o‘tkazilgan ko‘riklar, aniq hajm va tasdiqlash holati.", format: "xlsx", icon: FileSpreadsheet, permissions: ["defects.read"] },
  { code: "confirmed-defects", title: "Tasdiqlangan nuqsonlar", detail: "Inson tasdiqlagan operativ nuqsonlar registri.", format: "xlsx", icon: FileSpreadsheet, permissions: ["defects.read"] },
  { code: "plans", title: "Rejalar", detail: "Avtomatik va qo‘lda tuzilgan rejalar, resurs to‘siqlari va holati.", format: "xlsx", icon: FileSpreadsheet, permissions: ["planning.read"] },
  { code: "work-orders", title: "Ish topshiriqlari", detail: "Ish, joy, brigada, aniq hajm va amaldagi holat.", format: "xlsx", icon: FileSpreadsheet, permissions: ["execution.read"] },
  { code: "annual-program", title: "Yillik saqlash ishlari dasturi", detail: "IQN bandlari bo‘yicha tasdiqlangan yillik ish hajmlari.", format: "xlsx", icon: FileSpreadsheet, permissions: [] },
  { code: "workers", title: "Xodimlar", detail: "YTPdan sinxronlangan ishchilar va bo‘limga biriktirishlar.", format: "xlsx", icon: FileSpreadsheet, permissions: ["resources.read"] },
  { code: "equipment", title: "Texnika", detail: "Texnika, biriktirish va foydalanish holati.", format: "xlsx", icon: FileSpreadsheet, permissions: ["resources.read"] },
  { code: "warehouse", title: "Ombor", detail: "Materiallar, saqlash joylari va amaldagi qoldiq.", format: "xlsx", icon: FileSpreadsheet, permissions: ["resources.read"] },
  { code: "audit-log", title: "Harakatlar tarixi", detail: "Kim, qachon va qaysi yozuvda qanday harakat qilgan.", format: "xlsx", icon: FileSpreadsheet, permissions: ["audit.read"] },
  { code: "daily-brief", title: "Kunlik operativ ma’lumotnoma", detail: "Yo‘l bo‘limining bugungi ish va to‘siqlari.", format: "pdf", icon: FileText, permissions: ["defects.read", "execution.read", "integrations.read"] },
] as const;

export default function ReportsPage() {
  const { user } = useAuth();
  const currentYear = new Date().getFullYear();
  const can = (permission: string) => Boolean(user?.permissions.includes("system.all") || user?.permissions.includes(permission));
  const visibleReports = reports.filter((report) => report.permissions.every(can));

  return (
    <div className="page-stack">
      <PageHeader title="D001 hisobotlari" description="D001 bo‘yicha operativ va normativ yozuvlarni serverda shakllantirilgan haqiqiy Excel yoki PDF faylida yuklab oling." />
      <div className="report-grid">{visibleReports.map((report) => {
        const Icon = report.icon;
        const href = report.code === "annual-program"
          ? `/api/v1/reports/annual-program.xlsx?year=${currentYear}`
          : `/api/v1/reports/${report.code}.${report.format}`;
        return <Card className="report-card" key={report.code}><span className="report-icon"><Icon aria-hidden="true" /></span><div><h2>{report.title}</h2><p>{report.detail}</p></div><a className="button button--secondary" href={href} download><Download size={16} aria-hidden="true" /> {report.format.toUpperCase()} yuklash</a></Card>;
      })}</div>
    </div>
  );
}
