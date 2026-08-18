/**
 * E2E-only in-memory adapter.
 * This module is dynamically imported only when NEXT_PUBLIC_E2E_FIXTURES=true.
 */
import { ApiError } from "./client";
import type {
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
  RoadOption,
  RoadVisionFinding,
  User,
  WorkOrderDetail,
  WorkOrderExecutionInput,
} from "./types";

type FixtureOptions = { method?: string; body?: unknown };

const fixtureUser: User = {
  id: "e2e-user",
  fullName: "Sinov operatori",
  roleLabel: "Yo‘l bo‘limi dispetcheri",
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
let fixtureFindings: RoadVisionFinding[] = structuredClone(initialFixtureFindings);

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
    { value: "unit", label: "dona" },
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
    { id: "work-shoulder", code: "IQN02-YOQA", name: "Yo‘l yoqasini saqlash va tiklash", iqnTopicId: "02000000-0000-4000-8000-000000000001", iqnTopicName: "Йўл пойини сақлаш учун вақт меъёрлари", normReference: "IQN 02-24 · ekspert tasdiqlaydigan norma", unit: "m3", requiredWorkers: 4, laborMinutesPerUnit: 22 },
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
    { id: "worker-1", fullName: "Aziz Shermatov", positionName: "Yo‘l ishchisi", skills: ["road_worker"], availableMinutes: 420 },
    { id: "worker-2", fullName: "Kamola Umarova", positionName: "Yo‘l ustasi", skills: ["road_worker", "foreman"], availableMinutes: 420 },
    { id: "worker-3", fullName: "Bekzod Rahimov", positionName: "Yo‘l ishchisi", skills: ["road_worker"], availableMinutes: 360 },
    { id: "worker-4", fullName: "Madina Tolipova", positionName: "Harakat xavfsizligi xodimi", skills: ["safety"], availableMinutes: 420 },
    { id: "worker-5", fullName: "Rustam Qodirov", positionName: "Harakat xavfsizligi xodimi", skills: ["safety"], availableMinutes: 280 },
    { id: "worker-6", fullName: "Otabek Tursunov", positionName: "Maxsus texnika operatori", skills: ["operator", "road_worker"], availableMinutes: 0 },
  ],
  sourceDefects: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      sourceReference: "KORIK-2026-0087",
      iqnTopic: {
        id: "02000000-0000-4000-8000-000000000001",
        name: "Йўл пойини сақлаш учун вақт меъёрлари",
      },
      location: { chainageStartM: "44100", chainageEndM: "44106" },
      measuredQuantity: { value: "8.5", unit: "m3" },
    },
    {
      id: "23333333-3333-4333-8333-333333333333",
      sourceReference: "KORIK-2026-0091",
      iqnTopic: {
        id: "02000000-0000-4000-8000-000000000002",
        name: "Асфальтбетон қопламаларни сақлаш учун вақт меъёрлари",
      },
      location: { chainageStartM: "18420", chainageEndM: "18427" },
      measuredQuantity: { value: "12.4", unit: "m2" },
    },
  ],
};

