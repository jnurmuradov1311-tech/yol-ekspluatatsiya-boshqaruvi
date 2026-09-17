"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Download } from "lucide-react";
import { useHasPermission } from "@/components/auth-provider";
import { api } from "@/lib/api/client";
import { useReportMonth } from "@/lib/report-period";
import { formatMinutes } from "@/lib/execution-entry";
import type { MonthlyTimesheetEntry } from "@/lib/api/types";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, TextInput, TableFrame } from "@/components/ui";

const monthNames = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];

function dayValue(entry: MonthlyTimesheetEntry | undefined): { label: string; title: string; tone: string } {
  if (!entry) return { label: "—", title: "Ma’lumot kiritilmagan", tone: "empty" };
  if (entry.state === "LEAVE") return { label: "T", title: "Ta’til", tone: "leave" };
  if (entry.state === "SICK") return { label: "K", title: "Kasallik varaqasi", tone: "sick" };
  if (entry.state === "ABSENT") return { label: "Y", title: "Ishga kelmagan", tone: "absent" };
  if (entry.state === "REST") return { label: "D", title: "Dam olish kuni", tone: "rest" };
  if (entry.state === "OUTSIDE_ASSIGNMENT") return { label: "—", title: "Biriktirish davridan tashqari", tone: "rest" };
  const hours = entry.minutes / 60;
  return {
    label: Number.isInteger(hours) ? String(hours) : `${Math.floor(hours)}:${String(entry.minutes % 60).padStart(2, "0")}`,
    title: `${formatMinutes(entry.minutes)} ishlangan`,
    tone: entry.minutes > 420 ? "over" : "work",
  };
}

export default function TimesheetsPage() {
  const canExport = useHasPermission("reports.read");
  const [period, setPeriod] = useReportMonth();
  const [year, month] = period.split("-").map(Number) as [number, number];
  const { data, error, loading, reload } = useApiResource(
    () => api.monthlyTimesheet(year, month),
    `monthly-timesheet:${year}-${month}`,
  );
  const days = useMemo(() => Array.from({ length: data?.daysInMonth ?? 0 }, (_, index) => index + 1), [data?.daysInMonth]);
  const exportHref = api.monthlyTimesheetExportUrl(year, month);

  return (
    <div className="page-stack">
      <PageHeader title="Oylik tabel" description="Tasdiqlangan ishlar bo‘yicha haqiqiy ish vaqti. Kasrli soat o‘rniga soat:daqiqa ko‘rsatiladi." actions={<><TextInput label="Hisobot oyi" name="timesheetMonth" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /><Link className="button button--secondary" href={`/oylik?month=${period}`}>Oylik hisoblash</Link>{canExport && data && !loading ? <a className="button button--secondary" href={exportHref} download><Download size={16} aria-hidden="true" /> Excel</a> : null}</>} />
      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? data.rows.length ? (
        <>
          <div className="context-strip"><div><span>Yo‘l bo‘limi</span><strong>{data.divisionName}</strong></div><div><span>Hisobot davri</span><strong>{monthNames[data.month - 1]} {data.year}</strong></div><div><span>Belgilar</span><strong>T — ta’til · K — kasallik · Y — kelmagan · D — dam olish · — qayd yo‘q</strong></div></div>
          <Card className="timesheet-card">
            <TableFrame label={`${monthNames[data.month - 1]} ${data.year} oylik tabel`}>
              <table className="timesheet-table"><thead><tr><th className="timesheet-worker-column">Xodim</th>{days.map((day) => <th className="timesheet-day-column" key={day}>{day}</th>)}<th className="timesheet-total-column">Jami vaqt</th></tr></thead><tbody>{data.rows.map((row) => {
                const entries = new Map(row.entries.map((entry) => [entry.day, entry]));
                const hasOvertime = row.entries.some((entry) => entry.minutes > 420);
                return <tr key={row.workerId}><td className="timesheet-worker-column"><strong>{row.fullName}</strong><small>{row.personnelNumber ? `${row.personnelNumber} · ` : ""}{row.positionName}</small></td>{days.map((day) => {
                  const value = dayValue(entries.get(day));
                  return <td className={`timesheet-day timesheet-day--${value.tone}`} title={value.title} key={day}>{value.label}</td>;
                })}<td className="timesheet-total-column"><strong>{formatMinutes(row.totalMinutes)}</strong>{hasOvertime ? <Badge tone="danger">Kunlik chegaradan oshgan</Badge> : null}</td></tr>;
              })}</tbody></table>
            </TableFrame>
          </Card>
        </>
      ) : <EmptyState title="Tabel yozuvi yo‘q" detail="Tanlangan oy uchun bajarilgan ish vaqti hali kiritilmagan." /> : null}
    </div>
  );
}
