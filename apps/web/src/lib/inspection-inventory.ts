import type { ManualInspectionInput, RoadElementOption } from "./api/types";

function positive(value: unknown): number | undefined {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Conservative preview only. The server resolves and checks current inventory again. */
export function matchingInspectionElements(elements: RoadElementOption[], roadId: string, code: string, start: string, end?: string): RoadElementOption[] {
  if (!start.trim() || !Number.isFinite(Number(start))) return [];
  const startM = Number(start);
  const endM = end?.trim() ? Number(end) : startM + 1;
  if (!Number.isFinite(endM) || endM <= startM) return [];
  const aliases = code.startsWith("field.pavement.") || code === "field.surface.debris" ? ["pavement", "asphalt", "asphalt_pavement", "road_surface", "carriageway"]
    : code.startsWith("field.sign.") ? ["sign", "road_sign", "traffic_sign"]
      : code === "field.roadside.vegetation" ? ["grass", "vegetation", "greenery", "roadside"]
        : code.startsWith("field.drainage.") ? ["drainage", "ditch", "culvert"] : [];
  return elements.filter((element) => element.roadId === roadId && aliases.includes(element.elementType.toLowerCase().replaceAll("-", "_")) && (element.chainageEndM === null ? element.chainageStartM >= startM && element.chainageStartM < endM : startM >= element.chainageStartM && endM <= element.chainageEndM));
}

/** UI guidance only; unmeasured inventory never supplies an invented measurement. */
export function inspectionCapacity(element: RoadElementOption | undefined, unit: string, start: string, end: string): number | undefined {
  if (!element) return undefined;
  if (unit === "unit") return 1;
  const span = end.trim() ? Number(end) - Number(start) : 0;
  if (unit === "m") return span > 0 ? span : undefined;
  if (unit === "km") return span > 0 ? span / 1000 : undefined;
  const extent = element.chainageEndM === null ? null : element.chainageEndM - element.chainageStartM;
  const fraction = extent && span > 0 ? Math.min(1, span / extent) : extent ? undefined : 1;
  if (unit === "m2") {
    const area = positive(element.attributes.areaM2);
    if (area && fraction !== undefined) return area * fraction;
    const width = positive(element.attributes.widthM);
    return width && span > 0 ? width * span : undefined;
  }
  if (unit === "m3") {
    const volume = positive(element.attributes.volumeM3);
    return volume && fraction !== undefined ? volume * fraction : undefined;
  }
  return undefined;
}

export function inspectionInventoryError(input: ManualInspectionInput, elements: RoadElementOption[], roadLengthM: number): string | null {
  if (input.unit !== "unit" && !input.chainageEndM?.trim()) return "O‘lchangan uchastkaning tugash joyini kiriting.";
  const start = Number(input.chainageStartM);
  const end = input.chainageEndM ? Number(input.chainageEndM) : start + 1;
  const quantity = Number(input.exactQuantity);
  if (!input.chainageStartM.trim() || !Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end <= start || end > roadLengthM) return "Ko‘rik joyi yo‘l chegarasidan chiqmasligi kerak.";
  if (!Number.isFinite(quantity) || quantity <= 0) return "O‘lchangan hajm noldan katta bo‘lishi kerak.";
  if (input.unit === "unit" && !Number.isInteger(quantity)) return "Dona hisobidagi hajm butun son bo‘lishi kerak.";
  const element = elements.find((item) => item.id === input.roadElementId && item.roadId === input.roadId);
  if (input.roadElementId && !element) return "Yo‘l ma’lumoti yangilangan. Joylashuvni tekshiring.";
  // Unresolved observations may be sent to the manager, but cannot be approved.
  if (!element) return null;
  const elementEnd = element.chainageEndM ?? element.chainageStartM + 1;
  if (start < element.chainageStartM || end > elementEnd) return "Ko‘rik uchastkasi element chegarasidan chiqmasligi kerak.";
  const capacity = inspectionCapacity(element, input.unit, String(start), input.chainageEndM ?? "");
  if (capacity !== undefined && quantity > capacity + 0.000001) return `Bu joyda eng ko‘pi ${capacity} ${input.unit === "unit" ? "dona" : input.unit} qayd etish mumkin.`;
  return null;
}
