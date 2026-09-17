import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Page from "./page";
vi.mock("@/components/auth-provider", () => ({ useHasPermission: () => true }));
vi.mock("@/lib/use-api-resource", () => ({ useApiResource: () => ({ loading: false, error: null, data: { year: 2026, month: 9, daysInMonth: 30, divisionName: "Bo‘lim", rows: [{ workerId: "w1", fullName: "Aziz", positionName: "Ishchi", totalMinutes: 61, entries: [{ day: 1, minutes: 1, state: "WORK" }, { day: 2, minutes: 60, state: "WORK" }] }] } }) }));
afterEach(cleanup);
describe("timesheet actual time", () => {
  it("preserves one-minute work, monthly link and Excel period", () => {
    window.history.replaceState(null, "", "/tabel?month=2026-09");
    render(<Page />);
    expect(screen.getByText("0:01")).toHaveAttribute("title", "0 soat 1 daqiqa ishlangan");
    expect(screen.getByText("1 soat 1 daqiqa")).toBeVisible();
    expect(screen.getByRole("link", { name: "Oylik hisoblash" })).toHaveAttribute("href", "/oylik?month=2026-09");
    expect(screen.getByRole("link", { name: "Excel" })).toHaveAttribute("href", "/api/v1/reports/timesheet.xlsx?year=2026&month=9");
  });
});
