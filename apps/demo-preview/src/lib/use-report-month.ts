"use client";
import { useCallback, useEffect, useState } from "react";
export function useReportMonth() {
  const [month, setMonth] = useState(() => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tashkent" }).slice(0, 7));
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("month");
    if (value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)) setMonth(value);
  }, []);
  const selectMonth=useCallback((value:string)=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(value))setMonth(value);},[]);
  return [month, selectMonth] as const;
}
