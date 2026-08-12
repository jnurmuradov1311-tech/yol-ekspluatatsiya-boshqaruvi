"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api/client";
import type { User } from "@/lib/api/types";

type AuthContextValue = {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string, totpCode?: string) => Promise<{ mfaRequired: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const routePermissions: Array<[prefix: string, permission: string]> = [
  ["/dashboard", "reports.read"],
  ["/malumot-kiritish", "defects.capture"],
  ["/nuqsonlar", "defects.read"],
  ["/tasdiqlangan-nuqsonlar", "defects.read"],
  ["/rejalashtirish", "planning.read"],
  ["/topshiriqlar", "execution.read"],
  ["/tabel", "resources.read"],
  ["/xodimlar", "resources.read"],
  ["/texnika", "resources.read"],
  ["/ombor", "resources.read"],
  ["/yillik-dastur", "reports.read"],
  ["/xarita", "defects.read"],
  ["/hisobotlar", "reports.read"],
  ["/integratsiyalar", "integrations.read"],
  ["/sozlamalar", "system.all"],
];

function can(user: User, permission: string) {
  return user.permissions.includes("system.all") || user.permissions.includes(permission);
}

function firstAllowedRoute(user: User) {
  return routePermissions.find(([, permission]) => can(user, permission))?.[0] ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setUser(null);
      else throw error;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void refresh().catch(() => setReady(true)), 0);
    return () => window.clearTimeout(task);
  }, [refresh]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    ready,
    refresh,
    login: async (email, password, totpCode) => {
      const result = await api.login(email, password, totpCode);
      if ("mfaRequired" in result) return { mfaRequired: true };
      setUser(result);
      setReady(true);
      return { mfaRequired: false };
    },
    logout: async () => {
      await api.logout();
      setUser(null);
    },
  }), [ready, refresh, user]);

  return (
    <AuthContext.Provider value={value}>
      {api.fixturesEnabled ? <div className="fixture-ribbon" role="status">E2E SINOV REJIMI — MA’LUMOTLAR HAQIQIY EMAS</div> : null}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth AuthProvider ichida ishlatilishi kerak.");
  return context;
}

export function useHasPermission(permission: string) {
  const { user } = useAuth();
  return Boolean(user && can(user, permission));
}

export function AuthGuard({ children }: { children: ReactNode }) {
  const { ready, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
      return;
    }
    const rule = routePermissions.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    if (rule && !can(user, rule[1])) {
      const fallback = firstAllowedRoute(user);
      if (fallback && fallback !== pathname) router.replace(fallback);
    }
  }, [pathname, ready, router, user]);

  if (!ready || !user) {
    return <main className="full-page-loader" aria-busy="true"><span className="brand-mark">YY</span><p>Sessiya tekshirilmoqda…</p></main>;
  }
  const rule = routePermissions.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (rule && !can(user, rule[1])) {
    if (!firstAllowedRoute(user)) {
      return <main className="full-page-loader"><span className="brand-mark">YY</span><p>Hisobga hech bir operativ bo‘lim uchun ruxsat berilmagan.</p></main>;
    }
    return <main className="full-page-loader" aria-busy="true"><span className="brand-mark">YY</span><p>Ruxsat etilgan bo‘lim ochilmoqda…</p></main>;
  }
  return children;
}
