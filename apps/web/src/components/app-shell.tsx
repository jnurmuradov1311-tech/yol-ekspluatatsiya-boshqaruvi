"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3,
  Boxes,
  CalendarRange,
  CircleCheckBig,
  ClipboardCheck,
  ClipboardList,
  DatabaseZap,
  FileBarChart,
  Gauge,
  LogOut,
  Map,
  Menu,
  PenLine,
  Route,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  X,
} from "lucide-react";
import { AuthGuard, useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui";

const groups = [
  {
    label: "Operativ",
    links: [
      { href: "/dashboard", label: "Bosh sahifa", icon: Gauge, permission: "reports.read" },
      { href: "/malumot-kiritish", label: "Yo‘l ustasi ko‘rigi", icon: PenLine, permission: "defects.capture" },
      { href: "/nuqsonlar", label: "RoadVision AI topilmalari", icon: ShieldCheck, permission: "defects.read" },
      { href: "/tasdiqlangan-nuqsonlar", label: "Tasdiqlangan nuqsonlar", icon: CircleCheckBig, permission: "defects.read" },
    ],
  },
  {
    label: "Reja",
    links: [
      { href: "/rejalashtirish", label: "Rejalashtirish", icon: CalendarRange, permission: "planning.read" },
      { href: "/topshiriqlar", label: "Topshiriqlar", icon: ClipboardCheck, permission: "execution.read" },
      { href: "/tabel", label: "Tabel", icon: ClipboardList, permission: "resources.read" },
    ],
  },
  {
    label: "Resurs",
    links: [
      { href: "/xodimlar", label: "Xodimlar", icon: Users, permission: "resources.read" },
      { href: "/texnika", label: "Texnika", icon: Truck, permission: "resources.read" },
      { href: "/ombor", label: "Ombor", icon: Boxes, permission: "resources.read" },
    ],
  },
  {
    label: "Tahlil",
    links: [
      { href: "/yillik-dastur", label: "Yillik saqlash ishlari dasturi", icon: BarChart3, permission: "reports.read" },
      { href: "/xarita", label: "Xarita", icon: Map, permission: "defects.read" },
      { href: "/hisobotlar", label: "Hisobotlar", icon: FileBarChart, permission: "reports.read" },
    ],
  },
  {
    label: "Boshqaruv",
    links: [
      { href: "/integratsiyalar", label: "Integratsiyalar", icon: DatabaseZap, permission: "integrations.read" },
      { href: "/sozlamalar", label: "Sozlamalar", icon: Settings, permission: "system.all" },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const permissions = new Set(user?.permissions ?? []);
  const canSee = (permission: string | null) => permission === null
    || permissions.has("system.all")
    || permissions.has(permission);

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      router.replace("/login");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <AuthGuard>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">Asosiy mazmunga o‘tish</a>
        <header className="mobile-header">
          <Link className="mobile-brand" href="/dashboard" onClick={() => setMenuOpen(false)}><span className="brand-mark">YY</span><span>Yo‘l ekspluatatsiyasi</span></Link>
          <button className="icon-button" aria-label={menuOpen ? "Menyuni yopish" : "Menyuni ochish"} aria-controls="primary-navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </header>

        <aside id="primary-navigation" className={`sidebar ${menuOpen ? "sidebar--open" : ""}`} aria-label="Asosiy navigatsiya">
          <Link className="brand" href="/dashboard" onClick={() => setMenuOpen(false)}>
            <span className="brand-mark"><Route aria-hidden="true" /></span>
            <span><strong>Yagona yo‘l</strong><small>Ekspluatatsiya boshqaruvi</small></span>
          </Link>
          <nav className="nav-groups">
            {groups.map((group) => {
              const visibleLinks = group.links.filter((item) => canSee(item.permission));
              if (!visibleLinks.length) return null;
              return (
              <details className="nav-group" key={group.label} open>
                <summary>{group.label}</summary>
                {visibleLinks.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <Link href={item.href} key={item.href} aria-current={active ? "page" : undefined} className={active ? "active" : undefined} onClick={() => setMenuOpen(false)}>
                      <Icon aria-hidden="true" size={18} />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </details>
              );
            })}
          </nav>
          <div className="sidebar-user">
            <span className="avatar" aria-hidden="true">{user?.fullName.slice(0, 1)}</span>
            <div><strong>{user?.fullName}</strong><small>{user?.roleLabel}</small></div>
            <Button variant="ghost" busy={loggingOut} onClick={handleLogout} aria-label="Tizimdan chiqish"><LogOut size={18} aria-hidden="true" /></Button>
          </div>
        </aside>
        {menuOpen ? <button className="sidebar-scrim" aria-label="Menyuni yopish" onClick={() => setMenuOpen(false)} /> : null}
        <main className="main-content" id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </AuthGuard>
  );
}
