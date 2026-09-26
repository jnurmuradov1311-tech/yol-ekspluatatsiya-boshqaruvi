import type { PayrollSnapshot } from './payroll';
export type CostTrace = {
  workOrderId: string; orderNumber: string; workDate: string; roadCode: string; workName: string;
  resourceId: string; resourceCode: string; reservationId?: string;
  rateId: string; rateVersion: number; rateSource: string;
  recordedBy: string; verifiedBy: string; verifiedAt: string;
};
export type WageSegment = {
  rateId?: string; rateVersion?: number; rateSource?: string; normId?: string;
  workOrderId: string; workDate: string; minutes: number; normMinutes: number; monthlySalary: number; salaryCoefficient: number;
  bonusBps: number; seniorityBps: number; additionalBps: number; trafficBps: number; travelBps: number; socialBps: number;
  trafficBase: number; travelBase: number; base: number; bonus: number; traffic: number; travel: number;
  seniority: number; additional: number; holiday: number; oneTime: number; termination: number;
  sickLeave: number; leave: number; materialAid: number; meal: number; gross: number; social: number;
};
export type ExcelReport = {
  preparedBy?:string;approvedBy?:string;approvedAt?:string;
  period: string; divisionName: string; roadLabel: string; state: string; reference: string;
  payroll: PayrollSnapshot;
  works: Array<{name: string; norm: string; unit: string; quantity: number; normHours: number | null; totalNormHours: number | null}>;
  materials: Array<{name: string; unit: string; quantity: number; price: number; amount: number; trace?: CostTrace}>;
  equipment: Array<{name: string; hours: number; price: number; amount: number; trace?: CostTrace}>;
  timesheet: Array<{workerId: string; name: string; position: string; days: number; minutes: number; entries: Array<{day: number; minutes: number}>}>;
};
