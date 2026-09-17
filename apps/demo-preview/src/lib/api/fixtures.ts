import {annualLedger,activeProgram,approveBudget,allocateMonths,annualView,annualSource,annualSourceId,annualUsage,bindAnnualInput,checkAnnualOrders} from '../funding/annual';
import type {AssetSnapshot,FundingPolicy} from '../funding/types';
import {equipmentNorms as fullEquipmentNorms} from '../funding/norms';
import { automaticResourceRecipe, plannedResources, materialStockId, resourcePlanIssue, resourceUnit } from "../iqn/resource-plan";
import { inspectionTypes, iqnTopicId, selectDefectWork } from "../iqn/defects";
import { iqnWorkCatalog, normalizeUnit, workNormMinutes } from "../iqn/catalog";
import { selectionContext } from "../iqn/ai-selection";
import { requestAISelection } from "./ai-provider";
import { calculatePayrollSegments, fixedPayrollFields } from "./payroll-calculation";
import type { ExcelReport, WageSegment, CostTrace } from "./excel-report";
import {buildCostLedger, type CostLedger} from './cost-ledger';
import {sourceLabor} from '../funding/source-labor';
import {assignCrew} from '../iqn/crew';
/**
 * E2E-only in-memory adapter.
 * This module is dynamically imported only when NEXT_PUBLIC_E2E_FIXTURES=true.
 */
import { ApiError } from "./client";
import type {
  AIWorkRecommendation,
  DefectParameters,
  AdminNetworkSummary,
  AdminOrganizationHierarchy,
  AnnualProgramLine,
  ConfirmedDefect,
  ConfirmedDefectState,
  CostRate,
  CostRateInput,
  DashboardSummary,
  RoadMapData,
  IntegrationReadiness,
  ManualInspection,
  ManualInspectionInput,
  ManualInspectionOptions,
  ManualInspectionState,
  ManualPlanInput,
  MonthlyCompletionAct,
  MonthlyCompletionActSummary,
  MonthlyTimesheet,
  MonthlyWorkTimeNorm,
  MonthlyWorkTimeNormInput,
  Paged,
  PlanPreview,
  PlanningCandidate,
  PlanningOptions,
  PlanningRunSummary,
  ResourceRow,
  ResourceRequisition,
  RoadOption,
  RoadVisionFinding,
  User,
  WorkOrderDetail,
  WorkOrderExecutionInput,
} from "./types";

import type { PayrollAdjustment, PayrollHistoryRow, PayrollSnapshot } from "./payroll";
import type { WorkerEquipmentCard, WorkerEquipmentIssue } from "./worker-equipment";

type FixtureOptions = { method?: string; body?: unknown; signal?: AbortSignal | null };

let fixtureUser: User = {
  id: "demo-chief",
  fullName: "Yo‘l bo‘limi boshlig‘i (demo)",
  roleLabel: "Yo‘l bo‘limi boshlig‘i",
  division: { id: "e2e-division", name: "1-son yo‘l bo‘limi" },
  permissions: ["system.all"],
  globalPermissions: ["system.all"],
};

let authenticated = false;

function formatFixtureChainage(value: string) {
  const chainageM = Number(value);
  if (!Number.isFinite(chainageM) || chainageM < 0) return value;
  return `${Math.floor(chainageM / 1000)}+${String(Math.round(chainageM % 1000)).padStart(3, "0")}`;
}

