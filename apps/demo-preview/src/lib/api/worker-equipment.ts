export type WorkerEquipmentCard = {
  workerId: string; name: string; asOf: string; canIssue: boolean; occupationCode: string | null; positionName?: string;
  items: Array<{ id: string; materialId: string; name: string; unit?:string; quantity: number; issuedOn: string; expiresOn: string; daysRemaining: number; status: "ACTIVE" | "DUE" | "EXPIRED"; serviceMonths: number; sourceReference: string; allocationScope: string; occupationCode: string }>;
  norms: Array<{ code: string; name: string; serviceMonths: number; sourceReference: string; allocationScope: string; departmentQuantity: number | null; eligibleOccupationCodes: string[]; published: boolean }>;
  stockOptions: Array<{ materialId: string; normCode: string; stockLocationId: string; name: string; availableQuantity: number; unit: string }>;
};
export type WorkerEquipmentIssue = { materialId: string; stockLocationId: string; issuedOn: string; quantity: number; note?: string };
