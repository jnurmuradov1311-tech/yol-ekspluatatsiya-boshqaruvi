"use client";

import { ScriptSwitch } from "@/components/script-provider";
import { api } from "@/lib/api/client";

import Link from "next/link";
import {MobileInstall} from "@/components/mobile-install";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
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
  Route,
  Settings,
  Truck,
  Users,
  X,
} from "lucide-react";
import { AuthGuard, useAuth } from "@/components/auth-provider";
import { scopeLevelLabels, useOperatingScope } from "@/components/scope-provider";
import { Button } from "@/components/ui";
import { hasGlobalPermission, hasPermission } from "@/lib/authz";

const groups = [
  { label: "Ish jarayoni", links: [
    { href: "/dashboard", label: "Bosh sahifa", icon: Gauge, permission: "reports.read" },
    { href: "/tasdiqlangan-nuqsonlar", label: "Nuqsonlar", icon: CircleCheckBig, permission: "defects.read" },
    { href: "/rejalashtirish", label: "Topshiriq yaratish", icon: CalendarRange, permission: "planning.read" },
    { href: "/topshiriqlar", label: "Ijro", icon: ClipboardCheck, permission: "execution.read" },
    { href: "/yol-harakati", label: "Yo‘l harakati", icon: Route, permission: "execution.read" },
    { href: "/ish-turlari", label: "Ish yo‘riqnomalari", icon: FileCheck2, permission: "planning.read" },
  ] },
  { label: "Yillik reja", links: [
    { href: "/saqlash-budjeti", label: "Saqlash budjeti", icon: CircleDollarSign, permission: "costs.read" },
    { href: "/yillik-dastur", label: "Yillik reja", icon: BarChart3, permission: "reports.read" },
  ] },
  { label: "Oy yakuni", links: [
    { href: "/xarajatlar", label: "Xarajatlar", icon: CircleDollarSign, permission: "costs.read" },
    { href: "/tabel", label: "Tabel", icon: ClipboardList, permission: "resources.read" },
    { href: "/bajarilgan-ishlar", label: "Dalolatnoma", icon: FileCheck2, permission: "costs.read" },
    { href: "/oylik", label: "Oylik jadvali", icon: CircleDollarSign, permission: "costs.read" },
  ] },
  { label: "Xodim va resurslar", links: [
    { href: "/xodimlar", label: "Xodimlar", icon: Users, permission: "resources.read" },
    { href: "/ombor", label: "Ombor", icon: Boxes, permission: "resources.read" },
    { href: "/texnika", label: "Texnika", icon: Truck, permission: "resources.read" },
    { href: "/talabnomalar", label: "Talabnomalar", icon: ClipboardList, permission: "planning.read" },
    { href: "/narxlar", label: "Narxlar va normalar", icon: CircleDollarSign, permission: "costs.read" },
  ] },
  { label: "Boshqaruv", links: [
    { href: "/xarita", label: "Xarita", icon: Map, permission: "defects.read" },
    { href: "/hisobotlar", label: "Hisobotlar", icon: FileBarChart, permission: "reports.read" },
    { href: "/admin", label: "Respublika nazorati", icon: Building2, permission: "system.all" },
    { href: "/integratsiyalar", label: "YTP va ulanishlar", icon: DatabaseZap, permission: "integrations.read" },
    { href: "/sozlamalar", label: "Sozlamalar", icon: Settings, permission: "system.all" },
  ] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, refresh } = useAuth();
  const { scope } = useOperatingScope();
  const [menuOpen, setMenuOpen] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState("");
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

  async function changeDemoRole(role: "chief" | "engineer" | "foreman") {
    setDemoBusy(true); setDemoError("");
    try { await api.demoRole(role); await refresh(); }
    catch (error) { setDemoError(error instanceof Error ? error.message : "Rolni almashtirib bo‘lmadi."); }
    finally { setDemoBusy(false); }
  }
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
                <details className="nav-group" key={`${group.label}-${pathname}`} open={group.label === "Ish jarayoni" || visibleLinks.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))}>
                  <summary>{group.label}</summary>
                  {visibleLinks.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`) || (item.href === "/tasdiqlangan-nuqsonlar" && ["/nuqsonlar", "/malumot-kiritish"].includes(pathname));
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
          <MobileInstall/>
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
          <div className="workspace-content">
            {api.fixturesEnabled ? <aside className="demo-notice" aria-label="Demo haqida">
              <strong>Demo</strong><ScriptSwitch />
              <label className="demo-role">Sinov roli <select value={user?.id.replace("demo-","") ?? "chief"} disabled={demoBusy} onChange={(event)=>void changeDemoRole(event.target.value as "chief" | "engineer" | "foreman")}><option value="chief">Yo‘l bo‘limi boshlig‘i</option><option value="engineer">Bosh muhandis</option><option value="foreman">Yo‘l ustasi</option></select></label>
              {demoError ? <p role="alert">{demoError}</p> : null}
              <details id="demo-help"><summary>Demo haqida</summary>
                <p>Budjet, reja va ijro shu brauzerda birga saqlanadi. Boshqa qurilmaga avtomatik uzatilmaydi. Ish haqi, tabel va dalolatnomani Excelga yuklash ishlaydi. Tashqi Road AI/YTP ulanishlari demoda yoqilmagan.</p>
                <p>Boshliq ishni belgilaydi va ijroga beradi; bosh muhandis ta’minot talabnomasini ko‘radi; usta ishni bajaradi. Boshqa mas’ul bajarilgan ishni tasdiqlagach tabel va oylik hisoblanadi.</p>
              </details>
            </aside> : null}
            {children}
          </div>
        </main>
        <nav className="mobile-bottom-nav" aria-label="Mobil navigatsiya" style={{gridTemplateColumns:'repeat(4,minmax(0,1fr))'}}>
          <Link href={homeHref} aria-current={pathname===homeHref?'page':undefined} onClick={prepareNavigation}><Gauge size={20}/><span>Bosh sahifa</span></Link>
          <Link href="/tasdiqlangan-nuqsonlar" aria-current={['/tasdiqlangan-nuqsonlar','/malumot-kiritish','/nuqsonlar'].includes(pathname)?'page':undefined} onClick={prepareNavigation}><CircleCheckBig size={20}/><span>Nuqsonlar</span></Link>
          <Link href="/topshiriqlar" aria-current={pathname.startsWith('/topshiriqlar')?'page':undefined} onClick={prepareNavigation}><ClipboardCheck size={20}/><span>Topshiriqlar</span></Link>
          <button onClick={()=>setMenuOpen(v=>!v)} aria-expanded={menuOpen} aria-controls="primary-navigation"><Menu size={20}/><span>Menyu</span></button>
        </nav>
      </div>
    </AuthGuard>
  );
}
