"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useHasPermission } from "@/components/auth-provider";
import { api } from "@/lib/api/client";
import type { MonthlyTimesheetEntry } from "@/lib/api/types";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Card, EmptyState, ErrorState, LoadingState, PageHeader, SelectInput, TableFrame } from "@/components/ui";

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
    label: Number.isInteger(hours) ? String(hours) : hours.toFixed(1),
    title: `${entry.minutes} daqiqa ishlangan`,
    tone: entry.minutes > 420 ? "over" : "work",
  };
}

function totalHours(minutes: number) {
  const hours = minutes / 60;
  return new Intl.NumberFormat("uz-UZ", { maximumFractionDigits: 1 }).format(hours);
}

export default function TimesheetsPage() {
  const canExport = useHasPermission("reports.read");
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { data, error, loading, reload } = useApiResource(
    () => api.monthlyTimesheet(year, month),
    `monthly-timesheet:${year}-${month}`,
  );
  const days = useMemo(() => Array.from({ length: data?.daysInMonth ?? 0 }, (_, index) => index + 1), [data?.daysInMonth]);
  const exportHref = `/api/v1/reports/timesheet.xlsx?year=${year}&month=${month}`;

  return (
    <div className="page-stack">
      <PageHeader title="Oylik tabel" description="Har bir xodimning kunlik ish vaqti ketma-ket kunlar bo‘yicha. Kunlik me’yor — 7 soat." actions={<><SelectInput label="Yil" name="timesheetYear" value={year} onChange={(event) => setYear(Number(event.target.value))}><option value={year - 1}>{year - 1}</option><option value={year}>{year}</option><option value={year + 1}>{year + 1}</option></SelectInput><SelectInput label="Oy" name="timesheetMonth" value={month} onChange={(event) => setMonth(Number(event.target.value))}>{monthNames.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</SelectInput>{canExport ? <a className="button button--secondary" href={exportHref} download><Download size={16} aria-hidden="true" /> Excel yuklash</a> : null}</>} />
      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? data.rows.length ? (
        <>
          <div className="context-strip"><div><span>Yo‘l bo‘limi</span><strong>{data.divisionName}</strong></div><div><span>Hisobot davri</span><strong>{monthNames[data.month - 1]} {data.year}</strong></div><div><span>Belgilar</span><strong>7 — soat · T — ta’til · K — kasallik · D — dam olish · — biriktirilmagan</strong></div></div>
          <Card className="timesheet-card">
            <TableFrame label={`${monthNames[data.month - 1]} ${data.year} oylik tabel`}>
              <table className="timesheet-table"><thead><tr><th className="timesheet-worker-column">Xodim</th>{days.map((day) => <th className="timesheet-day-column" key={day}>{day}</th>)}<th className="timesheet-total-column">Jami, soat</th></tr></thead><tbody>{data.rows.map((row) => {
                const entries = new Map(row.entries.map((entry) => [entry.day, entry]));
                const hasOvertime = row.entries.some((entry) => entry.minutes > 420);
                return <tr key={row.workerId}><td className="timesheet-worker-column"><strong>{row.fullName}</strong><small>{row.personnelNumber ? `${row.personnelNumber} · ` : ""}{row.positionName}</small></td>{days.map((day) => {
                  const value = dayValue(entries.get(day));
                  return <td className={`timesheet-day timesheet-day--${value.tone}`} title={value.title} key={day}>{value.label}</td>;
                })}<td className="timesheet-total-column"><strong>{totalHours(row.totalMinutes)}</strong>{hasOvertime ? <Badge tone="danger">7 soatdan oshgan kun bor</Badge> : null}</td></tr>;
              })}</tbody></table>
            </TableFrame>
          </Card>
        </>
      ) : <EmptyState title="Tabel yozuvi yo‘q" detail="Tanlangan oy uchun bajarilgan ish vaqti hali kiritilmagan." /> : null}
    </div>
  );
}
