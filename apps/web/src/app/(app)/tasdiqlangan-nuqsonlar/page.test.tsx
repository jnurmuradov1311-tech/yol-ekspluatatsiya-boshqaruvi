import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Page from "./page";

vi.mock("@/components/auth-provider", () => ({ useHasPermission: () => true }));
vi.mock("@/components/scope-provider", () => ({ useOperatingScope: () => ({ scope: { shortName: "1-bo‘lim", roadLabel: "D001" } }) }));
vi.mock("@/lib/api/client", () => ({ api: { confirmedDefects: () => undefined } }));
vi.mock("@/lib/use-api-resource", () => ({ useApiResource: () => ({ data: { items: [{ id: "defect-1", sourceReference: "K-1", sourceKind: "MANUAL_INSPECTION", defectName: "Qoplamadagi chuqurcha", road: { code: "D001", name: "Halqa yo‘li" }, locationLabel: "12+300", exactQuantity: { value: "12", unit: "m2" }, observedAt: "2026-09-28T00:00:00Z", division: { name: "1-bo‘lim" }, state: "OPEN" }] }, loading: false, error: null }) }));
afterEach(cleanup);

describe("confirmed defect next action", () => {
  it("finds a Latin entry with Cyrillic search and opens planning for that exact defect", () => {
    render(<Page />);
    fireEvent.change(screen.getByLabelText("Nuqsonlarni qidirish"), { target: { value: "чуқур D001" } });
    expect(screen.getByText("Qoplamadagi chuqurcha")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Topshiriq yaratish" })).toHaveAttribute("href", "/rejalashtirish?source=defect-1&road=D001");
    fireEvent.change(screen.getByLabelText("Nuqsonlarni qidirish"), { target: { value: "mavjud emas" } });
    expect(screen.getByText("Qidiruvga mos nuqson yo‘q")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Topshiriq yaratish" })).toBeNull();
  });
});
