"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LockKeyhole, Route, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button, TextInput } from "@/components/ui";
import { api } from "@/lib/api/client";

function LoginForm() {
  const { login, ready, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(api.fixturesEnabled ? "operator@example.uz" : "");
  const [password, setPassword] = useState(api.fixturesEnabled ? "e2e-password" : "");
  const [totpCode, setTotpCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const returnTo = searchParams.get("returnTo");
  const safeReturnTo = returnTo?.startsWith("/") && !returnTo.startsWith("//") && !returnTo.includes("\\") ? returnTo : "/dashboard";

  useEffect(() => {
    if (ready && user) {
      if (api.fixturesEnabled) window.location.replace(safeReturnTo);
      else router.replace(safeReturnTo);
    }
  }, [ready, router, safeReturnTo, user]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await login(email.trim(), password, mfaRequired ? totpCode : undefined);
      if (result.mfaRequired) {
        setMfaRequired(true);
        setTotpCode("");
        return;
      }
      if (api.fixturesEnabled) window.location.replace(safeReturnTo);
      else router.replace(safeReturnTo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kirish amalga oshmadi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-intro" aria-labelledby="intro-title">
        <div className="login-brand"><span className="brand-mark"><Route aria-hidden="true" /></span><span>Yagona yo‘l</span></div>
        <div>
          <p className="eyebrow">Yo‘l ekspluatatsiyasi</p>
          <h1 id="intro-title">Nuqsondan bajarilgan ishgacha — sodda va aniq</h1>
          <p>Nuqson, IQN ishi, muddat, xodim va resurslar, topshiriq, tabel hamda oylik hisobini namuna ma’lumotlarida ko‘rib chiqing.</p>
        </div>
        <div className="login-assurance"><ShieldCheck aria-hidden="true" /><span>Namuna ma’lumotlari · Yangi ish jarayoni</span></div>
      </section>
      <section className="login-panel" aria-labelledby="login-title">
        <form className="login-form" onSubmit={submit}>
          <span className="login-lock"><LockKeyhole aria-hidden="true" /></span>
          <div><h2 id="login-title">Tizimga kirish</h2><p>Demo ma’lumotlari oldindan kiritilgan.</p></div>
          {error ? <div className="inline-error" role="alert">{error}</div> : null}
          <TextInput label="Elektron pochta" name="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <TextInput label="Parol" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          {mfaRequired ? <TextInput label="Autentifikator kodi" name="totpCode" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoFocus value={totpCode} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))} hint="Autentifikator ilovasidagi 6 xonali kodni kiriting." /> : null}
          <Button type="submit" busy={busy}>{mfaRequired ? "Kodni tasdiqlash" : "Kirish"}</Button>
          <p className="login-help">Faqat «Kirish» tugmasini bosing.</p>
        </form>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<main className="full-page-loader" aria-busy="true"><span className="brand-mark">YY</span><p>Kirish sahifasi yuklanmoqda…</p></main>}><LoginForm /></Suspense>;
}
