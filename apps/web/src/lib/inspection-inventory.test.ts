import { describe, expect, it } from "vitest";
import type { ManualInspectionInput, RoadElementOption } from "./api/types";
import { inspectionCapacity, inspectionInventoryError, matchingInspectionElements } from "./inspection-inventory";

const sign: RoadElementOption = { id: "sign-1", roadId: "road-1", elementType: "ROAD_SIGN", name: "Belgi", chainageStartM: 1200, chainageEndM: null, attributes: { areaM2: 25 } };
const pavement: RoadElementOption = { id: "pavement-1", roadId: "road-1", elementType: "PAVEMENT", name: "Qoplama", chainageStartM: 1000, chainageEndM: 2000, attributes: { widthM: 7 } };
const input: ManualInspectionInput = { roadId: "road-1", roadElementId: sign.id, observedDate: "2026-09-27", chainageStartM: "1200", exactQuantity: "1", unit: "unit" };
const validate = (changes: Partial<ManualInspectionInput>) => inspectionInventoryError({ ...input, ...changes }, [sign, pavement], 3000);

describe("automatic inspection inventory matching", () => {
  it("matches location and compatible defect type only, leaving ambiguous choices unresolved", () => {
    expect(matchingInspectionElements([sign, pavement], "road-1", "field.sign.damaged", "1200")).toEqual([sign]);
    expect(matchingInspectionElements([sign, { ...sign, id: "sign-2" }], "road-1", "field.sign.damaged", "1200")).toHaveLength(2);
    expect(matchingInspectionElements([sign, pavement], "road-1", "field.unknown", "1200")).toEqual([]);
    expect(matchingInspectionElements([sign], "road-2", "field.sign.damaged", "1200")).toEqual([]);
  });
  it("allows unresolved reports to be reviewed but enforces known capacity and whole counts", () => {
    expect(validate({})).toBeNull();
    expect(validate({ roadElementId: undefined })).toBeNull();
    expect(validate({ exactQuantity: "10" })).toContain("1 dona");
    expect(validate({ exactQuantity: "0.5" })).toContain("butun son");
    expect(validate({ roadElementId: undefined, exactQuantity: "0.5" })).toContain("butun son");
  });
  it("rejects a wrong road, wrong element section and invalid road positions", () => {
    expect(validate({ roadId: "road-2" })).toContain("Joylashuvni tekshiring");
    expect(validate({ chainageStartM: "1300" })).toContain("element chegarasidan");
    expect(validate({ roadElementId: undefined, chainageStartM: "3000" })).toContain("yo‘l chegarasidan");
  });
  it("limits pavement area by the inspected span and recorded width or proportioned area", () => {
    const selection = { roadElementId: pavement.id, unit: "m2", chainageStartM: "1100", chainageEndM: "1110" };
    expect(validate({ ...selection, exactQuantity: "70" })).toBeNull();
    expect(validate({ ...selection, exactQuantity: "71" })).toContain("70 m2");
    expect(inspectionCapacity({ ...pavement, attributes: { areaM2: 7000 } }, "m2", "1100", "1110")).toBe(70);
    expect(inspectionCapacity(pavement, "km", "1100", "1200")).toBe(0.1);
  });
  it("never invents dimensions when only a location is entered", () => {
    expect(validate({ unit: "m2", roadElementId: undefined })).toContain("tugash joyini kiriting");
    expect(inspectionCapacity(pavement, "m2", "1100", "")).toBeUndefined();
    expect(inspectionCapacity(sign, "m3", "1200", "")).toBeUndefined();
    expect(inspectionCapacity(sign, "m2", "1200", "")).toBe(25);
  });
});
