import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Page from "./page";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), recommend: vi.fn(), reload: vi.fn(), options: {
  road: { id: "road-1", code: "D001", name: "Halqa yo‘li", lengthM: 5000 },
  workVariants: [{ id: "patch", name: "Chuqurni ta’mirlash", iqnTopicId: "topic-1", normReference: "IQN 02-24 · 1", unit: "m2", requiredWorkers: 2, laborMinutesPerUnit: 10 }],
  safetySchemes: [{ id: "open", code: "ROAD_SHOULDER_WORK", requiredSafetyWorkers: 0 }, { id: "partial", code: "SINGLE_LANE_CLOSURE", requiredSafetyWorkers: 1 }, { id: "closed", code: "FULL_CLOSURE", requiredSafetyWorkers: 2, requiresPermit: true }],
  sourceDefects: [{ id: "defect-1", sourceReference: "N-1", iqnTopic: { id: "topic-1", name: "Qoplama nuqsoni" }, measuredQuantity: { value: "2", unit: "m2" }, location: { chainageStartM: "100", chainageEndM: "110" } }], workers: [],
} }));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ user: { permissions: ["system.all"] } }), useHasPermission: () => true }));
vi.mock("@/components/scope-provider", () => ({ useOperatingScope: () => ({ scope: { shortName: "1-bo‘lim", roadLabel: "D001" } }) }));
vi.mock("@/components/work-guides", () => ({ WorkGuides: () => <p>Yo‘riqnoma va video</p> }));
vi.mock("@/lib/api/client", () => ({ api: { previewManualPlan: mocks.preview, recommendAiWork: mocks.recommend, roads: vi.fn(), planningCandidates: vi.fn(), planningOptions: vi.fn(), plans: vi.fn() } }));
vi.mock("@/lib/use-api-resource", () => ({ useApiResource: (_fetcher: unknown, key: string) => ({ data: key.startsWith("planning-options:") ? mocks.options : key === "planning-roads" ? { items: [mocks.options.road] } : { items: [], total: 0 }, loading: false, error: null, reload: mocks.reload }) }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.recommend.mockResolvedValue({ status: "READY", sourceDefectId: "defect-1", recommendationId: "ai-1", candidates: [{ workVariantId: "patch", workName: "Chuqurni ta’mirlash", normReference: "IQN 02-24", reason: "Tasdiqlangan mos ish" }], missingMeasurements: [], message: "AI tavsiyasi tayyor", requiresHumanApproval: true });
  mocks.preview.mockRejectedValue(new Error("Sinov uchun hisob to‘xtatildi"));
});
afterEach(cleanup);
function chooseDefect() {
  render(<Page />);
  fireEvent.change(screen.getByLabelText("Nuqsonni tanlang"), { target: { value: "defect-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Ishni belgilash" }));
}
function chooseWork() { fireEvent.change(screen.getByLabelText("IQN 02-24 bo‘yicha ish turi"), { target: { value: "patch" } }); }

describe("simple human-led planning", () => {
  it("requires an exact lane and direction for partial closure and preserves the complete source section", async () => {
    chooseDefect(); chooseWork();
    fireEvent.change(screen.getByLabelText("Ish vaqtida yo‘l harakati"), { target: { value: "PARTIAL" } });
    const next = screen.getByRole("button", { name: "Xodimlarni biriktirish" });
    expect(next).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Yopiladigan yo‘nalish"), { target: { value: "FORWARD" } });
    expect(next).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Yopiladigan tasma"), { target: { value: "1-tasma, o‘ng chetdagi" } });
    fireEvent.click(next);
    fireEvent.click(screen.getByRole("button", { name: "Resurslarni hisoblash" }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledOnce());
    expect(mocks.preview.mock.calls[0]![0]).toMatchObject({ chainageStartM: "100", chainageEndM: "110", direction: "FORWARD", laneLabel: "1-tasma, o‘ng chetdagi", roadAccess: "PARTIAL" });
    expect(mocks.recommend).not.toHaveBeenCalled();
  });
  it("requires a permit for full closure and clears stale closure fields when reopened", () => {
    chooseDefect(); chooseWork();
    fireEvent.change(screen.getByLabelText("Ish vaqtida yo‘l harakati"), { target: { value: "CLOSED" } });
    fireEvent.change(screen.getByLabelText("Yopiladigan yo‘nalish"), { target: { value: "BOTH" } });
    expect(screen.getByRole("button", { name: "Xodimlarni biriktirish" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Yopish ruxsatnomasi raqami"), { target: { value: "YHXX-1" } });
    expect(screen.getByRole("button", { name: "Xodimlarni biriktirish" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Ish vaqtida yo‘l harakati"), { target: { value: "OPEN" } });
    expect(screen.queryByLabelText("Yopiladigan yo‘nalish")).toBeNull();
    expect(screen.getByRole("button", { name: "Xodimlarni biriktirish" })).toBeEnabled();
  });
  it("keeps AI optional and only applies a recommendation after explicit human choice", async () => {
    chooseDefect();
    fireEvent.click(screen.getByText("AI tavsiyasi · ixtiyoriy"));
    fireEvent.click(screen.getByRole("button", { name: "AI tavsiyasini olish" }));
    await screen.findByText("AI tavsiyasi tayyor");
    expect(screen.getByLabelText("IQN 02-24 bo‘yicha ish turi")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Qo‘llash" }));
    expect(screen.getByLabelText("IQN 02-24 bo‘yicha ish turi")).toHaveValue("patch");
  });
  it("continues manual selection when AI is not configured", async () => {
    mocks.recommend.mockResolvedValue({ status: "UNAVAILABLE", candidates: [], missingMeasurements: [], message: "AI ulanmagan", requiresHumanApproval: true });
    chooseDefect();
    fireEvent.click(screen.getByText("AI tavsiyasi · ixtiyoriy"));
    fireEvent.click(screen.getByRole("button", { name: "AI tavsiyasini olish" }));
    await screen.findByText("AI ulanmagan");
    chooseWork();
    expect(screen.getByRole("button", { name: "Xodimlarni biriktirish" })).toBeEnabled();
  });
  it("advances the end date with a later start without losing the chosen work", () => {
    chooseDefect(); chooseWork();
    fireEvent.change(screen.getByLabelText("Boshlanish sanasi"), { target: { value: "2027-12-10" } });
    expect(screen.getByLabelText("Tugash sanasi")).toHaveValue("2027-12-10");
    expect(screen.getByLabelText("IQN 02-24 bo‘yicha ish turi")).toHaveValue("patch");
  });
});
