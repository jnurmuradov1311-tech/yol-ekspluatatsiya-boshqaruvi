import type { WorkOrderDetail, WorkOrderExecutionInput } from "./api/types";

export type ExecutionDraft = {
  quantity: string;
  workerMinutes: Record<string, string>;
  materialQuantities: Record<string, string>;
  equipmentMinutes: Record<string, string>;
  unusedReason: string;
  evidenceUrl: string;
  note: string;
};

export function scheduledMinutes(order: WorkOrderDetail): number {
  if (!order.scheduledStartAt || !order.scheduledEndAt) return 1440;
  const duration = (Date.parse(order.scheduledEndAt) - Date.parse(order.scheduledStartAt)) / 60000;
  return Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 1440;
}

function amount(value: string | undefined, label: string, max: number, integer = false): number {
  if (!value?.trim()) throw new Error(`${label}: haqiqiy qiymatni kiriting. Ishlatilmagan bo‘lsa 0 yozing.`);
  const number = Number(value);
  if (!/^\d+(?:\.\d{1,6})?$/.test(value) || !Number.isFinite(number) || number < 0 || number > max || (integer && !Number.isInteger(number))) {
    throw new Error(`${label}: 0 dan ${max} gacha ${integer ? "butun son" : "miqdor"} kiriting.`);
  }
  return number;
}

export function executionPayload(order: WorkOrderDetail, draft: ExecutionDraft, completedAt: string): WorkOrderExecutionInput {
  if (amount(draft.quantity, "Bajarilgan hajm", Number(order.exactQuantity.value)) <= 0) throw new Error("Bajarilgan hajm noldan katta bo‘lishi kerak.");
  const laborEntries = order.executionResources.workers.map((worker) => ({
    workerId: worker.id, workDate: worker.workDate,
    actualMinutes: amount(draft.workerMinutes[worker.id], worker.fullName, Math.min(420, worker.reservedMinutes ?? scheduledMinutes(order), scheduledMinutes(order)), true),
  }));
  if (!laborEntries.some((entry) => entry.actualMinutes > 0)) throw new Error("Kamida bir xodimning haqiqiy ish vaqtini kiriting.");
  const materials = order.executionResources.materials.map((material) => ({ material, quantity: amount(draft.materialQuantities[material.reservationId], material.name, Number(material.plannedQuantity)) }));
  const equipment = order.executionResources.equipment.map((unit) => ({ unit, minutes: amount(draft.equipmentMinutes[unit.reservationId], unit.name, Math.min(1440, unit.reservedMinutes ?? scheduledMinutes(order), scheduledMinutes(order)), true) }));
  const hasUnused = laborEntries.some((entry) => entry.actualMinutes === 0) || materials.some((entry) => entry.quantity === 0) || equipment.some((entry) => entry.minutes === 0);
  const reason = draft.unusedReason.trim();
  if (hasUnused && reason.length < 3) throw new Error("Ishlamagan xodim yoki ishlatilmagan resurs sababini yozing.");
  let evidence: URL;
  try { evidence = new URL(draft.evidenceUrl.trim()); } catch { throw new Error("Dalil uchun to‘g‘ri HTTPS manzilini kiriting."); }
  if (evidence.protocol !== "https:" || evidence.username || evidence.password) throw new Error("Dalil uchun HTTPS manzilini kiriting.");
  if (!draft.note.trim()) throw new Error("Bajarilgan ish bo‘yicha qisqa izoh kiriting.");
  return {
    completedQuantity: draft.quantity, unit: order.exactQuantity.unit, laborEntries,
    materialUsages: materials.filter((entry) => entry.quantity > 0).map(({ material }) => ({ materialReservationId: material.reservationId, quantity: draft.materialQuantities[material.reservationId]!, usedAt: completedAt })),
    equipmentUsages: equipment.filter((entry) => entry.minutes > 0).map(({ unit, minutes }) => ({ equipmentReservationId: unit.reservationId, usageDate: unit.usageDate, actualMachineMinutes: minutes })),
    unusedResources: {
      ...(hasUnused ? { reason } : {}),
      materials: materials.filter((entry) => entry.quantity === 0).map(({ material }) => ({ reservationId: material.reservationId, reason })),
      equipment: equipment.filter((entry) => entry.minutes === 0).map(({ unit }) => ({ reservationId: unit.reservationId, reason })),
    },
    evidence: [evidence.href], note: draft.note.trim(),
  };
}

export function formatMinutes(value: number): string {
  const minutes = Math.max(0, Math.round(value));
  return `${Math.floor(minutes / 60)} soat ${minutes % 60} daqiqa`;
}
