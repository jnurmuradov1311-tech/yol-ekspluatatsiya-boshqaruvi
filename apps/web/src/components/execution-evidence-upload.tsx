"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, ExternalLink } from "lucide-react";
import { api } from "@/lib/api/client";
import type { WorkOrderEvidenceUpload } from "@/lib/api/types";
import { isAuthorizedWorkEvidence } from "@/lib/execution-entry";
import { Button } from "./ui";

export function ExecutionEvidenceUpload({ orderId, disabled, onChange, onUploadingChange }: {
  orderId: string;
  disabled?: boolean;
  onChange: (receipt: WorkOrderEvidenceUpload | null) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [receipt, setReceipt] = useState<WorkOrderEvidenceUpload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const generation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewRef = useRef("");
  useEffect(() => () => {
    generation.current += 1;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
  }, []);

  function clearPreview() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setPreviewUrl("");
  }

  async function upload(selected: File) {
    const request = ++generation.current;
    setReceipt(null); clearPreview(); onChange(null); setError("");
    if (!["image/jpeg", "image/png", "application/pdf"].includes(selected.type) || selected.size === 0 || selected.size > 20 * 1024 * 1024) {
      setFile(null); setError("JPEG, PNG yoki PDF fayl tanlang. Hajmi 20 MB dan oshmasin.");
      return;
    }
    setFile(selected); setUploading(true); onUploadingChange(true);
    try {
      const saved = await api.uploadWorkOrderEvidence(orderId, selected);
      if (generation.current !== request) return;
      if (!isAuthorizedWorkEvidence(orderId, saved.url, [saved.url])) throw new Error("Server fayl manzilini tasdiqlamadi. Qayta yuklang.");
      previewRef.current = typeof URL.createObjectURL === "function" ? URL.createObjectURL(selected) : "";
      setPreviewUrl(previewRef.current); setReceipt(saved); onChange(saved);
    } catch (caught) {
      if (generation.current === request) setError(caught instanceof Error ? caught.message : "Faylni yuklab bo‘lmadi. Qayta urinib ko‘ring.");
    } finally {
      if (generation.current === request) { setUploading(false); onUploadingChange(false); }
    }
  }

  function remove() {
    generation.current += 1; clearPreview(); setFile(null); setReceipt(null); setError(""); onChange(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  return <div className="field">
    <label className="field__label" htmlFor="execution-evidence-file"><Camera size={16} aria-hidden="true" /> Foto yoki hujjat</label>
    <input ref={fileInput} className="input" id="execution-evidence-file" type="file" accept="image/jpeg,image/png,application/pdf" disabled={disabled || uploading} aria-describedby="execution-evidence-help" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void upload(selected); }} />
    <span className="field__hint" id="execution-evidence-help">Bajarilgan ish fotosi yoki PDF · 20 MB gacha</span>
    {uploading ? <div role="status" aria-live="polite"><progress aria-label="Fayl yuklanmoqda" /> <span>{file?.name} yuklanmoqda…</span></div> : null}
    {error ? <div><p className="inline-error" role="alert">{error}</p>{file ? <Button type="button" variant="secondary" disabled={disabled} onClick={() => void upload(file)}>Qayta yuklash</Button> : null}</div> : null}
    {receipt ? <div><p role="status"><CheckCircle2 size={16} aria-hidden="true" /> {receipt.fileName} yuklandi.</p><div className="button-row"><a className="button button--secondary" href={previewUrl || receipt.url} target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden="true" /> Faylni ko‘rish</a><Button type="button" variant="ghost" disabled={disabled} onClick={remove}>Olib tashlash</Button></div></div> : null}
  </div>;
}
