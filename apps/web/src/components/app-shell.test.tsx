import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({ permissions: ["reports.read", "defects.capture", "defects.read", "execution.read"], pathname: "/topshiriqlar" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/components/auth-provider", () => ({
  AuthGuard: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ user: { fullName: "Yo‘l ustasi", roleLabel: "Usta", division: { id: "d1" }, permissions: state.permissions, globalPermissions: [] }, logout: vi.fn() }),
}));
vi.mock("@/components/scope-provider", () => ({ scopeLevelLabels: { division: "Yo‘l bo‘limi" }, useOperatingScope: () => ({ scope: { level: "division", shortName: "88-bo‘lim", roadLabel: "D001" } }) }));
import { AppShell } from "./app-shell";

beforeEach(() => {
  state.permissions = ["reports.read", "defects.capture", "defects.read", "execution.read"];
  vi.stubGlobal("matchMedia", vi.fn((query) => ({ matches: query === "(max-width: 900px)", addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Mobile navigation", () => {
  it("gives the foreman four clear actions, with an active task tab", () => {
    render(<AppShell><h1>Topshiriqlar</h1></AppShell>);
    const nav = within(screen.getByRole("navigation", { name: "Tezkor navigatsiya" }));
    expect(nav.getAllByRole("link")).toHaveLength(3);
    expect(nav.getByRole("link", { name: "Nuqson kiritish" })).toHaveAttribute("href", "/malumot-kiritish");
    expect(nav.getByRole("link", { name: "Topshiriqlar" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("button", { name: "Barcha bo‘limlar" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Oylik" })).not.toBeInTheDocument();
  });

  it("keeps inspection capture hidden for a reader and opens all sections from More", () => {
    state.permissions = ["reports.read", "defects.read", "execution.read"];
    render(<AppShell><h1>Topshiriqlar</h1></AppShell>);
    const nav = within(screen.getByRole("navigation", { name: "Tezkor navigatsiya" }));
    expect(nav.queryByRole("link", { name: "Nuqson kiritish" })).not.toBeInTheDocument();
    expect(nav.getByRole("link", { name: "Nuqsonlar" })).toHaveAttribute("href", "/tasdiqlangan-nuqsonlar");
    fireEvent.click(nav.getByRole("button", { name: "Barcha bo‘limlar" }));
    expect(screen.getByRole("dialog", { name: "Asosiy navigatsiya" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("main")).toHaveAttribute("inert");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).not.toHaveAttribute("inert");
  });
});
