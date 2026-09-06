"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { useHasPermission } from "@/components/auth-provider";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, TableFrame, TextArea } from "@/components/ui";

export default function RequisitionsPage() {
  const { data, loading, error, reload } = useApiResource(api.resourceRequisitions, "resource-requisitions");
  const canDecide = useHasPermission("resources.requisition.approve");
  const [selected, setSelected] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  async function decide(decision: "APPROVE" | "REJECT") {
    if (!selected) return;
    setBusy(true); setActionError(""); setMessage("");
    try { await api.decideResourceRequisition(selected, decision, note); setSelected(""); setNote(""); await reload(); setMessage("Qaror saqlandi. Ishni boshlashdan oldin ombor va texnika mavjudligi qayta tekshiriladi."); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : "Qaror saqlanmadi."); }
    finally { setBusy(false); }
  }
  return <div className="page-stack"><PageHeader title="Resurs talabnomalari" description="Omborda yetishmagan material va bo‘sh bo‘lmagan texnika bo‘yicha bosh muhandisga yuborilgan so‘rovlar." actions={<Link className="button button--secondary" href="/ombor">Omborni ko‘rish</Link>} />
    {message ? <p role="status" className="success-banner">{message}</p> : null}{actionError ? <p role="alert" className="inline-error">{actionError}</p> : null}
    {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data?.items.length ? <Card><TableFrame label="Bosh muhandis talabnomalari"><table><thead><tr><th>Talab qilingan resurs</th><th>Kerak</th><th>Mavjud</th><th>Holat</th><th>Amal</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td><strong>{item.requestedByName}</strong>{item.shortages.map((resource,index) => <small key={index}>{resource.resourceName ?? resource.resourceCode} · {resource.missingQuantity} {resource.unit} yetishmaydi</small>)}{item.decisionNote ? <small>{item.decisionNote}</small> : null}</td><td>{item.shortages.map((resource,index) => <small key={index}>{resource.requiredQuantity} {resource.unit}</small>)}</td><td>{item.shortages.map((resource,index) => <small key={index}>{resource.reservedQuantity} {resource.unit} biriktirilgan</small>)}</td><td><Badge tone={item.status === "APPROVED" || item.status === "FULFILLED" ? "success" : item.status === "REJECTED" ? "danger" : "warning"}>{({ SUBMITTED: "Yuborilgan", APPROVED: "Ta’minlash tasdiqlandi", REJECTED: "Rad etildi", FULFILLED: "Ta’minlandi", CANCELLED: "Bekor qilindi" } as Record<string,string>)[item.status] ?? item.status}</Badge></td><td>{canDecide && ["SUBMITTED"].includes(item.status) ? <Button variant="secondary" onClick={() => { setSelected(item.id); setNote(""); }}>Qaror berish</Button> : "—"}</td></tr>)}</tbody></table></TableFrame></Card> : <EmptyState title="Talabnoma yo‘q" detail="Rejalashtirishda resurs yetishmasa, bosh muhandisga talabnoma yuborish mumkin." />}
    {selected ? <Card><h2>Ta’minlash bo‘yicha qaror</h2><TextArea label="Qaror izohi" name="requisitionNote" value={note} onChange={(event) => setNote(event.target.value)} rows={3} /><div className="button-row"><Button busy={busy} onClick={() => decide("APPROVE")}>Ta’minlashni tasdiqlash</Button><Button variant="danger" busy={busy} disabled={!note.trim()} onClick={() => decide("REJECT")}>Rad etish</Button><Button variant="secondary" onClick={() => setSelected("")}>Bekor qilish</Button></div></Card> : null}
  </div>;
}
