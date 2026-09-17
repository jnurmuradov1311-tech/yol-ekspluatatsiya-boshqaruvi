"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function DefectNavigation() {
  const pathname=usePathname();
  const active=pathname.startsWith('/topshiriqlar')?3:pathname==='/rejalashtirish'?2:1;
  return <nav className="process-navigation" aria-label="Nuqsondan ijrogacha">{[
    ['/tasdiqlangan-nuqsonlar','Nuqson',1],['/rejalashtirish','Topshiriq',2],['/topshiriqlar','Ijro',3],
  ].map(([href,label,step])=><Link key={href} href={String(href)} aria-current={active===step?'step':undefined}><span>{step}</span>{label}</Link>)}</nav>;
}
