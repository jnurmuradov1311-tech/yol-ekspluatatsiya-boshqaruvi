import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Page from "./page";
const mock = vi.hoisted(() => ({ data: {} as Record<string, unknown>, complete: vi.fn(), returnOrder: vi.fn(), verify: vi.fn(), setData: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "order-1" }) }));
vi.mock("@/components/auth-provider", () => ({ useHasPermission: () => true }));
vi.mock("@/lib/use-api-resource", () => ({ useApiResource: () => ({ data: mock.data, loading: false, error: null, setData: mock.setData }) }));
vi.mock("@/lib/api/client", () => ({ api: { completeWorkOrder: mock.complete, returnWorkOrder: mock.returnOrder, verifyWorkOrder: mock.verify }, ApiError: class extends Error {} }));
beforeEach(() => {
  vi.clearAllMocks();
  mock.data = { id: "order-1", number: "T-001", workName: "Tozalash", road: { code: "D001", name: "Halqa yo‘li" }, state: "IN_PROGRESS", scheduledDate: "2026-09-17", scheduledStartAt: "2026-09-17T09:00:00+05:00", scheduledEndAt: "2026-09-17T11:00:00+05:00", exactQuantity: { value: "20", unit: "m2" }, executionResources: { workers: [{ id: "w1", fullName: "Aziz", plannedMinutes: 100, workDate: "2026-09-17" }], materials: [{ id: "m1", reservationId: "mr1", name: "Asfalt", plannedQuantity: "2", unit: "t" }], equipment: [{ id: "e1", reservationId: "er1", name: "Katok", plannedMachineMinutes: 120, usageDate: "2026-09-17" }] }, completion: null };
  mock.complete.mockResolvedValue(mock.data);
  mock.returnOrder.mockResolvedValue(mock.data);
});
afterEach(cleanup);
describe("work execution form", () => {
  it("starts with blank actuals and sends explicit zero-use reason", async () => {
    render(<Page />);
    const quantity = screen.getByLabelText("Haqiqiy bajarilgan hajm, m2");
    expect(quantity).toHaveValue(null);
    expect(quantity).toHaveAttribute("type", "number");
    expect(screen.getByLabelText("Aziz ishlagan daqiqa")).toHaveAttribute("max", "120");
    for (const [label, value] of [["Haqiqiy bajarilgan hajm, m2", "10"], ["Aziz ishlagan daqiqa", "60"], ["Asfalt sarfi", "0"], ["Katok mashina daqiqasi", "0"], ["Foto yoki hujjat manzili", "https://example.uz/evidence.jpg"], ["Bajarilgan ish bo‘yicha izoh", "Hajm o‘lchandi"], ["Ishlamagan xodim yoki ishlatilmagan resurs sababi", "Qo‘lda bajarildi"]]) fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Ishni yakunlash" }));
    await waitFor(() => expect(mock.complete).toHaveBeenCalledOnce());
    expect(mock.complete.mock.calls[0]![1]).toMatchObject({ completedQuantity: "10", equipmentUsages: [], materialUsages: [], unusedResources: { reason: "Qo‘lda bajarildi" } });
  });
  it("requires a reason before returning work for correction", async () => {
    mock.data = { ...mock.data, state: "COMPLETED", completion: { state: "PENDING_VERIFICATION", actualQuantity: { value: "10", unit: "m2" }, workerMinutes: [], materials: [], equipment: [], evidence: [], canVerify: true } };
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Tuzatishga qaytarish" }));
    expect(mock.returnOrder).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Qaytarish sababini");
    fireEvent.change(screen.getByLabelText("Tekshiruv izohi yoki qaytarish sababi"), { target: { value: "Hajmni qayta o‘lchang" } });
    fireEvent.click(screen.getByRole("button", { name: "Tuzatishga qaytarish" }));
    await waitFor(() => expect(mock.returnOrder).toHaveBeenCalledWith("order-1", "Hajmni qayta o‘lchang"));
  });
});
