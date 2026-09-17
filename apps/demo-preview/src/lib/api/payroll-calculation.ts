import type { WageSegment } from './excel-report';
import type { PayrollAdjustment } from './payroll';

export const fixedPayrollFields = {
  holidayAmountUzs: 'holiday', mealAmountUzs: 'meal', oneTimeAmountUzs: 'oneTime',
  terminationAmountUzs: 'termination', sickLeaveAmountUzs: 'sickLeave',
  leaveAmountUzs: 'leave', materialAidAmountUzs: 'materialAid',
} as const;
export const payrollDeductionFields = ['incomeTaxAmountUzs', 'unionFeeAmountUzs', 'advanceAmountUzs', 'otherDeductionAmountUzs'] as const;
export const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** One calculation for the editable worksheet, saved payroll and completion acts. */
export function calculatePayrollSegments(source: WageSegment[], adjustment: PayrollAdjustment, fixedShare = 1): WageSegment[] {
  const number = (key: string, fallback = 0) => {
    const raw = adjustment[key];
    const value = raw === undefined || raw === '' ? fallback : Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 9e12 || (key.endsWith('Bps') && (!Number.isInteger(value) || value > 100000)) || (key === 'salaryCoefficient' && (value <= 0 || value > 100))) throw new Error('Summa, foiz yoki koeffitsiyent yaroqsiz.');
    return value;
  };
  const minutes = source.reduce((n, s) => n + s.minutes, 0);
  const segments = source.map(s => {
    const salaryCoefficient = number('salaryCoefficient', 1);
    const base = roundMoney(s.monthlySalary * salaryCoefficient * s.minutes / s.normMinutes);
    const bonusBps = number('bonusRateBps', s.bonusBps), seniorityBps = number('seniorityRateBps', s.seniorityBps), additionalBps = number('additionalRateBps', s.additionalBps);
    const trafficBps = number('trafficAllowanceRateBps', s.trafficBps), travelBps = number('travelAllowanceRateBps', s.travelBps), socialBps = number('socialContributionRateBps', s.socialBps);
    const trafficBase = number('trafficMonthlyBaseUzs', s.monthlySalary), travelBase = number('travelMonthlyBaseUzs', s.monthlySalary);
    return {...s, salaryCoefficient, base, bonusBps, seniorityBps, additionalBps, trafficBps, travelBps, socialBps, trafficBase, travelBase,
      bonus: roundMoney(base * bonusBps / 10000), seniority: roundMoney(base * seniorityBps / 10000), additional: roundMoney(base * additionalBps / 10000),
      traffic: roundMoney(trafficBase * s.minutes / s.normMinutes * trafficBps / 10000), travel: roundMoney(travelBase * s.minutes / s.normMinutes * travelBps / 10000)};
  });
  if (Object.keys(fixedPayrollFields).some(key => number(key) > 0) && new Set(segments.map(s => s.socialBps)).size > 1 && adjustment.socialContributionRateBps === undefined) throw new Error('Qo‘shimcha to‘lovlar uchun ijtimoiy ajratma foizini belgilang.');
  for (const [key, field] of Object.entries(fixedPayrollFields)) {
    const cents = Math.round(number(key) * 100 * fixedShare);
    let allocated = 0;
    segments.forEach((s, i) => { const part = i === segments.length - 1 ? cents - allocated : Math.floor(cents * s.minutes / minutes); allocated += part; s[field] = part / 100; });
  }
  for (const s of segments) {
    s.gross = roundMoney(s.base + s.bonus + s.seniority + s.additional + s.traffic + s.travel + Object.values(fixedPayrollFields).reduce((n, key) => n + s[key], 0));
    s.social = roundMoney(s.gross * s.socialBps / 10000);
  }
  const gross = roundMoney(segments.reduce((n,s)=>n+s.gross,0));
  const deductions = roundMoney(payrollDeductionFields.reduce((n,key)=>n+number(key),0));
  if(deductions > gross) throw new Error('Ushlanmalar hisoblangan summadan katta.');
  return segments;
}
