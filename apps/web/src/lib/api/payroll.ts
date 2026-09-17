export type PayrollAdjustment = { workerId: string; deductionsConfirmed?: boolean; [key: string]: string | number | boolean | undefined };
export type PayrollSnapshot = {
  id: string; state: "PREVIEW"; paymentInitiated: false; period: string; policyReference: string;
  rows: Array<{workerId: string; adjustments?: PayrollAdjustment; fullName: string; actualDays: number; actualMinutes: number; baseWageAmountUzs: string; bonusAmountUzs: string; grossAmountUzs: string; employerSocialAmountUzs: string; employerCostAmountUzs: string; deductionsAmountUzs: string; payableAmountUzs: string | null; state: string; [key:string]: unknown}>;
  totals: {grossAmountUzs: string; employerCostAmountUzs: string; payableAmountUzs: string | null};
};
export type PayrollHistoryRow = { id: string; period: string; createdAt: string; policyReference: string; state: string };

export function payrollInputError(adjustments: PayrollAdjustment[]): string | null {
  for (const adjustment of adjustments) {
    for (const [key, value] of Object.entries(adjustment)) {
      if (key === "workerId" || key === "deductionsConfirmed" || value === "" || value === undefined) continue;
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0) return "Foiz va summalarni manfiy bo‘lmagan sonlarda kiriting.";
      if (key === "coefficient" && (numeric < 0.01 || numeric > 10)) return "Koeffitsiyent 0,01 dan 10 gacha bo‘lishi kerak.";
      if (key.endsWith("Bps") && (!Number.isInteger(numeric) || numeric > (key === "socialContributionRateBps" ? 10000 : 20000))) return "Ustama 200% dan, ijtimoiy ajratma 100% dan oshmasligi kerak.";
      if (key.endsWith("Uzs") && !/^\d+(?:\.\d{1,2})?$/.test(String(value))) return "Pul summasini ikki kasr xonasigacha kiriting.";
    }
  }
  return null;
}
