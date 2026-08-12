/**
 * E2E-only in-memory adapter.
 * This module is dynamically imported only when NEXT_PUBLIC_E2E_FIXTURES=true.
 */
import { ApiError } from "./client";
import type {
  AnnualProgramLine,
  ConfirmedDefect,
  ConfirmedDefectState,
  DashboardSummary,
  RoadMapData,
  IntegrationReadiness,
  ManualInspection,
  ManualInspectionInput,
  ManualInspectionOptions,
  ManualInspectionState,
  ManualPlanInput,
  MonthlyTimesheet,
  Paged,
  PlanPreview,
  PlanningCandidate,
  PlanningOptions,
  PlanningRunSummary,
  ResourceRow,
  RoadOption,
  RoadVisionFinding,
  User,
  WorkOrder,
} from "./types";

type FixtureOptions = { method?: string; body?: unknown };

const fixtureUser: User = {
  id: "e2e-user",
  fullName: "Sinov operatori",
  roleLabel: "Yo‘l bo‘limi dispetcheri",
  division: { id: "e2e-division", name: "D001 Toshkent halqa yo‘l bo‘limi" },
  permissions: ["system.all"],
};

let authenticated = false;

const initialFixtureFindings: RoadVisionFinding[] = [
  {
    id: "finding-1",
    vendorReference: "RV-E2E-1042",
    attributeName: "Qoplamadagi chuqur",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    division: { id: "e2e-division", name: "D001 Toshkent halqa yo‘l bo‘limi" },
    chainageStartM: 18420,
    chainageEndM: 18427,
    laneLabel: "O‘ng tasma",
    observedAt: "2026-08-11T04:22:00Z",
    receivedAt: "2026-08-11T04:37:00Z",
    state: "PENDING_REVIEW",
    measuredQuantity: { value: "12.4", unit: "m²" },
    evidenceUrl: "/e2e-road-evidence.svg",
    evidenceMediaType: "image/png",
  },
  {
    id: "finding-2",
    vendorReference: "RV-E2E-1043",
    attributeName: "Yo‘l yoqasidagi yemirilish",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    division: { id: "e2e-division", name: "D001 Toshkent halqa yo‘l bo‘limi" },
    chainageStartM: 46210,
    observedAt: "2026-08-11T05:11:00Z",
    receivedAt: "2026-08-11T05:24:00Z",
    state: "PENDING_REVIEW",
  },
];
let fixtureFindings: RoadVisionFinding[] = structuredClone(initialFixtureFindings);

