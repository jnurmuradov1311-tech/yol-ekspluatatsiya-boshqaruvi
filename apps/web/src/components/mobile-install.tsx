"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Smartphone } from "lucide-react";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function standalone() {
  return window.matchMedia("(display-mode: standalone)").matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function subscribeInstallation(callback: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", callback);
  window.addEventListener("appinstalled", callback);
  return () => {
    media.removeEventListener("change", callback);
    window.removeEventListener("appinstalled", callback);
  };
}

export function MobileInstall() {
  const installed = useSyncExternalStore(subscribeInstallation, standalone, () => false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const complete = () => { setPrompt(null); setNotice("Ilova o‘rnatildi."); };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", complete);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", complete);
    };
  }, []);

  async function install() {
    if (!prompt || busy) return;
    setBusy(true);
    try {
      await prompt.prompt();
      const result = await prompt.userChoice;
      setNotice(result.outcome === "accepted" ? "O‘rnatish boshlandi." : "Keyinroq brauzer menyusidan o‘rnatishingiz mumkin.");
    } catch {
      setNotice("Brauzer menyusidan «Ilovani o‘rnatish»ni tanlang.");
    } finally {
      setPrompt(null);
      setBusy(false);
    }
  }

  if (installed) return null;
  return (
    <details className="mobile-install">
      <summary><Smartphone size={18} aria-hidden="true" />Ilovani o‘rnatish</summary>
      {prompt ? <button className="button button--secondary" disabled={busy} onClick={() => void install()}><Download size={16} aria-hidden="true" />{busy ? "O‘rnatilmoqda…" : "Telefonga o‘rnatish"}</button> : (
        <div className="install-instructions">
          <p><strong>Android:</strong> brauzer menyusi → «Ilovani o‘rnatish».</p>
          <p><strong>iPhone:</strong> Safari → «Ulashish» → «Bosh ekranga qo‘shish».</p>
        </div>
      )}
      {notice ? <p role="status">{notice}</p> : null}
    </details>
  );
}
