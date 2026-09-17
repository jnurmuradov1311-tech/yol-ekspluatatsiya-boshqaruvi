"use client";

import { useState, useSyncExternalStore } from "react";

export function currentReportMonth(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit" }).format(new Date());
}
const validMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}
function locationMonth() {
  const value = new URLSearchParams(window.location.search).get("month") ?? "";
  return validMonth(value) ? value : "";
}
const serverMonth = () => "";
export function useReportMonth() {
  const queryMonth = useSyncExternalStore(subscribe, locationMonth, serverMonth);
  const [selectedMonth, selectMonth] = useState<string | null>(null);
  const setMonth = (value: string) => { if (validMonth(value)) selectMonth(value); };
  return [selectedMonth ?? (queryMonth || currentReportMonth()), setMonth] as const;
}
