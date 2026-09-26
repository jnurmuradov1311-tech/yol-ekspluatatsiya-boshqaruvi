import { describe, expect, it } from "vitest";
import type { ManualInspectionInput, RoadElementOption } from "./api/types";
import { inspectionCapacity, inspectionInventoryError } from "./inspection-inventory";

const stop: RoadElementOption = { id: "stop-1", roadId: "road-1", elementType: "BUS_STOP", name: "Bekat", chainageStartM: 1200, chainageEndM: null, attributes: { areaM2: 25 } };
const pavement: RoadElementOption = { id: "pavement-1", roadId: "road-1", elementType: "PAVEMENT", name: "Qoplama", chainageStartM: 1000, chainageEndM: 2000, attributes: { widthM: 7 } };
const input: ManualInspectionInput = { roadId: "road-1", roadElementId: stop.id, observedDate: "2026-09-27", chainageStartM: "1200", exactQuantity: "1", unit: "unit" };
const validate = (changes: Partial<ManualInspectionInput>) => inspectionInventoryError({ ...input, ...changes }, [stop, pavement], 3000);

describe("inspection inventory limits", () => {
  it("requires the physical element and permits only one whole item per linked point", () => {
    expect(validate({})).toBeNull();
    expect(validate({ roadElementId: undefined })).toContain("yo‘l elementini tanlang");
    expect(validate({ exactQuantity: "10" })).toContain("1 dona");
    expect(validate({ exactQuantity: "0.5" })).toContain("butun son");
  });
  it("rejects an element from another road and a location outside that element", () => {
    expect(validate({ roadId: "road-2" })).toContain("ushbu yo‘lga tegishli emas");
    expect(validate({ chainageStartM: "1300" })).toContain("element chegarasidan");
  });
  it("limits pavement area by the actual inspected span and recorded width", () => {
    const selection = { roadElementId: pavement.id, unit: "m2", chainageStartM: "1100", chainageEndM: "1110" };
    expect(validate({ ...selection, exactQuantity: "70" })).toBeNull();
    expect(validate({ ...selection, exactQuantity: "71" })).toContain("70 m2");
    expect(validate({ ...selection, chainageEndM: "2100", exactQuantity: "1" })).toContain("element chegarasidan");
    expect(inspectionCapacity(pavement, "km", "1100", "1200")).toBe(0.1);
  });
  it("blocks unrecorded dimensions rather than inventing volume", () => {
    expect(validate({ unit: "m3" })).toContain("o‘lchami bazada yetishmaydi");
    expect(validate({ unit: "m2", exactQuantity: "25" })).toBeNull();
  });
  it("preserves unlinked measured observations while rejecting invalid road positions", () => {
    expect(validate({ roadElementId: undefined, unit: "m2", exactQuantity: "12.4" })).toBeNull();
    expect(validate({ roadElementId: undefined, unit: "m2", chainageStartM: "3000" })).toContain("yo‘l chegarasidan");
  });
});
