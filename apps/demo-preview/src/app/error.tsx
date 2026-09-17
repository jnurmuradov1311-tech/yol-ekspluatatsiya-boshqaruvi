"use client";

import { Button } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="fatal-error" role="alert">
      <h1>Sahifani ochib bo‘lmadi</h1>
      <p>{error.message || "Kutilmagan xato yuz berdi."}</p>
      <Button onClick={reset}>Qayta urinish</Button>
    </main>
  );
}
