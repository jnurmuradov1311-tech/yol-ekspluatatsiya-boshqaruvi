"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  BookOpen,
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
import { MobileInstall } from "@/components/mobile-install";
import { hasGlobalPermission, hasPermission } from "@/lib/authz";

const groups = [
  {
    label: "Ish jarayoni",
    links: [
      { href: "/dashboard", label: "Bosh sahifa", icon: Gauge, permission: "reports.read" },
      { href: "/malumot-kiritish", label: "Nuqson kiritish", icon: PenLine, permission: "defects.capture" },
      { href: "/tasdiqlangan-nuqsonlar", label: "Nuqsonlar", icon: CircleCheckBig, permission: "defects.read" },
      { href: "/rejalashtirish", label: "Topshiriq yaratish", icon: CalendarRange, permission: "planning.read" },
      { href: "/topshiriqlar", label: "Topshiriqlar", icon: ClipboardCheck, permission: "execution.read" },
      { href: "/yol-harakati", label: "Yo‘l harakati", icon: Route, permission: "execution.read" },
    ],
  },
  {
    label: "AI tahlili",
    links: [
      { href: "/nuqsonlar", label: "RoadVision topilmalari", icon: ShieldCheck, permission: "defects.read" },
    ],
  },
  {
    label: "Hisob va hisobot",
    links: [
      { href: "/bajarilgan-ishlar", label: "Dalolatnomalar", icon: FileCheck2, permission: "costs.read" },
      { href: "/tabel", label: "Tabel", icon: ClipboardList, permission: "resources.read" },
      { href: "/oylik", label: "Oylik", icon: CircleDollarSign, permission: "costs.read" },
      { href: "/xarajatlar", label: "Xarajatlar", icon: CircleDollarSign, permission: "costs.read" },
      { href: "/hisobotlar", label: "Hisobotlar", icon: FileBarChart, permission: "reports.read" },
    ],
  },
  {
    label: "Resurs",
    links: [
      { href: "/xodimlar", label: "Xodimlar", icon: Users, permission: "resources.read" },
      { href: "/texnika", label: "Texnika", icon: Truck, permission: "resources.read" },
      { href: "/ombor", label: "Ombor", icon: Boxes, permission: "resources.read" },
      { href: "/talabnomalar", label: "Talabnomalar", icon: ClipboardList, permission: "planning.read" },
      { href: "/narxlar", label: "Narxlar va normalar", icon: CircleDollarSign, permission: "costs.read" },
      { href: "/ish-turlari", label: "Ish yo‘riqnomalari", icon: BookOpen, permission: "planning.read" },
    ],
  },
  {
    label: "Yillik reja",
    links: [
      { href: "/yillik-dastur", label: "Yillik dastur", icon: BarChart3, permission: "reports.read" },
      { href: "/xarita", label: "Xarita", icon: Map, permission: "defects.read" },
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
  const sidebarRef = useRef<HTMLElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);
  const adminWorkspace = pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/sozlamalar";
  const homeHref = user?.division ? "/dashboard" : "/admin";
  const canSee = (permission: string | null, globalOnly = false) =>
    permission === null
      || (globalOnly
        ? hasGlobalPermission(user, permission)
        : Boolean(user?.division) && hasPermission(user, permission));
  const mobileLinks = [
    { href: homeHref, label: "Bosh sahifa", icon: Gauge, visible: canSee(user?.division ? "reports.read" : "system.all", !user?.division) },
    canSee("defects.capture")
      ? { href: "/malumot-kiritish", label: "Nuqson kiritish", icon: PenLine, visible: true }
      : { href: "/tasdiqlangan-nuqsonlar", label: "Nuqsonlar", icon: CircleCheckBig, visible: canSee("defects.read") },
    { href: "/topshiriqlar", label: "Topshiriqlar", icon: ClipboardCheck, visible: canSee("execution.read") },
  ].filter((item) => item.visible);

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
      if (event.key === "Tab" && mobileMedia.matches) {
        const focusable = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), summary") ?? [])
          .filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first && last && (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    }
    function onBreakpointChange(event: MediaQueryListEvent) {
      if (!event.matches) closeMenu();
    }
    document.addEventListener("keydown", onKeyDown);
    mobileMedia.addEventListener("change", onBreakpointChange);
    const previousOverflow = document.body.style.overflow;
    if (mobileMedia.matches) {
      document.body.style.overflow = "hidden";
      sidebarRef.current?.querySelector<HTMLElement>("button")?.focus();
    }
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
          <Link className="mobile-brand" href={homeHref} onClick={prepareNavigation} tabIndex={menuOpen ? -1 : undefined}>
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
          ref={sidebarRef}
          id="primary-navigation"
          className={`sidebar ${menuOpen ? "sidebar--open" : ""}`}
          aria-label="Asosiy navigatsiya"
          role={menuOpen ? "dialog" : undefined}
          aria-modal={menuOpen || undefined}
        >
          <button className="sidebar-close icon-button" aria-label="Menyuni yopish" onClick={() => { setMenuOpen(false); menuButtonRef.current?.focus(); }}><X aria-hidden="true" /></button>
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
                <details className="nav-group" key={group.label} open={group.label === "Ish jarayoni" || visibleLinks.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))}>
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
          <MobileInstall />
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
              <span className="workspace-account"><i className="avatar" aria-hidden="true">{user?.fullName.slice(0, 1)}</i><span><strong>{user?.fullName}</strong><small>{user?.roleLabel}</small></span></span>
            </div>
          </div>
          <div className="workspace-content">{children}</div>
        </main>
        <nav className="mobile-bottom-nav" aria-label="Tezkor navigatsiya" inert={menuOpen} style={{ gridTemplateColumns: `repeat(${mobileLinks.length + 1}, minmax(0, 1fr))` }}>
          {mobileLinks.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} onClick={prepareNavigation}><Icon size={22} aria-hidden="true" /><span>{item.label}</span></Link>;
          })}
          <button aria-label="Barcha bo‘limlar" aria-expanded={menuOpen} aria-controls="primary-navigation" onClick={() => setMenuOpen(true)}><Menu size={22} aria-hidden="true" /><span>Yana</span></button>
        </nav>
      </div>
    </AuthGuard>
  );
}
