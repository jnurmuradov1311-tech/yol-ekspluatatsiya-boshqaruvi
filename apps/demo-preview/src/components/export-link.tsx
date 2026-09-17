"use client";

import type { AnchorHTMLAttributes } from "react";
import { api } from "@/lib/api/client";

export function ExportLink({ children, className, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (api.fixturesEnabled) {
    return <button type="button" className={className} disabled title="Excel va PDF yuklash haqiqiy server ulangach ishlaydi.">{children}</button>;
  }
  return <a className={className} {...props}>{children}</a>;
}
