import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { executionPayload } from "../execution-entry";
import { handleFixtureRequest } from "./fixtures";
import type { ConfirmedDefect, InspectionEvidenceUpload, ManualInspection, Paged, WorkOrderDetail, WorkOrderEvidenceUpload } from "./types";

beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  URL.createObjectURL = vi.fn(() => "blob:fixture-photo");
  URL.revokeObjectURL = vi.fn();
  await handleFixtureRequest("/auth/login", { method: "POST", body: { email: "operator@example.uz" } });
});

afterEach(() => { vi.unstubAllGlobals(); });

const capture = { roadId: "road-d001", defectTypeId: "defect-pothole", observedIssue: "Qoplamadagi chuqurcha", observedDate: "2026-09-28", chainageStartM: "18420", chainageEndM: "18425", exactQuantity: "12.4", unit: "m2", submitForReview: true };

describe("capture fixture flow", () => {
  it("keeps the actual uploaded photo and creates a pending review directly", async () => {
    const body = new FormData(); body.append("file", new File(["photo"], "photo.jpg", { type: "image/jpeg" }));
    const receipt = await handleFixtureRequest<InspectionEvidenceUpload>("/manual-inspections/evidence", { method: "POST", body });
    expect(receipt.sha256).toHaveLength(64);
    const created = await handleFixtureRequest<{ id: string; state: string; inventoryResolution: string }>("/manual-inspections", { method: "POST", body: { ...capture, evidence: [receipt] } });
    expect(created).toMatchObject({ state: "PENDING_REVIEW", inventoryResolution: "MATCHED" });
    const list = await handleFixtureRequest<Paged<ManualInspection>>("/manual-inspections?state=PENDING_REVIEW", {});
    expect(list.items.find((item) => item.id === created.id)?.observations[0]?.evidence[0]?.url).toBe("blob:fixture-photo");
    const approved = await handleFixtureRequest<ManualInspection>(`/manual-inspections/${created.id}/decision`, { method: "POST", body: { decision: "VERIFIED", note: "Tekshirildi" } });
    expect(approved.state).toBe("VERIFIED");
    const confirmed = await handleFixtureRequest<Paged<ConfirmedDefect>>("/defects?state=OPEN", {});
    expect(confirmed.items.some((item) => item.id === `defect-${created.id}`)).toBe(true);
  });
  it("accepts an unmatched location for review but blocks its approval", async () => {
    const created = await handleFixtureRequest<{ id: string; inventoryResolution: string }>("/manual-inspections", { method: "POST", body: { ...capture, defectTypeId: "defect-sign", unit: "unit", chainageStartM: "11000", chainageEndM: undefined, exactQuantity: "1" } });
    expect(created.inventoryResolution).toBe("REVIEW_REQUIRED");
    await expect(handleFixtureRequest(`/manual-inspections/${created.id}/decision`, { method: "POST", body: { decision: "VERIFIED", note: "" } })).rejects.toMatchObject({ code: "INVENTORY_REVIEW_REQUIRED" });
    const list = await handleFixtureRequest<Paged<ManualInspection>>("/manual-inspections?state=PENDING_REVIEW", {});
    expect(list.items.some((item) => item.id === created.id)).toBe(true);
  });
  it("binds an execution upload to its order and preserves its actual preview", async () => {
    const order = await handleFixtureRequest<WorkOrderDetail>("/work-orders/order-1", {});
    const body = new FormData(); body.append("file", new File(["pdf"], "work.pdf", { type: "application/pdf" }));
    const receipt = await handleFixtureRequest<WorkOrderEvidenceUpload>("/work-orders/order-1/evidence", { method: "POST", body });
    expect(receipt.url).toMatch(/^\/api\/v1\/work-orders\/order-1\/evidence\/.+\.pdf$/);
    const payload = executionPayload(order, { quantity: "8.25", workerMinutes: Object.fromEntries(order.executionResources.workers.map((item, index) => [item.id, index ? "0" : "60"])), materialQuantities: Object.fromEntries(order.executionResources.materials.map((item) => [item.reservationId, "0"])), equipmentMinutes: Object.fromEntries(order.executionResources.equipment.map((item) => [item.reservationId, "0"])), unusedReason: "Qo‘lda bajarildi", evidenceUrl: receipt.url, authorizedEvidenceUrls: [receipt.url], note: "Bajarilgan ish" }, new Date().toISOString());
    await expect(handleFixtureRequest("/work-orders/order-1/complete", { method: "POST", body: { ...payload, evidence: [receipt.url.replace("order-1", "order-2")] } })).rejects.toMatchObject({ code: "INVALID_EVIDENCE_URL" });
    const completed = await handleFixtureRequest<WorkOrderDetail>("/work-orders/order-1/complete", { method: "POST", body: payload });
    expect(completed.completion?.evidence[0]).toEqual({ url: "blob:fixture-photo", mediaType: "application/pdf" });
  });

});
