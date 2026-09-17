export type CostLedgerLine = {
  id: string; kind: "labor" | "material" | "equipment"; state: "DRAFT" | "SUBMITTED" | "APPROVED"; date: string;
  workOrderId: string; orderNumber: string; road: { id: string; code: string; name: string };
  work: { code: string; name: string; normReference: string };
  act: { id: string; number: string; snapshotHash: string | null };
  resource: { id: string; code: string; name: string; detail: string };
  quantity: { value: string; unit: string };
  rate: { id: string; version: number; reference: string; basis: string; amountUzs: string; denominatorQuantity: string; unitRateUzs: string };
  source: { timeEntryId: string | null; materialUsageId: string | null; equipmentUsageEntryId: string | null; inventoryTransactionId: string | null; payrollSnapshotId: string | null; monthlyWorkTimeNormId: string | null; normReference: string | null };
  components: { baseWageAmountUzs: string; bonusAmountUzs: string; trafficAllowanceAmountUzs: string; travelAllowanceAmountUzs: string; payrollExtraAmountUzs: string; socialAmountUzs: string };
  payrollAllocation: { components?: Record<string, string> } | null;
  amountUzs: string;
};
export type CostLedger = {
  month: string; currency: "UZS"; basis: "ACT_SNAPSHOT"; paymentTracking: "NOT_CONNECTED";
  pagination: { page: number; pageSize: number; total: number };
  summary: { approvedAmountUzs: string; submittedAmountUzs: string; draftAmountUzs: string; laborAmountUzs: string; socialAmountUzs: string; materialAmountUzs: string; equipmentAmountUzs: string; verifiedUncostedOrderCount: number };
  rows: CostLedgerLine[];
};
export type MachineUsageRow = {
  id: string; reservationId: string; equipmentId: string; inventoryCode: string; name: string; date: string;
  workOrderId: string; orderNumber: string; workState: string; road: { id: string; code: string; name: string };
  reservationState: string; reservedFrom: string; reservedUntil: string; reservedMinutes: number; plannedQuantity: { value: string; unit: string };
  usageId: string | null; usageState: "NOT_RECORDED" | "NOT_USED" | "RECORDED" | "VERIFIED"; actualMinutes: number | null;
  startedAt: string | null; endedAt: string | null; note: string | null;
  costLineId: string | null; actId: string | null; actNumber: string | null; actState: string | null;
  approvedAmountUzs: string | null; rateReference: string | null;
};
export type MachineUsage = {
  month: string; currency: "UZS"; paymentTracking: "NOT_CONNECTED"; pagination: { page: number; pageSize: number; total: number };
  summary: { reservedMinutes: number; recordedMinutes: number; verifiedMinutes: number; approvedAmountUzs: string; unpricedVerifiedCount: number };
  assets: Array<{ equipmentId: string; inventoryCode: string; name: string; reservedMinutes: number; recordedMinutes: number; verifiedMinutes: number; approvedAmountUzs: string; unpricedVerifiedCount: number }>;
  rows: MachineUsageRow[];
};
