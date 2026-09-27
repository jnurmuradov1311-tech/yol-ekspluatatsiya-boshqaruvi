"use client";

import { useState, type FormEvent } from "react";
import { BookOpen, ExternalLink, FileText, Film, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useAuth } from "@/components/auth-provider";
import { useApiResource } from "@/lib/use-api-resource";
import { Button, TextInput, SelectInput } from "@/components/ui";
import type { WorkGuide } from "@/lib/api/work-guides";

const documentTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export function WorkGuides({ workVariantId, workName, readOnly = false }: { workVariantId: string; workName?: string; readOnly?: boolean }) {
  const { user } = useAuth();
  const roadUnitId = user?.division?.id ?? "";
  const guides = useApiResource(() => api.workGuides(workVariantId, roadUnitId), `guides:${workVariantId}:${roadUnitId}`);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"DOCUMENT" | "VIDEO">("DOCUMENT");
  const [mode, setMode] = useState<"file" | "link">("file");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const canManage = Boolean(guides.data?.canManage && !readOnly && !guides.loading && !guides.error);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !canManage) return;
    setError("");
    if (!title.trim()) { setError("Biriktirma nomini kiriting."); return; }
    if (mode === "file") {
      if (!file) { setError("Faylni tanlang."); return; }
      const validType = kind === "VIDEO" ? file.type === "video/mp4" : documentTypes.includes(file.type);
      if (!validType || file.size === 0 || file.size > (kind === "VIDEO" ? 100 : 20) * 1024 * 1024) {
        setError(kind === "VIDEO" ? "100 MB gacha bo‘lgan MP4 video tanlang." : "20 MB gacha bo‘lgan PDF, JPEG, PNG yoki WebP fayl tanlang.");
        return;
      }
    } else {
      try {
        const link = new URL(url.trim());
        if (link.protocol !== "https:" || link.username || link.password) throw new Error();
      } catch { setError("To‘liq HTTPS havolani kiriting."); return; }
    }
    setBusy(true);
    try {
      await api.addWorkGuide({ workVariantId, roadUnitId, title: title.trim(), kind, file: mode === "file" ? file ?? undefined : undefined, url: mode === "link" ? url.trim() : undefined });
      await guides.reload();
      setAdding(false);
      setTitle("");
      setFile(null);
      setUrl("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Biriktirmani saqlab bo‘lmadi.");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (busy || !canManage || deleting !== id) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteWorkGuide(id, roadUnitId);
      await guides.reload();
      setDeleting(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Biriktirmani olib tashlab bo‘lmadi.");
    } finally { setBusy(false); }
  }

  function open(guide: WorkGuide) {
    setError("");
    try {
      const target = new URL(guide.url, window.location.origin);
      const valid = guide.sourceType === "LINK"
        ? target.protocol === "https:" && !target.username && !target.password
        : target.origin === window.location.origin && target.pathname.startsWith("/api/v1/work-guides/");
      if (!valid) throw new Error("Biriktirma havolasi yaroqsiz.");
      window.open(target.href, "_blank", "noopener,noreferrer");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Biriktirmani ochib bo‘lmadi."); }
  }

  return <section className="work-guides" aria-label="Ish yo‘riqnomalari">
    <div className="card-heading"><h3><BookOpen size={18} aria-hidden="true" /> Yo‘riqnoma va video</h3>{canManage ? <Button type="button" variant="ghost" disabled={busy} onClick={() => { setAdding((value) => !value); setError(""); }}><Plus size={16} aria-hidden="true" /> Biriktirish</Button> : null}</div>
    {guides.loading ? <p role="status">Yuklanmoqda…</p> : guides.error ? <p role="alert">Yo‘riqnomalar yuklanmadi. <button type="button" onClick={() => void guides.reload()}>Qayta urinish</button></p> : guides.data?.items.length ? <ul className="guide-list">
      {guides.data.items.map((guide) => <li key={guide.id}>
        {guide.kind === "VIDEO" ? <Film size={20} aria-hidden="true" /> : <FileText size={20} aria-hidden="true" />}
        <button type="button" className="guide-open" aria-label={guide.title} onClick={() => open(guide)}><strong>{guide.title}</strong><small>{guide.kind === "VIDEO" ? "Video" : "Yo‘riqnoma"}{guide.fileName ? ` · ${guide.fileName}` : ""}</small></button>
        <ExternalLink size={16} aria-hidden="true" />
        {canManage ? <Button type="button" variant="ghost" disabled={busy} aria-label={`${guide.title}ni olib tashlash`} onClick={() => setDeleting(guide.id)}><Trash2 size={16} aria-hidden="true" /></Button> : null}
        {deleting === guide.id && canManage ? <div className="guide-confirm"><span>Biriktirma olib tashlansinmi?</span><Button type="button" variant="danger" busy={busy} onClick={() => void remove(guide.id)}>Olib tashlash</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>Qoldirish</Button></div> : null}
      </li>)}
    </ul> : <p className="field__hint">Bu ishga hali yo‘riqnoma biriktirilmagan.</p>}
    {adding && canManage ? <form className="guide-form" onSubmit={save}>
      <p><strong>{workName ?? "Tanlangan ish"}</strong></p>
      <TextInput label="Biriktirma nomi" name="guideTitle" required maxLength={200} disabled={busy} value={title} onChange={(event) => setTitle(event.target.value)} />
      <div className="data-form">
        <SelectInput label="Turi" disabled={busy} value={kind} onChange={(event) => { setKind(event.target.value as typeof kind); setFile(null); setError(""); }}><option value="DOCUMENT">Yo‘riqnoma</option><option value="VIDEO">Video</option></SelectInput>
        <SelectInput label="Qanday biriktiriladi?" disabled={busy} value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); setFile(null); setUrl(""); setError(""); }}><option value="file">Qurilmadan fayl</option><option value="link">Havola</option></SelectInput>
      </div>
      {mode === "file" ? <label className="field"><span className="field__label">Fayl</span><input key={`${kind}-${mode}`} aria-label="Fayl" type="file" required disabled={busy} accept={kind === "VIDEO" ? "video/mp4" : ".pdf,image/jpeg,image/png,image/webp"} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><small>{kind === "VIDEO" ? "MP4 · 100 MB gacha" : "PDF yoki rasm · 20 MB gacha"}</small></label> : <TextInput label="HTTPS havola" type="url" required disabled={busy} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" />}
      <div className="button-row"><Button type="submit" busy={busy}>Saqlash</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setAdding(false)}>Bekor qilish</Button></div>
    </form> : null}
    {error ? <p role="alert" className="inline-error">{error}</p> : null}
  </section>;
}
