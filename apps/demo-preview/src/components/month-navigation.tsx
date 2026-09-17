"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function MonthNavigation({ month }: { month: string }) {
  const pathname = usePathname();
  return <nav className="section-links" aria-label="Oy yakuni">{[["/tabel", "Tabel"], ["/bajarilgan-ishlar", "Dalolatnoma"], ["/oylik", "Oylik hisoblash"], ["/xarajatlar", "Xarajatlar"], ["/texnika", "Texnika hisobi"]].map(([href, label]) => <Link key={href} href={`${href}?month=${encodeURIComponent(month)}`} aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}</nav>;
}
