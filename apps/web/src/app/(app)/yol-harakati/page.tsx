"use client";

import { useState } from "react";
import { api } from "@/lib/api/client";
import type { RoadAccessDetails } from "@/lib/api/types";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, TextInput } from "@/components/ui";
import { formatChainage } from "@/lib/format";

function localDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function displayTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("uz-UZ", { timeZone: "Asia/Tashkent", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "Belgilanmagan";
}
function direction(value: string | null) {
  return value === "FORWARD" ? "Kilometr oshish yo‘nalishi" : value === "REVERSE" ? "Kilometr kamayish yo‘nalishi" : value === "BOTH" ? "Ikkala yo‘nalish" : value || "Yo‘nalish belgilanmagan";
}
function stateLabel(item: RoadAccessDetails) {
  if (item.operationalState === "OPENED") return "Ish tugagan · ochilgan";
  if (item.operationalState === "CANCELLED") return "Bekor qilingan";
  if (item.operationalState === "OVERDUE") return "Muddat o‘tgan · tekshirish kerak";
  return item.operationalState === "ACTIVE" ? "Ish davom etmoqda" : "Rejalashtirilgan";
}
function delivery(value: RoadAccessDetails["deliveryState"]) {
  if (value === "PUBLISHED") return "YTPga yuborilgan";
  if (value === "FAILED" || value === "DEAD_LETTER") return "YTPga yuborishda xato";
  if (value === "NOT_QUEUED") return "Yuborish yozuvi yo‘q";
  return "YTPga yuborish navbatida";
}

export default function RoadAccessPage() {
  const [dateFrom, setDateFrom] = useState(localDay);
  const [dateTo, setDateTo] = useState(localDay);
  const valid = Boolean(dateFrom && dateTo && dateTo >= dateFrom);
  const result = useApiResource(() => valid ? api.roadAccess(dateFrom, dateTo) : Promise.resolve({ items: [], truncated: false }), `road-access:${dateFrom}:${dateTo}`);
  return <div className="page-stack">
    <PageHeader title="Yo‘l harakati" description="Topshiriqlar bo‘yicha yopilish joyi, tasmasi va vaqti." actions={<Button variant="secondary" onClick={() => void result.reload()}>Yangilash</Button>} />
    <Card><div className="date-fields"><TextInput label="Boshlanish sanasi" type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); if (dateTo < event.target.value) setDateTo(event.target.value); }} /><TextInput label="Tugash sanasi" type="date" min={dateFrom} value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div></Card>
    {!valid ? <p role="alert" className="inline-error">Sanalarni to‘g‘ri belgilang.</p> : result.loading ? <LoadingState /> : result.error ? <ErrorState error={result.error} retry={result.reload} /> : !result.data?.items.length ? <EmptyState title="Yopilish rejalashtirilmagan" detail="Shu davrda yo‘lni yopishni talab qiladigan topshiriq yo‘q." /> : <>
      {result.data.truncated ? <p role="alert">500 ta yozuv ko‘rsatildi. Aniqroq davrni tanlang.</p> : null}
      {result.data.items.map((item) => <Card key={item.planItemId}>
        <div className="card-heading"><div><h2>{item.roadCode} · {formatChainage(Number(item.chainageStartM))} — {formatChainage(Number(item.chainageEndM))}</h2><p>{item.workName}</p></div><Badge tone={item.operationalState === "OPENED" ? "success" : item.operationalState === "OVERDUE" ? "danger" : "warning"}>{stateLabel(item)}</Badge></div>
        <div className="plan-handoff-meta"><div><span>Yo‘l harakati</span><strong>{item.operationalState === "OPENED" || item.operationalState === "CANCELLED" ? "Ochiq" : item.roadAccess === "CLOSED" ? "To‘liq yopish" : "Qisman yopish"}</strong></div><div><span>Yo‘nalish va tasma</span><strong>{direction(item.direction)}</strong><small>{item.laneLabel || "Tasma belgilanmagan"}</small></div><div><span>Muddat</span><strong>{displayTime(item.startsAt)} — {displayTime(item.endsAt)}</strong></div></div>
        <div className="button-row"><Badge tone={item.deliveryState === "PUBLISHED" ? "success" : item.deliveryState === "FAILED" || item.deliveryState === "DEAD_LETTER" ? "danger" : "neutral"}>{delivery(item.deliveryState)}</Badge>{item.workOrderId ? <a className="button button--secondary" href={`/topshiriqlar/${item.workOrderId}`}>Topshiriq {item.orderNumber}</a> : null}</div>
        {item.permitReference ? <p>Ruxsatnoma: {item.permitReference}</p> : null}
      </Card>)}
    </>}
  </div>;
}
