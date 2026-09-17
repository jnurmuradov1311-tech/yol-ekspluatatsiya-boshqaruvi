"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Settings } from "lucide-react";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/use-api-resource";
import { Button, Card, ErrorState, LoadingState, PageHeader, SelectInput, TextInput } from "@/components/ui";

export default function SettingsPage() {
  const { data, error, loading, reload } = useApiResource(api.settings, "settings");
  return (
    <div className="page-stack">
      <PageHeader title="Sozlamalar" description="Tashkilot bo‘yicha umumiy ish parametrlari. Har bir o‘zgarish audit tarixiga yoziladi." />
      {loading ? <LoadingState /> : error ? <ErrorState error={error} retry={reload} /> : data ? <SettingsForm initial={data} /> : null}
    </div>
  );
}

function SettingsForm({ initial }: { initial: Record<string, string> }) {
  const [timezone, setTimezone] = useState(initial.timezone ?? "Asia/Tashkent");
  const [planningHorizonDays, setPlanningHorizonDays] = useState(initial.planningHorizonDays ?? "14");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setActionError("");
    try {
      await api.saveSettings({ timezone, planningHorizonDays });
      setMessage("Sozlamalar saqlandi.");
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Sozlamalarni saqlab bo‘lmadi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="form-card narrow-card"><div className="card-heading"><div><p className="eyebrow">Umumiy</p><h2>Rejalashtirish muhiti</h2></div><Settings aria-hidden="true" /></div>{message ? <div className="success-banner" role="status"><CheckCircle2 aria-hidden="true" />{message}</div> : null}{actionError ? <p className="inline-error" role="alert">{actionError}</p> : null}<form className="settings-form" onSubmit={submit}><SelectInput label="Vaqt mintaqasi" name="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)}><option value="Asia/Tashkent">Asia/Tashkent</option></SelectInput><TextInput label="Rejalashtirish oralig‘i, kun" name="planningHorizonDays" type="number" min="1" max="90" required value={planningHorizonDays} onChange={(event) => setPlanningHorizonDays(event.target.value)} /><Button type="submit" busy={busy}>Sozlamalarni saqlash</Button></form></Card>
  );
}
