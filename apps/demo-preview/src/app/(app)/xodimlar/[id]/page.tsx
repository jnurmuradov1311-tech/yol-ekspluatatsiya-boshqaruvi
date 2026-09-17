"use client";
import Link from "next/link";
import { use, useState, type FormEvent } from "react";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, SelectInput, TextInput } from "@/components/ui";

export default function WorkerCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading, error, reload } = useApiResource(() => api.workerEquipment(id), `worker-equipment:${id}`);
  const [stockKey, setStockKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const stock = data?.stockOptions.find((item) => `${item.materialId}:${item.stockLocationId}` === stockKey);
  const norm = data?.norms.find((item) => item.code === stock?.normCode);
  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!stock) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setActionError(""); setMessage("");
    try {
      await api.issueWorkerEquipment(id, { materialId: stock.materialId, stockLocationId: stock.stockLocationId, issuedOn: String(form.get("issuedOn")), quantity: Number(form.get("quantity")), note: String(form.get("note") ?? "") });
      await reload(); setMessage("Jihoz biriktirildi. Xizmat muddati berilgan sanadan hisoblanmoqda."); setStockKey("");
    } catch (caught) { setActionError(caught instanceof Error ? caught.message : "Jihozni biriktirib bo‘lmadi."); }
    finally { setBusy(false); }
  }
  return <div className="page-stack"><PageHeader title={data ? `${data.name} — kartochka` : "Xodim kartochkasi"} description="Berilgan kiyim va asboblar, IQN 03-24 bo‘yicha xizmat muddati." actions={<Link className="button button--secondary" href="/xodimlar">Xodimlarga qaytish</Link>} />
    {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? <>
      <p className="field__hint">Hisob sanasi: {data.asOf}. Muddat har bir buyumning berilgan sanasidan avtomatik hisoblanadi.</p>
      {data.items.length ? <div className="employee-card-items">{data.items.map((item) => <article key={item.id} className="card employee-card-item"><div className="card-heading"><h2>{item.name}</h2><Badge tone={item.status === "EXPIRED" ? "danger" : item.status === "DUE" ? "warning" : "success"}>{item.status === "EXPIRED" ? "Muddati tugagan" : item.status === "DUE" ? "Almashtirish yaqin" : "Amalda"}</Badge></div><p>{item.quantity} {item.unit??"dona"} · {item.serviceMonths} oy</p><p>Berildi: <strong>{item.issuedOn}</strong><br />Almashtirish: <strong>{item.expiresOn}</strong></p><progress aria-label={`${item.name} qolgan muddati`} max={Math.max(1, (Date.parse(item.expiresOn) - Date.parse(item.issuedOn)) / 86400000)} value={Math.max(0,item.daysRemaining)} /><p><strong>{item.daysRemaining > 0 ? `${item.daysRemaining} kun qoldi` : item.daysRemaining === 0 ? "Bugun muddati tugaydi" : `${Math.abs(item.daysRemaining)} kun o‘tgan`}</strong></p><small>{item.sourceReference}</small>{item.allocationScope.toUpperCase() === "DIVISION" ? <small>Bo‘lim jihozi — xodimga saqlash uchun biriktirilgan.</small> : null}</article>)}</div> : <EmptyState title="Jihoz biriktirilmagan" detail="Ombordan kiyim yoki asbob biriktirilgach xizmat muddati shu yerda ko‘rinadi." />}
      {data.canIssue ? <Card><h2>Ombordan biriktirish</h2>{data.stockOptions.length ? <form className="data-form" onSubmit={issue}><SelectInput label="Mavjud jihoz" name="stock" value={stockKey} onChange={(event) => setStockKey(event.target.value)} required><option value="">Jihozni tanlang</option>{data.stockOptions.map((item) => <option key={`${item.materialId}:${item.stockLocationId}`} value={`${item.materialId}:${item.stockLocationId}`}>{item.name} · {item.availableQuantity} {item.unit}</option>)}</SelectInput><TextInput label="Berilgan sana" name="issuedOn" type="date" required max={data.asOf.slice(0,10)} defaultValue={data.asOf.slice(0,10)} /><TextInput label={`Miqdor, ${stock?.unit??"dona"}`} name="quantity" type="number" required min={['kg','m'].includes(stock?.unit??'')?.001:1} step={['kg','m'].includes(stock?.unit??'')?.001:1} max={Number(stock?.availableQuantity ?? 0)} defaultValue={1} /><div className="field"><span className="field__label">Xodimning kasbi</span><p>{data.positionName || ({ yol_ishchisi: "Yo‘l ishchisi", yol_ustasi: "Yo‘l ustasi", haydovchi: "Haydovchi", mashinist: "Mashinist", energetik: "Energetik", mexanik: "Mexanik", hht_muhandisi: "Harakatni tashkil etish muhandisi", ytb_boshligi: "Yo‘l bo‘limi boshlig‘i" } as Record<string,string>)[data.occupationCode ?? ""] || "Kartochkada kasbni aniqlashtirish kerak"}</p><small>Jihoz kasb va berilgan sanadagi ma’lumotga muvofiq tekshiriladi.</small></div><TextInput label="Izoh" name="note" /><div className="form-span">{norm ? <p>{norm.sourceReference} · {norm.serviceMonths} oy. {norm.departmentQuantity ? `Bo‘lim uchun o‘rtacha ${norm.departmentQuantity} dona ta’minot me’yori.` : ""}</p> : null}{norm && (!norm.published || (data.occupationCode && !norm.eligibleOccupationCodes.includes(data.occupationCode))) ? <p className="field__hint">Bu jihoz uchun tasdiqlangan kasb me’yori mavjud emas.</p> : null}<Button type="submit" busy={busy} disabled={!stock || !data.occupationCode || !norm?.published || !norm.eligibleOccupationCodes.includes(data.occupationCode)}>Jihozni biriktirish</Button></div></form> : <p>Biriktirishga yaroqli, IQN 03-24 bilan bog‘langan bo‘sh ombor jihozi yo‘q.</p>}</Card> : null}
      {message ? <p className="success-banner" role="status">{message}</p> : null}{actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
    </> : null}
  </div>;
}