function monthlyTimesheet(year: number, month: number): MonthlyTimesheet {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const workEntries = Array.from({ length: daysInMonth }, (_, index) => ({
    day: index + 1,
    minutes: index % 7 === 5 || index % 7 === 6 ? 0 : 420,
    state: index % 7 === 5 || index % 7 === 6 ? "REST" as const : "WORK" as const,
  }));
  const mixedEntries = workEntries.map((entry) => entry.day === 7
    ? { ...entry, minutes: 0, state: "LEAVE" as const }
    : entry.day === 12 ? { ...entry, minutes: 0, state: "SICK" as const } : entry);
  return {
    year,
    month,
    daysInMonth,
    divisionName: "1-son yo‘l bo‘limi",
    rows: [
      { workerId: "worker-1", fullName: "Aziz Shermatov", personnelNumber: "D001-014", positionName: "Yo‘l ishchisi", entries: workEntries, totalMinutes: workEntries.reduce((sum, entry) => sum + entry.minutes, 0) },
      { workerId: "worker-2", fullName: "Kamola Umarova", personnelNumber: "D001-006", positionName: "Yo‘l ustasi", entries: mixedEntries, totalMinutes: mixedEntries.reduce((sum, entry) => sum + entry.minutes, 0) },
    ],
  };
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
  const selectedRoad = roads.find((item) => item.id === input.roadId);
  const sourceDefect = input.sourceDefectId
    ? planningOptions.sourceDefects.find((item) => item.id === input.sourceDefectId && selectedRoad?.id === planningOptions.road.id)
    : undefined;
  const work = planningOptions.workVariants.find((item) => item.id === input.workVariantId);
  const topicMatches = Boolean(sourceDefect?.iqnTopic.id && work?.iqnTopicId === sourceDefect.iqnTopic.id);
  const locationMatches = Boolean(sourceDefect)
    && Number(input.chainageStartM) === Number(sourceDefect?.location.chainageStartM);
  const scheme = planningOptions.safetySchemes.find((item) => item.id === input.safetySchemeId);
  const selectedWorkers = input.workerIds.flatMap((id) => {
    const worker = planningOptions.workers.find((item) => item.id === id);
    return worker ? [worker] : [];
  });
  const quantity = Number(input.exactQuantity);
  const workMinutes = work && Number.isFinite(quantity)
    ? Math.ceil((quantity * work.laborMinutesPerUnit) / Math.max(1, work.requiredWorkers))
    : 0;
  const assignedMinutes = Math.min(workMinutes, 420);
  const roadWorkers = selectedWorkers.filter((worker) => worker.skills.includes("road_worker"));
  const safetyWorkers = selectedWorkers.filter((worker) => worker.skills.includes("safety"));
  const workerCountOkay = Boolean(work && scheme)
    && roadWorkers.length >= (work?.requiredWorkers ?? 0)
    && safetyWorkers.length >= (scheme?.requiredSafetyWorkers ?? 0);
  const timeOkay = workMinutes > 0 && workMinutes <= 420
    && selectedWorkers.every((worker) => worker.availableMinutes >= assignedMinutes);
  const signsAvailable = 20;
  const conesAvailable = 60;
  const barriersAvailable = 6;
  const safetyEquipmentOkay = scheme !== undefined
    && scheme.requiredSigns <= signsAvailable
    && scheme.requiredCones <= conesAvailable
    && scheme.requiredBarriers <= barriersAvailable;
  const permitOkay = !scheme?.requiresPermit || Boolean(input.permitNumber?.trim());
  const resourceChecks = [
    {
      kind: "WORKERS" as const,
      label: "Brigada tarkibi",
      required: work && scheme ? `${work.requiredWorkers} ishchi + ${scheme.requiredSafetyWorkers} xavfsizlik xodimi` : "Ish va sxemani tanlang",
      available: `${roadWorkers.length} ishchi + ${safetyWorkers.length} xavfsizlik xodimi tanlandi`,
      sufficient: workerCountOkay,
    },
    {
      kind: "WORKER_TIME" as const,
      label: "Kunlik 420 daqiqalik limit",
      required: `${workMinutes || 0} daqiqa`,
      available: selectedWorkers.length ? `${Math.min(...selectedWorkers.map((worker) => worker.availableMinutes))} daqiqagacha` : "Xodim tanlanmagan",
      sufficient: timeOkay,
    },
    { kind: "EQUIPMENT" as const, label: "Texnika", required: "IQN bo‘yicha 1 ta maxsus transport", available: "2 ta bo‘sh", sufficient: true },
    { kind: "MATERIALS" as const, label: "Material", required: work ? `${input.exactQuantity || 0} ${work.unit} ish uchun` : "Ishni tanlang", available: "Omborda mavjud", sufficient: Boolean(work && quantity > 0) },
    {
      kind: "SAFETY_EQUIPMENT" as const,
      label: "Belgilar, konuslar va to‘siqlar",
      required: scheme ? `${scheme.requiredSigns} belgi, ${scheme.requiredCones} konus, ${scheme.requiredBarriers} to‘siq` : "Sxemani tanlang",
      available: `${signsAvailable} belgi, ${conesAvailable} konus, ${barriersAvailable} to‘siq`,
      sufficient: safetyEquipmentOkay,
    },
    ...(scheme?.requiresPermit ? [{ kind: "PERMIT" as const, label: "Yo‘lni yopish ruxsatnomasi", required: "Ruxsatnoma raqami", available: permitOkay ? input.permitNumber ?? "" : "Kiritilmagan", sufficient: permitOkay }] : []),
  ];
  const canPublish = Boolean(sourceDefect && work && topicMatches && locationMatches && scheme && quantity > 0)
    && resourceChecks.every((check) => check.sufficient);
  return {
    draftId: "44444444-4444-4444-8444-444444444444",
    state: "AWAITING_APPROVAL",
    dateFrom: input.scheduledDate,
    dateTo: input.scheduledDate,
    planningMode: "MANUAL",
    createdByName: fixtureUser.fullName,
    createdAt: new Date().toISOString(),
    jobs: [{
      candidateId: sourceDefect?.id ?? "MANUAL:SOURCE_DEFECT_REQUIRED",
      workName: work?.name ?? "Qo‘lda kiritilgan ish",
      scheduledDate: canPublish ? input.scheduledDate : null,
      teamName: canPublish ? "Tanlangan brigada" : null,
      laborHours: String(Math.round((assignedMinutes / 60) * 100) / 100),
      equipment: ["Maxsus transport"],
      materials: work ? [{ name: "IQN bo‘yicha material", quantity: input.exactQuantity, unit: work.unit }] : [],
    }],
    blockers: [
      ...(!sourceDefect ? [{
        code: "SOURCE_DEFECT_REQUIRED",
        title: "Tasdiqlangan nuqson tanlanmagan",
        explanation: "Qo‘lda topshiriq tasdiqlangan RoadVision yoki yo‘l ustasi ko‘rigi yozuviga bog‘lanishi kerak.",
        resolution: "Tasdiqlangan nuqsonni tanlang va hisobni qayta bajaring.",
        candidateId: input.sourceDefectId,
        level: "BLOCKING" as const,
      }] : []),
      ...(sourceDefect && !topicMatches ? [{
        code: "IQN_VARIANT_TOPIC_MISMATCH",
        title: "IQN ish turi mavzuga mos emas",
        explanation: "Tanlangan aniq ish turi yo‘l ustasi qayd etgan umumiy IQN 02-24 mavzusiga kirmaydi.",
        resolution: "Qayddagi IQN mavzusiga tegishli ish turini tanlang.",
        candidateId: sourceDefect.id,
        level: "BLOCKING" as const,
      }] : []),
      ...(sourceDefect && !locationMatches ? [{
        code: "SOURCE_DEFECT_LOCATION_MISMATCH",
        title: "Lokatsiya manba qaydga mos emas",
        explanation: "Topshiriq lokatsiyasi tanlangan yo‘l ustasi qaydining piketiga teng bo‘lishi kerak.",
        resolution: "Manba qayddagi lokatsiyani qayta tanlang.",
        candidateId: sourceDefect.id,
        level: "BLOCKING" as const,
      }] : []),
      ...resourceChecks.filter((check) => !check.sufficient).map((check) => ({
        code: `MANUAL_${check.kind}_INSUFFICIENT`,
        title: `${check.label} yetarli emas`,
        explanation: `Talab: ${check.required}. Mavjud: ${check.available}.`,
        resolution: check.kind === "PERMIT" ? "Ruxsatnoma raqamini kiriting." : "Yetishmayotgan resursni tanlang yoki ish sanasini o‘zgartiring.",
        candidateId: sourceDefect?.id,
        level: "BLOCKING" as const,
      })),
    ],
    resourceChecks,
    workerMinutesRemaining: selectedWorkers.map((worker) => ({
      workerId: worker.id,
      fullName: worker.fullName,
      beforeMinutes: worker.availableMinutes,
      assignedMinutes: Math.min(assignedMinutes, worker.availableMinutes),
      remainingMinutes: Math.max(0, worker.availableMinutes - assignedMinutes),
    })),
    safetyScheme: scheme ?? null,
    resourcesReady: canPublish,
    canApprove: false,
    canPublish: false,
  };
}