function tashkentFixtureDate(): string {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Tashkent",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const initialFixtureFindings: RoadVisionFinding[] = [
  {
    id: "finding-1",
    vendorReference: "RV-E2E-1042",
    attributeName: "Qoplamadagi chuqur",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    division: { id: "e2e-division", name: "1-son yo‘l bo‘limi" },
    chainageStartM: 18420,
    chainageEndM: 18427,
    laneLabel: "O‘ng tasma",
    observedAt: "2026-08-11T04:22:00Z",
    receivedAt: "2026-08-11T04:37:00Z",
    state: "PENDING_REVIEW",
    measuredQuantity: { value: "12.4", unit: "m²" },
    evidence: [{ index: 0, contentType: "image/png", capturedAt: "2026-08-11T04:22:00Z", sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", url: "/e2e-road-evidence.svg", mediaId: "rv-media-1042" }],
  },
  {
    id: "finding-2",
    vendorReference: "RV-E2E-1043",
    attributeName: "Yo‘l yoqasidagi yemirilish",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    division: { id: "e2e-division", name: "1-son yo‘l bo‘limi" },
    chainageStartM: 46210,
    observedAt: "2026-08-11T05:11:00Z",
    receivedAt: "2026-08-11T05:24:00Z",
    state: "PENDING_REVIEW",
    evidence: [],
  },
  {
    id: "finding-3",
    vendorReference: "RV-E2E-1044",
    attributeName: "Qoplamadagi chuqur",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    division: { id: "e2e-division", name: "1-son yo‘l bo‘limi" },
    chainageStartM: 22510,
    chainageEndM: 22515,
    observedAt: "2026-08-11T06:18:00Z",
    receivedAt: "2026-08-11T06:29:00Z",
    state: "PENDING_REVIEW",
    measuredQuantity: { value: "6.7", unit: "m²" },
    evidence: [{ index: 0, contentType: "image/png", capturedAt: "2026-08-11T06:18:00Z", sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", url: "/e2e-road-evidence.svg", mediaId: "rv-media-1044" }],
  },
  {
    id: "finding-4",
    vendorReference: "RV-E2E-1045",
    attributeName: "Yo‘l yoqasidagi yemirilish",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    division: { id: "e2e-division", name: "1-son yo‘l bo‘limi" },
    chainageStartM: 35670,
    chainageEndM: 35675,
    observedAt: "2026-08-11T07:11:00Z",
    receivedAt: "2026-08-11T07:25:00Z",
    state: "PENDING_REVIEW",
    measuredQuantity: { value: "9.2", unit: "m³" },
    evidence: [{ index: 0, contentType: "image/png", capturedAt: "2026-08-11T07:11:00Z", sha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", url: "/e2e-road-evidence.svg", mediaId: "rv-media-1045" }],
  },
  {
    id: "finding-5",
    vendorReference: "RV-E2E-1046",
    attributeName: "Qoplamadagi chuqur",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    division: { id: "e2e-division", name: "1-son yo‘l bo‘limi" },
    chainageStartM: 48920,
    chainageEndM: 48924,
    observedAt: "2026-08-11T08:05:00Z",
    receivedAt: "2026-08-11T08:18:00Z",
    state: "PENDING_REVIEW",
    measuredQuantity: { value: "4.6", unit: "m²" },
    evidence: [{ index: 0, contentType: "image/png", capturedAt: "2026-08-11T08:05:00Z", sha256: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", url: "/e2e-road-evidence.svg", mediaId: "rv-media-1046" }],
  },
];
const initialFindingTypes:Record<string,string>={"finding-1":"defect-pothole","finding-2":"defect-shoulder-eroded","finding-3":"defect-pothole","finding-4":"defect-shoulder-settled","finding-5":"defect-pothole"};
let fixtureFindings: RoadVisionFinding[] = structuredClone(initialFixtureFindings).map(item=>({...item,attributeName:inspectionTypes.find(t=>t.id===initialFindingTypes[item.id])!.name,simulation:true,recordKind:"DEFECT_CANDIDATE",quantityStatus:item.measuredQuantity?"ESTIMATED":"MISSING",defectTypeId:initialFindingTypes[item.id]}));

const confirmedDefects: ConfirmedDefect[] = [
  {
    id: "defect-confirmed-1",
    sourceKind: "ROADVISION",
    sourceReference: "RV-E2E-1001",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    division: { id: "e2e-division", name: "1-son yo‘l bo‘limi" },
    observedAt: "2026-08-11T04:22:00Z",
    locationLabel: "km 18.420–18.427",
    chainageStartM: 18420,
    chainageEndM: 18427,
    defectName: "Qoplamadagi chuqur",
    exactQuantity: { value: "12.4", unit: "m²" },
    state: "OPEN",
  },
  {
    id: "defect-confirmed-2",
    sourceKind: "MANUAL_INSPECTION",
    sourceReference: "KORIK-2026-0086",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    division: { id: "e2e-division", name: "1-son yo‘l bo‘limi" },
    observedAt: "2026-08-10T12:00:00Z",
    locationLabel: "km 44.100–44.106",
    chainageStartM: 44100,
    chainageEndM: 44106,
    defectName: "Yo‘l yoqasi yemirilgan",
    exactQuantity: { value: "8.5", unit: "m³" },
    state: "PLANNED",
  },
];

const dashboard: DashboardSummary = {
  asOf: "2026-08-12T05:30:00Z",
  division: fixtureUser.division ?? null,
  counts: {
    reviewQueue: 2,
    confirmedDefects: 14,
    plannedToday: 8,
    openWorkOrders: 11,
    overdueWorkOrders: 2,
    workersOnShift: 26,
    availableEquipment: 7,
    failedSyncs: 1,
  },
  alerts: [
    {
      id: "alert-1",
      kind: "danger",
      title: "RoadVision qabul oqimi sozlanmagan",
      detail: "Natijalarni qabul qilish manzili va imzo kaliti kiritilishi kerak.",
      href: "/integratsiyalar",
    },
    {
      id: "alert-2",
      kind: "warning",
      title: "Ikki topshiriq muddati o‘tgan",
      detail: "Mas’ul brigada holatni yangilashi kerak.",
      href: "/topshiriqlar",
    },
  ],
  activity: [
    {
      id: "activity-1",
      occurredAt: "2026-08-12T04:51:00Z",
      actor: "Dilshod Karimov",
      action: "Nuqsonni tasdiqladi",
      subject: "D001, 18+420",
    },
    {
      id: "activity-2",
      occurredAt: "2026-08-12T04:17:00Z",
      actor: "Malika Ismoilova",
      action: "Topshiriqni ishga oldi",
      subject: "YT-2026-00841",
    },
  ],
};

const adminNetworkSummary: AdminNetworkSummary = {
  asOf: "2026-08-18T10:30:00Z",
  officialNetworkLengthKm: 42371,
  synchronizedRoadLengthKm: "67.000",
  synchronizedRoadCount: 1,
  synchronizedDivisionCount: 1,
};

const adminOrganizationHierarchy: AdminOrganizationHierarchy = {
  asOf: "2026-08-18T10:30:00Z",
  officialNetworkLengthKm: 42371,
  summary: {
    synchronizedRepublicCount: 0,
    synchronizedRegionCount: 0,
    synchronizedEnterpriseCount: 0,
    synchronizedDivisionCount: 1,
    unlinkedNodeCount: 1,
    hierarchyComplete: false,
  },
  tree: [],
  unlinkedNodes: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      externalId: "division-d001",
      code: "D001-DIV",
      name: "1-son yo‘l bo‘limi",
      level: "DIVISION",
      reason: "ENTERPRISE_CHAIN_MISSING_OR_INEFFECTIVE",
    },
  ],
};

const candidates: PlanningCandidate[] = [
  {
    id: "candidate-1",
    sourceReference: "RV-E2E-1001",
    sourceKind: "ROADVISION",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    locationLabel: "18+420 — 18+427, o‘ng tasma",
    workName: "Qoplamadagi chuqurni ta’mirlash",
    exactQuantity: { value: "12.4", unit: "m²" },
    normReference: "IQN 02-24 · tasdiqlangan norma varianti",
    verificationState: "VERIFIED",
  },
  {
    id: "candidate-2",
    sourceReference: "MI-E2E-088",
    sourceKind: "MANUAL_INSPECTION",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    locationLabel: "46+210 — 46+260, chap yoqa",
    workName: "Yo‘l yoqasini tiklash",
    exactQuantity: { value: "75", unit: "m³" },
    normReference: "IQN 02-24 · tasdiqlangan norma varianti",
    verificationState: "VERIFIED",
  },
  {
    id: "candidate-3",
    sourceReference: "RV-E2E-1007",
    sourceKind: "ROADVISION",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    locationLabel: "61+900, o‘ng yoqa",
    workName: "Suv qochirish arig‘ini tozalash",
    exactQuantity: null,
    normReference: "IQN 02-24 · o‘lchash talab etiladi",
    verificationState: "VERIFIED",
  },
  {
    id: "candidate-4",
    sourceReference: "YP-2026-RECUR-08-01",
    sourceKind: "ANNUAL_PROGRAM",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    locationLabel: "0+000 — 67+000",
    workName: "Qoplamani mexanizatsiyalashgan supurish",
    exactQuantity: { value: "67", unit: "km" },
    normReference: "IQN 02-24 · avgust davriy ishi",
    verificationState: "APPROVED",
  },
  {
    id: "candidate-5",
    sourceReference: "YP-2026-RECUR-08-02",
    sourceKind: "ANNUAL_PROGRAM",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    locationLabel: "Yo‘l bo‘ylab 156 ta element",
    workName: "Yo‘l belgilari va to‘siqlarni yuvish",
    exactQuantity: { value: "156", unit: "dona" },
    normReference: "IQN 02-24 + IQN 03-24 · davriylik",
    verificationState: "APPROVED",
  },
];

const initialWorkOrders: WorkOrderDetail[] = [
  {
    id: "order-1",
    number: "YT-2026-00841",
    workName: "Qoplamadagi chuqurni ta’mirlash",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    locationLabel: "18+420 — 18+427",
    scheduledDate: "2026-08-12",
    teamName: "1-brigada",
    state: "IN_PROGRESS",
    exactQuantity: { value: "12.4", unit: "m²" },
    normReference: "IQN 02-24 · 4.2-band · qoplamani joriy ta’mirlash",
    startedAt: "2026-08-12T04:17:00Z",
    startedByName: "Kamola Umarova",
    executionResources: {
      workers: [
        { id: "w-1", fullName: "Aziz Shermatov", positionName: "Yo‘l ishchisi", workDate: "2026-08-12", plannedMinutes: 240 },
        { id: "w-2", fullName: "Kamola Umarova", positionName: "Yo‘l ustasi", workDate: "2026-08-12", plannedMinutes: 180 },
      ],
      materials: [
        { id: "s-1", reservationId: "51111111-1111-4111-8111-111111111111", code: "MAT-011", name: "Issiq asfalt qorishmasi", unit: "t", usedAt: "2026-08-12T09:00:00+05:00", plannedQuantity: "1.45" },
        { id: "s-2", reservationId: "52222222-2222-4222-8222-222222222222", code: "MAT-042", name: "Mayda chaqiq tosh", unit: "m³", usedAt: "2026-08-12T09:00:00+05:00", plannedQuantity: "0.32" },
      ],
      equipment: [
        { id: "e-1", reservationId: "61111111-1111-4111-8111-111111111111", inventoryCode: "TG-017", name: "Avtogreyder", usageDate: "2026-08-12", plannedMachineMinutes: 90 },
        { id: "e-2", reservationId: "62222222-2222-4222-8222-222222222222", inventoryCode: "TG-024", name: "Katok", usageDate: "2026-08-12", plannedMachineMinutes: 75 },
      ],
    },
    completion: null,
  },
  {
    id: "order-2",
    number: "YT-2026-00842",
    workName: "Yo‘l yoqasini tiklash",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    locationLabel: "46+210 — 46+260",
    scheduledDate: "2026-08-13",
    teamName: "2-brigada",
    state: "ASSIGNED",
    exactQuantity: { value: "75", unit: "m³" },
    normReference: "IQN 02-24 · 5.1-band · yo‘l yoqasini saqlash",
    executionResources: {
      workers: [
        { id: "w-1", fullName: "Aziz Shermatov", positionName: "Yo‘l ishchisi", workDate: "2026-08-13", plannedMinutes: 300 },
        { id: "w-2", fullName: "Kamola Umarova", positionName: "Yo‘l ustasi", workDate: "2026-08-13", plannedMinutes: 240 },
      ],
      materials: [
        { id: "s-2", reservationId: "53333333-3333-4333-8333-333333333333", code: "MAT-042", name: "Mayda chaqiq tosh", unit: "m³", usedAt: "2026-08-13T09:00:00+05:00", plannedQuantity: "82.5" },
      ],
      equipment: [
        { id: "e-1", reservationId: "63333333-3333-4333-8333-333333333333", inventoryCode: "TG-017", name: "Avtogreyder", usageDate: "2026-08-13", plannedMachineMinutes: 210 },
      ],
    },
    completion: null,
  },
  {
    id: "order-3",
    number: "YT-2026-00833",
    workName: "Qoplamani mexanizatsiyalashgan supurish",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    locationLabel: "0+000 — 67+000",
    scheduledDate: "2026-08-07",
    teamName: "1-brigada",
    state: "VERIFIED",
    exactQuantity: { value: "67", unit: "km" },
    normReference: "IQN 02-24 + IQN 03-24 · avgust davriy saqlash ishi",
    startedAt: "2026-08-07T03:00:00Z",
    startedByName: "Kamola Umarova",
    executionResources: {
      workers: [
        { id: "w-1", fullName: "Aziz Shermatov", positionName: "Yo‘l ishchisi", workDate: "2026-08-07", plannedMinutes: 420 },
        { id: "w-2", fullName: "Kamola Umarova", positionName: "Yo‘l ustasi", workDate: "2026-08-07", plannedMinutes: 180 },
      ],
      materials: [],
      equipment: [
        { id: "e-1", reservationId: "64444444-4444-4444-8444-444444444444", inventoryCode: "TG-017", name: "Avtogreyder", usageDate: "2026-08-07", plannedMachineMinutes: 240 },
      ],
    },
    completion: {
      id: "completion-3",
      state: "VERIFIED",
      actualQuantity: { value: "67", unit: "km" },
      workerMinutes: [{ workerId: "w-1", minutes: 420 }, { workerId: "w-2", minutes: 180 }],
      materials: [],
      equipment: [{ equipmentUnitId: "e-1", machineMinutes: 240 }],
      evidence: [{ url: "/e2e-road-evidence.svg", mediaType: "image/png" }],
      note: "Butun halqa yo‘li bo‘ylab reja asosida bajarildi.",
      recordedAt: "2026-08-07T10:30:00Z",
      recordedByName: "Kamola Umarova",
      canVerify: false,
      verifiedAt: "2026-08-07T12:00:00Z",
      verifiedByName: "Dilshod Ergashev",
      verificationNote: "Dalil, tabel va texnika qaydi bilan solishtirildi.",
    },
  },
];
let fixtureWorkOrders: WorkOrderDetail[] = structuredClone(initialWorkOrders);

const initialMonthlyCompletionActs: MonthlyCompletionAct[] = [
  {
    id: "monthly-act-2026-08",
    divisionId: "e2e-division",
    actNumber: "DAL-2026-08-001",
    actMonth: "2026-08-01",
    divisionName: "1-son yo‘l bo‘limi",
    roadLabel: "D001 · Toshkent halqa avtomobil yo‘li",
    state: "DRAFT",
    createdByMe: true,
    submittedByMe: false,
    canSubmit: true,
    canApprove: false,
    itemCount: 1,
    laborAmountUzs: "3300000.00",
    socialAmountUzs: "396000.00",
    materialAmountUzs: "0.00",
    equipmentAmountUzs: "1400000.00",
    totalAmountUzs: "5096000.00",
    createdAt: "2026-08-18T05:20:00Z",
    items: [{
      id: "monthly-act-item-3",
      workOrderId: "order-3",
      orderNumber: "YT-2026-00833",
      workName: "Qoplamani mexanizatsiyalashgan supurish",
      normReference: "IQN 02-24 + IQN 03-24 · avgust davriy saqlash ishi",
      completedQuantity: { value: "67", unit: "km" },
      iqnLaborNorm: {
        normSetId: "fixture-iqn-norm-set-sweeping",
        normLineIds: ["fixture-iqn-labor-line-sweeping"],
        basisQuantity: { value: "1", unit: "km" },
        minutesPerBasis: "9.000",
        minutesPerUnit: "9.000000",
        totalMinutes: "603.000000",
      },
      laborAmountUzs: "3300000.00",
      socialAmountUzs: "396000.00",
      materialAmountUzs: "0.00",
      equipmentAmountUzs: "1400000.00",
      totalAmountUzs: "5096000.00",
    }],
  },
];
let monthlyCompletionActs: MonthlyCompletionAct[] = structuredClone(initialMonthlyCompletionActs);

function monthlyCompletionActSummary(act: MonthlyCompletionAct): MonthlyCompletionActSummary {
  return {
    id: act.id,
    divisionId: act.divisionId,
    actNumber: act.actNumber,
    actMonth: act.actMonth,
    divisionName: act.divisionName,
    roadLabel: act.roadLabel,
    state: act.state,
    createdByMe: act.createdByMe,
    submittedByMe: act.submittedByMe,
    canSubmit: act.canSubmit,
    canApprove: act.canApprove,
    itemCount: act.itemCount,
    laborAmountUzs: act.laborAmountUzs,
    socialAmountUzs: act.socialAmountUzs,
    materialAmountUzs: act.materialAmountUzs,
    equipmentAmountUzs: act.equipmentAmountUzs,
    totalAmountUzs: act.totalAmountUzs,
    createdAt: act.createdAt,
    submittedAt: act.submittedAt,
    approvedAt: act.approvedAt,
  };
}

const initialCostRates: CostRate[] = [
  {
    id: "rate-labor-1",
    divisionId: "e2e-division",
    rateKind: "labor",
    target: { id: "w-1", code: "D001-014", name: "Aziz Shermatov" },
    rateBasis: "monthly_salary",
    pricingUnit: "month",
    rateAmountUzs: "3800000.00",
    scheduleCode: "ROAD_7H",
    bonusRateBps: 1500,
    trafficAllowanceRateBps: 1200,
    travelAllowanceRateBps: 0,
    socialContributionRateBps: 1200,
    effectiveFrom: "2026-08-01",
    effectiveUntil: "2027-01-01",
    sourceReference: "Shtat jadvali 2026/08",
    versionNo: 1,
    state: "APPROVED",
    createdByMe: false,
    canApprove: false,
    createdAt: "2026-07-28T08:00:00Z",
    approvedAt: "2026-07-29T08:00:00Z",
  },
  {
    id: "rate-material-1",
    divisionId: "e2e-division",
    rateKind: "material",
    target: { id: "s-1", code: "MAT-011", name: "Issiq asfalt qorishmasi" },
    rateBasis: "material_unit",
    pricingUnit: "t",
    rateAmountUzs: "920000.00",
    bonusRateBps: 0,
    trafficAllowanceRateBps: 0,
    travelAllowanceRateBps: 0,
    socialContributionRateBps: 0,
    effectiveFrom: "2026-08-01",
    effectiveUntil: "2026-09-01",
    sourceReference: "Shartnoma №41 · 01.08.2026",
    versionNo: 1,
    state: "APPROVED",
    createdByMe: false,
    canApprove: false,
    createdAt: "2026-08-01T07:30:00Z",
    approvedAt: "2026-08-01T09:00:00Z",
  },
  {
    id: "rate-equipment-1",
    divisionId: "e2e-division",
    rateKind: "equipment",
    target: { id: "e-1", code: "TG-017", name: "Avtogreyder" },
    rateBasis: "machine_hour",
    pricingUnit: "machine_hour",
    rateAmountUzs: "350000.00",
    bonusRateBps: 0,
    trafficAllowanceRateBps: 0,
    travelAllowanceRateBps: 0,
    socialContributionRateBps: 0,
    effectiveFrom: "2026-08-01",
    effectiveUntil: "2027-01-01",
    sourceReference: "Mashina-soat kalkulyatsiyasi 2026",
    versionNo: 1,
    state: "APPROVED",
    createdByMe: false,
    canApprove: false,
    createdAt: "2026-07-28T08:10:00Z",
    approvedAt: "2026-07-29T08:10:00Z",
  },
  {
    id: "rate-labor-2",
    divisionId: "e2e-division",
    rateKind: "labor",
    target: { id: "w-2", code: "D001-006", name: "Kamola Umarova" },
    rateBasis: "monthly_salary",
    pricingUnit: "month",
    rateAmountUzs: "5200000.00",
    scheduleCode: "ROAD_7H",
    bonusRateBps: 2000,
    trafficAllowanceRateBps: 1200,
    travelAllowanceRateBps: 0,
    socialContributionRateBps: 1200,
    effectiveFrom: "2026-08-01",
    effectiveUntil: "2027-01-01",
    sourceReference: "Shtat jadvali 2026/08",
    versionNo: 1,
    state: "APPROVED",
    createdByMe: false,
    canApprove: false,
    createdAt: "2026-07-28T08:03:00Z",
    approvedAt: "2026-07-29T08:03:00Z",
  },
  {
    id: "rate-material-2",
    divisionId: "e2e-division",
    rateKind: "material",
    target: { id: "s-2", code: "MAT-042", name: "Mayda chaqiq tosh" },
    rateBasis: "material_unit",
    pricingUnit: "m³",
    rateAmountUzs: "185000.00",
    bonusRateBps: 0,
    trafficAllowanceRateBps: 0,
    travelAllowanceRateBps: 0,
    socialContributionRateBps: 0,
    effectiveFrom: "2026-08-01",
    effectiveUntil: "2027-01-01",
    sourceReference: "Shartnoma №42 · 01.08.2026",
    versionNo: 1,
    state: "APPROVED",
    createdByMe: false,
    canApprove: false,
    createdAt: "2026-08-01T07:31:00Z",
    approvedAt: "2026-08-01T09:01:00Z",
  },
  {
    id: "rate-equipment-2",
    divisionId: "e2e-division",
    rateKind: "equipment",
    target: { id: "e-2", code: "TG-024", name: "Katok" },
    rateBasis: "machine_hour",
    pricingUnit: "machine_hour",
    rateAmountUzs: "285000.00",
    bonusRateBps: 0,
    trafficAllowanceRateBps: 0,
    travelAllowanceRateBps: 0,
    socialContributionRateBps: 0,
    effectiveFrom: "2026-08-01",
    effectiveUntil: "2027-01-01",
    sourceReference: "Mashina-soat kalkulyatsiyasi 2026",
    versionNo: 1,
    state: "APPROVED",
    createdByMe: false,
    canApprove: false,
    createdAt: "2026-07-28T08:11:00Z",
    approvedAt: "2026-07-29T08:11:00Z",
  },
  {
    id: "rate-material-september-draft",
    divisionId: "e2e-division",
    rateKind: "material",
    target: { id: "s-1", code: "MAT-011", name: "Issiq asfalt qorishmasi" },
    rateBasis: "material_unit",
    pricingUnit: "t",
    rateAmountUzs: "955000.00",
    bonusRateBps: 0,
    trafficAllowanceRateBps: 0,
    travelAllowanceRateBps: 0,
    socialContributionRateBps: 0,
    effectiveFrom: "2026-09-01",
    effectiveUntil: "2026-10-01",
    sourceReference: "Shartnoma №41/1 · 25.08.2026",
    versionNo: 2,
    state: "DRAFT",
    createdByMe: false,
    canApprove: true,
    createdAt: "2026-08-18T07:30:00Z",
  },
];
let costRates: CostRate[] = structuredClone(initialCostRates);

const initialMonthlyWorkTimeNorms: MonthlyWorkTimeNorm[] = [
  {
    id: "time-norm-2026-08",
    divisionId: "e2e-division",
    workMonth: "2026-08-01",
    scheduleCode: "ROAD_7H",
    workingDays: 22,
    normMinutes: 9240,
    sourceReference: "2026-yil ishlab chiqarish taqvimi",
    versionNo: 1,
    state: "APPROVED",
    createdByMe: false,
    canApprove: false,
    createdAt: "2026-07-25T08:00:00Z",
    approvedAt: "2026-07-26T08:00:00Z",
  },
  {
    id: "time-norm-2026-08-road-6h-draft",
    divisionId: "e2e-division",
    workMonth: "2026-08-01",
    scheduleCode: "ROAD_6H",
    workingDays: 22,
    normMinutes: 7920,
    sourceReference: "2026-yil ishlab chiqarish taqvimi · 6 soatlik grafik",
    versionNo: 1,
    state: "DRAFT",
    createdByMe: false,
    canApprove: true,
    createdAt: "2026-08-17T08:00:00Z",
  },
];
let monthlyWorkTimeNorms: MonthlyWorkTimeNorm[] = structuredClone(initialMonthlyWorkTimeNorms);

const annualLines: AnnualProgramLine[] = [
  {
    id: "annual-1",
    programId: "30000000-0000-4000-8000-000000002026",
    year: 2026,
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    workName: "Qoplamadagi chuqurlarni ta’mirlash",
    normReference: "IQN 02-24 · tasdiqlangan norma varianti",
    quantity: { planned: "1850", completed: "642", unit: "m²" },
    laborHours: { required: "1194", completed: "416" },
    approvalState: "APPROVED",
  },
  {
    id: "annual-2",
    programId: "30000000-0000-4000-8000-000000002026",
    year: 2026,
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    workName: "Suv qochirish inshootlarini tozalash",
    normReference: "IQN 02-24 · tasdiqlangan norma varianti",
    quantity: { planned: "24.6", completed: "8.1", unit: "km" },
    laborHours: { required: "820", completed: "271" },
    approvalState: "APPROVED",
  },
];

let integrations: IntegrationReadiness[] = [
  {
    code: "ROAD_REPAIR_POINT",
    name: "Yo‘l ta’mirlash punkti",
    supplies: ["Yo‘llar va uzunliklar", "Yo‘l elementlari", "Yo‘l bo‘limlari", "Ishchilar"],
    state: "NEEDS_CONFIGURATION",
    lastSuccessfulSyncAt: null,
    lastAttemptAt: null,
    message: "API manzili va xizmat hisobi kiritilmagan.",
    requiredActions: ["API manzilini kiriting", "Xizmat hisobini ulang", "Tarmoq ruxsatini tekshiring"],
  },
  {
    code: "ROADVISION",
    name: "RoadVision AI",
    supplies: ["Aniqlangan nuqsonlar", "Kuzatuv dalillari", "O‘lchovlar"],
    state: "ERROR",
    lastSuccessfulSyncAt: null,
    lastAttemptAt: "2026-08-12T04:00:00Z",
    message: "Natija manbasi bo‘yicha texnik shartnoma mavjud emas.",
    requiredActions: ["Natija formatini tasdiqlang", "Qabul manzilini sozlang", "Imzo kalitini kiriting"],
  },
  {
    code: "SUPABASE",
    name: "Supabase PostgreSQL",
    supplies: ["Operatsion ma’lumotlar", "Audit tarixi"],
    state: "READY",
    lastSuccessfulSyncAt: "2026-08-12T05:29:00Z",
    lastAttemptAt: "2026-08-12T05:29:00Z",
    message: "Ulanish tayyor.",
    requiredActions: [],
  },
];

const resourceSets: Record<string, ResourceRow[]> = {
  workers: [
    { id: "w-1", name: "Aziz Shermatov", divisionName: "1-son yo‘l bo‘limi", detail: "Yo‘l ishchisi", stateLabel: "Smenada" },
    { id: "w-2", name: "Kamola Umarova", divisionName: "1-son yo‘l bo‘limi", detail: "Usta", stateLabel: "Smenada" },
  ],
  equipment: [
    { id: "e-1", name: "Avtogreyder", code: "TG-017", detail: "D001 yo‘l bo‘limiga biriktirilgan", stateLabel: "Bo‘sh" },
    { id: "e-2", name: "Katok", code: "TG-024", detail: "2-brigadaga biriktirilgan", stateLabel: "Ishda" },
  ],
  warehouse: [
    { id: "s-1", name: "Issiq asfalt qorishmasi", code: "MAT-011", detail: "48.5 t mavjud", stateLabel: "Mavjud" },
    { id: "s-2", name: "Mayda chaqiq tosh", code: "MAT-042", detail: "112 m³ mavjud", stateLabel: "Mavjud" },
  ],
  materials: [
    { id: "s-1", name: "Issiq asfalt qorishmasi", code: "MAT-011", detail: "Narxlash birligi: t", stateLabel: "Narx kiritish mumkin", unit: "t" },
    { id: "s-2", name: "Mayda chaqiq tosh", code: "MAT-042", detail: "Narxlash birligi: m3", stateLabel: "Narx kiritish mumkin", unit: "m3" },
  ],
  timesheets: [
    { id: "t-1", name: "1-brigada", detail: "2026-08-12 · 6 ishchi · 36 soat", stateLabel: "Kiritilgan" },
  ],
};

const roads: RoadOption[] = [
  { id: "road-d001", code: "D001", name: "Toshkent halqa avtomobil yo‘li", divisionName: "1-son yo‘l bo‘limi", lengthM: 67000 },
];

const d001Coordinates: RoadMapData["road"]["geometry"]["coordinates"] = [
  [69.1168, 41.3097],
  [69.174, 41.267],
  [69.254, 41.232],
  [69.35, 41.212],
  [69.4381, 41.2064],
  [69.516, 41.17],
  [69.59, 41.11],
  [69.65, 41.04],
  [69.6743, 40.9892],
  [69.65, 41.1],
  [69.61, 41.235],
  [69.56, 41.36],
  [69.4912, 41.4721],
  [69.27, 41.405],
  [69.1168, 41.3097],
];

const d001Chainages = [0, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000, 55000, 60000, 65000, 67000];

const mapData: RoadMapData = {
  road: {
    id: "road-d001",
    code: "D001",
    name: "Toshkent halqa avtomobil yo‘li",
    lengthM: 67000,
    geometry: { type: "LineString", coordinates: d001Coordinates },
    bounds: [[69.1168, 40.9892], [69.6743, 41.4721]],
    chainageMarkers: d001Chainages.map((chainageM, index) => {
      const [longitude, latitude] = d001Coordinates[index] ?? d001Coordinates.at(-1)!;
      return {
        chainageM,
        label: `${Math.floor(chainageM / 1000)}+${String(chainageM % 1000).padStart(3, "0")}`,
        latitude,
        longitude,
      };
    }),
  },
  layers: {
    elements: [
      { id: "element-sign-1", layer: "ELEMENT", locationLabel: "10+000", kindLabel: "Ogohlantiruvchi yo‘l belgisi", stateLabel: "Ishlayapti", latitude: 41.232, longitude: 69.254, chainageStartM: 10000 },
      { id: "element-culvert-1", layer: "ELEMENT", locationLabel: "32+400", kindLabel: "Suv o‘tkazish quvuri", stateLabel: "Ko‘rikdan o‘tgan", latitude: 41.076, longitude: 69.626, chainageStartM: 32400 },
    ],
    defects: [
      { id: "map-defect-1", layer: "DEFECT", locationLabel: "18+420 — 18+427", kindLabel: "Qoplamadagi chuqur", stateLabel: "Tasdiqlangan", latitude: 41.2064, longitude: 69.4381, chainageStartM: 18420, chainageEndM: 18427 },
      { id: "map-defect-2", layer: "DEFECT", locationLabel: "46+210 — 46+260", kindLabel: "Yo‘l yoqasi yemirilgan", stateLabel: "Ko‘rik kutilmoqda", latitude: 41.133, longitude: 69.64, chainageStartM: 46210, chainageEndM: 46260 },
    ],
    workZones: [
      { id: "map-work-1", layer: "WORK_ZONE", locationLabel: "52+100 — 52+480", kindLabel: "Ariqni tozalash", stateLabel: "Biriktirilgan", latitude: 41.29, longitude: 69.588, chainageStartM: 52100, chainageEndM: 52480 },
    ],
  },
};

const manualInspectionOptions: ManualInspectionOptions = {
  roads,
  defectTypes: inspectionTypes,
  workTopics: [
    { id: "02000000-0000-4000-8000-000000000001", topicNumber: 1, name: "Йўл пойини сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000002", topicNumber: 2, name: "Асфальтбетон қопламаларни сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000003", topicNumber: 3, name: "Цементбетон қопламаларни сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000004", topicNumber: 4, name: "Қора-шағал қопламаларни сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000005", topicNumber: 5, name: "Шағалли ва чақилган тошли қопламаларни сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000006", topicNumber: 6, name: "Тупроқ йўлни сақлаш учун вақт меъёрлари (6 m кенгликда)" },
    { id: "02000000-0000-4000-8000-000000000007", topicNumber: 7, name: "Сунъий иншоотларни сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000008", topicNumber: 8, name: "Йўналтирувчи устунчалар ва ажратувчи ва ҳимояловчи тўсиқларни сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000009", topicNumber: 9, name: "Бир автомобиль тўхташ майдончасини сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000010", topicNumber: 10, name: "Бир майдончани (дам олиш) ва автомобилларнинг тўхтаб туриш жойини сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000011", topicNumber: 11, name: "Бир дона автобекатни сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000012", topicNumber: 12, name: "Бир дона йўл белгисини сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000013", topicNumber: 13, name: "Пиёдалар учун йўлакларни, ер ости ва ер усти пиёдалар ўтиш жойларини сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000014", topicNumber: 14, name: "Асфальтбетон билан мустаҳкамланган йўл четини сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000015", topicNumber: 15, name: "Қаттиқ қопламали туташувчи йўлларни сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000016", topicNumber: 16, name: "Қордан ҳимояловчи тўсиқларни сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000017", topicNumber: 17, name: "Ёритиш тармоғини сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000018", topicNumber: 18, name: "Маъмурий бинолар ва ишлаб чиқариш иншоотларини сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000019", topicNumber: 19, name: "Кўкаламзорлаштириш, манзарали дарахтлар ва гулхоналарни сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000020", topicNumber: 20, name: "Автомобиль йўлларининг қишки қарови учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000021", topicNumber: 21, name: "Сақлаш ишларига оид техник ишлар учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000022", topicNumber: 22, name: "Сақлаш ишларида юклаш ва тушириш ишлари вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000023", topicNumber: 23, name: "Сув қудуқларини сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000024", topicNumber: 24, name: "Канализация сув қувурларини сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000025", topicNumber: 25, name: "Марказий иситиш қувурларини сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000026", topicNumber: 26, name: "Сув таъминоти қувурларини сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000027", topicNumber: 27, name: "Тонел иншоотини сақлаш учун вақт меъёрлари" },
    { id: "02000000-0000-4000-8000-000000000028", topicNumber: 28, name: "Автомобил йўллари техник ҳолатини диагностикадан ўтказиш ва баҳолаш ишларининг 1 км автомобил йўли учун вақт меъёрлари." },
    { id: "02000000-0000-4000-8000-000000000029", topicNumber: 29, name: "Автомобил йўлларини йўл ҳаракатини ташкил этилганлиги юзасидан аудитдан ўтказиш ишларининг 1 км автомобил йўли учун вақт меъёрлари." },
  ],
  measurementUnits: [
    { value: "m", label: "metr" },
    { value: "m2", label: "kvadrat metr" },
    { value: "m3", label: "kub metr" },
    { value: "dona", label: "dona" },
    { value: "km", label: "kilometr" },
  ],
};

const initialManualInspections: ManualInspection[] = [
  {
    id: "inspection-draft-1",
    inspectionNumber: "KORIK-2026-0088",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    division: { id: "e2e-division", name: "1-son yo‘l bo‘limi" },
    observedDate: "2026-08-11",
    inspectorName: "Kamola Umarova",
    state: "DRAFT",
    observations: [{
      id: "observation-1",
      locationLabel: "32+400 — 32+412, o‘ng tasma",
      observedIssue: "Ko‘ndalang yoriq",
      exactQuantity: { value: "12", unit: "m" },
      laneLabel: "O‘ng tasma",
      evidence: [{ index: 0, contentType: "image/png", capturedAt: "2026-08-11T08:20:00Z", sha256: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", url: "/e2e-road-evidence.svg" }],
    }],
    note: "Dalil joyida tekshirildi.",
  },
  {
    id: "inspection-review-1",
    inspectionNumber: "KORIK-2026-0087",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    division: { id: "e2e-division", name: "1-son yo‘l bo‘limi" },
    observedDate: "2026-08-10",
    inspectorName: "Aziz Shermatov",
    state: "PENDING_REVIEW",
    observations: [{
      id: "observation-2",
      locationLabel: "44+100 — 44+106, chap yoqa",
      observedIssue: "Yo‘l yoqasi yemirilgan",
      exactQuantity: { value: "8.5", unit: "m³" },
      laneLabel: "Chap yoqa",
      evidence: [],
    }],
    submittedAt: "2026-08-10T12:15:00Z",
  },
];
let manualInspections: ManualInspection[] = structuredClone(initialManualInspections);

const planningOptions: PlanningOptions = {
  road: roads[0]!,
  workVariants: [
    { id: "work-pothole", code: "IQN02-QOPLAMA", name: "Qoplamani joriy saqlash va tiklash", iqnTopicId: "02000000-0000-4000-8000-000000000002", iqnTopicName: "Асфальтбетон қопламаларни сақлаш учун вақт меъёрлари", normReference: "IQN 02-24 · ekspert tasdiqlaydigan norma", unit: "m2", requiredWorkers: 3, laborMinutesPerUnit: 16 },
    { id: "work-shoulder", code: "IQN02-YOQA", name: "Yo‘l yoqasini saqlash va tiklash", iqnTopicId: "02000000-0000-4000-8000-000000000001", iqnTopicName: "Йўл пойини сақлаш учун вақт меъёрлари", normReference: "IQN 02-24 · ekspert tasdiqlaydigan norma", unit: "m3", requiredWorkers: 1, laborMinutesPerUnit: 22 },
    { id: "work-ditch", code: "IQN02-SUV", name: "Suv qochirish tizimini saqlash", iqnTopicId: "02000000-0000-4000-8000-000000000001", iqnTopicName: "Йўл пойини сақлаш учун вақт меъёрлари", normReference: "IQN 02-24 · ekspert tasdiqlaydigan norma", unit: "m", requiredWorkers: 3, laborMinutesPerUnit: 8 },
  ],
  safetySchemes: [
    { id: "safety-shoulder", code: "ROAD_SHOULDER_WORK", name: "Yo‘l yoqasida ishlash", description: "Harakat tasmalari ochiq, ish joyi yo‘l yoqasida himoyalanadi.", requiredSafetyWorkers: 1, requiredSigns: 4, requiredCones: 12, requiredBarriers: 0, requiresPermit: false },
    { id: "safety-one-lane", code: "SINGLE_LANE_CLOSURE", name: "Bir tasmani yopish", description: "Bir yo‘nalishdagi bitta tasma vaqtincha yopiladi.", requiredSafetyWorkers: 2, requiredSigns: 8, requiredCones: 30, requiredBarriers: 2, requiresPermit: false },
    { id: "safety-half-road", code: "HALF_ROAD_CLOSURE", name: "Yo‘lning yarmini yopish", description: "Harakat yo‘lning ochiq qismiga xavfsiz yo‘naltiriladi.", requiredSafetyWorkers: 2, requiredSigns: 10, requiredCones: 40, requiredBarriers: 4, requiresPermit: false },
    { id: "safety-alternating", code: "ALTERNATING_TRAFFIC", name: "Navbatma-navbat harakat", description: "Transport ikki nazoratchi orqali navbat bilan o‘tkaziladi.", requiredSafetyWorkers: 3, requiredSigns: 12, requiredCones: 50, requiredBarriers: 4, requiresPermit: false },
    { id: "safety-full", code: "FULL_CLOSURE", name: "Yo‘lni to‘liq yopish", description: "Uchastka yopiladi va aylanma yo‘l tashkil etiladi.", requiredSafetyWorkers: 4, requiredSigns: 18, requiredCones: 70, requiredBarriers: 8, requiresPermit: true },
  ],
  workers: [
    { id: "w-1", fullName: "Aziz Shermatov", positionName: "Yo‘l ishchisi", skills: ["road_worker"], availableMinutes: 420 },
    { id: "w-2", fullName: "Kamola Umarova", positionName: "Yo‘l ustasi", skills: ["road_worker", "foreman"], availableMinutes: 420 },
    { id: "w-3", fullName: "Bekzod Rahimov", positionName: "Yo‘l ishchisi", skills: ["road_worker"], availableMinutes: 360 },
    { id: "w-4", fullName: "Madina Tolipova", positionName: "Harakat xavfsizligi xodimi", skills: ["safety"], availableMinutes: 420 },
    { id: "w-5", fullName: "Rustam Qodirov", positionName: "Harakat xavfsizligi xodimi", skills: ["safety"], availableMinutes: 280 },
    { id: "w-6", fullName: "Otabek Tursunov", positionName: "Maxsus texnika operatori", skills: ["operator"], availableMinutes: 420 },
  ],
  sourceDefects: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      sourceKind: "MANUAL_INSPECTION", sourceReference: "KORIK-2026-0087",
      iqnTopic: { id: null, name: "Yo‘l yoqasidagi yemirilish" },
      suggestedWorkVariantIds: ["work-shoulder"],
      location: { chainageStartM: "44100", chainageEndM: "44106" },
      measuredQuantity: { value: "8.5", unit: "m3" },
    },
    {
      id: "23333333-3333-4333-8333-333333333333",
      sourceKind: "MANUAL_INSPECTION", sourceReference: "KORIK-2026-0091",
      iqnTopic: { id: null, name: "Qoplamadagi chuqurchalar" },
      suggestedWorkVariantIds: ["work-pothole"],
      location: { chainageStartM: "18420", chainageEndM: "18427" },
      measuredQuantity: { value: "12.4", unit: "m2" },
    },
    {
      id: "24444444-4444-4444-8444-444444444444",
      sourceKind: "ROADVISION", sourceReference: "RV-E2E-1001",
      iqnTopic: { id: null, name: "Road AI aniqlagan qoplama chuqurchasi" },
      suggestedWorkVariantIds: ["work-pothole"],
      location: { chainageStartM: "22510", chainageEndM: "22515" },
      measuredQuantity: { value: "6.7", unit: "m2" },
    },
  ],
};

const initialSourceDefects = structuredClone(planningOptions.sourceDefects);
const manualCaptureInputs = new Map<string, ManualInspectionInput>();
let fixtureRequisitions: ResourceRequisition[] = [];
const fixturePayrollSnapshots = new Map<string, PayrollSnapshot>();
let fixturePayrollHistory: PayrollHistoryRow[] = [];
const equipmentNorms:WorkerEquipmentCard['norms']=fullEquipmentNorms.filter(n=>n.months!==null&&n.scope!=='work').sort((a,b)=>[4,2,18].indexOf(a.row)<0?([4,2,18].indexOf(b.row)<0?a.row-b.row:1):[4,2,18].indexOf(b.row)<0?-1:[4,2,18].indexOf(a.row)-[4,2,18].indexOf(b.row)).map(n=>({code:`iqn03-t3-r${n.row}`,name:n.name,serviceMonths:n.months!,sourceReference:`IQN 03-24 · 3-jadval, ${n.row}-qator`,allocationScope:n.scope==='personal'?'PERSONAL':'DIVISION',departmentQuantity:n.scope==='division'?n.quantity:null,eligibleOccupationCodes:n.roles,published:true}));
const initialEquipmentStock: WorkerEquipmentCard["stockOptions"] = equipmentNorms.map((norm, index) => ({
  materialId: `ppe-material-${index + 1}`, normCode: norm.code, stockLocationId: "ppe-stock-1",
  name: norm.name, availableQuantity: index === 2 ? 3 : 10, unit: fullEquipmentNorms.find(n=>`iqn03-t3-r${n.row}`===norm.code)?.unit??'dona',
}));
let equipmentStock = structuredClone(initialEquipmentStock);
const workerEquipmentIssues = new Map<string, WorkerEquipmentCard["items"]>();

function fixtureEquipmentExpiry(issuedOn: string, months: number): string {
  const [year, month, day] = issuedOn.split("-").map(Number);
  const expiry = new Date(Date.UTC(year!, month! - 1 + months, 1));
  expiry.setUTCDate(Math.min(day!, new Date(Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0)).getUTCDate()));
  return expiry.toISOString().slice(0, 10);
}

function fixtureWorkerCard(workerId: string): WorkerEquipmentCard {
  const worker = resourceSets.workers?.find((item) => item.id === workerId);
  if (!worker) throw new ApiError("Xodim topilmadi.", 404, "NOT_FOUND");
  const asOf = tashkentFixtureDate();
  const occupationCode = workerId === "w-2" ? "yol_ustasi" : ["w-4","w-5"].includes(workerId) ? "hht_muhandisi" : workerId === "w-6" ? "mashinist" : "yol_ishchisi";
  const initial = [{ materialId: "ppe-material-1", name: "Ogohlantiruvchi nimcha", quantity: 1, issuedOn: "2026-03-31", serviceMonths: 6, sourceReference: equipmentNorms[0]!.sourceReference, allocationScope: "PERSONAL", occupationCode, id: `ppe-initial-${workerId}`, expiresOn: "2026-09-30", daysRemaining: 0, status: "ACTIVE" as const }];
  const items = [...initial, ...(workerEquipmentIssues.get(workerId) ?? [])].map((item) => {
    const daysRemaining = Math.round((Date.parse(`${item.expiresOn}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86400000);
    return { ...item, daysRemaining, status: daysRemaining < 0 ? "EXPIRED" as const : daysRemaining <= 30 ? "DUE" as const : "ACTIVE" as const };
  });
  return { workerId, name: worker.name, asOf, occupationCode, canIssue: true, items, norms: equipmentNorms.filter(n=>n.eligibleOccupationCodes.includes(occupationCode)), stockOptions: equipmentStock.filter((item) => item.availableQuantity > 0 && equipmentNorms.some((norm) => norm.code === item.normCode && norm.eligibleOccupationCodes.includes(occupationCode))) };
}

function monthlyTimesheet(year: number, month: number): MonthlyTimesheet {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new ApiError("Hisob oyi yaroqsiz.", 422, "MONTH_INVALID");
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const totals = new Map<string, Map<number, number>>();
  for (const order of fixtureWorkOrders) {
    if (order.completion?.state !== "VERIFIED" || !order.scheduledDate.startsWith(monthKey)) continue;
    const day = Number(order.scheduledDate.slice(8));
    for (const entry of order.completion.workerMinutes) {
      const days = totals.get(entry.workerId) ?? new Map<number, number>();
      days.set(day, (days.get(day) ?? 0) + entry.minutes);
      totals.set(entry.workerId, days);
    }
  }
  return { year, month, daysInMonth, divisionName: "1-son yo‘l bo‘limi", rows: resourceSets.workers!.map((worker) => {
    const entries = [...(totals.get(worker.id) ?? new Map<number, number>())].map(([day, minutes]) => ({day, minutes, state: "WORK" as const}));
    return {workerId: worker.id, fullName: worker.name, positionName: worker.detail, entries, totalMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0)};
  }) };
}

function automaticResourceChecks() {
  return [
    { kind: "WORKERS" as const, label: "Brigada", required: "3 nafar ishchi", available: "5 nafar bo‘sh", sufficient: true },
    { kind: "WORKER_TIME" as const, label: "Kunlik ish vaqti", required: "har bir xodim uchun 420 daqiqagacha", available: "420 daqiqa", sufficient: true },
    { kind: "EQUIPMENT" as const, label: "Texnika", required: "1 ta maxsus transport", available: "2 ta bo‘sh", sufficient: true },
    { kind: "MATERIALS" as const, label: "Material", required: "IQN normasi bo‘yicha", available: "Omborda mavjud", sufficient: true },
    { kind: "SAFETY_EQUIPMENT" as const, label: "Belgi va konuslar", required: "8 belgi, 30 konus", available: "20 belgi, 60 konus", sufficient: true },
  ];
}

function automaticAssignedMinutes(availableMinutes: number): number {
  return Math.min(240, availableMinutes);
}

let fixturePlans: PlanPreview[] = [{
  draftId: "11111111-1111-4111-8111-111111111111",
  state: "AWAITING_APPROVAL",
  dateFrom: "2026-08-13",
  dateTo: "2026-08-13",
  planningMode: "AUTOMATIC",
  createdByName: "Dilshod Ergashev",
  createdAt: "2026-08-12T04:30:00Z",
  jobs: [{
    candidateId: "DEFECT:22222222-2222-4222-8222-222222222222",
    workName: "Qoplamadagi chuqurni ta’mirlash",
    scheduledDate: "2026-08-13",
    teamName: "1-brigada",
    laborHours: "8.00",
    equipment: ["Maxsus transport"],
    materials: [{ name: "IQN bo‘yicha material", quantity: "12.4", unit: "m²" }],
  }],
  blockers: [],
  resourceChecks: automaticResourceChecks(),
  workerMinutesRemaining: planningOptions.workers.slice(0, 3).map((worker) => ({
    workerId: worker.id,
    fullName: worker.fullName,
    beforeMinutes: worker.availableMinutes,
    assignedMinutes: automaticAssignedMinutes(worker.availableMinutes),
    remainingMinutes: worker.availableMinutes - automaticAssignedMinutes(worker.availableMinutes),
  })),
  safetyScheme: planningOptions.safetySchemes[1] ?? null,
  resourcesReady: true,
  canApprove: true,
  canPublish: false,
}];

function planningSummary(plan: PlanPreview): PlanningRunSummary {
  return {
    id: plan.draftId,
    state: plan.state === "AWAITING_APPROVAL" ? "EVALUATED" : plan.state,
    planningMode: plan.planningMode,
    dateFrom: plan.dateFrom,
    dateTo: plan.dateTo,
    itemCount: plan.jobs.length,
    blockerCount: plan.blockers.filter((blocker) => blocker.level === "BLOCKING").length,
    createdAt: plan.createdAt,
    createdByName: plan.createdByName,
    createdByMe: plan.createdByName === fixtureUser.fullName,
    canApprove: plan.canApprove,
    canPublish: plan.canPublish,
  };
}

function manualPlanPreview(input: ManualPlanInput): PlanPreview {
  const source = demoPlanSource(input.sourceDefectId??"",input.scheduledDate);
  const work = planningOptions.workVariants.find((item) => item.id === input.workVariantId);
  const dates = demoDates(input.scheduledDate, input.scheduledEndDate ?? input.scheduledDate);
  const normMinutes = work ? workNormMinutes(work, input) : NaN;
  if (work && !Number.isFinite(normMinutes)) throw new ApiError(work.normIssue ?? "Me’yor oralig‘idan qiymatni tanlang.",422,"NORM_SELECTION_REQUIRED");
  const startTime = input.startTime ?? "08:00", endTime = input.endTime ?? "15:00";
  const dailyMinutes = Math.min(420, demoTime(endTime) - demoTime(startTime));
  const quantity = Number(input.exactQuantity);
  if (!source || !work || !dates.length || !Number.isFinite(dailyMinutes) || dailyMinutes <= 0 || !Number.isFinite(quantity) || quantity <= 0 || input.roadId !== (source.roadId??planningOptions.road.id)) throw new ApiError("Nuqson, ish, musbat hajm va to‘g‘ri muddatni kiriting.", 422, "PLAN_INPUT_INVALID");
  const annualRef = bindAnnualInput(input,fixtureWorkOrders);
  const roadAccess = input.roadAccess ?? "OPEN";
  const scheme = planningOptions.safetySchemes.find((item) => item.code === (roadAccess === "CLOSED" ? "FULL_CLOSURE" : roadAccess === "PARTIAL" ? "SINGLE_LANE_CLOSURE" : "ROAD_SHOULDER_WORK"))!;
  const demands = demoMaterialDemands(work.id, quantity, input);
  const machines = demoMachines(work.id, dates, input);
  const approvedLine=annualRef?activeProgram(annualRef.year)?.lines.find(l=>l.id===annualRef.lineId):undefined;
  const recipe=automaticResourceRecipe(work,planningOptions.workVariants),laborSource=sourceLabor[work.id],operatorSource=recipe?sourceLabor[recipe.id]:undefined;
  let workerNorm=approvedLine?approvedLine.workerHours/approvedLine.quantity*60:work.catalogSeries==='RESOURCE'?(laborSource?.worker??NaN)*60:normMinutes;
  let operatorNorm=approvedLine?approvedLine.operatorHours/approvedLine.quantity*60:work.catalogSeries==='RESOURCE'?(laborSource?.operator??NaN)*60:operatorSource?.operator!==null&&operatorSource?.operator!==undefined?operatorSource.operator*60:machines.length?NaN:0;
  if(!work.catalogSeries){workerNorm=normMinutes;operatorNorm=machines.length?normMinutes/Math.max(1,work.requiredWorkers):0;}
  if(!approvedLine&&work.catalogSeries==='TIME'&&input.operatorHoursPerUnit!==undefined&&input.operatorBasis?.trim())operatorNorm=input.operatorHoursPerUnit*60;
  const laborIssue=!Number.isFinite(workerNorm)||workerNorm<0||!Number.isFinite(operatorNorm)||operatorNorm<0;
  const perDayUnits=Math.ceil(quantity*1e6/dates.length)/1e6;
  const workers=planningOptions.workers.map(w=>({...w,availableMinutes:Math.min(...dates.map(day=>demoWorkerWindowAvailable(w.id,day,startTime,endTime)))}));
  const crew=assignCrew(workers,input.workerIds,laborIssue?0:perDayUnits*workerNorm,laborIssue?0:perDayUnits*operatorNorm,work.requiredWorkers,scheme.requiredSafetyWorkers,dailyMinutes,Math.max(0,...machines.map(m=>m.minutesPerUnit*perDayUnits)));
  const selected=crew.picked,requiredRoad=crew.requirements.WORKER,roadCount=crew.counts.WORKER,safetyCount=crew.counts.SAFETY;
  const staffEnough=!laborIssue&&crew.staffEnough,timeEnough=crew.timeEnough,minutes=Math.max(0,...selected.map(w=>w.assignedMinutes));
  const signs=Math.min(...dates.map((day)=>demoSafetyAvailable("signs",day))),cones=Math.min(...dates.map((day)=>demoSafetyAvailable("cones",day))),barriers=Math.min(...dates.map((day)=>demoSafetyAvailable("barriers",day)));
  const checks: PlanPreview["resourceChecks"] = [
    {kind:"WORKERS", label:"Brigada tarkibi", required:`${requiredRoad} ishchi + ${crew.requirements.OPERATOR} operator + ${scheme.requiredSafetyWorkers} xavfsizlik xodimi`, available:`${roadCount} ishchi + ${crew.counts.OPERATOR} operator + ${safetyCount} xavfsizlik xodimi`, sufficient:staffEnough},
    {kind:"WORKER_TIME", label:"Xodimlarning bo‘sh vaqti", required:`${minutes} daqiqa/kun · ${dates.length} kun`, available:`${selected.length ? Math.min(...selected.map((w) => w.availableMinutes)) : 0} daqiqa/kun`, sufficient:timeEnough},
    ...demands.map(demand=>({kind:"MATERIALS" as const,label:demand.name,required:`${demand.quantity.toFixed(3)} ${demand.unit}`,available:`${(demoStock[demand.id]??0).toFixed(3)} ${demand.unit}`,sufficient:(demoStock[demand.id]??0)+1e-9>=demand.quantity})),
    ...machines.map(machine=>({kind:"EQUIPMENT" as const,label:machine.name,required:machine.minutesPerUnit?`1 ta · ${(machine.minutesPerUnit*quantity/60).toFixed(3)} mashina-soat`:"1 ta · namuna hisob",available:machine.available?.name??"Mavjud emas yoki band",sufficient:Boolean(machine.available)})),
    ...machines.filter(m=>m.minutesPerUnit*quantity/dates.length>dailyMinutes).map(m=>({kind:"EQUIPMENT_TIME" as const,label:`${m.name}: ish vaqti`,required:`${Math.ceil(m.minutesPerUnit*quantity/dates.length)} daqiqa/kun`,available:`${dailyMinutes} daqiqa/kun. Ish muddatini uzaytiring.`,sufficient:false})),
    {kind:"SAFETY_EQUIPMENT", label:"Belgi va to‘siqlar", required:`${scheme.requiredSigns} belgi, ${scheme.requiredCones} konus, ${scheme.requiredBarriers} to‘siq`, available:`${signs} belgi, ${cones} konus, ${barriers} to‘siq`, sufficient:scheme.requiredSigns <= signs && scheme.requiredCones <= cones && scheme.requiredBarriers <= barriers},
    ...(scheme.requiresPermit ? [{kind:"PERMIT" as const, label:"Yopish ruxsatnomasi", required:"Ruxsatnoma raqami", available:input.permitNumber?.trim() || "Kiritilmagan", sufficient:Boolean(input.permitNumber?.trim())}] : []),
  ];
  const existing = input.replacesDraftId ? fixturePlans.find((item) => item.draftId === input.replacesDraftId) : undefined;
  if (existing && existing.state !== "AWAITING_APPROVAL") throw new ApiError("Tasdiqlangan rejani almashtirib bo‘lmaydi.",409,"PLAN_LOCKED");
  const sourceBusy = (!annualSource(source.id)&&demoSourceBusy(source.id)) || quantity > demoSourceRemaining(source.id) + 1e-6;
  const compatible = normalizeUnit(source.measuredQuantity.unit) === normalizeUnit(work.unit);
  const blockers: PlanPreview["blockers"] = checks.filter((check) => !check.sufficient).map((check) => ({code:`MANUAL_${check.kind}_INSUFFICIENT`,title:`${check.label} yetarli emas`, explanation:`Talab: ${check.required}. Mavjud: ${check.available}.`,resolution:check.kind==="EQUIPMENT_TIME"?"Ish muddatini uzaytiring yoki kunlik vaqtni o‘zgartiring.":"Muddat yoki tarkibni o‘zgartiring; resurs kamomadiga talabnoma bering.",candidateId:source.id,level:"BLOCKING"}));
  if(laborIssue)blockers.push({code:"OPERATOR_NORM_REQUIRED",title:"Ishchi yoki operator mehnat normasi aniqlashtirilsin",explanation:"Operator vaqtini va uning asosini kiriting.",resolution:"Ish va muddat qadamidagi operator hisobini to‘ldiring.",candidateId:source.id,level:"BLOCKING"});
  const resourceIssue=resourcePlanIssue(work,input.resourcePlan,planningOptions.workVariants);
  if(resourceIssue)blockers.push({code:"RESOURCE_RECIPE_MISSING",title:resourceIssue,explanation:"IQN mehnat me’yori saqlanadi. Yetishmagan resurs hisobi boshliq tomonidan kiritiladi.",resolution:"Ish va muddat qadamida «Resurs tarkibi»ni to‘ldiring. Kerak emas bo‘lsa, sababini yozing.",candidateId:source.id,level:"BLOCKING"});
  if (!compatible || sourceBusy || Number(input.chainageStartM) !== Number(source.location.chainageStartM)) blockers.push({code:"SOURCE_INVALID",title:sourceBusy ? "Bu nuqson uchun topshiriq chiqarilgan" : "Ish yoki joy nuqsonga mos emas",explanation:"Bir xil nuqsonni takror rejalashtirish va mos bo‘lmagan birlikda hisoblash mumkin emas.",resolution:"Tegishli ochiq nuqson va unga mos ishni tanlang.",candidateId:source.id,level:"BLOCKING"});
  const draftId = existing?.draftId ?? demoId("plan");
  const scaled = Math.round(quantity * 1e6), perDay = Math.floor(scaled / dates.length);
  const jobs = dates.map((day, index) => {
    const dayQuantity = (index === dates.length - 1 ? scaled - perDay * index : perDay) / 1e6;
    const materials = demoMaterialDemands(work.id, dayQuantity, input);
    return {candidateId:source.id, planItemId:`${draftId}-${index}`, workName:work.name, scheduledDate:day, teamName:"Tanlangan brigada", exactQuantity:String(dayQuantity), unit:work.unit, laborHours:(dayQuantity * normMinutes / 60).toFixed(3), startTime,endTime,roadAccess, requiredWorkers:requiredRoad + crew.requirements.OPERATOR + scheme.requiredSafetyWorkers, assignedWorkers:selected.length, equipment:machines.flatMap(m=>m.available?[m.available.name]:[]), materials:materials.map(m=>({name:m.name,quantity:m.quantity.toFixed(6),unit:m.unit}))};
  });
  return {draftId,workSelectionSource:input.workSelectionSource??"MANUAL",state:"AWAITING_APPROVAL",dateFrom:dates[0]!,dateTo:dates.at(-1)!,startTime,endTime,roadAccess,workersReady:staffEnough && timeEnough,workflowStage:staffEnough && timeEnough ? "RESOURCES" : "STAFFING",requisitions:fixtureRequisitions.filter((r) => r.planId === draftId),planningMode:"MANUAL",createdByName:existing?.createdByName ?? fixtureUser.fullName,createdAt:existing?.createdAt ?? new Date().toISOString(),jobs,blockers,resourceChecks:checks,workerMinutesRemaining:selected.map((worker) => ({workerId:worker.id,role:worker.role,fullName:worker.fullName,beforeMinutes:worker.availableMinutes,assignedMinutes:worker.assignedMinutes,remainingMinutes:Math.max(0,worker.availableMinutes-worker.assignedMinutes)})),safetyScheme:scheme,resourcesReady:!blockers.length,canApprove:!blockers.length && fixtureUser.id === "demo-chief",canPublish:false};
}

function approvedRate(kind: CostRate["rateKind"], targetId: string, workDate: string): CostRate {
  const rate = costRates.filter((item) => item.rateKind === kind
    && item.target.id === targetId
    && item.state === "APPROVED"
    && item.effectiveFrom <= workDate
    && item.effectiveUntil > workDate).sort((a,b)=>b.effectiveFrom.localeCompare(a.effectiveFrom)||b.versionNo-a.versionNo)[0];
  if (!rate) {
    throw new ApiError("Bajarilgan resurs uchun tasdiqlangan narx topilmadi.", 422, "APPROVED_COST_RATE_REQUIRED");
  }
  return rate;
}

function monthlyActItem(order: WorkOrderDetail, index: number): MonthlyCompletionAct["items"][number] {
  const frozen = monthlyCompletionActs.filter(a => a.state !== 'DRAFT').flatMap(a => a.items).find(i => i.workOrderId === order.id);
  if (frozen) return structuredClone(frozen);
  const completion = order.completion;
  if (!completion || completion.state !== "VERIFIED") {
    throw new ApiError("Faqat tekshirilgan bajarilgan ish dalolatnomaga kiradi.", 422, "VERIFIED_COMPLETION_REQUIRED");
  }
  const workDate = order.scheduledDate;
  let laborAmount = 0;
  let socialAmount = 0;
  for (const usage of completion.workerMinutes) {
    if (!usage.minutes) continue;
    const rate = approvedRate("labor", usage.workerId, workDate);
    const norm = monthlyWorkTimeNorms.find((item) => item.state === "APPROVED"
      && item.scheduleCode === rate.scheduleCode
      && item.workMonth.slice(0, 7) === workDate.slice(0, 7));
    if (!norm) {
      throw new ApiError("Ishchi grafigi uchun tasdiqlangan oylik vaqt normasi topilmadi.", 422, "APPROVED_TIME_NORM_REQUIRED");
    }
    const base = Number(rate.rateAmountUzs) * usage.minutes / norm.normMinutes;
    const allowanceBps = rate.bonusRateBps + rate.trafficAllowanceRateBps + rate.travelAllowanceRateBps;
    const withAllowances = base + (base * allowanceBps / 10_000);
    laborAmount += withAllowances;
    socialAmount += withAllowances * rate.socialContributionRateBps / 10_000;
  }
  const materialAmount = completion.materials.reduce((sum, usage) => {
    if (Number(usage.quantity) === 0) return sum;
    const rate = approvedRate("material", usage.materialId, workDate);
    return sum + money2(Number(rate.rateAmountUzs) * Number(usage.quantity));
  }, 0);
  const equipmentAmount = completion.equipment.reduce((sum, usage) => {
    if (usage.machineMinutes === 0) return sum;
    const rate = approvedRate("equipment", usage.equipmentUnitId, workDate);
    return sum + money2(Number(rate.rateAmountUzs) * usage.machineMinutes / 60);
  }, 0);
  const totalAmount = laborAmount + socialAmount + materialAmount + equipmentAmount;
  return {
    id: `monthly-act-item-${index + 1}-${order.id}`,
    workOrderId: order.id,
    orderNumber: order.number,
    workName: order.workName,
    normReference: order.normReference,
    completedQuantity: completion.actualQuantity,
    iqnLaborNorm: demoOrderMeta.has(order.id) ? {
      normSetId:`demo-norm-${order.id}`,normLineIds:[`demo-line-${order.id}`],basisQuantity:{value:'1',unit:completion.actualQuantity.unit},
      minutesPerBasis:String(demoOrderMeta.get(order.id)!.normMinutes),minutesPerUnit:String(demoOrderMeta.get(order.id)!.normMinutes),totalMinutes:String(Number(completion.actualQuantity.value)*demoOrderMeta.get(order.id)!.normMinutes),
    } : null,
    laborAmountUzs: laborAmount.toFixed(2),
    socialAmountUzs: socialAmount.toFixed(2),
    materialAmountUzs: materialAmount.toFixed(2),
    equipmentAmountUzs: equipmentAmount.toFixed(2),
    totalAmountUzs: totalAmount.toFixed(2),
  };
}

function demoActPayrollAdjustments(month:string) {
  const latest=fixturePayrollHistory.find(p=>p.period===month);
  return (latest?fixturePayrollSnapshots.get(latest.id)?.rows??[]:[]).flatMap(row=>{
    const entries=Object.entries(row.adjustments??{}).filter(([key,value])=>value!==undefined&&key!=='workerId'&&!['incomeTaxAmountUzs','unionFeeAmountUzs','advanceAmountUzs','otherDeductionAmountUzs','deductionsConfirmed'].includes(key)).sort(([a],[b])=>a.localeCompare(b));
    return entries.length?[[row.workerId,entries]]:[];
  });
}
function demoActBasis(month:string) {
  const orders=fixtureWorkOrders.filter(o=>o.completion?.state==='VERIFIED'&&o.scheduledDate.startsWith(month));
  const rates=costRates.filter(r=>r.state==='APPROVED'&&r.effectiveFrom.slice(0,7)<=month&&r.effectiveUntil>month+'-01').map(r=>[r.id,r.versionNo,r.rateAmountUzs,r.effectiveFrom,r.effectiveUntil]);
  const norms=monthlyWorkTimeNorms.filter(n=>n.state==='APPROVED'&&n.workMonth===month+'-01').map(n=>[n.id,n.versionNo,n.normMinutes]);
  return JSON.stringify([orders.map(o=>[o.id,o.scheduledDate,o.completion?.actualQuantity,o.completion?.workerMinutes,o.completion?.materials,o.completion?.equipment]),rates,norms,demoActPayrollAdjustments(month)]);
}

function buildMonthlyCompletionAct(actMonth: string, divisionId: string, existing?: MonthlyCompletionAct): MonthlyCompletionAct {
  const monthKey = actMonth.slice(0, 7);
  const used=new Set(monthlyCompletionActs.filter((act)=>act.actMonth===actMonth&&act.state!=='DRAFT').flatMap((act)=>act.items.map((item)=>item.workOrderId)));
  const eligibleOrders = fixtureWorkOrders.filter((order) => order.completion?.state === "VERIFIED" && order.scheduledDate.slice(0, 7) === monthKey && !used.has(order.id));
  if (!eligibleOrders.length) {
    throw new ApiError("Bu oy uchun tekshirilgan bajarilgan ish topilmadi.", 422, "NO_VERIFIED_COMPLETIONS");
  }
  const latest=fixturePayrollHistory.find((item)=>item.period===monthKey);
  const latestRows=latest?fixturePayrollSnapshots.get(latest.id)?.rows??[]:[];
  const activeWorkers=new Set(eligibleOrders.flatMap((o)=>o.completion!.workerMinutes.filter((w)=>w.minutes>0).map((w)=>w.workerId)));
  const adjustments:PayrollAdjustment[]=latestRows.flatMap((row)=>row.adjustments&&activeWorkers.has(row.workerId)?[{...row.adjustments, deductionsConfirmed:false, incomeTaxAmountUzs:0,unionFeeAmountUzs:0,advanceAmountUzs:0,otherDeductionAmountUzs:0}]:[]);
  const fixedFields = fixedPayrollFields;
  const postedRows=monthlyCompletionActs.filter((act)=>act.actMonth===actMonth&&act.state!=='DRAFT').flatMap((act)=>demoExcelReports.get(act.id)?.payroll.rows??[]);
  for(const adjustment of adjustments)for(const [field,segmentField] of Object.entries(fixedFields)){
    const already=money2(postedRows.filter((row)=>row.workerId===adjustment.workerId).flatMap((row)=>row.segments??[]).reduce((sum,segment)=>sum+segment[segmentField],0));
    const desired=Number(adjustment[field]??0);
    if(desired<already)throw new ApiError('Tasdiqlangan dalolatnomadagi to‘lovni kamaytirish uchun tuzatish hujjati kerak.',422,'POSTED_PAYMENT_CONFLICT');
    adjustment[field]=money2(desired-already);
  }
  const payroll=demoPayroll(monthKey,adjustments,eligibleOrders,true);
  const items = eligibleOrders.map((order,index)=>{const item=monthlyActItem(order,index);const segments=payroll.rows.flatMap((row)=>row.segments??[]).filter((segment)=>segment.workOrderId===order.id);item.laborAmountUzs=money2(segments.reduce((sum,segment)=>sum+segment.gross,0)).toFixed(2);item.socialAmountUzs=money2(segments.reduce((sum,segment)=>sum+segment.social,0)).toFixed(2);item.totalAmountUzs=money2(Number(item.laborAmountUzs)+Number(item.socialAmountUzs)+Number(item.materialAmountUzs)+Number(item.equipmentAmountUzs)).toFixed(2);return item;});
  const total = (key: "laborAmountUzs" | "socialAmountUzs" | "materialAmountUzs" | "equipmentAmountUzs" | "totalAmountUzs") =>
    items.reduce((sum, item) => sum + Number(item[key]), 0).toFixed(2);
  const result:MonthlyCompletionAct = {
    id: existing?.id ?? demoId(`monthly-act-${monthKey}`),
    divisionId,
    actNumber: existing?.actNumber ?? `DAL-${monthKey}-${String(monthlyCompletionActs.filter((act)=>act.actMonth===actMonth).length+1).padStart(3,"0")}`,
    actMonth: `${monthKey}-01`,
    divisionName: "1-son yo‘l bo‘limi",
    roadLabel: [...new Set(eligibleOrders.map(o => `${o.road.code} · ${o.road.name}`))].join('; '),
    state: "DRAFT",
    createdByMe: existing?.createdByMe ?? true,
    submittedByMe: false,
    canSubmit: true,
    canApprove: false,
    itemCount: items.length,
    laborAmountUzs: total("laborAmountUzs"),
    socialAmountUzs: total("socialAmountUzs"),
    materialAmountUzs: total("materialAmountUzs"),
    equipmentAmountUzs: total("equipmentAmountUzs"),
    totalAmountUzs: total("totalAmountUzs"),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    items,
  };
  demoExcelReports.set(result.id,demoReport(monthKey,payroll,eligibleOrders,items,'Qoralama',result.actNumber));
  demoActBases.set(result.id,demoActBasis(monthKey));
  return result;
}

function page<T>(items: T[]): Paged<T> {
  return { items, page: 1, pageSize: Math.max(1, items.length), total: items.length };
}

function requireSession(): void {
  const persisted = typeof window !== "undefined" && window.sessionStorage.getItem("roadops_fixture_session") === "active";
  if (!authenticated && !persisted) throw new ApiError("Sessiya topilmadi.", 401, "UNAUTHENTICATED");
  authenticated = true;
}

async function dispatchFixtureRequest<T>(path: string, options: FixtureOptions): Promise<T> {

  const method = (options.method ?? "GET").toUpperCase();

  if (path === "/auth/login" && method === "POST") {
    const credentials = options.body as { email?: string; totpCode?: string };
    if (credentials.email === "mfa@example.uz" && !credentials.totpCode) return { mfaRequired: true, factorType: "totp" } as T;
    if (credentials.email === "mfa@example.uz" && credentials.totpCode !== "123456") {
      throw new ApiError("Autentifikator kodi noto‘g‘ri.", 422, "INVALID_TOTP");
    }
    authenticated = true;
    window.sessionStorage.setItem("roadops_fixture_session", "active");
    document.cookie = "roadops_csrf=e2e-csrf; path=/; SameSite=Lax";
    return fixtureUser as T;
  }
  if (path === "/auth/me") {
    requireSession();
    return fixtureUser as T;
  }
  if (path === "/auth/logout" && method === "POST") {
    authenticated = false;
    window.sessionStorage.removeItem("roadops_fixture_session");
    return undefined as T;
  }

  requireSession();
  if (path === "/dashboard/summary") return demoDashboard() as T;
  if (path === "/admin/network-summary") return adminNetworkSummary as T;
  if (path === "/admin/organization-hierarchy") return adminOrganizationHierarchy as T;
  if (path.startsWith("/roadvision/findings?")) {
    const requestedState = new URLSearchParams(path.split("?")[1]).get("state");
    return page(fixtureFindings.filter((item) => item.state === requestedState)) as T;
  }
  if (path.startsWith("/defects?") && method === "GET") {
    demoSyncDefects();
    const requestedState = new URLSearchParams(path.split("?")[1]).get("state") as ConfirmedDefectState | null;
    return page(confirmedDefects.filter((item) => item.state === requestedState)) as T;
  }
  const decisionMatch = path.match(/^\/roadvision\/findings\/([^/]+)\/decision$/);
  if (decisionMatch && method === "POST") {
    const body = options.body as {
      decision: RoadVisionFinding["state"];
      note: string;
      measuredQuantity?: { value: string; unit: string };
      parameters?: DefectParameters;
      defectTypeId?: string;
    };
    const itemPosition = fixtureFindings.findIndex((item) => item.id === decisionMatch[1]);
    if(fixtureUser.id!=="demo-chief")throw new ApiError("Nuqsonni yo‘l bo‘limi boshlig‘i tasdiqlaydi.",403,"CHIEF_REQUIRED");
    const current = fixtureFindings[itemPosition];
    if (!current) throw new ApiError("Yozuv topilmadi.", 404, "NOT_FOUND");
    if(current.recordKind && current.recordKind!=="DEFECT_CANDIDATE" && body.decision==="VERIFIED")throw new ApiError("Obyekt mavjudligi nuqson deb tasdiqlanmaydi.",422,"NOT_A_DEFECT");
    const findingType=inspectionTypes.find(t=>t.id===(body.defectTypeId??current.defectTypeId));
    if(body.defectTypeId&&!findingType)throw new ApiError("Nuqson turini tanlang.",422,"DEFECT_TYPE_REQUIRED");
    if(body.decision==="VERIFIED" && findingType && normalizeUnit(body.measuredQuantity?.unit??"")!==normalizeUnit(findingType.unit))throw new ApiError(`Bu nuqson ${findingType.unit} da o‘lchanadi.`,422,"DEFECT_UNIT_MISMATCH");
    if(current.state!=="PENDING_REVIEW"||!["VERIFIED","REJECTED","DUPLICATE"].includes(body.decision))throw new ApiError("Nuqson ko‘rib chiqish holatida emas.",409,"REVIEW_STATE_INVALID");
    if(body.decision==='VERIFIED'&&(!body.measuredQuantity||!Number.isFinite(Number(body.measuredQuantity.value))||Number(body.measuredQuantity.value)<=0||!['m2','m3','m²','m³','m','dona','km'].includes(body.measuredQuantity.unit)))throw new ApiError("Hajm va birlikni tekshiring.",422,"MEASUREMENT_INVALID");
    if(body.decision!=='VERIFIED'&&!body.note?.trim())throw new ApiError("Qaror sababini kiriting.",422,"REVIEW_NOTE_REQUIRED");
    const updated = {
      ...current,
      state: body.decision,
      defectTypeId:findingType?.id??current.defectTypeId,
      attributeName:body.decision==="VERIFIED"?(findingType?.name??current.attributeName):current.attributeName,
      reviewerNote: body.note,
      quantityStatus:body.decision==="VERIFIED"?"FIELD_VERIFIED" as const:current.quantityStatus,
      parameters:body.parameters??current.parameters,
      measuredQuantity: body.measuredQuantity ?? current.measuredQuantity,
    };
    fixtureFindings = fixtureFindings.map((item) => (item.id === updated.id ? updated : item));
    if (updated.state === "VERIFIED" && updated.measuredQuantity) {
      const id = `defect-${updated.id}`;
      const unit = updated.measuredQuantity.unit.replace("²", "2").replace("³", "3");
      planningOptions.sourceDefects = [{ id, sourceKind: "ROADVISION", sourceReference: updated.vendorReference,
        observationText:current.attributeName,reviewerNote:updated.reviewerNote,
        defectTypeId:updated.defectTypeId,parameters:updated.parameters,
        iqnTopic: { id: findingType?iqnTopicId(findingType.iqnTopicNumber):null, name: findingType?.name??updated.attributeName },
        suggestedWorkVariantIds: findingType?.candidateWorkIds??[],
        location: { chainageStartM: String(updated.chainageStartM), chainageEndM: String(updated.chainageEndM ?? updated.chainageStartM + 1) },
        measuredQuantity: { value: updated.measuredQuantity.value, unit },
      }, ...planningOptions.sourceDefects.filter((item) => item.id !== id)];
    }
    return updated as T;
  }
  if(path==="/roadvision/demo/import"&&method==="POST"){
    const batch=["pothole","crack","sign-dirty","barrier-bent","vegetation","culvert-blocked"];
    let added=0;
    for(const [index,key] of batch.entries()){
      const id=`rv-demo-iqn-v1-${key}`;
      if(fixtureFindings.some(f=>f.id===id))continue;
      const type=inspectionTypes.find(t=>t.id===`defect-${key}`)!;
      fixtureFindings.unshift({id,vendorReference:`RV-DEMO-${index+1}`,attributeName:type.name,defectTypeId:type.id,recordKind:"DEFECT_CANDIDATE",simulation:true,quantityStatus:"MISSING",road:{code:roads[0]!.code,name:roads[0]!.name},division:{id:"e2e-division",name:roads[0]!.divisionName},chainageStartM:30000+index*500,observedAt:new Date().toISOString(),receivedAt:new Date().toISOString(),state:"PENDING_REVIEW",evidence:[]});
      added++;
    }
    return {added,duplicates:batch.length-added} as T;
  }
  if(path==="/planning/ai/recommendation"&&method==="POST"){
    if(fixtureUser.id!=="demo-chief")throw new ApiError("Loyihani yo‘l bo‘limi boshlig‘i tayyorlaydi.",403,"ROLE_FORBIDDEN");
    const body=options.body as {sourceDefectId:string;scheduledDate:string;parameters?:DefectParameters;resourcePlan?:ManualPlanInput["resourcePlan"];inspectionNote?:string;useAI?:boolean};
    const source=demoPlanSource(body.sourceDefectId,body.scheduledDate);
    if(!source||demoSourceBusy(source.id)||demoSourceRemaining(source.id)<=0)throw new ApiError("Tasdiqlangan, ochiq nuqsonni tanlang.",422,"SOURCE_INVALID");
    if(!demoValidDate(body.scheduledDate))throw new ApiError("Boshlanish sanasini kiriting.",422,"PLAN_INPUT_INVALID");
    const parameters={...source.parameters,...body.parameters};
    const match=selectDefectWork(source,planningOptions.workVariants,parameters);
    const result:AIWorkRecommendation={mode:"DEMO_RULES",sourceDefectId:source.id,status:match.work?"READY":match.type?.patchParameters?"NEEDS_MEASUREMENT":"NEEDS_SELECTION",explanation:"Namuna rejimi: haqiqiy AI ulanmagan. Taklif IQN moslik qoidalari bilan tayyorlandi.",missingFields:match.missing,alternatives:match.alternatives.map(w=>({id:w.id,name:w.name,normReference:w.normReference})),input:null,preview:null};
    let work=match.work;
    if(body.useAI&&match.type){
      const selectionInput={defectTypeId:match.type.id,observedIssue:source.observationText??source.iqnTopic.name,reviewNote:source.reviewerNote??"",measuredQuantity:{...source.measuredQuantity,value:String(demoSourceRemaining(source.id))},parameters,inspectionNote:body.inspectionNote??""};
      const live=await requestAISelection(selectionInput,options.signal??undefined);
      if(live){
        const context=selectionContext(selectionInput,planningOptions.workVariants);
        work=live.workVariantId?context.candidates.find(item=>item.id===live.workVariantId):undefined;
        if(live.workVariantId&&(!work||context.hardMissing.length||live.missingFields.length))throw new ApiError("AI tanlovi IQN shartlariga mos kelmadi.",422,"AI_SELECTION_INVALID");
        Object.assign(result,{mode:live.mode,model:live.model,analysisId:live.analysisId,createdAt:live.createdAt,checks:live.checks,status:work?"READY":"NEEDS_SELECTION",explanation:live.explanation,missingFields:live.missingFields,alternatives:context.candidates.map(item=>({id:item.id,name:item.name,normReference:item.normReference}))});
      }else result.serviceIssue="AI ulanishi sozlanmagan. Quyida IQN qoidalari bilan tayyorlangan namuna loyiha.";
    }
    if(!work)return result as T;
    const input:ManualPlanInput={sourceDefectId:source.id,roadId:source.roadId??planningOptions.road.id,workVariantId:work.id,workSelectionSource:result.mode==="OPENAI"?"AI":"AI_DEMO",aiInspectionNote:body.inspectionNote,aiAnalysis:result.mode==="OPENAI"?{id:result.analysisId,model:result.model,explanation:result.explanation,createdAt:result.createdAt!}:undefined,defectParameters:parameters,resourcePlan:body.resourcePlan?.workVariantId===work.id?body.resourcePlan:undefined,exactQuantity:String(demoSourceRemaining(source.id)),chainageStartM:source.location.chainageStartM,chainageEndM:source.location.chainageEndM,scheduledDate:body.scheduledDate,scheduledEndDate:body.scheduledDate,startTime:"08:00",endTime:"15:00",roadAccess:match.type?.roadAccess??"PARTIAL",...(work.normRange?{selectedNormHours:work.normRange[1]}:{})};
    let preview=manualPlanPreview(input);
    const feasible=(part:PlanPreview)=>part.workersReady&&!part.resourceChecks.some(c=>c.kind==="EQUIPMENT_TIME"&&!c.sufficient);
    let found=Boolean(feasible(preview));
    // Search the 14-day horizon; a busy first day must not poison every longer proposal.
    for(let offset=0;offset<14&&!found;offset++)for(let days=1;days<=14-offset;days++){
      if(offset===0&&days===1)continue;
      const candidate={...input,scheduledDate:new Date(Date.parse(body.scheduledDate)+86400000*offset).toISOString().slice(0,10),scheduledEndDate:new Date(Date.parse(body.scheduledDate)+86400000*(offset+days-1)).toISOString().slice(0,10)};
      const next=manualPlanPreview(candidate);
      if(feasible(next)){Object.assign(input,candidate);preview=next;found=true;break;}
    }
    if(input.scheduledDate!==body.scheduledDate)result.explanation+=` Brigada bandligi sabab boshlanish ${input.scheduledDate} ga taklif qilindi.`;
    if(!found)result.explanation+=" 14 kun ichida yetarli bo‘sh brigada topilmadi. Tarkib yoki muddatni o‘zgartiring.";
    result.input=input;result.preview=preview;
    if(work.normRange)result.explanation+=` Me’yor oralig‘ining yuqori qiymati (${work.normRange[1]}) muddat taklifi uchun olindi; boshliq o‘zgartirishi mumkin.`;
    if(resourcePlanIssue(work,input.resourcePlan,planningOptions.workVariants))result.explanation+=" Bu me’yorda resurs tarkibi to‘liq emas; material va texnikani alohida aniqlashtiring.";
    return result as T;
  }
  if (path === "/manual-inspections/options" && method === "GET") return manualInspectionOptions as T;
  if (path.startsWith("/manual-inspections?") && method === "GET") {
    const requestedState = new URLSearchParams(path.split("?")[1]).get("state") as ManualInspectionState | null;
    return page(manualInspections.filter((item) => item.state === requestedState)) as T;
  }
  if (path === "/manual-inspections" && method === "POST") {
    const body = options.body as ManualInspectionInput;
    const road = roads.find((item) => item.id === body.roadId);
    if(!road||!demoValidDate(body.observedDate)||body.observedDate>tashkentFixtureDate()||!Number.isFinite(Number(body.chainageStartM))||Number(body.chainageStartM)<0||Number(body.chainageStartM)>=road.lengthM||!Number.isFinite(Number(body.exactQuantity))||Number(body.exactQuantity)<=0)throw new ApiError("Yo‘l, sana, joy yoki hajm yaroqsiz.",422,"INSPECTION_INPUT_INVALID");
    const topic = manualInspectionOptions.workTopics.find((item) => item.id === body.iqnTopicId);
    const defectType = manualInspectionOptions.defectTypes?.find((item) => item.id === body.defectTypeId);
    if ((!topic && !defectType) || (!topic && !body.observedIssue?.trim())) {
      throw new ApiError("Nuqson turi va aniqlangan holatni kiriting.", 422, "DEFECT_TYPE_REQUIRED");
    }
    if (defectType?.unit && normalizeUnit(defectType.unit) !== normalizeUnit(body.unit)) throw new ApiError("Nuqson birligi mos emas.", 422, "DEFECT_UNIT_MISMATCH");
    const sequence = manualInspections.length + 89;
    const inspection: ManualInspection = {
      id: `inspection-e2e-${sequence}`,
      inspectionNumber: `KORIK-2026-${String(sequence).padStart(4, "0")}`,
      road: { code: road.code, name: road.name },
      division: { id: "e2e-division", name: road.divisionName },
      observedDate: body.observedDate,
      inspectorName: fixtureUser.fullName,
      state: "DRAFT",
      observations: [{
        id: `observation-e2e-${sequence}`,
        locationLabel: formatFixtureChainage(body.chainageStartM),
        observedIssue: body.observedIssue?.trim() || topic?.name || defectType!.name,
        exactQuantity: { value: body.exactQuantity, unit: body.unit },
        evidence: (body.evidence ?? []).map((item, index) => ({
          index,
          contentType: item.contentType as "image/jpeg" | "image/png" | "video/mp4",
          capturedAt: item.capturedAt,
          sha256: item.sha256,
          url: "/e2e-road-evidence.svg",
        })),
      }],
      note: body.note,
    };
    manualCaptureInputs.set(inspection.id, body);
    manualInspections = [inspection, ...manualInspections];
    return { id: inspection.id } as T;
  }
  const inspectionSubmitMatch = path.match(/^\/manual-inspections\/([^/]+)\/submit$/);
  if (inspectionSubmitMatch && method === "POST") {
    const current = manualInspections.find((item) => item.id === inspectionSubmitMatch[1]);
    if (!current) throw new ApiError("Ko‘rik topilmadi.", 404, "NOT_FOUND");
    if(current.state!=="DRAFT")throw new ApiError("Nuqson allaqachon yuborilgan.",409,"REVIEW_STATE_INVALID");
    const updated: ManualInspection = { ...current, state: "PENDING_REVIEW", submittedAt: new Date().toISOString() };
    manualInspections = manualInspections.map((item) => item.id === updated.id ? updated : item);
    return updated as T;
  }
  const inspectionDecisionMatch = path.match(/^\/manual-inspections\/([^/]+)\/decision$/);
  if (inspectionDecisionMatch && method === "POST") {
    const body = options.body as { decision: "VERIFIED" | "REJECTED"; note: string };
    const current = manualInspections.find((item) => item.id === inspectionDecisionMatch[1]);
    if (!current) throw new ApiError("Ko‘rik topilmadi.", 404, "NOT_FOUND");
    if(fixtureUser.id!=="demo-chief")throw new ApiError("Nuqsonni yo‘l bo‘limi boshlig‘i tasdiqlaydi.",403,"CHIEF_REQUIRED");
    if(current.state!=="PENDING_REVIEW"||!["VERIFIED","REJECTED"].includes(body.decision))throw new ApiError("Nuqson ko‘rib chiqish holatida emas.",409,"REVIEW_STATE_INVALID");
    if(body.decision==='REJECTED'&&!body.note?.trim())throw new ApiError("Qaror sababini kiriting.",422,"REVIEW_NOTE_REQUIRED");
    const updated: ManualInspection = { ...current, state: body.decision, reviewerNote: body.note, reviewedAt: new Date().toISOString() };
    manualInspections = manualInspections.map((item) => item.id === updated.id ? updated : item);
    const capture = manualCaptureInputs.get(current.id);
    if (body.decision === "VERIFIED" && capture) {
      const observation = updated.observations[0]!;
      const id = `defect-${current.id}`;
      const type=inspectionTypes.find(t=>t.id===capture.defectTypeId);
      planningOptions.sourceDefects = [{
        id, sourceKind: "MANUAL_INSPECTION", sourceReference: updated.inspectionNumber,
        observationText:observation.observedIssue,reviewerNote:updated.reviewerNote,
        defectTypeId:capture.defectTypeId,parameters:capture.parameters,
        iqnTopic: { id: type?iqnTopicId(type.iqnTopicNumber):capture.iqnTopicId??null, name: observation.observedIssue },
        suggestedWorkVariantIds: type?.candidateWorkIds??[],
        location: { chainageStartM: capture.chainageStartM, chainageEndM: String(Number(capture.chainageStartM) + 1) },
        measuredQuantity: observation.exactQuantity,
      }, ...planningOptions.sourceDefects.filter((item) => item.id !== id)];
    }
    return updated as T;
  }
  if (path.startsWith("/planning/candidates?")) return page(demoCandidates()) as T;
  if (path.startsWith("/planning/options?")) {
    const params=new URLSearchParams(path.split('?')[1]),date=params.get('scheduledDate')??tashkentFixtureDate(),road=demoRoads().find(r=>r.id===params.get('roadId'))??roads[0]!;
    const sources=[...planningOptions.sourceDefects.map(s=>demoPlanSource(s.id,date)!),...demoAnnualCandidates(date.slice(0,7)).map(a=>demoPlanSource(a.id)!)].filter(s=>s.roadId===road.id&&(annualSource(s.id)||!demoSourceBusy(s.id))&&demoSourceRemaining(s.id)>1e-6).map(s=>({...s,measuredQuantity:{...s.measuredQuantity,value:String(demoSourceRemaining(s.id))}}));
    return {...planningOptions,road,annualBudgetLines:activeProgram(Number(date.slice(0,4)))?.lines.filter(l=>l.roadId===road.id).map(l=>({id:l.id,workId:l.workId,name:l.assetName+' · '+l.workName,resourcePlan:l.resourcePlan,selectedNormHours:l.selectedNormHours})),sourceDefects:sources,workers:planningOptions.workers.map(w=>({...w,availableMinutes:demoWorkerAvailable(w.id,date)}))} as T;
  }
  if (path === "/planning/preview" && method === "POST") {
    if(fixtureUser.id!=="demo-chief")throw new ApiError("Ishni yo‘l bo‘limi boshlig‘i yaratadi.",403,"ROLE_FORBIDDEN");
    const body = options.body as {candidateIds:string[];dateFrom:string;dateTo:string};
    const dates = demoDates(body.dateFrom, body.dateTo), ids = [...new Set(body.candidateIds)];
    if (!ids.length || dates.length < ids.length) throw new ApiError("Har bir tanlangan ish uchun kamida bir kun ajrating.",422,"AUTO_DATES_INSUFFICIENT");
    const inputs = ids.map((id,index) => {
      const source = demoPlanSource(id,dates[Math.floor(index*dates.length/ids.length)]);
      const workId = source?.suggestedWorkVariantIds?.[0];
      if (!source || !workId) throw new ApiError("Bu nuqsonga tasdiqlangan ish mosligi topilmadi. Qo‘lda ish turini tanlang.",422,"WORK_MAPPING_REQUIRED");
      return {sourceDefectId:source.id,annualLineId:source.annualLineId,resourcePlan:source.resourcePlan,selectedNormHours:source.selectedNormHours,roadId:source.roadId??roads[0]!.id,workVariantId:workId,exactQuantity:String(demoSourceRemaining(source.id)),chainageStartM:source.location.chainageStartM,scheduledDate:dates[Math.floor(index*dates.length/ids.length)]!,scheduledEndDate:dates[Math.floor((index+1)*dates.length/ids.length)-1]!,roadAccess:"OPEN" as const};
    });
    const parts = inputs.map(manualPlanPreview), first = parts[0]!;
    const preview: PlanPreview = {...first,draftId:demoId("auto"),dateFrom:body.dateFrom,dateTo:body.dateTo,planningMode:"AUTOMATIC",jobs:parts.flatMap((part)=>part.jobs),blockers:parts.flatMap((part)=>part.blockers),resourceChecks:parts.flatMap((part)=>part.resourceChecks),workerMinutesRemaining:parts.flatMap((part)=>part.workerMinutesRemaining),workersReady:parts.every((part)=>part.workersReady),resourcesReady:parts.every((part)=>part.resourcesReady),canApprove:false};
    demoPlanInputs.set(preview.draftId,inputs);
    demoPlanCrews.set(preview.draftId,Object.fromEntries(inputs.map((input,i)=>[input.sourceDefectId!,parts[i]!.workerMinutesRemaining.map(w=>w.workerId)])));
    demoValidateTotalMaterials(preview, inputs);
    fixturePlans.unshift(preview);
    return preview as T;
  }

  if (path === "/planning/manual/preview" && method === "POST") {
    if(fixtureUser.id!=="demo-chief")throw new ApiError("Ishni yo‘l bo‘limi boshlig‘i yaratadi.",403,"ROLE_FORBIDDEN");
    const input = options.body as ManualPlanInput;
    const preview = manualPlanPreview(input);
    const previous=demoPlanInputs.get(preview.draftId)?.[0];
    const signature=(value:ManualPlanInput)=>JSON.stringify([value.sourceDefectId,value.workVariantId,Number(value.exactQuantity),value.scheduledDate,value.scheduledEndDate??value.scheduledDate,value.startTime??"08:00",value.endTime??"15:00",value.roadAccess??"OPEN",demoMaterialDemands(value.workVariantId,Number(value.exactQuantity),value).map(r=>[r.id,r.quantity]).sort(),demoMachines(value.workVariantId,[],value).map(r=>[r.code,r.minutesPerUnit]).sort()]);
    if(previous&&signature(previous)!==signature(input))for(const request of fixtureRequisitions){
      if(request.planId===preview.draftId&&["SUBMITTED","APPROVED"].includes(request.status)){request.status="CANCELLED";request.decisionNote="Reja tahrirlandi. Yangilangan hisob bo‘yicha talabnoma tuzing.";}
    }
    preview.requisitions=fixtureRequisitions.filter(r=>r.planId===preview.draftId);
    demoPlanInputs.set(preview.draftId, [structuredClone(input)]);
    demoPlanCrews.set(preview.draftId,{[input.sourceDefectId!]:preview.workerMinutesRemaining.map(w=>w.workerId)});
    fixturePlans = [preview, ...fixturePlans.filter((plan) => plan.draftId !== preview.draftId)];
    return preview as T;
  }
  if (path.startsWith("/planning/plans?") && method === "GET") {
    return page(fixturePlans.map(planningSummary)) as T;
  }
  const resourceRequestMatch = path.match(/^\/planning\/plans\/([^/]+)\/resources\/(request|recheck)$/);
  if (resourceRequestMatch && method === "POST") {
    const plan = fixturePlans.find((item) => item.draftId === resourceRequestMatch[1]);
    if (!plan) throw new ApiError("Reja topilmadi.", 404, "NOT_FOUND");
    if (plan.state === "PUBLISHED") return plan as T;
    demoRecheckPlan(plan);
    if (resourceRequestMatch[2] === "request" && !plan.workersReady) throw new ApiError("Avval yetarli xodim biriktiring.", 409, "STAFFING_INCOMPLETE");
    if (resourceRequestMatch[2] === "request") {
      const shortages = demoShortages(plan);
      if (shortages.length && !fixtureRequisitions.some((item) => item.planId === plan.draftId && !["REJECTED","CANCELLED","FULFILLED"].includes(item.status))) fixtureRequisitions.push({id:demoId("req"),planId:plan.draftId,divisionId:"e2e-division",status:"SUBMITTED",recipientRole:"CHIEF_ENGINEER",requestedByName:fixtureUser.fullName,requestedAt:new Date().toISOString(),decisionNote:null,decidedAt:null,shortages});
    }
    plan.requisitions = fixtureRequisitions.filter((item) => item.planId === plan.draftId);
    demoPermissions();
    return plan as T;
  }

  if (path.startsWith("/resource-requisitions") && !path.includes("/decision") && method === "GET") return page(fixtureRequisitions) as T;
  const requisitionDecision = path.match(/^\/resource-requisitions\/([^/]+)\/decision$/);
  if (requisitionDecision && method === "POST") {
    if(fixtureUser.id!=="demo-engineer")throw new ApiError("Talabnoma bo‘yicha bosh muhandis qaror beradi. Sinov rolini almashtiring.",403,"ENGINEER_REQUIRED");
    const requisition = fixtureRequisitions.find((item) => item.id === requisitionDecision[1]);
    if (!requisition) throw new ApiError("Talabnoma topilmadi.", 404, "NOT_FOUND");
    const body = options.body as { decision: "APPROVE" | "REJECT"; note: string };
    if (requisition.status !== "SUBMITTED" || !["APPROVE", "REJECT"].includes(body.decision)) throw new ApiError("Talabnoma qarori yaroqsiz.", 409, "REQUISITION_DECISION_INVALID");
    requisition.status = body.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    requisition.decisionNote = body.note;
    requisition.decidedAt = new Date().toISOString();
    return requisition as T;
  }
  const workerEquipmentMatch = path.match(/^\/workers\/([^/]+)\/equipment$/);
  if (workerEquipmentMatch) {
    const workerId = workerEquipmentMatch[1]!;
    const card = fixtureWorkerCard(workerId);
    if (method === "GET") return card as T;
    if (method === "POST") {
      const body = options.body as WorkerEquipmentIssue;
      if ("occupationCode" in body) throw new ApiError("Xodim kasbi uning profilidan olinadi.", 422, "OCCUPATION_OVERRIDE_PROHIBITED");
      const stock = equipmentStock.find((item) => item.materialId === body.materialId && item.stockLocationId === body.stockLocationId);
      const norm = equipmentNorms.find((item) => item.code === stock?.normCode);
      if (!stock || !norm || !card.occupationCode || !norm.eligibleOccupationCodes.includes(card.occupationCode)) throw new ApiError("Jihoz yoki kasb me’yorga mos emas.", 422, "EQUIPMENT_NORM_INVALID");
      if (!Number.isFinite(body.quantity) || body.quantity <= 0 || !['kg','m'].includes(stock.unit)&&!Number.isInteger(body.quantity) || body.quantity > stock.availableQuantity) throw new ApiError("Omborda yetarli jihoz yo‘q.", 422, "STOCK_INSUFFICIENT");
      if (!demoValidDate(body.issuedOn) || body.issuedOn > card.asOf) throw new ApiError("Berilgan sana yaroqsiz.", 422, "ISSUED_ON_INVALID");
      const id = `ppe-issue-${workerId}-${(workerEquipmentIssues.get(workerId)?.length ?? 0) + 1}`;
      const item: WorkerEquipmentCard["items"][number] = { id, materialId: stock.materialId, name: stock.name, unit:stock.unit,quantity: body.quantity, issuedOn: body.issuedOn, expiresOn: fixtureEquipmentExpiry(body.issuedOn, norm.serviceMonths), daysRemaining: 0, status: "ACTIVE", serviceMonths: norm.serviceMonths, sourceReference: norm.sourceReference, allocationScope: norm.allocationScope, occupationCode: card.occupationCode };
      workerEquipmentIssues.set(workerId, [...(workerEquipmentIssues.get(workerId) ?? []), item]);
      stock.availableQuantity -= body.quantity;
      return { id } as T;
    }
  }
  const planDetailMatch = path.match(/^\/planning\/plans\/([^/]+)$/);
  if (planDetailMatch && method === "GET") {
    const plan = fixturePlans.find((item) => item.draftId === planDetailMatch[1]);
    if (!plan) throw new ApiError("Reja topilmadi.", 404, "NOT_FOUND");
    return plan as T;
  }
  const approvePlanMatch = path.match(/^\/planning\/plans\/([^/]+)\/approve$/);
  if (approvePlanMatch && method === "POST") {
    const plan = fixturePlans.find((item) => item.draftId === approvePlanMatch[1]);
    if (!plan) throw new ApiError("Reja topilmadi.", 404, "NOT_FOUND");
    demoRecheckPlan(plan);
    if (!plan.canApprove) throw new ApiError("Topshiriqni yo‘l bo‘limi boshlig‘i tasdiqlaydi.", 409, "PLAN_APPROVAL_REJECTED");
    fixturePlans = fixturePlans.map((item) => item.draftId === plan.draftId
      ? { ...item, state: "APPROVED", approvedByName:fixtureUser.fullName, approvedAt:new Date().toISOString(), canApprove: false, canPublish: item.resourcesReady }
      : item);
    return { planId: plan.draftId, state: "APPROVED" } as T;
  }
  const publishPlanMatch = path.match(/^\/planning\/plans\/([^/]+)\/publish$/);
  if (publishPlanMatch && method === "POST") {
    const plan = fixturePlans.find((item) => item.draftId === publishPlanMatch[1]);
    if (plan?.state === "PUBLISHED") return {planId:plan.draftId,state:"PUBLISHED"} as T;
    if (!plan?.canPublish) throw new ApiError("Reja topshiriqqa tayyor emas.",409,"PLAN_PUBLISH_REJECTED");
    demoRecheckPlan(plan);
    if (!plan.resourcesReady) throw new ApiError("Bandlik yoki ombor qoldig‘i o‘zgargan. Resurslarni qayta tekshiring.",409,"RESOURCES_CHANGED");
    if(plan.state!=="APPROVED")throw new ApiError("Reja tarkibi o‘zgardi. Boshliq yangilangan tarkibni qayta tasdiqlasin.",409,"PLAN_REAPPROVAL_REQUIRED");
    demoPublish(plan);
    plan.state="PUBLISHED";plan.canApprove=false;plan.canPublish=false;
    return {planId:plan.draftId,state:"PUBLISHED"} as T;
  }

  const cancelMatch=path.match(/^\/work-orders\/([^/]+)\/cancel$/);
  if(cancelMatch&&method==='POST'){if(fixtureUser.id!=='demo-chief')throw new ApiError('Topshiriqni boshliq bekor qiladi.',403,'CHIEF_REQUIRED');const order=fixtureWorkOrders.find(o=>o.id===cancelMatch[1]);if(!order||order.state!=='ASSIGNED'||order.startedAt)throw new ApiError('Faqat boshlanmagan topshiriq bekor qilinadi.',409,'ORDER_STARTED');if(demoOrderMeta.has(order.id))for(const m of order.executionResources.materials)demoStock[m.id]=(demoStock[m.id]??0)+Number(m.plannedQuantity);order.state='CANCELLED';return order as T;}
  const workOrderRescheduleMatch = path.match(/^\/work-orders\/([^/]+)\/reschedule$/);
  if (workOrderRescheduleMatch && method === "POST") {
    const current = fixtureWorkOrders.find((item) => item.id === workOrderRescheduleMatch[1]);
    if (!current) throw new ApiError("Topshiriq topilmadi.", 404, "NOT_FOUND");
    if (current.state !== "ASSIGNED" || current.startedAt) {
      throw new ApiError("Faqat boshlanmagan topshiriq qayta sanalanadi.", 409, "WORK_ORDER_NOT_RESCHEDULABLE");
    }
    const body = options.body as { scheduledDate?: string };
    const scheduledDate = body.scheduledDate ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || scheduledDate < tashkentFixtureDate()) {
      throw new ApiError("Yangi sana bugundan oldin bo‘lishi mumkin emas.", 422, "WORK_ORDER_RESCHEDULE_DATE_INVALID");
    }
    if(current.annualRef)checkAnnualOrders([{...current,scheduledDate}],fixtureWorkOrders);
    if(!current.annualRef&&activeProgram(Number(scheduledDate.slice(0,4))))throw new ApiError('Eski topshiriq yillik rejaga bog‘lanmagan. Boshlanmagan topshiriqni bekor qilib, yillik reja bandidan yarating.',409,'ANNUAL_BINDING_REQUIRED');
    demoCheckReschedule(current, scheduledDate);
    const updated: WorkOrderDetail = {
      ...current,
      scheduledStartAt:current.scheduledStartAt ? `${scheduledDate}${current.scheduledStartAt.slice(10)}` : undefined,
      scheduledEndAt:current.scheduledEndAt ? `${scheduledDate}${current.scheduledEndAt.slice(10)}` : undefined,
      scheduledDate,
      executionResources: {
        workers: current.executionResources.workers.map((worker) => ({ ...worker, workDate: scheduledDate })),
        materials: current.executionResources.materials.map((material) => ({
          ...material,
          usedAt: `${scheduledDate}T09:00:00+05:00`,
        })),
        equipment: current.executionResources.equipment.map((unit) => ({ ...unit, usageDate: scheduledDate })),
      },
    };
    fixtureWorkOrders = fixtureWorkOrders.map((item) => item.id === updated.id ? updated : item);
    return updated as T;
  }
  const workOrderStartMatch = path.match(/^\/work-orders\/([^/]+)\/start$/);
  if (workOrderStartMatch && method === "POST") {
    const current = fixtureWorkOrders.find((item) => item.id === workOrderStartMatch[1]);
    if(current&&!current.annualRef&&activeProgram(Number(current.scheduledDate.slice(0,4))))throw new ApiError('Topshiriq tasdiqlangan yillik rejadan yaratilishi kerak.',409,'ANNUAL_BINDING_REQUIRED');
    if (!current) throw new ApiError("Topshiriq topilmadi.", 404, "NOT_FOUND");
    if (current.state !== "ASSIGNED") throw new ApiError("Faqat biriktirilgan topshiriqni boshlash mumkin.", 409, "WORK_ORDER_NOT_ASSIGNED");
    if (current.scheduledDate !== tashkentFixtureDate()) {
      throw new ApiError("Ishni boshlashdan oldin topshiriqni bugungi sanaga qayta sanalang.", 409, "WORK_ORDER_RESCHEDULE_REQUIRED");
    }
    const updated: WorkOrderDetail = {
      ...current,
      state: "IN_PROGRESS",
      startedAt: new Date().toISOString(),
      startedByName: fixtureUser.fullName,
    };
    fixtureWorkOrders = fixtureWorkOrders.map((item) => item.id === updated.id ? updated : item);
    return updated as T;
  }
  const workOrderCompleteMatch = path.match(/^\/work-orders\/([^/]+)\/complete$/);
  if (workOrderCompleteMatch && method === "POST") {
    const current = fixtureWorkOrders.find((item) => item.id === workOrderCompleteMatch[1]);
    if (!current) throw new ApiError("Topshiriq topilmadi.", 404, "NOT_FOUND");
    if (current.state !== "IN_PROGRESS") throw new ApiError("Faqat bajarilayotgan topshiriqni yakunlash mumkin.", 409, "WORK_ORDER_NOT_IN_PROGRESS");
    const body = options.body as WorkOrderExecutionInput;
    if (!body.completedQuantity || Number(body.completedQuantity) <= 0
      || !body.laborEntries?.length || body.laborEntries.some((item) => item.actualMinutes < 0)) {
      throw new ApiError("Haqiqiy hajm va ishchi daqiqalarini to‘liq kiriting.", 422, "INVALID_COMPLETION_ACTUALS");
    }
    demoValidateCompletion(current, body);
    if (body.evidence.some((url) => !/^https:\/\/[^\s]+$/i.test(url))) {
      throw new ApiError("Dalil manzili administrator tasdiqlagan HTTPS manzil bo‘lishi kerak.", 422, "INVALID_EVIDENCE_URL");
    }
    const updated: WorkOrderDetail = {
      ...current,
      state: "COMPLETED",
      completion: {
        id: `completion-${current.id}`,
        state: "PENDING_VERIFICATION",
        actualQuantity: { value: body.completedQuantity, unit: body.unit },
        workerMinutes: body.laborEntries.map((item) => ({ workerId: item.workerId, minutes: item.actualMinutes })),
        materials: body.materialUsages.flatMap((item) => {
          const material = current.executionResources.materials.find((resource) => resource.reservationId === item.materialReservationId);
          return material ? [{ materialId: material.id, quantity: item.quantity, unit: material.unit }] : [];
        }),
        equipment: body.equipmentUsages.flatMap((item) => {
          const unit = current.executionResources.equipment.find((resource) => resource.reservationId === item.equipmentReservationId);
          return unit ? [{ equipmentUnitId: unit.id, machineMinutes: item.actualMachineMinutes }] : [];
        }),
        evidence: body.evidence.map((url) => ({
          url,
          mediaType: url.toLowerCase().endsWith(".pdf") ? "application/pdf" as const : "image/png" as const,
        })),
        note: body.note,
        recordedAt: new Date().toISOString(),
        recordedByName: fixtureUser.fullName,
        canVerify: false,
      },
    };
    // Keep the reservation until review; returning a draft must not borrow stock
    // which another task may already have consumed.
    updated.materialReturnSettled = false;
    fixtureWorkOrders = fixtureWorkOrders.map((item) => item.id === updated.id ? updated : item);
    return updated as T;
  }
  const workOrderVerifyMatch = path.match(/^\/work-orders\/([^/]+)\/verify$/);
  if (workOrderVerifyMatch && method === "POST") {
    const current = fixtureWorkOrders.find((item) => item.id === workOrderVerifyMatch[1]);
    if (!current?.completion) throw new ApiError("Bajarilgan ish qaydi topilmadi.", 404, "COMPLETION_NOT_FOUND");
    if (current.completion.state !== "PENDING_VERIFICATION") {
      throw new ApiError("Bajarilgan ish allaqachon tekshirilgan.", 409, "COMPLETION_ALREADY_VERIFIED");
    }
    if (!current.completion.canVerify) {
      throw new ApiError("Bajarilgan ishni uni qayd etgan xodim tekshira olmaydi.", 409, "INDEPENDENT_VERIFIER_REQUIRED");
    }
    checkAnnualOrders([current],fixtureWorkOrders);
    const body = options.body as { note?: string };
    const updated: WorkOrderDetail = {
      ...current,
      state: "VERIFIED",
      completion: {
        ...current.completion,
        state: "VERIFIED",
        canVerify: false,
        verifiedAt: new Date().toISOString(),
        verifiedByName: fixtureUser.fullName,
        verificationNote: body.note,
      },
    };
    if (current.materialReturnSettled === false) demoReturnUnused(current, updated);
    updated.materialReturnSettled = true;
    fixtureWorkOrders = fixtureWorkOrders.map((item) => item.id === updated.id ? updated : item);
    return updated as T;
  }
  const returnMatch = path.match(/^\/work-orders\/([^/]+)\/return$/);
  if (returnMatch && method === 'POST') {
    if (fixtureUser.id !== 'demo-chief') throw new ApiError('Ish qaydini boshliq qaytaradi.', 403, 'CHIEF_REQUIRED');
    const current = fixtureWorkOrders.find(o => o.id === returnMatch[1]);
    if (!current?.completion || current.completion.state !== 'PENDING_VERIFICATION') throw new ApiError('Faqat tekshiruvdagi qayd qaytariladi.', 409, 'COMPLETION_NOT_PENDING');
    const reason = String((options.body as {note?: string}).note ?? '').trim();
    if (reason.length < 3) throw new ApiError('Qaytarish sababini kiriting.', 422, 'RETURN_REASON_REQUIRED');
    // Earlier demo versions released unused stock on completion. Re-reserve it
    // atomically before allowing a correction; never produce a negative balance.
    if (current.materialReturnSettled !== false && demoOrderMeta.has(current.id)) {
      for (const m of current.executionResources.materials) {
        const unused = Number(m.plannedQuantity) - Number(current.completion.materials.find(u => u.materialId === m.id)?.quantity ?? 0);
        if ((demoStock[m.id] ?? 0) + 1e-8 < unused) throw new ApiError('Qaytarilgan material boshqa ishga biriktirilgan. Avval omborni to‘ldiring.', 409, 'CORRECTION_STOCK_REQUIRED');
        demoStock[m.id] = Math.max(0, (demoStock[m.id] ?? 0) - unused);
      }
    }
    const updated: WorkOrderDetail = {...current, state: 'IN_PROGRESS', completion: null, materialReturnSettled: false,
      correctionHistory: [...(current.correctionHistory ?? []), {completion: structuredClone(current.completion), returnedAt: new Date().toISOString(), returnedBy: fixtureUser.fullName, reason}]};
    fixtureWorkOrders = fixtureWorkOrders.map(o => o.id === updated.id ? updated : o);
    return updated as T;
  }
  const workOrderDetailMatch = path.match(/^\/work-orders\/([^/]+)$/);
  if (workOrderDetailMatch && method === "GET") {
    const current = fixtureWorkOrders.find((item) => item.id === workOrderDetailMatch[1]);
    if (!current) throw new ApiError("Topshiriq topilmadi.", 404, "NOT_FOUND");
    return current as T;
  }
  if (path.startsWith("/work-orders?")) { const state = new URLSearchParams(path.split('?')[1]).get('state'); return page(fixtureWorkOrders.filter(o => !state || o.state === state)) as T; }
  if (path.startsWith("/monthly-completion-acts?") && method === "GET") {
    const month = new URLSearchParams(path.split("?")[1]).get("actMonth");
    return page(monthlyCompletionActs
      .filter((item) => !month || item.actMonth === month)
      .map(monthlyCompletionActSummary)) as T;
  }
  if (path === "/monthly-completion-acts" && method === "POST") {
    const body = options.body as { divisionId?: string; actMonth?: string };
    if (!body.divisionId || body.divisionId!==fixtureUser.division?.id || !body.actMonth || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(body.actMonth)) {
      throw new ApiError("Yo‘l bo‘limi va dalolatnoma oyini kiriting.", 422, "INVALID_ACT_MONTH");
    }
    const actMonth = body.actMonth;
    const existing = monthlyCompletionActs.find((item) => item.actMonth === actMonth && item.state === 'DRAFT');
    if(existing&&demoActAuthors.get(existing.id)!==fixtureUser.id)throw new ApiError('Qoralamani uni yaratgan mas’ul qayta hisoblaydi.',403,'ACT_AUTHOR_REQUIRED');
    const generated = buildMonthlyCompletionAct(actMonth, body.divisionId, existing);
    if (!demoActAuthors.has(generated.id)) demoActAuthors.set(generated.id,fixtureUser.id);
    monthlyCompletionActs = [generated, ...monthlyCompletionActs.filter((item) => item.id !== generated.id)];
    return generated as T;
  }
  const detailActMatch = path.match(/^\/monthly-completion-acts\/([^/]+)$/);
  if (detailActMatch && method === "GET") {
    const current = monthlyCompletionActs.find((item) => item.id === detailActMatch[1]);
    if (!current) throw new ApiError("Dalolatnoma topilmadi.", 404, "NOT_FOUND");
    return current as T;
  }
  const submitActMatch = path.match(/^\/monthly-completion-acts\/([^/]+)\/submit$/);
  if (submitActMatch && method === "POST") {
    const current = monthlyCompletionActs.find((item) => item.id === submitActMatch[1]);
    if (!current) throw new ApiError("Dalolatnoma topilmadi.", 404, "NOT_FOUND");
    if (current.state !== "DRAFT") throw new ApiError("Faqat qoralama dalolatnoma taqdim etiladi.", 409, "ACT_NOT_DRAFT");
    if (!current.canSubmit) throw new ApiError("Dalolatnomani taqdim etish vakolati mavjud emas.", 403, "ACT_SUBMIT_FORBIDDEN");
    if(demoActBases.get(current.id)!==demoActBasis(current.actMonth.slice(0,7)))throw new ApiError('Ishlar yoki oylik hisobi o‘zgargan. Dalolatnomani qayta shakllantiring.',409,'ACT_STALE');
    demoActSubmitters.set(current.id,fixtureUser.id);
    const updated: MonthlyCompletionAct = {
      ...current,
      state: "SUBMITTED",
      submittedByMe: true,
      canSubmit: false,
      canApprove: false,
      submittedAt: new Date().toISOString(),
    };
    monthlyCompletionActs = monthlyCompletionActs.map((item) => item.id === updated.id ? updated : item);
    return updated as T;
  }
  const approveActMatch = path.match(/^\/monthly-completion-acts\/([^/]+)\/approve$/);
  if (approveActMatch && method === "POST") {
    const current = monthlyCompletionActs.find((item) => item.id === approveActMatch[1]);
    if (!current) throw new ApiError("Dalolatnoma topilmadi.", 404, "NOT_FOUND");
    if (current.state !== "SUBMITTED") throw new ApiError("Faqat taqdim etilgan dalolatnoma tasdiqlanadi.", 409, "ACT_NOT_SUBMITTED");
    if (!current.canApprove) {
      throw new ApiError("Dalolatnomani uni yaratgan yoki taqdim etgan xodim tasdiqlay olmaydi.", 409, "INDEPENDENT_APPROVER_REQUIRED");
    }
    const updated: MonthlyCompletionAct = {
      ...current,
      state: "APPROVED",
      canSubmit: false,
      canApprove: false,
      approvedAt: new Date().toISOString(),
    };
    monthlyCompletionActs = monthlyCompletionActs.map((item) => item.id === updated.id ? updated : item);
    return updated as T;
  }
  if (path.startsWith("/cost-rates?") && method === "GET") return page(costRates) as T;
  if (path === "/cost-rates" && method === "POST") {
    const body = options.body as CostRateInput;
    const resourceKind = body.rateKind === "labor" ? "workers" : body.rateKind === "material" ? "materials" : "equipment";
    const target = resourceSets[resourceKind]?.find((item) => item.id === body.targetId);
    if (!target || body.divisionId!==fixtureUser.division?.id || !Number.isFinite(Number(body.rateAmountUzs)) || Number(body.rateAmountUzs)<=0 || Number(body.rateAmountUzs)>9e12
      || !demoValidDate(body.effectiveFrom) || !demoValidDate(body.effectiveUntil) || body.effectiveUntil<=body.effectiveFrom || !body.sourceReference?.trim()
      || [body.bonusRateBps,body.trafficAllowanceRateBps,body.travelAllowanceRateBps,body.socialContributionRateBps].some(v=>v!==undefined&&(!Number.isInteger(v)||v<0||v>100000))) {
      throw new ApiError("Resurs va musbat narxni kiriting.", 422, "INVALID_COST_RATE");
    }
    const expectedBasis=body.rateKind==='labor'?'monthly_salary':body.rateKind==='equipment'?'machine_hour':'material_unit';
    const expectedUnit=body.rateKind==='labor'?'month':body.rateKind==='equipment'?'machine_hour':target.unit;
    const normalizeUnit=(unit:string|null|undefined)=>(unit??'').replace('²','2').replace('³','3');
    if(body.rateBasis!==expectedBasis||normalizeUnit(body.pricingUnit)!==normalizeUnit(expectedUnit)||body.rateKind==='labor'&&!body.scheduleCode?.trim())throw new ApiError('Narx birligi resursning hisob birligiga mos emas.',422,'INVALID_COST_RATE');
    const created: CostRate = {
      ...body,
      id: `rate-${body.rateKind}-${Date.now()}`,
      target: { id: target.id, code: target.code, name: target.name },
      bonusRateBps: body.bonusRateBps ?? 0,
      trafficAllowanceRateBps: body.trafficAllowanceRateBps ?? 0,
      travelAllowanceRateBps: body.travelAllowanceRateBps ?? 0,
      socialContributionRateBps: body.socialContributionRateBps ?? 0,
      versionNo: costRates.filter((item) => item.rateKind === body.rateKind && item.target.id === body.targetId).length + 1,
      state: "DRAFT",
      createdByMe: true,
      canApprove: false,
      createdAt: new Date().toISOString(),
    };
    demoRateAuthors.set(created.id, fixtureUser.id);
    costRates = [created, ...costRates];
    return created as T;
  }
  const approveRateMatch = path.match(/^\/cost-rates\/([^/]+)\/approve$/);
  if (approveRateMatch && method === "POST") {
    const current = costRates.find((item) => item.id === approveRateMatch[1]);
    if (!current) throw new ApiError("Narx versiyasi topilmadi.", 404, "NOT_FOUND");
    if (current.state !== "DRAFT") throw new ApiError("Narx allaqachon tasdiqlangan.", 409, "RATE_ALREADY_APPROVED");
    if (!current.canApprove) {
      throw new ApiError("Narxni uni yaratgan xodim tasdiqlay olmaydi.", 409, "INDEPENDENT_APPROVER_REQUIRED");
    }
    const updated: CostRate = {
      ...current,
      state: "APPROVED",
      canApprove: false,
      approvedAt: new Date().toISOString(),
    };
    costRates = costRates.map((item) => item.id === updated.id ? updated : item);
    return updated as T;
  }
  if (path.startsWith("/monthly-work-time-norms?") && method === "GET") {
    const workMonth = new URLSearchParams(path.split("?")[1]).get("workMonth");
    return page(monthlyWorkTimeNorms.filter((item) => !workMonth || item.workMonth === workMonth)) as T;
  }
  if (path === "/monthly-work-time-norms" && method === "POST") {
    const body = options.body as MonthlyWorkTimeNormInput & { month?: string };
    const workMonth = body.workMonth ?? (body.month ? `${body.month}-01` : "");
    if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(workMonth) || body.divisionId!==fixtureUser.division?.id
      || !Number.isInteger(body.workingDays) || body.workingDays<=0 || body.workingDays>new Date(Number(workMonth.slice(0,4)),Number(workMonth.slice(5,7)),0).getDate()
      || !Number.isInteger(body.normMinutes) || body.normMinutes<=0 || body.normMinutes>body.workingDays*1440 || !body.scheduleCode?.trim() || !body.sourceReference?.trim()) {
      throw new ApiError("Oylik vaqt normasi maydonlarini to‘liq kiriting.", 422, "INVALID_MONTHLY_TIME_NORM");
    }
    const created: MonthlyWorkTimeNorm = {
      divisionId: body.divisionId,
      workMonth,
      scheduleCode: body.scheduleCode,
      workingDays: body.workingDays,
      normMinutes: body.normMinutes,
      sourceReference: body.sourceReference,
      id: `time-norm-${Date.now()}`,
      versionNo: Math.max(0,...monthlyWorkTimeNorms.filter(n=>n.workMonth===workMonth&&n.scheduleCode===body.scheduleCode).map(n=>n.versionNo))+1,
      state: "DRAFT",
      createdByMe: true,
      canApprove: false,
      createdAt: new Date().toISOString(),
    };
    demoRateAuthors.set(created.id, fixtureUser.id);
    monthlyWorkTimeNorms = [created, ...monthlyWorkTimeNorms];
    return created as T;
  }
  const approveTimeNormMatch = path.match(/^\/monthly-work-time-norms\/([^/]+)\/approve$/);
  if (approveTimeNormMatch && method === "POST") {
    const current = monthlyWorkTimeNorms.find((item) => item.id === approveTimeNormMatch[1]);
    if (!current) throw new ApiError("Vaqt normasi topilmadi.", 404, "NOT_FOUND");
    if (current.state !== "DRAFT") throw new ApiError("Vaqt normasi allaqachon tasdiqlangan.", 409, "TIME_NORM_ALREADY_APPROVED");
    if (!current.canApprove) {
      throw new ApiError("Vaqt normasini uni yaratgan xodim tasdiqlay olmaydi.", 409, "INDEPENDENT_APPROVER_REQUIRED");
    }
    const updated: MonthlyWorkTimeNorm = {
      ...current,
      state: "APPROVED",
      canApprove: false,
      approvedAt: new Date().toISOString(),
    };
    monthlyWorkTimeNorms = monthlyWorkTimeNorms.map((item) => item.id === updated.id ? updated : item);
    return updated as T;
  }
  if (path === '/annual-programs/generate' || /^\/annual-programs\/[^/]+\/approve$/.test(path))throw new ApiError('Yillik reja saqlash budjeti tasdiqlanganda avtomatik yaratiladi.',409,'BUDGET_APPROVAL_REQUIRED');
  if (path.startsWith("/payroll/worksheet?") && method === "GET") {
    const period=new URLSearchParams(path.split('?')[1]).get('period')??'';
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw new ApiError('Hisob oyi yaroqsiz.',422,'PAYROLL_INPUT_INVALID');
    const hasWork=fixtureWorkOrders.some(o=>o.completion?.state==='VERIFIED'&&o.scheduledDate.startsWith(period));
    const latest = fixturePayrollHistory.find(p => p.period === period);
    const adjustments = latest ? fixturePayrollSnapshots.get(latest.id)?.rows.flatMap(r => r.adjustments ? [r.adjustments] : []) ?? [] : [];
    const snapshot=hasWork?demoPayroll(period,adjustments):null;
    return {snapshot,workers:planningOptions.workers.map(w=>({id:w.id,fullName:w.fullName,positionName:w.positionName}))} as T;
  }
  if (path === "/payroll/preview" && method === "POST") {
    const body = options.body as { divisionId: string; period: string; policyReference: string; adjustments: PayrollAdjustment[] };
    if (!body.policyReference?.trim() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period) || body.divisionId !== "e2e-division") throw new ApiError("Hisob oyi, bo‘lim va asosni kiriting.", 422, "PAYROLL_INPUT_INVALID");
    const snapshot=demoPayroll(body.period,body.adjustments??[]);
    snapshot.policyReference=body.policyReference;
    const orders=fixtureWorkOrders.filter((o)=>o.completion?.state==='VERIFIED'&&o.scheduledDate.startsWith(body.period));
    const report=demoReport(body.period,snapshot,orders,orders.map(monthlyActItem));
    fixturePayrollSnapshots.set(snapshot.id,structuredClone(snapshot));
    fixturePayrollHistory.unshift({id:snapshot.id,period:body.period,createdAt:new Date().toISOString(),policyReference:body.policyReference,state:'PREVIEW'});
    demoExcelReports.set(snapshot.id,report);
    return snapshot as T;
  }
  if (path.startsWith("/payroll/history?") && method === "GET") {
    const period = new URLSearchParams(path.split("?")[1]).get("period");
    return page(fixturePayrollHistory.filter((item) => item.period === period)) as T;
  }
  const payrollDetail = path.match(/^\/payroll\/([^/]+)$/);
  if (payrollDetail && method === "GET") {
    const snapshot = fixturePayrollSnapshots.get(payrollDetail[1]!);
    if (!snapshot) throw new ApiError("Oylik hisobi topilmadi.", 404, "NOT_FOUND");
    return structuredClone(snapshot) as T;
  }
  if(path.startsWith('/annual-programs?')){const year=Number(new URLSearchParams(path.split('?')[1]).get('year')),view=annualView(year,fixtureWorkOrders);return page(view.lines.map(l=>({id:l.id,programId:view.program!.id,year,road:view.program!.snapshot.roads.find(r=>r.id===l.roadId)!,workName:l.workName,normReference:l.normReference,quantity:{planned:String(l.quantity),completed:String(l.completed),unit:l.unit},laborHours:{required:String(l.workerHours+l.operatorHours),completed:String((l.workerHours+l.operatorHours)*l.percent/100)},approvalState:'APPROVED'}))) as T;}

  if (path === "/integrations/readiness") return integrations as T;
  const syncMatch = path.match(/^\/integrations\/([^/]+)\/sync$/);
  if (syncMatch && method === "POST") {
    const code = syncMatch[1] as IntegrationReadiness["code"];
    const integration = integrations.find((item) => item.code === code);
    if (!integration || integration.state !== "READY") {
      throw new ApiError("Ulanish tayyor bo‘lmagani sababli sinxronlash boshlanmadi.", 422, "INTEGRATION_NOT_READY");
    }
    const updated = { ...integration, lastAttemptAt: new Date().toISOString(), message: "Sinxronlash navbatga qo‘yildi." };
    integrations = integrations.map((item) => (item.code === code ? updated : item));
    return updated as T;
  }
  const resourceMatch = path.match(/^\/resources\/(workers|equipment|warehouse|materials|timesheets)(?:\?.*)?$/);
  if (resourceMatch) return page(demoResources(resourceMatch[1] ?? "")) as T;
  if (path.startsWith("/timesheets/monthly?")) {
    const params = new URLSearchParams(path.split("?")[1]);
    const year = Number(params.get("year"));
    const month = Number(params.get("month"));
    return monthlyTimesheet(year, month) as T;
  }
  if (path.startsWith("/roads?")) return page(demoRoads()) as T;
  if (path.startsWith("/map/records?")) return demoMapData() as T;
  if (path === "/settings" && method === "GET") return { timezone: "Asia/Tashkent", planningHorizonDays: "14" } as T;
  if (path === "/settings" && method === "PATCH") return options.body as T;

  throw new ApiError(`E2E yo‘li topilmadi: ${path}`, 404, "FIXTURE_ROUTE_NOT_FOUND");
}

// Connected simulation. No data is sent to an external road or payroll system.
type DemoRole = "chief" | "engineer" | "foreman";
const demoActors: Record<DemoRole, {id:string;fullName:string;roleLabel:string}> = {
  chief:{id:"demo-chief",fullName:"Yo‘l bo‘limi boshlig‘i (demo)",roleLabel:"Yo‘l bo‘limi boshlig‘i"},
  engineer:{id:"demo-engineer",fullName:"Bosh muhandis (demo)",roleLabel:"Bosh muhandis"},
  foreman:{id:"demo-foreman",fullName:"Yo‘l ustasi (demo)",roleLabel:"Yo‘l ustasi"},
};
const demoPlanInputs = new Map<string,ManualPlanInput[]>();
const demoPlanCrews = new Map<string,Record<string,string[]>>();
const demoActBases = new Map<string,string>();
const demoOrderMeta = new Map<string,{sourceId:string;planId:string;normMinutes:number;roadAccess:string;chainage:number;safety:{signs:number;cones:number;barriers:number}}>();
const demoActAuthors = new Map<string,string>();
const demoActSubmitters = new Map<string,string>();
const demoRateAuthors = new Map<string,string>();
const demoStock: Record<string,number> = {"s-1":48.5,"s-2":112,signs:20,cones:60,barriers:6};
let demoSequence = 0;
function demoId(prefix:string) { return `${prefix}-${Date.now()}-${++demoSequence}`; }
function demoValidDate(value:string) {return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;}
function demoDates(from:string,to:string) {
  if (!demoValidDate(from) || !demoValidDate(to) || to < from) return [];
  const count = Math.round((Date.parse(to)-Date.parse(from))/86400000)+1;
  if (count > 366) return [];
  return Array.from({length:count},(_,i)=>new Date(Date.parse(from)+i*86400000).toISOString().slice(0,10));
}
function demoTime(value:string) {return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? Number(value.slice(0,2))*60+Number(value.slice(3)):NaN;}
function demoWorkerAvailable(id:string,date:string,except?:string) {
  const capacity=planningOptions.workers.find((w)=>w.id===id)?.availableMinutes ?? 0;
  const used=fixtureWorkOrders.filter((order)=>order.id!==except && order.scheduledDate===date && order.state!=="CANCELLED").reduce((sum,order)=>sum+(order.completion?.workerMinutes.find((w)=>w.workerId===id)?.minutes ?? order.executionResources.workers.find((w)=>w.id===id)?.plannedMinutes ?? 0),0);
  return Math.max(0,capacity-used);
}
function demoWorkerWindowAvailable(id:string,date:string,start:string,end:string,except?:string){
  const from=demoTime(start),to=demoTime(end);
  const overlapping=fixtureWorkOrders.some((order)=>order.id!==except&&order.scheduledDate===date&&order.state!=='CANCELLED'&&order.executionResources.workers.some((w)=>w.id===id)&&from<demoTime(order.scheduledEndAt?.slice(11,16)??'15:00')&&to>demoTime(order.scheduledStartAt?.slice(11,16)??'08:00'));
  return overlapping?0:Math.min(to-from,demoWorkerAvailable(id,date,except));
}
function demoOrderWindow(order:WorkOrderDetail){return Math.max(0,Math.min(420,demoTime(order.scheduledEndAt?.slice(11,16)??'15:00')-demoTime(order.scheduledStartAt?.slice(11,16)??'08:00')));}
function demoEquipmentAvailable(id:string,date:string,except?:string) {return !fixtureWorkOrders.some((order)=>order.id!==except && order.scheduledDate===date && order.state!=="CANCELLED" && order.executionResources.equipment.some((item)=>item.id===id));}
type DemoMaterialDemand={id:string;name:string;code:string;unit:string;quantity:number};
function demoMaterialDemands(workId:string,quantity:number,input?:ManualPlanInput):DemoMaterialDemand[] {
  const work=planningOptions.workVariants.find(w=>w.id===workId)!;
  const resources=plannedResources(work,input?.resourcePlan,planningOptions.workVariants);
  if(work.catalogSeries||resources.length)return resources.filter(r=>r.kind==='material'&&r.quantityPerUnit!==null&&r.quantityPerUnit>0).map(r=>({id:materialStockId(r.code,r.unit),name:r.name,code:r.code,unit:resourceUnit(r.unit),quantity:quantity*r.quantityPerUnit!}));
  const id=workId==="work-pothole"?"s-1":workId==="work-shoulder"?"s-2":null;
  if(!id)return [];
  const row=resourceSets.materials!.find(item=>item.id===id)!;
  return [{id,name:row.name,code:row.code!,unit:id==="s-1"?"t":"m3",quantity:quantity*(id==="s-1"?0.117:1.1)}];
}
function demoMachines(workId:string,dates:string[],input?:ManualPlanInput) {
  const work=planningOptions.workVariants.find(w=>w.id===workId)!;
  const resources=plannedResources(work,input?.resourcePlan,planningOptions.workVariants);
  const requirements=resources.filter(r=>r.kind==='machine'&&r.quantityPerUnit!==null&&r.quantityPerUnit>0).map(r=>({code:r.code,name:r.name,minutesPerUnit:r.quantityPerUnit!*60}))??[];
  if(!work.catalogSeries)requirements.push({code:'DEMO',name:'Texnika (demo)',minutesPerUnit:0});
  return requirements.map(r=>({...r,available:resourceSets.equipment!.find(e=>(r.code==='DEMO'||e.code===r.code)&&dates.every(date=>demoEquipmentAvailable(e.id,date)))}));
}
function demoDemands(inputs:ManualPlanInput[]) {
  const values=new Map<string,DemoMaterialDemand>();
  for(const input of inputs)for(const item of demoMaterialDemands(input.workVariantId,Number(input.exactQuantity),input)){const current=values.get(item.id);values.set(item.id,{...item,quantity:item.quantity+(current?.quantity??0)});}
  return [...values.values()];
}
function demoValidateTotalMaterials(plan:PlanPreview,inputs:ManualPlanInput[]) {
  for(const item of demoDemands(inputs)) if(item.quantity>(demoStock[item.id]??0)+1e-9 && !plan.blockers.some((b)=>b.code===`TOTAL_${item.id}`)) {
    plan.blockers.push({code:`TOTAL_${item.id}`,title:`${item.name} jami yetarli emas`,explanation:`Jami ${item.quantity.toFixed(3)} ${item.unit}; omborda ${demoStock[item.id]}.`,resolution:"Kamomad uchun talabnoma bering.",level:"BLOCKING"});
    plan.resourcesReady=false;
    for(const check of plan.resourceChecks) if(check.kind==="MATERIALS") check.sufficient=false;
  }
}
function demoPermissions() {
  for(const plan of fixturePlans){plan.canApprove=plan.state==="AWAITING_APPROVAL" && plan.resourcesReady && fixtureUser.id==="demo-chief";plan.canPublish=plan.state==="APPROVED" && plan.resourcesReady && fixtureUser.id==="demo-chief";}
  for(const order of fixtureWorkOrders) if(order.completion) order.completion.canVerify=order.completion.state==="PENDING_VERIFICATION" && order.completion.recordedByName!==fixtureUser.fullName && fixtureUser.id==="demo-chief";
  for(const act of monthlyCompletionActs){act.createdByMe=demoActAuthors.get(act.id)===fixtureUser.id;act.submittedByMe=demoActSubmitters.get(act.id)===fixtureUser.id;act.canSubmit=act.state==="DRAFT" && act.createdByMe && fixtureUser.id!=="demo-foreman";act.canApprove=act.state==="SUBMITTED" && !act.createdByMe && !act.submittedByMe && fixtureUser.id!=="demo-foreman";}
  for(const rate of [...costRates,...monthlyWorkTimeNorms]){rate.createdByMe=demoRateAuthors.get(rate.id)===fixtureUser.id;rate.canApprove=rate.state==="DRAFT" && !rate.createdByMe && fixtureUser.id!=="demo-foreman";}
}
function demoPlanSignature(plan:PlanPreview) {
  return JSON.stringify([plan.jobs.map(job=>[job.candidateId,job.workName,job.scheduledDate,job.startTime,job.endTime,job.exactQuantity,job.equipment,job.materials,job.requiredWorkers,job.assignedWorkers]),demoPlanCrews.get(plan.draftId),plan.workerMinutesRemaining.map(w=>[w.workerId,w.role,w.assignedMinutes])]);
}
function demoRecheckPlan(plan:PlanPreview) {
  const inputs=demoPlanInputs.get(plan.draftId);
  if (!inputs?.length || plan.state==="PUBLISHED") return;
  const originalState=plan.state;
  const before=demoPlanSignature(plan);
  const parts=inputs.map((input)=>manualPlanPreview({...input,replacesDraftId:undefined}));
  plan.jobs=parts.flatMap((part)=>part.jobs);plan.blockers=parts.flatMap((part)=>part.blockers);plan.resourceChecks=parts.flatMap((part)=>part.resourceChecks);plan.workerMinutesRemaining=parts.flatMap((part)=>part.workerMinutesRemaining);
  plan.workersReady=parts.every((part)=>part.workersReady);plan.resourcesReady=parts.every((part)=>part.resourcesReady);plan.state=originalState;
  demoValidateTotalMaterials(plan,inputs);
  demoPlanCrews.set(plan.draftId,Object.fromEntries(inputs.map((input,i)=>[input.sourceDefectId!,parts[i]!.workerMinutesRemaining.map(w=>w.workerId)])));
  // A changed crew or job must be reviewed again before publication.
  if(originalState==='APPROVED'&&before!==demoPlanSignature(plan)){plan.state='AWAITING_APPROVAL';delete plan.approvedByName;delete plan.approvedAt;}
  demoPermissions();
}
function demoShortages(plan:PlanPreview):ResourceRequisition["shortages"] {
  const inputs=demoPlanInputs.get(plan.draftId)??[];
  const rows:ResourceRequisition["shortages"]=demoDemands(inputs).filter((item)=>item.quantity>(demoStock[item.id]??0)+1e-9).map((item)=>({planItemId:plan.jobs[0]?.candidateId??plan.draftId,resourceKind:"MATERIAL",resourceId:item.id,resourceCode:item.code,resourceName:item.name,unit:item.unit,requiredQuantity:item.quantity.toFixed(6),reservedQuantity:(demoStock[item.id]??0).toFixed(6),missingQuantity:(Math.ceil((item.quantity-(demoStock[item.id]??0))*1e6)/1e6).toFixed(6)}));
  const missingMachines=new Map(inputs.flatMap(input=>demoMachines(input.workVariantId,demoDates(input.scheduledDate,input.scheduledEndDate??input.scheduledDate),input).filter(m=>!m.available).map(m=>[m.code,m] as const)));
  for(const machine of missingMachines.values())rows.push({planItemId:plan.draftId,resourceKind:"EQUIPMENT",resourceId:machine.code,resourceCode:machine.code,resourceName:machine.name,unit:"dona",requiredQuantity:"1",reservedQuantity:"0",missingQuantity:"1"});
  const scheme=plan.safetyScheme;
  for(const [key,required,name] of [["signs",scheme?.requiredSigns??0,"Vaqtinchalik belgilar"],["cones",scheme?.requiredCones??0,"Konuslar"],["barriers",scheme?.requiredBarriers??0,"To‘siqlar"]] as const)if(required>Math.min(...demoDates(plan.dateFrom,plan.dateTo).map((day)=>demoSafetyAvailable(key,day))))rows.push({planItemId:plan.draftId,resourceKind:"SAFETY_EQUIPMENT",resourceId:key,resourceCode:key,resourceName:name,unit:"dona",requiredQuantity:String(required),reservedQuantity:String(Math.min(...demoDates(plan.dateFrom,plan.dateTo).map((day)=>demoSafetyAvailable(key,day)))),missingQuantity:String(required-Math.min(...demoDates(plan.dateFrom,plan.dateTo).map((day)=>demoSafetyAvailable(key,day))))});
  return rows;
}
function demoPublish(plan:PlanPreview) {
  const inputs=demoPlanInputs.get(plan.draftId);
  if(!inputs?.length)throw new ApiError("Bu eski namunadan yangi reja tuzing.",409,"LEGACY_DEMO_PLAN");
  const generated:WorkOrderDetail[]=[];
  for(const job of plan.jobs){
    const input=inputs.find((item)=>item.sourceDefectId===job.candidateId)!;
    const work=planningOptions.workVariants.find((item)=>item.id===input.workVariantId)!;
    const quantity=Number(job.exactQuantity),date=job.scheduledDate!;
    const detail=manualPlanPreview({...input,workerIds:demoPlanCrews.get(plan.draftId)?.[input.sourceDefectId!],scheduledDate:date,scheduledEndDate:date,exactQuantity:String(quantity),replacesDraftId:undefined});
    if(!detail.resourcesReady)throw new ApiError("Rejadagi resurslar o‘zgargan. Qayta tekshiring.",409,"RESOURCES_CHANGED");
    const staff=detail.workerMinutesRemaining;
    const machines=demoMachines(work.id,[date],input);
    if(machines.some(m=>!m.available||generated.some(order=>order.scheduledDate===date&&order.executionResources.equipment.some(e=>e.id===m.available!.id))))throw new ApiError("Tanlangan kunda zarur texnika band.",409,"EQUIPMENT_BUSY");
    const materials=demoMaterialDemands(work.id,quantity,input),id=`order-${plan.draftId}-${generated.length+1}`;
    generated.push({id,annualRef:bindAnnualInput({...input,scheduledDate:date,scheduledEndDate:date,exactQuantity:String(quantity)},fixtureWorkOrders),number:`YT-${date.replaceAll("-","")}-${String(fixtureWorkOrders.length+generated.length+1).padStart(4,"0")}`,workName:work.name,road:demoRoads().find(r=>r.id===input.roadId)!,locationLabel:formatFixtureChainage(input.chainageStartM),scheduledDate:date,scheduledStartAt:`${date}T${job.startTime??"08:00"}:00+05:00`,scheduledEndAt:`${date}T${job.endTime??"15:00"}:00+05:00`,teamName:job.teamName??"Tanlangan brigada",state:"ASSIGNED",exactQuantity:{value:String(quantity),unit:work.unit},normReference:`${work.normReference} · demo hisob parametrlari`,completion:null,executionResources:{workers:staff.map((w)=>({id:w.workerId,fullName:w.fullName,positionName:planningOptions.workers.find((item)=>item.id===w.workerId)!.positionName,workDate:date,plannedMinutes:w.assignedMinutes,role:w.role})),materials:materials.map(material=>({id:material.id,reservationId:`reserve-${id}-${material.id}`,code:material.code,name:material.name,unit:material.unit,usedAt:`${date}T08:00:00+05:00`,plannedQuantity:material.quantity.toFixed(6)})),equipment:machines.map(m=>({id:m.available!.id,reservationId:`reserve-${id}-${m.available!.id}`,operatorWorkerIds:staff.filter(w=>w.role==='OPERATOR').map(w=>w.workerId),inventoryCode:m.available!.code??m.available!.id,name:m.available!.name,usageDate:date,plannedMachineMinutes:m.minutesPerUnit?Math.ceil(m.minutesPerUnit*quantity):Math.max(1,...staff.map(w=>w.assignedMinutes))}))}});
  }
  checkAnnualOrders(generated,fixtureWorkOrders);
  for(let i=0;i<generated.length;i++)for(let j=i+1;j<generated.length;j++){const a=generated[i]!,b=generated[j]!;if(a.scheduledDate===b.scheduledDate&&a.scheduledStartAt!<b.scheduledEndAt!&&b.scheduledStartAt!<a.scheduledEndAt!&&a.executionResources.workers.some((w)=>b.executionResources.workers.some((other)=>other.id===w.id)))throw new ApiError('Bir xodim bir vaqtda ikki ishga biriktirilmaydi.',409,'WORKER_TIME_OVERLAP');}
  const staffUse=new Map<string,number>();
  for(const order of generated)for(const worker of order.executionResources.workers){const key=`${worker.id}:${order.scheduledDate}`;staffUse.set(key,(staffUse.get(key)??0)+worker.plannedMinutes);if(staffUse.get(key)!>demoWorkerAvailable(worker.id,order.scheduledDate))throw new ApiError("Bir kunda xodimning bo‘sh vaqti yetmaydi.",409,"WORKER_TIME_INSUFFICIENT");}
  for(const day of new Set(generated.map((order)=>order.scheduledDate)))for(const [key,amount] of [["signs",plan.safetyScheme?.requiredSigns??0],["cones",plan.safetyScheme?.requiredCones??0],["barriers",plan.safetyScheme?.requiredBarriers??0]] as const)if(amount*generated.filter((order)=>order.scheduledDate===day).length>demoSafetyAvailable(key,day))throw new ApiError("Bu kunda xavfsizlik jihozlari band.",409,"SAFETY_EQUIPMENT_BUSY");
  for(const demand of demoDemands(inputs)){if((demoStock[demand.id]??0)+1e-8<demand.quantity)throw new ApiError("Ombor qoldig‘i yetmaydi.",409,"STOCK_INSUFFICIENT");}
  for(const demand of demoDemands(inputs))demoStock[demand.id]=Math.max(0,demoStock[demand.id]!-demand.quantity);
  for(const order of generated){const job=plan.jobs[generated.indexOf(order)]!,input=inputs.find((i)=>i.sourceDefectId===job.candidateId)!;demoOrderMeta.set(order.id,{sourceId:input.sourceDefectId!,planId:plan.draftId,normMinutes:workNormMinutes(planningOptions.workVariants.find((w)=>w.id===input.workVariantId)!,input),roadAccess:input.roadAccess??"OPEN",chainage:Number(input.chainageStartM),safety:{signs:plan.safetyScheme?.requiredSigns??0,cones:plan.safetyScheme?.requiredCones??0,barriers:plan.safetyScheme?.requiredBarriers??0}});}
  for(const order of generated){const meta=demoOrderMeta.get(order.id);order.sourceDefectId=meta?.sourceId;order.planId=plan.draftId;}
  fixtureWorkOrders.unshift(...generated);
  demoSyncDefects();
}
function demoValidateCompletion(order:WorkOrderDetail,body:WorkOrderExecutionInput){
  const qty=Number(body.completedQuantity);
  if(!Number.isFinite(qty)||qty<=0||qty>Number(order.exactQuantity.value)||body.unit!==order.exactQuantity.unit)throw new ApiError("Hajm reja doirasida va birligi bir xil bo‘lishi kerak.",422,"QUANTITY_INVALID");
  const ids=new Set(body.laborEntries.map((row)=>row.workerId));
  if(ids.size!==body.laborEntries.length||ids.size!==order.executionResources.workers.length||!body.laborEntries.some((row)=>row.actualMinutes>0))throw new ApiError("Har bir biriktirilgan xodim vaqti bir marta kiritilsin.",422,"LABOR_INVALID");
  for(const row of body.laborEntries){if(!order.executionResources.workers.some((w)=>w.id===row.workerId)||row.workDate!==order.scheduledDate||!Number.isInteger(row.actualMinutes)||row.actualMinutes<0||row.actualMinutes>Math.min(demoOrderWindow(order),demoWorkerAvailable(row.workerId,row.workDate,order.id)))throw new ApiError("Xodim, ish sanasi yoki haqiqiy vaqt noto‘g‘ri.",422,"LABOR_INVALID");}
  if(new Set(body.materialUsages.map((r)=>r.materialReservationId)).size!==body.materialUsages.length||new Set(body.equipmentUsages.map((r)=>r.equipmentReservationId)).size!==body.equipmentUsages.length)throw new ApiError("Resurs qaydi takrorlangan.",422,"RESOURCE_DUPLICATE");
  if(body.materialUsages.length!==order.executionResources.materials.length||body.equipmentUsages.length!==order.executionResources.equipment.length)throw new ApiError('Har bir resurs sarfini kiriting; ishlatilmagan bo‘lsa 0 yozing.',422,'RESOURCE_USAGE_REQUIRED');
  for(const row of body.materialUsages){if(!Number.isFinite(Date.parse(row.usedAt))||new Date(row.usedAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Tashkent'})!==order.scheduledDate)throw new ApiError('Material sarfi sanasi ish sanasiga mos emas.',422,'RESOURCE_DATE_INVALID');const resource=order.executionResources.materials.find((m)=>m.reservationId===row.materialReservationId);const q=Number(row.quantity);if(!resource||!Number.isFinite(q)||q<0||q>Number(resource.plannedQuantity)+1e-8)throw new ApiError("Material sarfi biriktirilgan miqdordan katta.",422,"MATERIAL_OVERUSE");}
  for(const row of body.equipmentUsages)if(!order.executionResources.equipment.some((e)=>e.reservationId===row.equipmentReservationId)||row.usageDate!==order.scheduledDate||!Number.isInteger(row.actualMachineMinutes)||row.actualMachineMinutes<0||row.actualMachineMinutes>demoOrderWindow(order))throw new ApiError("Texnikaning sanasi yoki vaqti yaroqsiz.",422,"EQUIPMENT_USAGE_INVALID");
  for(const row of body.equipmentUsages){
    const machine=order.executionResources.equipment.find(e=>e.reservationId===row.equipmentReservationId)!;
    if(row.actualMachineMinutes>0&&machine.operatorWorkerIds){
      const operatorMinutes=body.laborEntries.filter(w=>machine.operatorWorkerIds!.includes(w.workerId)&&order.executionResources.workers.some(r=>r.id===w.workerId&&r.role==='OPERATOR')).reduce((n,w)=>n+w.actualMinutes,0);
      if(operatorMinutes<row.actualMachineMinutes)throw new ApiError('Ishlagan texnika uchun operatorning haqiqiy vaqti yetarli emas.',422,'OPERATOR_TIME_REQUIRED');
    }
  }
}
function demoReturnUnused(before:WorkOrderDetail,after:WorkOrderDetail){if(!demoOrderMeta.has(before.id))return;for(const material of before.executionResources.materials){const used=after.completion!.materials.find((m)=>m.materialId===material.id);demoStock[material.id]=(demoStock[material.id]??0)+Number(material.plannedQuantity)-Number(used?.quantity??0);}}
function demoCheckReschedule(order:WorkOrderDetail,date:string){
  const safety=demoOrderMeta.get(order.id)?.safety;
  if(safety&&(['signs','cones','barriers'] as const).some(key=>safety[key]>demoSafetyAvailable(key,date,order.id)))throw new ApiError('Bu kunda belgi, konus yoki to‘siqlar yetmaydi.',409,'SAFETY_EQUIPMENT_BUSY');
  if(!demoValidDate(date))throw new ApiError("Sana yaroqsiz.",422,"DATE_INVALID");
  if(order.executionResources.workers.some((w)=>demoWorkerWindowAvailable(w.id,date,order.scheduledStartAt?.slice(11,16)??"08:00",order.scheduledEndAt?.slice(11,16)??"15:00",order.id)<w.plannedMinutes)||order.executionResources.equipment.some((e)=>!demoEquipmentAvailable(e.id,date,order.id)))throw new ApiError("Bu kunda xodim yoki texnika band.",409,"RESOURCES_BUSY");
}
function demoSyncDefects(){
  confirmedDefects.splice(0,confirmedDefects.length,...planningOptions.sourceDefects.map((source)=>{
    const orders=fixtureWorkOrders.filter((o)=>demoOrderMeta.get(o.id)?.sourceId===source.id&&o.state!=="CANCELLED");
    const complete=orders.length>0&&orders.every((o)=>o.completion?.state==="VERIFIED")&&orders.reduce((sum,o)=>sum+Number(o.completion?.actualQuantity.value??0),0)>=Number(source.measuredQuantity.value)-1e-6;
    return {id:source.id,sourceKind:source.sourceKind??"MANUAL_INSPECTION",sourceReference:source.sourceReference,road:(demoRoads().find(r=>r.id===source.roadId)??roads[0]!),division:fixtureUser.division!,observedAt:`${tashkentFixtureDate()}T00:00:00+05:00`,locationLabel:formatFixtureChainage(source.location.chainageStartM),chainageStartM:Number(source.location.chainageStartM),chainageEndM:Number(source.location.chainageEndM??source.location.chainageStartM),defectName:source.iqnTopic.name,exactQuantity:source.measuredQuantity,state:complete?"CLOSED" as const:demoSourceBusy(source.id)?"PLANNED" as const:"OPEN" as const};
  }));
}
function demoDefectCandidates():PlanningCandidate[]{demoSyncDefects();return planningOptions.sourceDefects.filter((s)=>confirmedDefects.some((d)=>d.id===s.id&&d.state==="OPEN")).map((s)=>({id:s.id,sourceReference:s.sourceReference,sourceKind:s.sourceKind??"MANUAL_INSPECTION",road:demoRoads().find(r=>r.id===(s.roadId??roads[0]!.id))!,locationLabel:formatFixtureChainage(s.location.chainageStartM),workName:planningOptions.workVariants.find((w)=>w.id===s.suggestedWorkVariantIds?.[0])?.name??s.iqnTopic.name,exactQuantity:{...s.measuredQuantity,value:String(demoSourceRemaining(s.id))},normReference:"IQN 02-24 · namuna mosligi",verificationState:"VERIFIED"}));}
function demoDashboard():DashboardSummary {demoSyncDefects();const today=tashkentFixtureDate();const open=fixtureWorkOrders.filter((o)=>!["VERIFIED","CANCELLED"].includes(o.state));return {...dashboard,asOf:new Date().toISOString(),counts:{...dashboard.counts,reviewQueue:fixtureFindings.filter((f)=>f.state==="PENDING_REVIEW").length+manualInspections.filter((i)=>i.state==="PENDING_REVIEW").length,confirmedDefects:confirmedDefects.filter((d)=>d.state==="OPEN").length,plannedToday:fixtureWorkOrders.filter((o)=>o.scheduledDate===today).length,openWorkOrders:open.length,overdueWorkOrders:open.filter((o)=>o.scheduledDate<today).length,workersOnShift:resourceSets.workers!.length,availableEquipment:resourceSets.equipment!.filter((e)=>demoEquipmentAvailable(e.id,today)).length},alerts:dashboard.alerts.filter((a)=>a.id!=="alert-2")};}
function demoResources(kind:string):ResourceRow[]{
 if(kind==="warehouse")return resourceSets.materials!.filter(row=>Object.hasOwn(demoStock,row.id)).map(row=>({...row,detail:`${(demoStock[row.id]??0).toFixed(3)} ${row.id==="s-1"?"t":row.id==="s-2"?"m3":row.detail} mavjud`,stateLabel:(demoStock[row.id]??0)>0?"Mavjud":"Tugagan"}));
 if(kind==="equipment")return resourceSets.equipment!.map(row=>({...row,stateLabel:demoEquipmentAvailable(row.id,tashkentFixtureDate())?"Bo‘sh":"Band"}));
 return resourceSets[kind]??[];
}
function demoClosures(){return fixtureWorkOrders.filter((order)=>demoOrderMeta.has(order.id)&&demoOrderMeta.get(order.id)!.roadAccess!=="OPEN").map((order)=>({id:order.id,number:order.number,location:order.locationLabel,date:order.scheduledDate,from:order.scheduledStartAt,to:order.scheduledEndAt,access:demoOrderMeta.get(order.id)!.roadAccess,state:order.state,externalSent:false}));}
function demoInitialize(){
  planningOptions.workVariants.push(...iqnWorkCatalog);
  for(const work of iqnWorkCatalog)for(const r of work.resources??[])if(r.kind==='material'&&!resourceSets.materials!.some(m=>m.id===materialStockId(r.code,r.unit)))resourceSets.materials!.push({id:materialStockId(r.code,r.unit),code:r.code,name:r.name,detail:resourceUnit(r.unit),stateLabel:"Omborda yo‘q"});
  resourceSets.workers=planningOptions.workers.map((worker)=>({id:worker.id,name:worker.fullName,divisionName:"1-son yo‘l bo‘limi",detail:worker.positionName,stateLabel:worker.availableMinutes>0?"Smenada":"Band"}));
  planningOptions.workVariants.push({id:"work-sign-wash",code:"IQN02-SIGN-DEMO",name:"Yo‘l belgilarini yuvish",iqnTopicId:"demo-sign-topic",iqnTopicName:"Yo‘l belgilarini saqlash",normReference:"IQN 02-24 · 12-12-1 · namuna",unit:"dona",requiredWorkers:2,laborMinutesPerUnit:0.354});
  const today=tashkentFixtureDate(),month=today.slice(0,7),year=Number(today.slice(0,4));
  for(const worker of resourceSets.workers)if(!costRates.some((rate)=>rate.rateKind==="labor"&&rate.target.id===worker.id))costRates.push({...structuredClone(costRates[0]!),id:`demo-rate-${worker.id}`,target:{id:worker.id,name:worker.name},sourceReference:"Namuna oylik stavkasi · haqiqiy hisob uchun emas"});
  for(const rate of costRates)if(rate.effectiveFrom<=today&&rate.effectiveUntil>today&&rate.state==="DRAFT"&&rate.rateKind==="material")rate.state="APPROVED";
  for(const rate of costRates){rate.sourceReference=`NAMUNA · ${rate.sourceReference}`;if(rate.state==="APPROVED"&&rate.effectiveUntil<=today&&!costRates.some((other)=>other!==rate&&other.target.id===rate.target.id&&other.effectiveFrom<=today&&other.effectiveUntil>today))rate.effectiveUntil=`${year+1}-01-01`;}
  if(!monthlyWorkTimeNorms.some((n)=>n.state==="APPROVED"&&n.workMonth===`${month}-01`&&n.scheduleCode==="ROAD_7H")){
    const days=demoDates(`${month}-01`,new Date(Date.UTC(year,Number(month.slice(5)),0)).toISOString().slice(0,10));const workingDays=days.filter((d)=>![0,6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())).length;
    monthlyWorkTimeNorms.push({id:`demo-norm-${month}`,divisionId:"e2e-division",workMonth:`${month}-01`,scheduleCode:"ROAD_7H",workingDays,normMinutes:workingDays*420,sourceReference:"NAMUNA · 5 kunlik/7 soatlik grafik; bayramlar hisobga olinmagan",versionNo:1,state:"APPROVED",createdByMe:false,canApprove:false,createdAt:new Date().toISOString()});
  }
  fixturePlans=[];
  monthlyCompletionActs=[];
  for(const act of monthlyCompletionActs)demoActAuthors.set(act.id,"demo-chief");
  demoSyncDefects();
}
demoInitialize();

async function executeFixtureRequest<T>(path:string,options:FixtureOptions):Promise<T>{
  demoPermissions();
  const method=options.method??"GET";
  if(path.startsWith('/cost-ledger?')&&method==='GET'){
    requireSession();const period=new URLSearchParams(path.split('?')[1]).get('period')??'';
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw new ApiError('Hisob oyini tanlang.',422,'PERIOD_INVALID');
    const orders=fixtureWorkOrders.filter(o=>o.scheduledDate.startsWith(period)),verified=orders.filter(o=>o.completion?.state==='VERIFIED');
    const latest=fixturePayrollHistory.find(p=>p.period===period),adjustments=latest?fixturePayrollSnapshots.get(latest.id)?.rows.flatMap(r=>r.adjustments?[r.adjustments]:[])??[]:[];
    const report=verified.length?demoReport(period,demoPayroll(period,adjustments),verified,verified.map(monthlyActItem)):null;
    const result=buildCostLedger(period,report,orders,monthlyCompletionActs);
    result.audit=demoAudit.filter(a=>a.period===period).map(({period:_,...a})=>a);
    return result as T;
  }
  if(path==='/budget-programs/approve'&&method==='POST'){requireSession();if(fixtureUser.id!=='demo-chief')throw new ApiError('Budjetni yo‘l bo‘limi boshlig‘i tasdiqlaydi.',403,'CHIEF_REQUIRED');const b=options.body as {snapshot:AssetSnapshot;policy:FundingPolicy;limit:number|null};if(fixtureWorkOrders.some(o=>!o.annualRef&&Number(o.scheduledDate.slice(0,4))===b.policy.year&&!['VERIFIED','CANCELLED'].includes(o.state)))throw new ApiError('Shu yildagi avvalgi topshiriqlarni yakunlang yoki boshlanmaganlarini bekor qiling. Keyingi ishlar yillik rejadan yaratiladi.',409,'LEGACY_ORDERS_OPEN');const result=approveBudget(b.snapshot,b.policy,b.limit,fixtureUser.fullName,fixtureWorkOrders);dashboard.activity.unshift({id:demoId('budget'),occurredAt:new Date().toISOString(),actor:fixtureUser.fullName,action:'Budjetni tasdiqladi',subject:`${b.policy.year}-yil · ${result.program.revision}-tahrir`});return result as T;}
  if(path.startsWith('/budget-programs?')){requireSession();return {...annualView(Number(new URLSearchParams(path.split('?')[1]).get('year')),fixtureWorkOrders),years:[...new Set(annualLedger.programs.map(p=>p.year))],revisions:annualLedger.programs.map(p=>({id:p.id,year:p.year,revision:p.revision,state:p.state,approvedAt:p.approvedAt,total:p.total}))} as T;}
  if(path==='/budget-programs/months'&&method==='POST'){requireSession();if(fixtureUser.id!=='demo-chief')throw new ApiError('Oylik hajmlarni boshliq belgilaydi.',403,'CHIEF_REQUIRED');const b=options.body as {year:number;lineId:string;monthly:number[]};return allocateMonths(b.year,b.lineId,b.monthly,fixtureWorkOrders) as T;}

  if(method!=='GET'&&fixtureUser.id==='demo-foreman'&&/^\/(payroll|cost-rates|monthly-work-time-norms|monthly-completion-acts|reports\/excel-data)(?:[/?]|$)/.test(path)){requireSession();throw new ApiError('Moliyaviy hisob uchun boshliq yoki bosh muhandis rolini tanlang.',403,'ROLE_FORBIDDEN');}
  if(method!=='GET'&&fixtureUser.id==='demo-foreman'&&/^\/(planning|annual-programs|resource-requisitions)/.test(path)){requireSession();throw new ApiError('Bu amal yo‘l bo‘limi rahbari vakolatiga kiradi.',403,'ROLE_FORBIDDEN');}
  if(method==='POST'&&/^\/work-orders\/[^/]+\/(start|complete)$/.test(path)&&fixtureUser.id!=='demo-foreman'){requireSession();throw new ApiError('Ishni yo‘l ustasi bajaradi.',403,'FOREMAN_REQUIRED');}
  if(method==='POST'&&/^\/work-orders\/[^/]+\/(verify|reschedule)$/.test(path)&&fixtureUser.id!=='demo-chief'){requireSession();throw new ApiError('Bajarilgan ishni boshliq tekshiradi.',403,'CHIEF_REQUIRED');}
  if(path==="/demo/role"&&(options.method??"GET")==="POST"){
    requireSession();const role=(options.body as {role:DemoRole}).role;
    if(!demoActors[role])throw new ApiError("Sinov roli topilmadi.",422,"ROLE_INVALID");
    fixtureUser={...fixtureUser,...demoActors[role],permissions:role==="foreman"?["reports.read","defects.read","defects.capture","planning.read","execution.read","execution.manage","resources.read","costs.read"]:["system.all"],globalPermissions:role==="chief"?["system.all"]:[]};demoPermissions();return structuredClone(fixtureUser) as T;
  }
  if(path==='/reports/months'){requireSession();const values=new Map<string,number>();for(const order of fixtureWorkOrders)if(order.completion?.state==='VERIFIED')values.set(order.scheduledDate.slice(0,7),(values.get(order.scheduledDate.slice(0,7))??0)+1);return {items:[...values].sort((a,b)=>b[0].localeCompare(a[0])).map(([period,count])=>({period,count}))} as T;}
  if(path.startsWith('/reports/excel-data?')){
    requireSession();const params=new URLSearchParams(path.split('?')[1]);const id=params.get('id');
    if(id){const report=demoExcelReports.get(id);if(!report)throw new ApiError('Excel uchun hisobni qayta shakllantiring.',404,'REPORT_NOT_FOUND');const act=monthlyCompletionActs.find((item)=>item.id===id);return structuredClone({...report,state:act?.state??report.state}) as T;}
    const period=params.get('period')??'';if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw new ApiError('Hisobot oyi yaroqsiz.',422,'PERIOD_INVALID');const saved=fixturePayrollHistory.find((row)=>row.period===period);const adjustments=saved?fixturePayrollSnapshots.get(saved.id)?.rows.flatMap(row=>row.adjustments?[row.adjustments]:[])??[]:[];const payroll=demoPayroll(period,adjustments);const orders=fixtureWorkOrders.filter((o)=>o.completion?.state==='VERIFIED'&&o.scheduledDate.startsWith(period));return demoReport(period,payroll,orders,orders.map(monthlyActItem)) as T;
  }
  const inputMatch=path.match(/^\/planning\/plans\/([^/]+)\/input$/);
  if(inputMatch){requireSession();const input=demoPlanInputs.get(inputMatch[1]!);if(!input||input.length!==1)throw new ApiError('Bu rejani qo‘lda tahrirlab bo‘lmaydi.',422,'PLAN_INPUT_UNAVAILABLE');return structuredClone(input[0]) as T;}
  if(path==="/demo/closures"){requireSession();return demoClosures() as T;}
  const receipt=path.match(/^\/demo\/requisitions\/([^/]+)\/receive$/);
  if(receipt&&(options.method??"GET")==="POST"){
    requireSession();if(fixtureUser.id==="demo-foreman")throw new ApiError("Resurs qabul qilish uchun mas’ul roliga o‘ting.",403,"ROLE_FORBIDDEN");const req=fixtureRequisitions.find((r)=>r.id===receipt[1]);
    if(!req||req.status!=="APPROVED")throw new ApiError("Faqat tasdiqlangan talabnoma bo‘yicha qabul qilish mumkin.",409,"RECEIPT_INVALID");
    for(const item of req.shortages){if(item.resourceKind==="EQUIPMENT"){const id=demoId("e");resourceSets.equipment!.push({id,name:item.resourceName??"Talabnoma texnikasi",code:item.resourceCode==="DEMO"?id:item.resourceCode??id,detail:"Talabnoma bo‘yicha qabul qilindi",stateLabel:"Bo‘sh"});const rate=costRates.find((r)=>r.target.id==="e-1")!;costRates.push({...rate,id:`rate-${id}`,target:{id,name:"Qo‘shimcha texnika (demo)"}});}else demoStock[item.resourceId]=(demoStock[item.resourceId]??0)+Number(item.missingQuantity);}
    req.status="FULFILLED";req.decisionNote=`${req.decisionNote??""} · Omborga qabul qilindi (demo)`;
    return structuredClone(req) as T;
  }
  const result=await dispatchFixtureRequest<unknown>(path,options);
  demoPermissions();demoSyncDefects();
  if((options.method??"GET")!=="GET"&&!path.startsWith("/auth")){dashboard.activity.unshift({id:demoId("activity"),occurredAt:new Date().toISOString(),actor:fixtureUser.fullName,action:demoActionLabel(path),subject:"Demo jarayoni"});dashboard.activity=dashboard.activity.slice(0,30);}
  if(result&&typeof result==="object"&&"items" in result&&"pageSize" in result){const pageResult=result as Paged<unknown>;const params=new URLSearchParams(path.split("?")[1]);const pageNo=Math.max(1,Number(params.get("page")??1)),size=Math.min(100,Math.max(1,Number(params.get("pageSize")??25)));return structuredClone({...pageResult,items:pageResult.items.slice((pageNo-1)*size,pageNo*size),page:pageNo,pageSize:size,total:pageResult.items.length}) as T;}
  return result===undefined?undefined as T:structuredClone(result) as T;
}
function demoActionLabel(path:string){if(path.endsWith("/return"))return "Ish qaydini tuzatishga qaytardi";if(path.endsWith("/cancel"))return "Topshiriqni bekor qildi";if(path.endsWith("/verify"))return "Bajarilgan ishni tekshirdi";if(path.endsWith("/complete"))return "Ishni yakunladi";if(path.endsWith("/start"))return "Ishni boshladi";if(path.endsWith("/publish"))return "Topshiriq chiqardi";if(path.includes("/preview"))return "Hisob-kitob tuzdi";if(path.endsWith("/approve"))return "Tasdiqladi";if(path.includes("/equipment"))return "Jihoz biriktirdi";if(path.includes("/decision"))return "Qaror berdi";return "Yozuvni yangiladi";}

function demoSourceBusy(id:string){return fixtureWorkOrders.some((order)=>demoOrderMeta.get(order.id)?.sourceId===id&&!['CANCELLED','VERIFIED'].includes(order.state));}
function demoSourceRemaining(id:string){const annual=annualSource(id);if(annual)return Math.max(0,annual.line.monthly[annual.month-1]!-annualUsage(annual.line.id,annual.program.year,fixtureWorkOrders,annual.month).used);const source=demoPlanSource(id);const done=fixtureWorkOrders.filter(o=>demoOrderMeta.get(o.id)?.sourceId===id&&o.completion?.state==='VERIFIED').reduce((s,o)=>s+Number(o.completion!.actualQuantity.value),0);return Math.max(0,Number(source?.measuredQuantity.value??0)-done);}


function demoSafetyAvailable(key:"signs"|"cones"|"barriers",date:string,except?:string){return Math.max(0,(demoStock[key]??0)-fixtureWorkOrders.filter((order)=>order.id!==except&&order.scheduledDate===date&&!['VERIFIED','CANCELLED'].includes(order.state)).reduce((sum,order)=>sum+(demoOrderMeta.get(order.id)?.safety[key]??0),0));}
function demoRoads():RoadOption[]{return [...new Map([...roads,...annualLedger.programs.filter(p=>p.state==='APPROVED').flatMap(p=>p.snapshot.roads.filter(r=>p.policy.roadSelection.includes(r.id)).map(r=>({id:r.id,code:r.code,name:r.name,divisionName:fixtureUser.division?.name??"Yo‘l bo‘limi",lengthM:r.lengthKm*1000})))].map(r=>[r.id,r])).values()];}
function demoAnnualCandidates(period?:string):PlanningCandidate[]{
 return annualLedger.programs.filter(p=>p.state==='APPROVED').flatMap(p=>p.lines.flatMap(l=>l.monthly.flatMap((q,i)=>{const month=i+1,ym=`${p.year}-${String(month).padStart(2,'0')}`;if(q<=0||period&&period!==ym)return [];const road=p.snapshot.roads.find(r=>r.id===l.roadId)!;return [{id:annualSourceId(p.year,l.id,month),sourceReference:`${ym} · ${l.assetName}`,sourceKind:'ANNUAL_PROGRAM' as const,road:{code:road.code,name:road.name},locationLabel:`0 — ${road.lengthKm} km`,workName:l.workName,exactQuantity:{value:String(q),unit:l.unit},normReference:l.normReference,verificationState:'APPROVED' as const}];})));
}
function demoPlanSource(id:string,date=tashkentFixtureDate()):PlanningOptions['sourceDefects'][number]|undefined{
 const existing=planningOptions.sourceDefects.find(s=>s.id===id);if(existing)return {...existing,roadId:existing.roadId??activeProgram(Number(date.slice(0,4)))?.snapshot.roads.find(r=>r.code===roads[0]!.code)?.id??roads[0]!.id};
 const a=annualSource(id);if(!a)return;const road=a.program.snapshot.roads.find(r=>r.id===a.line.roadId)!;const work=planningOptions.workVariants.find(w=>w.id===a.line.workId)!;
 return {id,annualLineId:a.line.id,roadId:road.id,resourcePlan:a.line.resourcePlan,selectedNormHours:a.line.selectedNormHours,sourceReference:`Yillik reja · ${a.program.year}-${String(a.month).padStart(2,'0')} · ${a.line.assetName}`,iqnTopic:{id:work.iqnTopicId??null,name:a.line.workName},suggestedWorkVariantIds:[work.id],location:{chainageStartM:'0',chainageEndM:String(road.lengthKm*1000)},measuredQuantity:{value:String(a.line.monthly[a.month-1]),unit:a.line.unit}};
}
function demoCandidates():PlanningCandidate[]{return [...demoDefectCandidates(),...demoAnnualCandidates().filter(item=>demoSourceRemaining(item.id)>1e-6).map(item=>({...item,exactQuantity:{...item.exactQuantity!,value:String(demoSourceRemaining(item.id))}}))];}
function demoWorkerWage(workerId:string,period:string){
  const values={base:0,bonus:0,traffic:0,travel:0,social:0,rate:approvedRate('labor',workerId,`${period}-01`)};
  for(const order of fixtureWorkOrders){if(order.completion?.state!=='VERIFIED'||!order.scheduledDate.startsWith(period))continue;const minutes=order.completion.workerMinutes.find((item)=>item.workerId===workerId)?.minutes??0;if(!minutes)continue;
    const rate=approvedRate('labor',workerId,order.scheduledDate);const norm=monthlyWorkTimeNorms.find((item)=>item.state==='APPROVED'&&item.workMonth===`${period}-01`&&item.scheduleCode===rate.scheduleCode);if(!norm)throw new ApiError('Tasdiqlangan vaqt normasi topilmadi.',422,'APPROVED_TIME_NORM_REQUIRED');
    const base=Number(rate.rateAmountUzs)*minutes/norm.normMinutes,bonus=base*rate.bonusRateBps/10000,traffic=base*rate.trafficAllowanceRateBps/10000,travel=base*rate.travelAllowanceRateBps/10000;
    values.base+=base;values.bonus+=bonus;values.traffic+=traffic;values.travel+=travel;values.social+=(base+bonus+traffic+travel)*rate.socialContributionRateBps/10000;values.rate=rate;
  }
  return values;
}
function demoMapData():RoadMapData{
  demoSyncDefects();const position=(chainage:number)=>{const markers=mapData.road.chainageMarkers;const a=[...markers].reverse().find((p)=>p.chainageM<=chainage)??markers[0]!;const b=markers.find((p)=>p.chainageM>=chainage)??markers.at(-1)!;const ratio=a===b?0:(chainage-a.chainageM)/(b.chainageM-a.chainageM);return {latitude:a.latitude+(b.latitude-a.latitude)*ratio,longitude:a.longitude+(b.longitude-a.longitude)*ratio};};
  return {...mapData,layers:{...mapData.layers,defects:confirmedDefects.filter((d)=>d.state!=='CLOSED').map((d)=>({id:d.id,layer:'DEFECT',locationLabel:d.locationLabel,kindLabel:d.defectName,stateLabel:d.state==='OPEN'?'Ochiq':'Rejalashtirilgan',chainageStartM:d.chainageStartM,...position(d.chainageStartM??0)})),workZones:fixtureWorkOrders.filter((o)=>demoOrderMeta.has(o.id)&&!['COMPLETED','VERIFIED','CANCELLED'].includes(o.state)).map((o)=>{const meta=demoOrderMeta.get(o.id)!;return {id:o.id,layer:'WORK_ZONE',locationLabel:o.locationLabel,kindLabel:`${o.workName} · ${o.scheduledDate}`,stateLabel:meta.roadAccess==='CLOSED'?'To‘liq yopiladi':meta.roadAccess==='PARTIAL'?'Qisman yopiladi':'Yo‘l ochiq',chainageStartM:meta.chainage,...position(meta.chainage)};})}};
}

const money2 = (n:number) => Math.round((n + Number.EPSILON) * 100) / 100;
function demoPayroll(period:string, adjustments:PayrollAdjustment[], orders=fixtureWorkOrders.filter((o)=>o.completion?.state==='VERIFIED' && o.scheduledDate.startsWith(period)),allocateFullFixed=false):PayrollSnapshot {
  const deductionsKeys=['incomeTaxAmountUzs','unionFeeAmountUzs','advanceAmountUzs','otherDeductionAmountUzs'];
  const fixedNames = Object.values(fixedPayrollFields);
  if(new Set(adjustments.map((a)=>a.workerId)).size!==adjustments.length)throw new ApiError('Xodim takrorlangan.',422,'PAYROLL_DUPLICATE');
  const rows:PayrollSnapshot['rows']=[];
  for(const worker of planningOptions.workers){
    const worked=orders.flatMap((o)=>{const minutes=o.completion?.workerMinutes.find((w)=>w.workerId===worker.id)?.minutes??0;return minutes>0?[{order:o,minutes}]:[];});
    if(!worked.length)continue;
    const adjustment=adjustments.find((a)=>a.workerId===worker.id);
    const numeric=(key:string,fallback=0)=>{const value=Number(adjustment?.[key]??fallback);if(!Number.isFinite(value)||value<0||(key.endsWith('Bps')&&(!Number.isInteger(value)||value>100000)))throw new ApiError('Summa yoki foiz yaroqsiz.',422,'PAYROLL_AMOUNT_INVALID');return value;};
    const totalMinutes=worked.reduce((sum,w)=>sum+w.minutes,0);
    const monthMinutes=fixtureWorkOrders.filter((o)=>o.completion?.state==='VERIFIED'&&o.scheduledDate.startsWith(period)).reduce((sum,o)=>sum+(o.completion!.workerMinutes.find((w)=>w.workerId===worker.id)?.minutes??0),0);
    const posted = monthlyCompletionActs.filter(a => a.actMonth === `${period}-01` && a.state !== 'DRAFT')
      .flatMap(a => demoExcelReports.get(a.id)?.payroll.rows ?? []).filter(r => r.workerId === worker.id)
      .flatMap(r => r.segments ?? []).filter(s => orders.some(o => o.id === s.workOrderId));
    let segments:WageSegment[]=worked.map(({order,minutes})=>{
      const frozen = posted.find(s => s.workOrderId === order.id);
      if (frozen) return structuredClone(frozen);
      const rate=approvedRate('labor',worker.id,order.scheduledDate);
      const norm=monthlyWorkTimeNorms.filter((n)=>n.state==='APPROVED'&&n.workMonth===`${period}-01`&&n.scheduleCode===rate.scheduleCode).sort((a,b)=>b.versionNo-a.versionNo)[0];
      if(!norm?.normMinutes)throw new ApiError('Shu oy uchun tasdiqlangan ish vaqti normasi kerak.',422,'APPROVED_TIME_NORM_REQUIRED');
      const bonusBps=numeric('bonusRateBps',rate.bonusRateBps),trafficBps=numeric('trafficAllowanceRateBps',rate.trafficAllowanceRateBps),travelBps=numeric('travelAllowanceRateBps',rate.travelAllowanceRateBps),socialBps=numeric('socialContributionRateBps',rate.socialContributionRateBps);
      const salary=Number(rate.rateAmountUzs),base=money2(salary*minutes/norm.normMinutes),trafficBase=numeric('trafficMonthlyBaseUzs',salary),travelBase=numeric('travelMonthlyBaseUzs',salary);
      return {rateId:rate.id,rateVersion:rate.versionNo,rateSource:rate.sourceReference,normId:norm.id,workOrderId:order.id,workDate:order.scheduledDate,minutes,normMinutes:norm.normMinutes,monthlySalary:salary,salaryCoefficient:1,seniorityBps:numeric('seniorityRateBps'),additionalBps:numeric('additionalRateBps'),bonusBps,trafficBps,travelBps,socialBps,trafficBase,travelBase,base,bonus:money2(base*bonusBps/10000),traffic:money2(trafficBase*minutes/norm.normMinutes*trafficBps/10000),travel:money2(travelBase*minutes/norm.normMinutes*travelBps/10000),seniority:money2(base*numeric('seniorityRateBps')/10000),additional:money2(base*numeric('additionalRateBps')/10000),holiday:0,oneTime:0,termination:0,sickLeave:0,leave:0,materialAid:0,meal:0,gross:0,social:0};
    });
    try { segments=calculatePayrollSegments(segments,adjustment??{workerId:worker.id},allocateFullFixed?1:totalMinutes/Math.max(1,monthMinutes)); }
    catch(error) { throw new ApiError(error instanceof Error?error.message:'Hisob yaroqsiz.',422,'PAYROLL_AMOUNT_INVALID'); }
    if (posted.length) {
      const variableFields = ['base','bonus','traffic','travel','seniority','additional','socialBps','salaryCoefficient'] as const;
      for (const frozen of posted) {
        const recalculated = segments.find(s => s.workOrderId === frozen.workOrderId)!;
        if (variableFields.some(key => Math.abs(Number(recalculated[key]) - Number(frozen[key])) > 0.000001))
          throw new ApiError('Bu ish dalolatnomaga kiritilgan. Uning koeffitsiyenti va ustamalarini o‘zgartirib bo‘lmaydi.',409,'POSTED_PAYROLL_CONFLICT');
      }
      const pending = segments.filter(s => !posted.some(p => p.workOrderId === s.workOrderId));
      const pendingMinutes = pending.reduce((n,s) => n+s.minutes,0);
      for (const [key,field] of Object.entries(fixedPayrollFields)) {
        const postedCents = Math.round(posted.reduce((n,s) => n+s[field],0)*100);
        const remaining = Math.round(numeric(key)*100)-postedCents;
        if (remaining < 0 || (!pending.length && remaining > 0))
          throw new ApiError('Dalolatnomadagi oylik to‘lov o‘zgarmaydi. Qo‘shimcha to‘lov uchun yangi ish yoki tuzatish hujjati kerak.',409,'POSTED_PAYMENT_CONFLICT');
        let allocated=0;
        pending.forEach((s,i) => {const cents=i===pending.length-1?remaining-allocated:Math.floor(remaining*s.minutes/pendingMinutes);allocated+=cents;s[field]=cents/100;});
      }
      for (const s of pending) {s.gross=money2(s.base+s.bonus+s.traffic+s.travel+s.seniority+s.additional+fixedNames.reduce((n,key)=>n+s[key],0));s.social=money2(s.gross*s.socialBps/10000);}
      segments=segments.map(s => structuredClone(posted.find(p => p.workOrderId===s.workOrderId)??s));
    }
    const sum=(key:keyof WageSegment)=>money2(segments.reduce((total,segment)=>total+Number(segment[key]),0));
    const gross=sum('gross'),social=sum('social'),deductions=money2(deductionsKeys.reduce((total,key)=>total+numeric(key),0));
    if(deductions>gross)throw new ApiError('Ushlanmalar hisoblangan summadan katta.',422,'DEDUCTIONS_EXCEED_GROSS');
    const confirmed=adjustment?.deductionsConfirmed===true&&deductionsKeys.every((key)=>adjustment[key]!==undefined&&adjustment[key]!=='');
    rows.push({workerId:worker.id,fullName:worker.fullName,positionName:worker.positionName,adjustments:adjustment,segments,actualMinutes:totalMinutes,actualDays:new Set(worked.map((w)=>w.order.scheduledDate)).size,baseWageAmountUzs:sum('base').toFixed(2),bonusAmountUzs:sum('bonus').toFixed(2),trafficAmountUzs:sum('traffic').toFixed(2),travelAmountUzs:sum('travel').toFixed(2),extraAmountUzs:money2(sum('seniority')+sum('additional')+fixedNames.reduce((total,key)=>total+sum(key),0)).toFixed(2),grossAmountUzs:gross.toFixed(2),employerSocialAmountUzs:social.toFixed(2),employerCostAmountUzs:money2(gross+social).toFixed(2),deductionsAmountUzs:deductions.toFixed(2),payableAmountUzs:confirmed?money2(gross-deductions).toFixed(2):null,state:confirmed?'READY':'DEDUCTIONS_REQUIRED'});
  }
  if(!rows.length)throw new ApiError('Bu oyda tasdiqlangan ish vaqti yo‘q. Avval bajarilgan ishni tasdiqlang.',422,'NO_VERIFIED_COMPLETIONS');
  for(const adjustment of adjustments)if(!rows.some((r)=>r.workerId===adjustment.workerId))throw new ApiError('Ish vaqti yo‘q xodim uchun tuzatish kiritilgan.',422,'PAYROLL_WORKER_INVALID');
  const total=(key:'grossAmountUzs'|'employerCostAmountUzs'|'payableAmountUzs')=>money2(rows.reduce((sum,row)=>sum+Number(row[key]??0),0)).toFixed(2);
  return {id:demoId('payroll'),state:'PREVIEW',paymentInitiated:false,period,policyReference:'Tasdiqlangan tabel va stavkalar',rows,totals:{grossAmountUzs:total('grossAmountUzs'),employerCostAmountUzs:total('employerCostAmountUzs'),payableAmountUzs:rows.every((r)=>r.payableAmountUzs!==null)?total('payableAmountUzs'):null}};
}
function demoReport(period:string,payroll:PayrollSnapshot,orders:WorkOrderDetail[],items:MonthlyCompletionAct['items'],state='Qoralama',reference=payroll.policyReference):ExcelReport {
  const works=new Map<string,ExcelReport['works'][number]>();
  for(const item of items){const norm=item.iqnLaborNorm,basis=Number(norm?.basisQuantity.value??1),key=[item.workName,item.normReference,item.completedQuantity.unit,basis,norm?.minutesPerBasis??''].join('|');const existing=works.get(key);const quantity=Number(item.completedQuantity.value)/basis;const normHours=norm?Number(norm.minutesPerBasis)/60:null;
    if(existing){existing.quantity+=quantity;existing.totalNormHours=normHours===null?null:existing.quantity*normHours;}else works.set(key,{name:item.workName,norm:item.normReference,unit:`${basis===1?'':basis+' '}${item.completedQuantity.unit}`,quantity,normHours,totalNormHours:normHours===null?null:quantity*normHours});
  }
  const materials:ExcelReport['materials']=[],equipment:ExcelReport['equipment']=[];
  for (const order of orders) {
    const postedAct = monthlyCompletionActs.find(a => a.state !== 'DRAFT' && a.items.some(i => i.workOrderId === order.id));
    const saved = postedAct ? demoExcelReports.get(postedAct.id) : undefined;
    const trace = (resourceId:string, resourceCode:string, reservationId:string|undefined, rate:CostRate|undefined):CostTrace => ({
      workOrderId:order.id,orderNumber:order.number,workDate:order.scheduledDate,roadCode:order.road.code,workName:order.workName,
      resourceId,resourceCode,reservationId,rateId:rate?.id??'snapshot',rateVersion:rate?.versionNo??0,rateSource:rate?.sourceReference??'Avvalgi dalolatnoma nusxasi',
      recordedBy:order.completion!.recordedByName,verifiedBy:order.completion!.verifiedByName??'',verifiedAt:order.completion!.verifiedAt??'',
    });
    for (const [index,use] of order.completion!.materials.entries()) {
      if (Number(use.quantity) === 0) continue;
      const resource=order.executionResources.materials.find(r=>r.id===use.materialId)!;
      const preceding=postedAct?.items.slice(0,postedAct.items.findIndex(i=>i.workOrderId===order.id)).reduce((n,i)=>n+(fixtureWorkOrders.find(o=>o.id===i.workOrderId)?.completion?.materials.length??0),0)??0;
      const frozen=saved?.materials.find(m=>m.trace?.workOrderId===order.id&&m.trace.resourceId===use.materialId) ?? (saved?.materials.every(m=>!m.trace)?saved.materials[preceding+index]:undefined);
      const rate=frozen?undefined:approvedRate('material',use.materialId,order.scheduledDate);
      materials.push(frozen?{...structuredClone(frozen),trace:frozen.trace??trace(use.materialId,resource.code,resource.reservationId,rate)}:
        {name:rate!.target.name,unit:rate!.pricingUnit,quantity:Number(use.quantity),price:Number(rate!.rateAmountUzs),amount:money2(Number(use.quantity)*Number(rate!.rateAmountUzs)),trace:trace(use.materialId,resource.code,resource.reservationId,rate)});
    }
    for (const [index,use] of order.completion!.equipment.entries()) {
      if (use.machineMinutes === 0) continue;
      const resource=order.executionResources.equipment.find(r=>r.id===use.equipmentUnitId)!;
      const preceding=postedAct?.items.slice(0,postedAct.items.findIndex(i=>i.workOrderId===order.id)).reduce((n,i)=>n+(fixtureWorkOrders.find(o=>o.id===i.workOrderId)?.completion?.equipment.length??0),0)??0;
      const frozen=saved?.equipment.find(m=>m.trace?.workOrderId===order.id&&m.trace.resourceId===use.equipmentUnitId) ?? (saved?.equipment.every(m=>!m.trace)?saved.equipment[preceding+index]:undefined);
      const rate=frozen?undefined:approvedRate('equipment',use.equipmentUnitId,order.scheduledDate);
      equipment.push(frozen?{...structuredClone(frozen),trace:frozen.trace??trace(use.equipmentUnitId,resource.inventoryCode,resource.reservationId,rate)}:
        {name:rate!.target.name,hours:use.machineMinutes/60,price:Number(rate!.rateAmountUzs),amount:money2(use.machineMinutes/60*Number(rate!.rateAmountUzs)),trace:trace(use.equipmentUnitId,resource.inventoryCode,resource.reservationId,rate)});
    }
  }
  const timesheet=planningOptions.workers.map(worker=>{
    const byDay=new Map<number,number>();
    for(const order of orders){const use=order.completion?.workerMinutes.find(w=>w.workerId===worker.id);if(use)byDay.set(Number(order.scheduledDate.slice(8)),(byDay.get(Number(order.scheduledDate.slice(8)))??0)+use.minutes);}
    const entries=[...byDay].sort((a,b)=>a[0]-b[0]).map(([day,minutes])=>({day,minutes}));
    return {workerId:worker.id,name:worker.fullName,position:worker.positionName??'',days:entries.filter(e=>e.minutes>0).length,minutes:entries.reduce((n,e)=>n+e.minutes,0),entries};
  });
  return {period,divisionName:fixtureUser.division?.name??'Yo‘l bo‘limi',roadLabel:[...new Set(orders.map(o=>`${o.road.code} · ${o.road.name}`))].join('; '),reference,state,payroll:structuredClone(payroll),works:[...works.values()],materials,equipment,timesheet};
}
const demoExcelReports=new Map<string,ExcelReport>();
let demoAudit:Array<CostLedger['audit'][number]&{period:string}>=[];

function recordDemoAudit(path:string,body:unknown,result:unknown){
  if(!/^\/(work-orders|payroll|monthly-completion-acts|cost-rates|monthly-work-time-norms|resource-requisitions|workers|budget-programs)(?:\/|$)/.test(path))return;
  const value=(result??{}) as Record<string,unknown>,input=(body??{}) as Record<string,unknown>;
  const program=value.program as Record<string,unknown>|undefined;
  const date=String(value.period??value.actMonth??value.scheduledDate??value.workMonth??input.period??input.actMonth??input.workMonth??tashkentFixtureDate());
  demoAudit.push({id:demoId('audit'),period:date.slice(0,7),at:new Date().toISOString(),actor:fixtureUser.fullName,action:demoActionLabel(path),recordId:String(value.id??value.draftId??program?.id??path.split('/')[2]??''),reference:String(value.number??value.actNumber??value.policyReference??value.sourceReference??input.note??(program?`${program.year}-yil budjeti`:path))});
}

// One browser transaction stores limits together with the orders that consume them.
const demoStorageKey='roadops-operations-v2';
let demoStoredRaw:string|null|undefined;
function captureDemoState(){return {schema:2,audit:demoAudit,programs:annualLedger.programs,fixtureWorkOrders,fixturePlans,fixtureRequisitions,fixturePayrollHistory,monthlyCompletionActs,costRates,monthlyWorkTimeNorms,manualInspections,fixtureFindings,equipmentStock,sourceDefects:planningOptions.sourceDefects,resourceSets,confirmedDefects,activity:dashboard.activity,demoStock,demoSequence,maps:{demoPlanInputs:[...demoPlanInputs],demoPlanCrews:[...demoPlanCrews],demoOrderMeta:[...demoOrderMeta],demoActBases:[...demoActBases],demoActAuthors:[...demoActAuthors],demoActSubmitters:[...demoActSubmitters],demoRateAuthors:[...demoRateAuthors],demoExcelReports:[...demoExcelReports],fixturePayrollSnapshots:[...fixturePayrollSnapshots],manualCaptureInputs:[...manualCaptureInputs],workerEquipmentIssues:[...workerEquipmentIssues]}};}
function restoreDemoState(s:ReturnType<typeof captureDemoState>){
 if(s.schema!==2||!Array.isArray(s.programs)||!Array.isArray(s.fixtureWorkOrders)||!s.maps)throw new Error('Saqlangan reja va ijro nusxasi yaroqsiz.');
 demoAudit=s.audit??[];annualLedger.programs=s.programs;fixtureWorkOrders=s.fixtureWorkOrders;fixturePlans=s.fixturePlans;fixtureRequisitions=s.fixtureRequisitions;fixturePayrollHistory=s.fixturePayrollHistory;monthlyCompletionActs=s.monthlyCompletionActs;costRates=s.costRates;monthlyWorkTimeNorms=s.monthlyWorkTimeNorms;manualInspections=s.manualInspections;fixtureFindings=s.fixtureFindings;equipmentStock=s.equipmentStock;planningOptions.sourceDefects=s.sourceDefects;Object.assign(resourceSets,s.resourceSets);confirmedDefects.splice(0,confirmedDefects.length,...s.confirmedDefects);dashboard.activity=s.activity;Object.assign(demoStock,s.demoStock);demoSequence=s.demoSequence;
 const maps={demoPlanInputs,demoPlanCrews,demoOrderMeta,demoActBases,demoActAuthors,demoActSubmitters,demoRateAuthors,demoExcelReports,fixturePayrollSnapshots,manualCaptureInputs,workerEquipmentIssues};
 for(const key of Object.keys(maps) as (keyof typeof maps)[]){const map=maps[key] as Map<string,unknown>;map.clear();for(const [id,v] of s.maps[key])map.set(id,v);}
}
function loadDemoState(){if(typeof localStorage==='undefined')return;const raw=localStorage.getItem(demoStorageKey);if(raw===demoStoredRaw)return;if(raw){const data=JSON.parse(raw);restoreDemoState(data);}else if(demoStoredRaw!==undefined&&demoStoredRaw!==null)throw new Error('Saqlangan nusxa boshqa oynada olib tashlangan. Sahifani yangilang.');demoStoredRaw=raw;}
let demoQueue=Promise.resolve();
export function handleFixtureRequest<T>(path:string,options:FixtureOptions):Promise<T>{
 const run=async()=>{
  loadDemoState();const write=(options.method??'GET')!=='GET',before=write?JSON.stringify(captureDemoState()):null;
  try{const result=await executeFixtureRequest<T>(path,options);if(write)recordDemoAudit(path,options.body,result);if(write&&typeof localStorage!=='undefined'){if(localStorage.getItem(demoStorageKey)!==demoStoredRaw)throw new Error('Boshqa oynada reja o‘zgardi. Ma’lumotni yangilab qayta urinib ko‘ring.');const raw=JSON.stringify(captureDemoState());localStorage.setItem(demoStorageKey,raw);demoStoredRaw=raw;}return result===undefined?result:JSON.parse(JSON.stringify(result));}
  catch(e){const review=e instanceof ApiError&&['PLAN_REAPPROVAL_REQUIRED','RESOURCES_CHANGED'].includes(e.code??'')&&/^\/planning\/plans\/[^/]+\/publish$/.test(path);if(review&&typeof localStorage!=='undefined'&&localStorage.getItem(demoStorageKey)===demoStoredRaw){try{const raw=JSON.stringify(captureDemoState());localStorage.setItem(demoStorageKey,raw);demoStoredRaw=raw;}catch{if(before)restoreDemoState(JSON.parse(before));throw new Error('Qayta tasdiqlash holati saqlanmadi. Brauzer xotirasini tekshiring.');}}else if(before)restoreDemoState(JSON.parse(before));throw e;}
 };
 const task=async ():Promise<T>=>{if(typeof navigator!=='undefined'&&navigator.locks)return await navigator.locks.request('roadops-operations',run) as T;return run();};
 const result=demoQueue.then(task,task);demoQueue=result.then(()=>undefined,()=>undefined);return result;
}
