"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert, DatabaseZap, RefreshCw, Settings2 } from "lucide-react";
import { api } from "@/lib/api/client";
import type { IntegrationReadiness } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { useApiResource } from "@/lib/use-api-resource";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/ui";

function integrationState(state: IntegrationReadiness["state"]) {
  const states: Record<IntegrationReadiness["state"], { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
    READY: { label: "Tayyor", tone: "success" },
    NEEDS_CONFIGURATION: { label: "Sozlash kerak", tone: "warning" },
    SYNCING: { label: "Sinxronlanmoqda", tone: "info" },
    ERROR: { label: "Xato", tone: "danger" },
    DISABLED: { label: "O‘chirilgan", tone: "neutral" },
  };
  return states[state];
}

export default function IntegrationsPage() {
  const { data, error, loading, reload, setData } = useApiResource(api.integrations, "integrations");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  async function sync(code: IntegrationReadiness["code"]) {
    setSyncing(code);
    setActionError("");
    try {
      const updated = await api.syncIntegration(code);
      setData((current) => current?.map((item) => item.code === code ? updated : item) ?? current);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Sinxronlashni boshlab bo‘lmadi.");
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="Integratsiyalar" description="Tashqi tizimlardan qaysi ma’lumot olinishi, ulanish tayyorligi va so‘nggi almashinuv holati." actions={<Button variant="secondary" onClick={reload}><RefreshCw size={16} aria-hidden="true" /> Yangilash</Button>} />
      <div className="source-boundary"><DatabaseZap aria-hidden="true" /><div><strong>Ma’lumotlar manbasi qat’iy ajratilgan</strong><p>Yo‘l, element, yo‘l bo‘limi va ishchi — Yo‘l ta’mirlash punktidan. Avtomatik aniqlangan nuqson va dalil — RoadVision AI’dan. Mahalliy tahrirlar manba yozuvini almashtirmaydi.</p></div></div>
      {actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}
      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? data.length ? (
        <div className="integration-grid">{data.map((integration) => {
          const state = integrationState(integration.state);
          const ready = integration.state === "READY";
          const syncable = ready && integration.code !== "SUPABASE";
          return <Card className="integration-card" key={integration.code}>
            <header><span className={`integration-icon integration-icon--${ready ? "ready" : "attention"}`}>{ready ? <CheckCircle2 aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}</span><div><h2>{integration.name}</h2><Badge tone={state.tone}>{state.label}</Badge></div></header>
            <p className="integration-message">{integration.message}</p>
            <div><span className="field-caption">Olinadigan ma’lumot</span><ul className="chip-list">{integration.supplies.map((item) => <li key={item}>{item}</li>)}</ul></div>
            <dl className="integration-times"><div><dt>So‘nggi muvaffaqiyatli almashinuv</dt><dd>{formatDateTime(integration.lastSuccessfulSyncAt)}</dd></div><div><dt>So‘nggi urinish</dt><dd>{formatDateTime(integration.lastAttemptAt)}</dd></div></dl>
            {integration.requiredActions.length ? <div className="required-actions"><strong><Settings2 size={16} aria-hidden="true" /> Tayyorlash uchun</strong><ol>{integration.requiredActions.map((item) => <li key={item}>{item}</li>)}</ol></div> : <EmptyState title="Ulanish tayyor" detail="Majburiy sozlash amali qolmagan." />}
            <Button variant="secondary" busy={syncing === integration.code} disabled={!syncable} onClick={() => sync(integration.code)}><RefreshCw size={16} aria-hidden="true" /> {integration.code === "SUPABASE" ? "Sinxronlash talab qilinmaydi" : "Sinxronlashni boshlash"}</Button>
          </Card>;
        })}</div>
      ) : <EmptyState title="Integratsiya ro‘yxati yo‘q" detail="Administrator ulanishlarni ro‘yxatdan o‘tkazishi kerak." /> : null}
    </div>
  );
}
