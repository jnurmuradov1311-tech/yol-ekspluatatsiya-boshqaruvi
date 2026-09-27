import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Page from "./page";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), upload: vi.fn(), reload: vi.fn(), options: {
  roads: [{ id: "road-1", code: "D001", name: "Halqa yo‘li", lengthM: 3000, divisionName: "1-bo‘lim" }, { id: "road-2", code: "D002", name: "Ikkinchi yo‘l", lengthM: 3000, divisionName: "1-bo‘lim" }],
  roadElements: [{ id: "sign-1", roadId: "road-1", elementType: "ROAD_SIGN", name: "Yo‘l belgisi", chainageStartM: 1200, chainageEndM: null, attributes: {} }],
  defectTypes: [{ id: "sign-damaged", name: "Shikastlangan yo‘l belgisi", code: "field.sign.damaged", unit: "unit" }, { id: "pothole", name: "Qoplamadagi chuqurcha", code: "field.pavement.pothole", unit: "m2" }],
  workTopics: [], measurementUnits: [{ value: "unit", label: "dona" }, { value: "m2", label: "m²" }],
} }));
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ user: { permissions: ["system.all"] } }), useHasPermission: () => true }));
vi.mock("@/lib/api/client", () => ({ api: { submitInspection: mocks.submit, uploadInspectionEvidence: mocks.upload, manualInspectionOptions: () => undefined, manualInspections: () => undefined } }));
vi.mock("@/lib/use-api-resource", () => ({ useApiResource: (_fetcher: unknown, key: string) => ({ data: key === "manual-inspection-options" ? mocks.options : { items: [], total: 0 }, loading: false, error: null, reload: mocks.reload }) }));
beforeEach(() => { vi.clearAllMocks(); mocks.submit.mockResolvedValue({ id: "inspection-1", state: "PENDING_REVIEW", inventoryResolution: "MATCHED" }); mocks.upload.mockResolvedValue({ objectUri: "local-evidence://receipt", contentType: "image/jpeg", sha256: "a".repeat(64), capturedAt: "2026-09-28T00:00:00Z", uploadToken: "receipt" }); });
afterEach(cleanup);

function selectSign() {
  fireEvent.focus(screen.getByRole("combobox", { name: "Nuqson turi" }));
  fireEvent.click(screen.getByRole("option", { name: "Shikastlangan yo‘l belgisi" }));
  fireEvent.change(screen.getByLabelText(/^Boshlanish, km/), { target: { value: "1.2" } });
  fireEvent.change(screen.getByLabelText(/^Hajm, dona/), { target: { value: "1" } });
}
function submit() { fireEvent.submit(screen.getByRole("button", { name: "Boshliqqa yuborish" }).closest("form")!); }

describe("simple manual capture", () => {
  it("sends a measured defect in one action with no asset or technical photo fields", async () => {
    render(<Page />);
    expect(screen.queryByLabelText("Yo‘l elementi")).toBeNull();
    expect(screen.queryByLabelText("Dalil SHA-256")).toBeNull();
    selectSign();
    expect(screen.getByLabelText(/^Hajm, dona/)).toHaveAttribute("max", "1");
    submit();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit.mock.calls[0]![0]).toMatchObject({ roadId: "road-1", chainageStartM: "1200", exactQuantity: "1", unit: "unit", submitForReview: true, observedIssue: "Shikastlangan yo‘l belgisi" });
    expect(mocks.submit.mock.calls[0]![0].roadElementId).toBeUndefined();
    expect(await screen.findByRole("status")).toHaveTextContent("Nuqson boshliqqa yuborildi.");
  });
  it("still blocks ten defects on one physical sign", () => {
    render(<Page />); selectSign();
    fireEvent.change(screen.getByLabelText(/^Hajm, dona/), { target: { value: "10" } }); submit();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("eng ko‘pi 1 dona");
  });
  it("searches Cyrillic names and reports an empty result", () => {
    render(<Page />);
    const search = screen.getByRole("combobox", { name: "Nuqson turi" });
    fireEvent.change(search, { target: { value: "чуқур" } });
    expect(screen.getByRole("option", { name: "Qoplamadagi chuqurcha" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /belgisi/ })).toBeNull();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(search).toHaveValue("Qoplamadagi chuqurcha");
    fireEvent.change(search, { target: { value: "zzzzz" } });
    expect(screen.getByRole("status")).toHaveTextContent("Nuqson topilmadi");
    expect(screen.getByRole("button", { name: "Boshliqqa yuborish" })).toBeDisabled();
  });
  it("uploads a selected file and attaches its receipt before sending", async () => {
    render(<Page />); selectSign();
    const file = new File(["photo"], "photo.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText(/^Foto yoki video/), { target: { files: [file] } });
    submit();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.upload).toHaveBeenCalledWith(file);
    expect(mocks.submit.mock.calls[0]![0].evidence[0]).toMatchObject({ objectUri: "local-evidence://receipt", uploadToken: "receipt" });
  });
  it("retains the form and does not create a record when photo upload fails", async () => {
    mocks.upload.mockRejectedValue(new Error("Faylni yuklab bo‘lmadi."));
    render(<Page />); selectSign();
    fireEvent.change(screen.getByLabelText(/^Foto yoki video/), { target: { files: [new File(["photo"], "photo.jpg", { type: "image/jpeg" })] } });
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Faylni yuklab bo‘lmadi");
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Boshlanish, km/)).toHaveValue(1.2);
  });
  it("clears stale location on road changes and allows unresolved inventory to reach review", async () => {
    mocks.submit.mockResolvedValue({ id: "inspection-1", state: "PENDING_REVIEW", inventoryResolution: "REVIEW_REQUIRED" });
    render(<Page />); selectSign();
    fireEvent.change(screen.getByLabelText("Yo‘l"), { target: { value: "road-2" } });
    expect(screen.getByLabelText(/^Boshlanish, km/)).toHaveValue(null);
    expect(screen.getByLabelText(/^Hajm, dona/)).not.toHaveAttribute("max");
    fireEvent.change(screen.getByLabelText(/^Boshlanish, km/), { target: { value: "1.2" } }); submit();
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(await screen.findByRole("status")).toHaveTextContent("tasdiqlashda aniqlashtiriladi");
  });
});
