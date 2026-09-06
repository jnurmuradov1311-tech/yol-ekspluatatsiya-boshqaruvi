export type PayrollAdjustment = { workerId: string; deductionsConfirmed?: boolean; [key: string]: string | number | boolean | undefined };
export type PayrollSnapshot = {
  id: string; state: "PREVIEW"; paymentInitiated: false; period: string; policyReference: string;
  rows: Array<{workerId: string; adjustments?: PayrollAdjustment; fullName: string; actualDays: number; actualMinutes: number; baseWageAmountUzs: string; bonusAmountUzs: string; grossAmountUzs: string; employerSocialAmountUzs: string; employerCostAmountUzs: string; deductionsAmountUzs: string; payableAmountUzs: string | null; state: string; [key:string]: unknown}>;
  totals: {grossAmountUzs: string; employerCostAmountUzs: string; payableAmountUzs: string | null};
};
export type PayrollHistoryRow = { id: string; period: string; createdAt: string; policyReference: string; state: string };