const confirmedDefects: ConfirmedDefect[] = [
  {
    id: "defect-confirmed-1",
    sourceKind: "ROADVISION",
    sourceReference: "RV-E2E-1001",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    division: { id: "e2e-division", name: "D001 Toshkent halqa yo‘l bo‘limi" },
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
    division: { id: "e2e-division", name: "D001 Toshkent halqa yo‘l bo‘limi" },
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

const candidates: PlanningCandidate[] = [
  {
    id: "candidate-1",
    sourceReference: "RV-E2E-1001",
    sourceKind: "ROADVISION",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    locationLabel: "18+420 — 18+427, o‘ng tasma",
    workName: "Qoplamadagi chuqurni ta’mirlash",
    exactQuantity: { value: "12.4", unit: "m²" },
    normReference: "IQN 02-24, 3.2-band",
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
    normReference: "IQN 02-24, 4.1-band",
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
    normReference: "IQN 02-24, 5.3-band",
    verificationState: "VERIFIED",
  },
];

const workOrders: WorkOrder[] = [
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
  },
];

const annualLines: AnnualProgramLine[] = [
  {
    id: "annual-1",
    programId: "30000000-0000-4000-8000-000000002026",
    year: 2026,
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    workName: "Qoplamadagi chuqurlarni ta’mirlash",
    normReference: "IQN 02-24, 3.2-band",
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
    normReference: "IQN 02-24, 5.3-band",
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
    { id: "w-1", name: "Aziz Shermatov", divisionName: "D001 Toshkent halqa yo‘l bo‘limi", detail: "Yo‘l ishchisi", stateLabel: "Smenada" },
    { id: "w-2", name: "Kamola Umarova", divisionName: "D001 Toshkent halqa yo‘l bo‘limi", detail: "Usta", stateLabel: "Smenada" },
  ],
  equipment: [
    { id: "e-1", name: "Avtogreyder", code: "TG-017", detail: "D001 yo‘l bo‘limiga biriktirilgan", stateLabel: "Bo‘sh" },
    { id: "e-2", name: "Katok", code: "TG-024", detail: "2-brigadaga biriktirilgan", stateLabel: "Ishda" },
  ],
  warehouse: [
    { id: "s-1", name: "Issiq asfalt qorishmasi", code: "MAT-011", detail: "48.5 t mavjud", stateLabel: "Mavjud" },
    { id: "s-2", name: "Mayda chaqiq tosh", code: "MAT-042", detail: "112 m³ mavjud", stateLabel: "Mavjud" },
  ],
  timesheets: [
    { id: "t-1", name: "1-brigada", detail: "2026-08-12 · 6 ishchi · 36 soat", stateLabel: "Kiritilgan" },
  ],
};

const roads: RoadOption[] = [
  { id: "road-d001", code: "D001", name: "Toshkent halqa avtomobil yo‘li", divisionName: "D001 Toshkent halqa yo‘l bo‘limi", lengthM: 67000 },
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
  defectTypes: [
    { id: "defect-pothole", code: "QOPLAMA-CHUQUR", name: "Qoplamadagi chuqur", unit: "m2" },
    { id: "defect-crack", code: "QOPLAMA-YORIQ", name: "Ko‘ndalang yoki bo‘ylama yoriq", unit: "m" },
    { id: "defect-sign", code: "BELGI-SHIKAST", name: "Yo‘l belgisi shikastlangan", unit: "unit" },
    { id: "defect-shoulder", code: "YOQA-YEMIRILISH", name: "Yo‘l yoqasi yemirilgan", unit: "m3" },
  ],
};

const initialManualInspections: ManualInspection[] = [
  {
    id: "inspection-draft-1",
    inspectionNumber: "KORIK-2026-0088",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    division: { id: "e2e-division", name: "D001 Toshkent halqa yo‘l bo‘limi" },
    observedDate: "2026-08-11",
    inspectorName: "Kamola Umarova",
    state: "DRAFT",
    observations: [{
      id: "observation-1",
      locationLabel: "32+400 — 32+412, o‘ng tasma",
      observedIssue: "Ko‘ndalang yoriq",
      exactQuantity: { value: "12", unit: "m" },
      laneLabel: "O‘ng tasma",
    }],
    note: "Dalil joyida tekshirildi.",
  },
  {
    id: "inspection-review-1",
    inspectionNumber: "KORIK-2026-0087",
    road: { code: "D001", name: "Toshkent halqa avtomobil yo‘li" },
    division: { id: "e2e-division", name: "D001 Toshkent halqa yo‘l bo‘limi" },
    observedDate: "2026-08-10",
    inspectorName: "Aziz Shermatov",
    state: "PENDING_REVIEW",
    observations: [{
      id: "observation-2",
      locationLabel: "44+100 — 44+106, chap yoqa",
      observedIssue: "Yo‘l yoqasi yemirilgan",
      exactQuantity: { value: "8.5", unit: "m³" },
      laneLabel: "Chap yoqa",
    }],
    submittedAt: "2026-08-10T12:15:00Z",
  },
];
let manualInspections: ManualInspection[] = structuredClone(initialManualInspections);

const planningOptions: PlanningOptions = {
  road: roads[0]!,
  workVariants: [
    { id: "work-pothole", code: "IQN02-3.2", name: "Qoplamadagi chuqurni ta’mirlash", normReference: "IQN 02-24, 3.2-band", unit: "m²", requiredWorkers: 3, laborMinutesPerUnit: 16 },
    { id: "work-shoulder", code: "IQN02-4.1", name: "Yo‘l yoqasini tiklash", normReference: "IQN 02-24, 4.1-band", unit: "m³", requiredWorkers: 4, laborMinutesPerUnit: 22 },
    { id: "work-ditch", code: "IQN02-5.3", name: "Suv qochirish arig‘ini tozalash", normReference: "IQN 02-24, 5.3-band", unit: "m", requiredWorkers: 3, laborMinutesPerUnit: 8 },
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
    divisionName: "D001 Toshkent halqa yo‘l bo‘limi",
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
  const work = planningOptions.workVariants.find((item) => item.id === input.workVariantId);
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
  const canPublish = Boolean(work && scheme && quantity > 0) && resourceChecks.every((check) => check.sufficient);
  return {
    draftId: "44444444-4444-4444-8444-444444444444",
    state: "AWAITING_APPROVAL",
    dateFrom: input.scheduledDate,
    dateTo: input.scheduledDate,
    planningMode: "MANUAL",
    createdByName: fixtureUser.fullName,
    createdAt: new Date().toISOString(),
    jobs: [{
      candidateId: "MANUAL:55555555-5555-4555-8555-555555555555",
      workName: work?.name ?? "Qo‘lda kiritilgan ish",
      scheduledDate: canPublish ? input.scheduledDate : null,
      teamName: canPublish ? "Tanlangan brigada" : null,
      laborHours: String(Math.round((assignedMinutes / 60) * 100) / 100),
      equipment: ["Maxsus transport"],
      materials: work ? [{ name: "IQN bo‘yicha material", quantity: input.exactQuantity, unit: work.unit }] : [],
    }],
    blockers: resourceChecks.filter((check) => !check.sufficient).map((check) => ({
      code: `MANUAL_${check.kind}_INSUFFICIENT`,
      title: `${check.label} yetarli emas`,
      explanation: `Talab: ${check.required}. Mavjud: ${check.available}.`,
      resolution: check.kind === "PERMIT" ? "Ruxsatnoma raqamini kiriting." : "Yetishmayotgan resursni tanlang yoki ish sanasini o‘zgartiring.",
      level: "BLOCKING" as const,
    })),
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

function page<T>(items: T[]): Paged<T> {
  return { items, page: 1, pageSize: 25, total: items.length };
}

function requireSession(): void {
  if (!authenticated) throw new ApiError("Sessiya topilmadi.", 401, "UNAUTHENTICATED");
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
    authenticated = true;
    document.cookie = "roadops_csrf=e2e-csrf; path=/; SameSite=Lax";
    return fixtureUser as T;
  }
  if (path === "/auth/me") {
    requireSession();
    return fixtureUser as T;
  }
  if (path === "/auth/logout" && method === "POST") {
    authenticated = false;
    return undefined as T;
  }

  requireSession();
  if (path === "/dashboard/summary") return dashboard as T;
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
    const defect = manualInspectionOptions.defectTypes.find((item) => item.id === body.defectTypeId);
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
        locationLabel: `${body.chainageStartM}–${body.chainageEndM || body.chainageStartM} m${body.direction ? `, ${body.direction}` : ""}${body.laneLabel ? `, ${body.laneLabel}` : ""}`,
        observedIssue: defect?.name ?? body.observedIssue,
        exactQuantity: { value: body.exactQuantity, unit: defect?.unit ?? body.unit },
        laneLabel: body.laneLabel,
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
  if (path.startsWith("/work-orders?")) return page(workOrders) as T;
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
  const resourceMatch = path.match(/^\/resources\/(workers|equipment|warehouse|timesheets)(?:\?.*)?$/);
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
