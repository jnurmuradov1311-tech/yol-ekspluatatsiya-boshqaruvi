import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Page from "./page";
const mock = vi.hoisted(() => ({ data: {} as Record<string, unknown>, complete: vi.fn(), upload: vi.fn(), returnOrder: vi.fn(), verify: vi.fn(), setData: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "order-1" }) }));
vi.mock("@/components/auth-provider", () => ({ useHasPermission: () => true }));
vi.mock("@/lib/use-api-resource", () => ({ useApiResource: () => ({ data: mock.data, loading: false, error: null, setData: mock.setData }) }));
vi.mock("@/lib/api/client", () => ({ api: { completeWorkOrder: mock.complete, uploadWorkOrderEvidence: mock.upload, returnWorkOrder: mock.returnOrder, verifyWorkOrder: mock.verify }, ApiError: class extends Error {} }));
beforeEach(() => {
  vi.clearAllMocks();
  mock.data = { id: "order-1", number: "T-001", workName: "Tozalash", road: { code: "D001", name: "Halqa yo‘li" }, state: "IN_PROGRESS", scheduledDate: "2026-09-17", scheduledStartAt: "2026-09-17T09:00:00+05:00", scheduledEndAt: "2026-09-17T11:00:00+05:00", exactQuantity: { value: "20", unit: "m2" }, executionResources: { workers: [{ id: "w1", fullName: "Aziz", plannedMinutes: 100, workDate: "2026-09-17" }], materials: [{ id: "m1", reservationId: "mr1", name: "Asfalt", plannedQuantity: "2", unit: "t" }], equipment: [{ id: "e1", reservationId: "er1", name: "Katok", plannedMachineMinutes: 120, usageDate: "2026-09-17" }] }, completion: null };
  mock.upload.mockResolvedValue({ id: "12345678-1234-4234-8234-123456789abc", url: "/api/v1/work-orders/order-1/evidence/12345678-1234-4234-8234-123456789abc.jpg", contentType: "image/jpeg", fileName: "ish.jpg", sizeBytes: 5 });
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
    for (const [label, value] of [["Haqiqiy bajarilgan hajm, m2", "10"], ["Aziz ishlagan daqiqa", "60"], ["Asfalt sarfi", "0"], ["Katok mashina daqiqasi", "0"], ["Bajarilgan ish bo‘yicha izoh", "Hajm o‘lchandi"], ["Ishlamagan xodim yoki ishlatilmagan resurs sababi", "Qo‘lda bajarildi"]]) fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });
    fireEvent.change(screen.getByLabelText("Foto yoki hujjat", { exact: true }), { target: { files: [new File(["photo"], "ish.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("ish.jpg yuklandi"));
    fireEvent.click(screen.getByRole("button", { name: "Ishni yakunlash" }));
    await waitFor(() => expect(mock.complete).toHaveBeenCalledOnce());
    expect(mock.complete.mock.calls[0]![1]).toMatchObject({ completedQuantity: "10", evidence: ["/api/v1/work-orders/order-1/evidence/12345678-1234-4234-8234-123456789abc.jpg"], equipmentUsages: [], materialUsages: [], unusedResources: { reason: "Qo‘lda bajarildi" } });
  });
  it("shows upload progress and preserves entered actuals while retrying a failed upload", async () => {
    let rejectUpload: (error: Error) => void = () => undefined;
    mock.upload.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectUpload = reject; }));
    render(<Page />);
    fireEvent.change(screen.getByLabelText("Haqiqiy bajarilgan hajm, m2"), { target: { value: "8" } });
    const file = new File(["photo"], "ish.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Foto yoki hujjat", { exact: true }), { target: { files: [file] } });
    expect(screen.getByRole("progressbar", { name: "Fayl yuklanmoqda" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ishni yakunlash" })).toBeDisabled();
    rejectUpload(new Error("Aloqa uzildi. Qayta urinib ko‘ring."));
    expect(await screen.findByRole("alert")).toHaveTextContent("Aloqa uzildi");
    expect(screen.getByLabelText("Haqiqiy bajarilgan hajm, m2")).toHaveValue(8);
    fireEvent.click(screen.getByRole("button", { name: "Qayta yuklash" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("ish.jpg yuklandi"));
    expect(mock.upload).toHaveBeenLastCalledWith("order-1", file);
    expect(mock.complete).not.toHaveBeenCalled();
  });
  it("does not upload a disallowed file type", async () => {
    render(<Page />);
    fireEvent.change(screen.getByLabelText("Foto yoki hujjat", { exact: true }), { target: { files: [new File(["html"], "file.html", { type: "text/html" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent("JPEG, PNG yoki PDF");
    expect(mock.upload).not.toHaveBeenCalled();
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
