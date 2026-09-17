import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Page from "./page";
vi.mock("@/lib/use-api-resource", () => ({ useApiResource: () => ({ loading: false, error: null, data: {
  month: "2026-09", pagination: { page: 1, pageSize: 50, total: 1 },
  summary: { approvedAmountUzs: "100.01", submittedAmountUzs: "20.02", draftAmountUzs: "30.03", laborAmountUzs: "0.00", socialAmountUzs: "0.00", materialAmountUzs: "0.00", equipmentAmountUzs: "100.01", verifiedUncostedOrderCount: 2 },
  rows: [{ id: "c1", kind: "equipment", state: "APPROVED", date: "2026-09-17", workOrderId: "work-1", orderNumber: "T-001", road: { code: "D001", name: "Halqa yo‘li" }, work: { name: "Tekislash", normReference: "IQN 02-24" }, resource: { name: "Katok", code: "K-1" }, quantity: { value: "60", unit: "machine_minute" }, rate: { id: "rate-1", reference: "Buyruq 17", basis: "machine_hour", amountUzs: "100.01" }, source: { equipmentUsageEntryId: "usage-1" }, act: { id: "act-1", number: "F2-01", snapshotHash: "abc123" }, amountUzs: "100.01" }],
} }) }));
afterEach(cleanup);
describe("transparent expense ledger", () => {
  it("keeps draft and approved totals separate and reveals source documents", () => {
    window.history.replaceState(null, "", "/xarajatlar?month=2026-09");
    render(<Page />);
    expect(screen.getByText("30,03 so‘m")).toBeVisible();
    expect(screen.getByText("20,02 so‘m")).toBeVisible();
    expect(screen.getByRole("link", { name: "T-001" })).toHaveAttribute("href", "/topshiriqlar/work-1");
    expect(screen.getByText("Buyruq 17")).toBeInTheDocument();
    expect(screen.getByText("usage-1")).toBeInTheDocument();
    expect(screen.getByText(/Bank yoki g‘aznachilik/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Keyingi" })).toBeDisabled();
  });
});