function approvedRate(kind: CostRate["rateKind"], targetId: string, workDate: string): CostRate {
  const rate = costRates.find((item) => item.rateKind === kind
    && item.target.id === targetId
    && item.state === "APPROVED"
    && item.effectiveFrom <= workDate
    && item.effectiveUntil > workDate);
  if (!rate) {
    throw new ApiError("Bajarilgan resurs uchun tasdiqlangan narx topilmadi.", 422, "APPROVED_COST_RATE_REQUIRED");
  }
  return rate;
}

function monthlyActItem(order: WorkOrderDetail, index: number): MonthlyCompletionAct["items"][number] {
  const completion = order.completion;
  if (!completion || completion.state !== "VERIFIED") {
    throw new ApiError("Faqat tekshirilgan bajarilgan ish dalolatnomaga kiradi.", 422, "VERIFIED_COMPLETION_REQUIRED");
  }
  const workDate = completion.recordedAt.slice(0, 10);
  let laborAmount = 0;
  let socialAmount = 0;
  for (const usage of completion.workerMinutes) {
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
    const rate = approvedRate("material", usage.materialId, workDate);
    return sum + Number(rate.rateAmountUzs) * Number(usage.quantity);
  }, 0);
  const equipmentAmount = completion.equipment.reduce((sum, usage) => {
    const rate = approvedRate("equipment", usage.equipmentUnitId, workDate);
    return sum + Number(rate.rateAmountUzs) * usage.machineMinutes / 60;
  }, 0);
  const totalAmount = laborAmount + socialAmount + materialAmount + equipmentAmount;
  return {
    id: `monthly-act-item-${index + 1}-${order.id}`,
    workOrderId: order.id,
    orderNumber: order.number,
    workName: order.workName,
    normReference: order.normReference,
    completedQuantity: completion.actualQuantity,
    iqnLaborNorm: {
      normSetId: `fixture-iqn-norm-set-${order.id}`,
      normLineIds: [`fixture-iqn-labor-line-${order.id}`],
      basisQuantity: { value: "1", unit: completion.actualQuantity.unit },
      minutesPerBasis: "9.000",
      minutesPerUnit: "9.000000",
      totalMinutes: (Number(completion.actualQuantity.value) * 9).toFixed(6),
    },
    laborAmountUzs: laborAmount.toFixed(2),
    socialAmountUzs: socialAmount.toFixed(2),
    materialAmountUzs: materialAmount.toFixed(2),
    equipmentAmountUzs: equipmentAmount.toFixed(2),
    totalAmountUzs: totalAmount.toFixed(2),
  };
}

