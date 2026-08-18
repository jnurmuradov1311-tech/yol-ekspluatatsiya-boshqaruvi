"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Bell,
  Building2,
  Boxes,
  CalendarRange,
  CircleCheckBig,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  DatabaseZap,
  FileBarChart,
  FileCheck2,
  Gauge,
  HelpCircle,
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
import { scopeLevelLabels, useOperatingScope } from "@/components/scope-provider";
import { Button } from "@/components/ui";
import { hasGlobalPermission, hasPermission } from "@/lib/authz";

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
      { href: "/bajarilgan-ishlar", label: "Bajarilgan ishlar", icon: FileCheck2, permission: "costs.read" },
      { href: "/tabel", label: "Tabel", icon: ClipboardList, permission: "resources.read" },
    ],
  },
  {
    label: "Resurs",
    links: [
      { href: "/xodimlar", label: "Xodimlar", icon: Users, permission: "resources.read" },
      { href: "/texnika", label: "Texnika", icon: Truck, permission: "resources.read" },
      { href: "/ombor", label: "Ombor", icon: Boxes, permission: "resources.read" },
      { href: "/narxlar", label: "Narxlar va normalar", icon: CircleDollarSign, permission: "costs.read" },
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
      { href: "/admin", label: "Respublika nazorati", icon: Building2, permission: "system.all" },
      { href: "/integratsiyalar", label: "Integratsiyalar", icon: DatabaseZap, permission: "integrations.read" },
      { href: "/sozlamalar", label: "Sozlamalar", icon: Settings, permission: "system.all" },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const { scope } = useOperatingScope();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);
  const adminWorkspace = pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/sozlamalar";
  const homeHref = user?.division ? "/dashboard" : "/admin";
  const canSee = (permission: string | null, globalOnly = false) =>
    permission === null
      || (globalOnly
        ? hasGlobalPermission(user, permission)
        : Boolean(user?.division) && hasPermission(user, permission));

  useEffect(() => {
    if (!menuOpen) return;
    const mobileMedia = window.matchMedia("(max-width: 900px)");
    function closeMenu(restoreFocus = false) {
      setMenuOpen(false);
      if (restoreFocus) {
        window.requestAnimationFrame(() => menuButtonRef.current?.focus());
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu(true);
    }
    function onBreakpointChange(event: MediaQueryListEvent) {
      if (!event.matches) closeMenu();
    }
    document.addEventListener("keydown", onKeyDown);
    mobileMedia.addEventListener("change", onBreakpointChange);
    const previousOverflow = document.body.style.overflow;
    if (mobileMedia.matches) document.body.style.overflow = "hidden";
    const onPopState = () => closeMenu();
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("popstate", onPopState);
      mobileMedia.removeEventListener("change", onBreakpointChange);
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

  function closeMenuForNavigation() {
    const shouldMoveFocus = menuOpen;
    setMenuOpen(false);
    if (shouldMoveFocus) {
      window.requestAnimationFrame(() => mainContentRef.current?.focus());
    }
  }

  function prepareNavigation() {
    closeMenuForNavigation();
  }

  return (
    <AuthGuard>
      <div className="app-shell">
        <a className="skip-link" href="#main-content" tabIndex={menuOpen ? -1 : undefined}>Asosiy mazmunga o‘tish</a>
        <header className="mobile-header">
          <Link className="mobile-brand" href={homeHref} onClick={prepareNavigation}>
            <span className="brand-mark"><Route aria-hidden="true" /></span>
            <span>Yagona yo‘l</span>
          </Link>
          <button
            ref={menuButtonRef}
            className="icon-button"
            aria-label={menuOpen ? "Menyuni yopish" : "Menyuni ochish"}
            aria-controls="primary-navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </header>

        <aside
          id="primary-navigation"
          className={`sidebar ${menuOpen ? "sidebar--open" : ""}`}
          aria-label="Asosiy navigatsiya"
        >
          <Link className="brand" href={homeHref} onClick={prepareNavigation}>
            <span className="brand-mark"><Route aria-hidden="true" /></span>
            <span>
              <strong>Yagona yo‘l</strong>
              <small>Ekspluatatsiya boshqaruvi</small>
            </span>
          </Link>
          <nav className="nav-groups">
            {groups.map((group) => {
              const visibleLinks = group.links.filter((item) =>
                canSee(item.permission, item.href === "/admin" || item.href === "/sozlamalar"),
              );
              if (!visibleLinks.length) return null;
              return (
                <details className="nav-group" key={group.label} open>
                  <summary>{group.label}</summary>
                  {visibleLinks.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    const Icon = item.icon;
                    return (
                      <Link
                        href={item.href}
                        key={item.href}
                        aria-current={active ? "page" : undefined}
                        className={active ? "active" : undefined}
                        onClick={prepareNavigation}
                      >
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
            <div>
              <strong>{user?.fullName}</strong>
              <small>{user?.roleLabel}</small>
            </div>
            <Button variant="ghost" busy={loggingOut} onClick={handleLogout} aria-label="Tizimdan chiqish">
              <LogOut size={18} aria-hidden="true" />
            </Button>
          </div>
        </aside>
        {menuOpen ? (
          <button
            className="sidebar-scrim"
            aria-label="Menyuni yopish"
            onClick={() => {
              setMenuOpen(false);
              window.requestAnimationFrame(() => menuButtonRef.current?.focus());
            }}
          />
        ) : null}
        <main ref={mainContentRef} className="main-content" id="main-content" tabIndex={-1} inert={menuOpen}>
          <div className="workspace-bar" aria-label="Faol boshqaruv doirasi">
            <div className="scope-selector scope-selector--fixed">
              <span>{adminWorkspace ? "Administrator" : scopeLevelLabels[scope.level]}</span>
              <strong>{adminWorkspace ? "Respublika nazorati" : scope.shortName}</strong>
              <small>{adminWorkspace ? "Faqat global administrator jamlanmasi" : scope.roadLabel}</small>
            </div>
            <div className="workspace-actions">
              <button className="utility-button" aria-label="Bildirishnomalar"><Bell aria-hidden="true" /><span /></button>
              <button className="utility-button" aria-label="Yordam"><HelpCircle aria-hidden="true" /></button>
              <span className="workspace-account"><i className="avatar" aria-hidden="true">{user?.fullName.slice(0, 1)}</i><span><strong>{user?.fullName}</strong><small>{user?.roleLabel}</small></span></span>
            </div>
          </div>
          <div className="workspace-content">{children}</div>
        </main>
      </div>
    </AuthGuard>
  );
}
