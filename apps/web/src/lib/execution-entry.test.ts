import { describe, expect, it } from "vitest";
import type { WorkOrderDetail } from "./api/types";
import { executionPayload, formatMinutes, type ExecutionDraft } from "./execution-entry";

const order = {
  id: "order-1",
  exactQuantity: { value: "20", unit: "m2" },
  scheduledStartAt: "2026-09-17T09:00:00+05:00", scheduledEndAt: "2026-09-17T11:00:00+05:00",
  executionResources: {
    workers: [{ id: "w1", fullName: "Aziz", workDate: "2026-09-17" }, { id: "w2", fullName: "Olim", workDate: "2026-09-17" }],
    materials: [{ id: "m1", reservationId: "mr1", name: "Asfalt", plannedQuantity: "2" }, { id: "m1", reservationId: "mr2", name: "Asfalt", plannedQuantity: "3" }],
    equipment: [{ id: "e1", reservationId: "er1", name: "Katok", plannedMachineMinutes: 120, usageDate: "2026-09-17" }],
  },
} as unknown as WorkOrderDetail;
const draft = (): ExecutionDraft => ({ quantity: "12.500001", workerMinutes: { w1: "100", w2: "0" }, materialQuantities: { mr1: "0", mr2: "1.500001" }, equipmentMinutes: { er1: "0" }, unusedReason: "Ish hajmi kamaydi, ikkinchi xodim kelmadi", evidenceUrl: "https://evidence.example.uz/work.pdf", note: "Joyida o‘lchandi" });

describe("explicit execution evidence", () => {
  it("keeps zero attendance and non-use reasons without charging unused resources", () => {
    const payload = executionPayload(order, draft(), "2026-09-17T06:00:00Z");
    expect(payload.laborEntries).toEqual([{ workerId: "w1", workDate: "2026-09-17", actualMinutes: 100 }, { workerId: "w2", workDate: "2026-09-17", actualMinutes: 0 }]);
    expect(payload.materialUsages).toEqual([{ materialReservationId: "mr2", quantity: "1.500001", usedAt: "2026-09-17T06:00:00Z" }]);
    expect(payload.equipmentUsages).toEqual([]);
    expect(payload.unusedResources).toMatchObject({ reason: draft().unusedReason, materials: [{ reservationId: "mr1" }], equipment: [{ reservationId: "er1" }] });
  });
  it("does not treat a blank attendance field as a zero or prefill planned expenditure", () => {
    expect(() => executionPayload(order, { ...draft(), workerMinutes: { w1: "100", w2: "" } }, "now")).toThrow("haqiqiy qiymatni kiriting");
  });
  it("requires a reason for zero use and a positive worked attendance", () => {
    expect(() => executionPayload(order, { ...draft(), unusedReason: "" }, "now")).toThrow("sababini yozing");
    expect(() => executionPayload(order, { ...draft(), workerMinutes: { w1: "0", w2: "0" } }, "now")).toThrow("Kamida bir xodim");
  });
  it("rejects overscheduled attendance, excess material and fractional machine minutes", () => {
    expect(() => executionPayload(order, { ...draft(), workerMinutes: { w1: "121", w2: "0" } }, "now")).toThrow("120");
    expect(() => executionPayload(order, { ...draft(), materialQuantities: { mr1: "2.000001", mr2: "1" } }, "now")).toThrow("Asfalt");
    expect(() => executionPayload(order, { ...draft(), equipmentMinutes: { er1: "0.5" } }, "now")).toThrow("butun son");
  });
  it("allows actual machine time above the IQN estimate within the reserved window", () => {
    const aboveEstimate = { ...order, executionResources: { ...order.executionResources, equipment: [{ ...order.executionResources.equipment[0]!, plannedMachineMinutes: 30, reservedMinutes: 120 }] } };
    const result = executionPayload(aboveEstimate, { ...draft(), equipmentMinutes: { er1: "90" } }, "now");
    expect(result.equipmentUsages[0]?.actualMachineMinutes).toBe(90);
  });
  it("rejects over-completion, non-finite amounts, missing notes and unsafe evidence URLs", () => {
    for (const quantity of ["20.000001", "Infinity", "-1", "0", "1e3", "0.0000001"]) expect(() => executionPayload(order, { ...draft(), quantity }, "now")).toThrow();
    expect(() => executionPayload(order, { ...draft(), evidenceUrl: "javascript:alert(1)" }, "now")).toThrow("HTTPS");
    expect(() => executionPayload(order, { ...draft(), note: " " }, "now")).toThrow("izoh");
  });
  it("does not complete a fraction of a counted asset", () => {
    const countOrder = { ...order, exactQuantity: { value: "2", unit: "dona" } };
    expect(() => executionPayload(countOrder, { ...draft(), quantity: "1.5" }, "now")).toThrow("butun son");
  });
  it("accepts an uploaded receipt only for this order and rejects arbitrary local paths", () => {
    const url = "/api/v1/work-orders/order-1/evidence/12345678-1234-4234-8234-123456789abc.pdf";
    expect(executionPayload(order, { ...draft(), evidenceUrl: url, authorizedEvidenceUrls: [url] }, "now").evidence).toEqual([url]);
    for (const unsafe of [url, "/files/photo.jpg", "//evil.example/photo.png", "/api/v1/work-orders/order-2/evidence/12345678-1234-4234-8234-123456789abc.pdf", `${url}?redirect=evil`, `${url}/../secret`]) {
      const receipts = unsafe === url ? [] : [unsafe];
      expect(() => executionPayload(order, { ...draft(), evidenceUrl: unsafe, authorizedEvidenceUrls: receipts }, "now")).toThrow("Foto yoki hujjat yuklang");
    }
  });
  it("displays minutes exactly, preserving small worked amounts", () => {
    expect(formatMinutes(61)).toBe("1 soat 1 daqiqa");
    expect(formatMinutes(1)).toBe("0 soat 1 daqiqa");
  });
});