function buildMonthlyCompletionAct(actMonth: string, divisionId: string, existing?: MonthlyCompletionAct): MonthlyCompletionAct {
  const monthKey = actMonth.slice(0, 7);
  const eligibleOrders = fixtureWorkOrders.filter((order) => order.completion?.state === "VERIFIED"
    && order.completion.recordedAt.slice(0, 7) === monthKey);
  if (!eligibleOrders.length) {
    throw new ApiError("Bu oy uchun tekshirilgan bajarilgan ish topilmadi.", 422, "NO_VERIFIED_COMPLETIONS");
  }
  const items = eligibleOrders.map(monthlyActItem);
  const total = (key: "laborAmountUzs" | "socialAmountUzs" | "materialAmountUzs" | "equipmentAmountUzs" | "totalAmountUzs") =>
    items.reduce((sum, item) => sum + Number(item[key]), 0).toFixed(2);
  return {
    id: existing?.id ?? `monthly-act-${monthKey}`,
    divisionId,
    actNumber: existing?.actNumber ?? `DAL-${monthKey}-001`,
    actMonth: `${monthKey}-01`,
    divisionName: "1-son yo‘l bo‘limi",
    roadLabel: "D001 · Toshkent halqa avtomobil yo‘li",
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
}

function page<T>(items: T[]): Paged<T> {
  return { items, page: 1, pageSize: 25, total: items.length };
}

function requireSession(): void {
  const persisted = typeof window !== "undefined" && window.sessionStorage.getItem("roadops_fixture_session") === "active";
  if (!authenticated && !persisted) throw new ApiError("Sessiya topilmadi.", 401, "UNAUTHENTICATED");
  authenticated = true;
}

export async function handleFixtureRequest<T>(path: string, options: FixtureOptions): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 90));
  const method = (options.method ?? "GET").toUpperCase();

  if (path === "/auth/login" && method === "POST") {
    const credentials = options.body as { email?: string; totpCode?: string };
    if (credentials.email === "mfa@example.uz" && !credentials.totpCode) return { mfaRequired: true, factorType: "totp" } as T;
    if (credentials.email === "mfa@example.uz" && credentials.totpCode !== "123456") {
      throw new ApiError("Autentifikator kodi noto‘g‘ri.", 422, "INVALID_TOTP");
    }
    fixtureFindings = structuredClone(initialFixtureFindings);
    manualInspections = structuredClone(initialManualInspections);
    fixtureWorkOrders = structuredClone(initialWorkOrders);
    monthlyCompletionActs = structuredClone(initialMonthlyCompletionActs);
    costRates = structuredClone(initialCostRates);
    monthlyWorkTimeNorms = structuredClone(initialMonthlyWorkTimeNorms);
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
  if (path === "/dashboard/summary") return dashboard as T;
  if (path === "/admin/network-summary") return adminNetworkSummary as T;
  if (path === "/admin/organization-hierarchy") return adminOrganizationHierarchy as T;
  if (path.startsWith("/roadvision/findings?")) {
    const requestedState = new URLSearchParams(path.split("?")[1]).get("state");
    return page(fixtureFindings.filter((item) => item.state === requestedState)) as T;
  }
  if (path.startsWith("/defects?") && method === "GET") {
    const requestedState = new URLSearchParams(path.split("?")[1]).get("state") as ConfirmedDefectState | null;
    return page(confirmedDefects.filter((item) => item.state === requestedState)) as T;
  }
  const decisionMatch = path.match(/^\/roadvision\/findings\/([^/]+)\/decision$/);
  if (decisionMatch && method === "POST") {
    const body = options.body as {
      decision: RoadVisionFinding["state"];
      note: string;
      measuredQuantity?: { value: string; unit: string };
    };
    const itemPosition = fixtureFindings.findIndex((item) => item.id === decisionMatch[1]);
    const current = fixtureFindings[itemPosition];
    if (!current) throw new ApiError("Yozuv topilmadi.", 404, "NOT_FOUND");
    const updated = {
      ...current,
      state: body.decision,
      reviewerNote: body.note,
      measuredQuantity: body.measuredQuantity ?? current.measuredQuantity,
    };
    fixtureFindings = fixtureFindings.map((item) => (item.id === updated.id ? updated : item));
    return updated as T;
  }
  if (path === "/manual-inspections/options" && method === "GET") return manualInspectionOptions as T;
  if (path.startsWith("/manual-inspections?") && method === "GET") {
    const requestedState = new URLSearchParams(path.split("?")[1]).get("state") as ManualInspectionState | null;
    return page(manualInspections.filter((item) => item.state === requestedState)) as T;
  }
  if (path === "/manual-inspections" && method === "POST") {
    const body = options.body as ManualInspectionInput;
    const road = roads.find((item) => item.id === body.roadId) ?? roads[0]!;
    const topic = manualInspectionOptions.workTopics.find((item) => item.id === body.iqnTopicId);
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
        observedIssue: topic?.name ?? "IQN 02-24 umumiy ish mavzusi",
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
    manualInspections = [inspection, ...manualInspections];
    return { id: inspection.id } as T;
  }
  const inspectionSubmitMatch = path.match(/^\/manual-inspections\/([^/]+)\/submit$/);
  if (inspectionSubmitMatch && method === "POST") {
    const current = manualInspections.find((item) => item.id === inspectionSubmitMatch[1]);
    if (!current) throw new ApiError("Ko‘rik topilmadi.", 404, "NOT_FOUND");
    const updated: ManualInspection = { ...current, state: "PENDING_REVIEW", submittedAt: new Date().toISOString() };
    manualInspections = manualInspections.map((item) => item.id === updated.id ? updated : item);
    return updated as T;
  }
  const inspectionDecisionMatch = path.match(/^\/manual-inspections\/([^/]+)\/decision$/);
  if (inspectionDecisionMatch && method === "POST") {
    const body = options.body as { decision: "VERIFIED" | "REJECTED"; note: string };
    const current = manualInspections.find((item) => item.id === inspectionDecisionMatch[1]);
    if (!current) throw new ApiError("Ko‘rik topilmadi.", 404, "NOT_FOUND");
    const updated: ManualInspection = { ...current, state: body.decision, reviewerNote: body.note, reviewedAt: new Date().toISOString() };
    manualInspections = manualInspections.map((item) => item.id === updated.id ? updated : item);
    return updated as T;
  }
  if (path.startsWith("/planning/candidates?")) return page(candidates) as T;
  if (path.startsWith("/planning/options?")) return planningOptions as T;
  if (path === "/planning/preview" && method === "POST") {
    const body = options.body as { candidateIds: string[]; dateFrom: string; dateTo: string };
    const selected = body.candidateIds.map((id) => candidates.find((item) => item.id === id)).filter(Boolean) as PlanningCandidate[];
    const blockers = selected
      .filter((item) => !item.exactQuantity)
      .map((item) => ({
        code: "EXACT_QUANTITY_REQUIRED",
        title: "Aniq ish hajmi yetishmaydi",
        explanation: `${item.sourceReference} yozuvida norma hisoblash uchun ish hajmi kiritilmagan.`,
        resolution: "Dalilni o‘lchang va birlik bilan aniq hajm kiriting.",
        candidateId: item.id,
        level: "BLOCKING" as const,
      }));
    const preview: PlanPreview = {
      draftId: "33333333-3333-4333-8333-333333333333",
      state: "AWAITING_APPROVAL",
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      planningMode: "AUTOMATIC",
      createdByName: fixtureUser.fullName,
      createdAt: new Date().toISOString(),
      jobs: selected.map((item, order) => ({
        candidateId: item.id,
        workName: item.workName,
        scheduledDate: item.exactQuantity ? body.dateFrom : null,
        teamName: item.exactQuantity ? `${order + 1}-brigada` : null,
        laborHours: item.exactQuantity ? String(12 + order * 8) : "0",
        equipment: item.exactQuantity ? ["Maxsus transport"] : [],
        materials: item.exactQuantity ? [{ name: "Norma bo‘yicha material", quantity: item.exactQuantity.value, unit: item.exactQuantity.unit }] : [],
      })),
      blockers,
      resourceChecks: automaticResourceChecks(),
      workerMinutesRemaining: planningOptions.workers.slice(0, 3).map((worker) => ({
        workerId: worker.id,
        fullName: worker.fullName,
        beforeMinutes: worker.availableMinutes,
        assignedMinutes: automaticAssignedMinutes(worker.availableMinutes),
        remainingMinutes: worker.availableMinutes - automaticAssignedMinutes(worker.availableMinutes),
      })),
      safetyScheme: planningOptions.safetySchemes[1] ?? null,
      resourcesReady: blockers.length === 0 && selected.length > 0,
      canApprove: false,
      canPublish: false,
    };
    fixturePlans = [preview, ...fixturePlans.filter((plan) => plan.draftId !== preview.draftId)];
    return preview as T;
  }
  if (path === "/planning/manual/preview" && method === "POST") {
    const preview = manualPlanPreview(options.body as ManualPlanInput);
    fixturePlans = [preview, ...fixturePlans.filter((plan) => plan.draftId !== preview.draftId)];
    return preview as T;
  }
  if (path.startsWith("/planning/plans?") && method === "GET") {
    return page(fixturePlans.map(planningSummary)) as T;
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
    if (!plan.canApprove) throw new ApiError("Rejani boshqa vakolatli xodim tasdiqlashi kerak.", 409, "PLAN_APPROVAL_REJECTED");
    fixturePlans = fixturePlans.map((item) => item.draftId === plan.draftId
      ? { ...item, state: "APPROVED", canApprove: false, canPublish: item.resourcesReady }
      : item);
    return { planId: plan.draftId, state: "APPROVED" } as T;
  }
  const publishPlanMatch = path.match(/^\/planning\/plans\/([^/]+)\/publish$/);
  if (publishPlanMatch && method === "POST") {
    const plan = fixturePlans.find((item) => item.draftId === publishPlanMatch[1]);
    if (!plan?.canPublish) throw new ApiError("Reja nashrga tayyor emas.", 409, "PLAN_PUBLISH_REJECTED");
    fixturePlans = fixturePlans.map((item) => item.draftId === plan.draftId
      ? { ...item, state: "PUBLISHED", canApprove: false, canPublish: false }
      : item);
    return { planId: plan.draftId, state: "PUBLISHED" } as T;
  }
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
    const updated: WorkOrderDetail = {
      ...current,
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
      || !body.laborEntries?.length || body.laborEntries.some((item) => item.actualMinutes <= 0)) {
      throw new ApiError("Haqiqiy hajm va ishchi daqiqalarini to‘liq kiriting.", 422, "INVALID_COMPLETION_ACTUALS");
    }
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
    fixtureWorkOrders = fixtureWorkOrders.map((item) => item.id === updated.id ? updated : item);
    return updated as T;
  }
  const workOrderDetailMatch = path.match(/^\/work-orders\/([^/]+)$/);
  if (workOrderDetailMatch && method === "GET") {
    const current = fixtureWorkOrders.find((item) => item.id === workOrderDetailMatch[1]);
    if (!current) throw new ApiError("Topshiriq topilmadi.", 404, "NOT_FOUND");
    return current as T;
  }
  if (path.startsWith("/work-orders?")) return page(fixtureWorkOrders) as T;
  if (path.startsWith("/monthly-completion-acts?") && method === "GET") {
    const month = new URLSearchParams(path.split("?")[1]).get("actMonth");
    return page(monthlyCompletionActs
      .filter((item) => !month || item.actMonth === month)
      .map(monthlyCompletionActSummary)) as T;
  }
  if (path === "/monthly-completion-acts" && method === "POST") {
    const body = options.body as { divisionId?: string; actMonth?: string };
    if (!body.divisionId || !body.actMonth || !/^\d{4}-\d{2}-01$/.test(body.actMonth)) {
      throw new ApiError("Yo‘l bo‘limi va dalolatnoma oyini kiriting.", 422, "INVALID_ACT_MONTH");
    }
    const actMonth = body.actMonth;
    const existing = monthlyCompletionActs.find((item) => item.actMonth === actMonth);
    if (existing && existing.state !== "DRAFT") {
      throw new ApiError("Taqdim etilgan dalolatnomani qayta hisoblab bo‘lmaydi.", 409, "ACT_ALREADY_SUBMITTED");
    }
    const generated = buildMonthlyCompletionAct(actMonth, body.divisionId, existing);
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
    if (!target || !body.rateAmountUzs || Number(body.rateAmountUzs) <= 0) {
      throw new ApiError("Resurs va musbat narxni kiriting.", 422, "INVALID_COST_RATE");
    }
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
    if (!workMonth || body.workingDays <= 0 || body.normMinutes <= 0 || !body.scheduleCode) {
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
      versionNo: body.versionNo,
      state: "DRAFT",
      createdByMe: true,
      canApprove: false,
      createdAt: new Date().toISOString(),
    };
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
  if (path.startsWith("/annual-programs?")) return page(annualLines) as T;
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
  if (resourceMatch) return page(resourceSets[resourceMatch[1] ?? ""] ?? []) as T;
  if (path.startsWith("/timesheets/monthly?")) {
    const params = new URLSearchParams(path.split("?")[1]);
    const year = Number(params.get("year"));
    const month = Number(params.get("month"));
    return monthlyTimesheet(year, month) as T;
  }
  if (path.startsWith("/roads?")) return page(roads) as T;
  if (path.startsWith("/map/records?")) return mapData as T;
  if (path === "/settings" && method === "GET") return { timezone: "Asia/Tashkent", planningHorizonDays: "14" } as T;
  if (path === "/settings" && method === "PATCH") return options.body as T;

  throw new ApiError(`E2E yo‘li topilmadi: ${path}`, 404, "FIXTURE_ROUTE_NOT_FOUND");
}
