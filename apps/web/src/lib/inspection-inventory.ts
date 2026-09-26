import type { ManualInspectionInput, RoadElementOption } from "./api/types";

function positive(value: unknown): number | undefined {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** UI guidance only; the server rechecks the effective inventory on every write. */
export function inspectionCapacity(element: RoadElementOption | undefined, unit: string, start: string, end: string): number | undefined {
  if (!element) return undefined;
  if (unit === "unit") return 1;
  const span = Number(end) - Number(start);
  if (unit === "m") return span > 0 ? span : undefined;
  if (unit === "km") return span > 0 ? span / 1000 : undefined;
  if (unit === "m2") return positive(element.attributes.areaM2) ?? (span > 0 && positive(element.attributes.widthM) ? span * Number(element.attributes.widthM) : undefined);
  if (unit === "m3") return positive(element.attributes.volumeM3);
  return undefined;
}

export function inspectionInventoryError(input: ManualInspectionInput, elements: RoadElementOption[], roadLengthM: number): string | null {
  const start = Number(input.chainageStartM);
  const end = input.chainageEndM ? Number(input.chainageEndM) : start + 1;
  const quantity = Number(input.exactQuantity);
  if (!input.chainageStartM.trim() || !Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start || end > roadLengthM) {
    return "Ko‘rik joyi yo‘l chegarasidan chiqmasligi kerak.";
  }
  if (!Number.isFinite(quantity) || quantity <= 0) return "O‘lchangan hajm noldan katta bo‘lishi kerak.";
  const element = elements.find((item) => item.id === input.roadElementId && item.roadId === input.roadId);
  if (input.roadElementId && !element) return "Tanlangan element ushbu yo‘lga tegishli emas. Elementni qayta tanlang.";
  if (input.unit === "unit" && !element) return "Dona hisobidagi nuqson uchun yo‘l elementini tanlang.";
  if (!element) return null;
  const elementEnd = element.chainageEndM ?? element.chainageStartM + 1;
  if (start < element.chainageStartM || end > elementEnd) return "Ko‘rik uchastkasi tanlangan element chegarasidan chiqmasligi kerak.";
  if (input.unit === "unit" && !Number.isInteger(quantity)) return "Dona hisobidagi hajm butun son bo‘lishi kerak.";
  const capacity = inspectionCapacity(element, input.unit, String(start), String(end));
  if (capacity === undefined) return "Elementning o‘lchami bazada yetishmaydi. Avval element ma’lumotini to‘ldiring.";
  if (quantity > capacity + 0.000001) return `Ushbu element uchun ko‘rik hajmi ${capacity} ${input.unit === "unit" ? "dona" : input.unit} dan oshmasligi kerak.`;
  return null;
}
