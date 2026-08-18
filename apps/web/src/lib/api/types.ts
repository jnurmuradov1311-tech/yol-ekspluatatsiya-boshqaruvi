export type ApiMeta = {
  requestId?: string;
  page?: number;
  pageSize?: number;
  total?: number;
};

export type ApiEnvelope<T> = {
  data: T;
  meta?: ApiMeta;
  error?: never;
};

export type ApiProblem = {
  data?: never;
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
    requestId?: string;
  };
};

export type User = {
  id: string;
  fullName: string;
  roleLabel: string;
  division: { id: string; name: string } | null;
  permissions: string[];
  globalPermissions: string[];
};

export type MfaChallenge = {
  mfaRequired: true;
  factorType: "totp";
};

export type DashboardSummary = {
  asOf: string;
  division: { id: string; name: string } | null;
  counts: {
    reviewQueue: number;
    confirmedDefects: number;
    plannedToday: number;
    openWorkOrders: number;
    overdueWorkOrders: number;
    workersOnShift: number;
    availableEquipment: number;
    failedSyncs: number;
  };
  alerts: Array<{
    id: string;
    kind: "danger" | "warning" | "info";
    title: string;
    detail: string;
    href?: string;
  }>;
  activity: Array<{
    id: string;
    occurredAt: string;
    actor: string;
    action: string;
    subject: string;
  }>;
};

export type AdminNetworkSummary = {
  asOf: string;
  officialNetworkLengthKm: number;
  synchronizedRoadLengthKm: string;
  synchronizedRoadCount: number;
  synchronizedDivisionCount: number;
};

export type OrganizationHierarchyLevel = "REPUBLIC" | "REGION" | "ENTERPRISE" | "DIVISION";

export type OrganizationHierarchyNode = {
  id: string;
  externalId: string;
  code: string;
  name: string;
  level: OrganizationHierarchyLevel;
  officialNetworkLengthKm?: number;
  children: OrganizationHierarchyNode[];
};

export type UnlinkedOrganizationHierarchyNode = Omit<OrganizationHierarchyNode, "children" | "officialNetworkLengthKm"> & {
  reason:
    | "ORGANIZATION_VERSION_MISSING_OR_INEFFECTIVE"
    | "DIVISION_VERSION_MISSING_OR_INEFFECTIVE"
    | "REPUBLIC_PARENT_MISSING_OR_INEFFECTIVE"
    | "REGION_CHAIN_MISSING_OR_INEFFECTIVE"
    | "ENTERPRISE_CHAIN_MISSING_OR_INEFFECTIVE";
};

export type AdminOrganizationHierarchy = {
  asOf: string;
  officialNetworkLengthKm: number;
  summary: {
    synchronizedRepublicCount: number;
    synchronizedRegionCount: number;
    synchronizedEnterpriseCount: number;
    synchronizedDivisionCount: number;
    unlinkedNodeCount: number;
    hierarchyComplete: boolean;
  };
  tree: OrganizationHierarchyNode[];
  unlinkedNodes: UnlinkedOrganizationHierarchyNode[];
};

export type FindingState = "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "DUPLICATE";

export type EvidenceMedia = {
  index: number;
  contentType: "image/jpeg" | "image/png" | "video/mp4";
  capturedAt: string;
  sha256: string;
  url: string;
  mediaId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type RoadVisionFinding = {
  id: string;
  vendorReference: string;
  attributeName: string;
  road: { code: string; name: string };
  division: { id: string; name: string };
  chainageStartM: number;
  chainageEndM?: number;
  laneLabel?: string;
  observedAt: string;
  receivedAt: string;
  state: FindingState;
  measuredQuantity?: { value: string; unit: string };
  evidence: EvidenceMedia[];
  reviewerNote?: string;
};

export type ConfirmedDefectState = "OPEN" | "PLANNED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | "CANCELLED";

export type ConfirmedDefect = {
  id: string;
  sourceKind: "ROADVISION" | "MANUAL_INSPECTION";
  sourceReference: string;
  road: { code: string; name: string };
  division: { id: string; name: string };
  observedAt: string;
  locationLabel: string;
  chainageStartM: number;
  chainageEndM: number;
  defectName: string;
  exactQuantity: { value: string; unit: string };
  state: ConfirmedDefectState;
};

export type ManualInspectionState = "DRAFT" | "PENDING_REVIEW" | "VERIFIED" | "REJECTED";

export type ManualInspectionObservation = {
  id: string;
  locationLabel: string;
  observedIssue: string;
  exactQuantity: { value: string; unit: string };
  laneLabel?: string;
  evidence: EvidenceMedia[];
};

export type ManualInspection = {
  id: string;
  inspectionNumber: string;
  road: { code: string; name: string };
  division: { id: string; name: string };
  observedDate: string;
  inspectorName: string;
  state: ManualInspectionState;
  observations: ManualInspectionObservation[];
  note?: string;
  reviewerNote?: string;
  submittedAt?: string;
  reviewedAt?: string;
};

export type ManualInspectionOptions = {
  roads: RoadOption[];
  workTopics: Array<{
    id: string;
    name: string;
    topicNumber: number;
  }>;
  measurementUnits: Array<{ value: string; label: string }>;
};

export type ManualInspectionInput = {
  roadId: string;
  iqnTopicId: string;
  observedDate: string;
  chainageStartM: string;
  exactQuantity: string;
  unit: string;
  note?: string;
  evidence?: Array<{
    objectUri: string;
    contentType: string;
    sha256: string;
    capturedAt: string;
    latitude?: string;
    longitude?: string;
  }>;
};

export type PlanningCandidate = {
  id: string;
  sourceReference: string;
  sourceKind: "ROADVISION" | "MANUAL_INSPECTION" | "ANNUAL_PROGRAM";
  road: { code: string; name: string };
  locationLabel: string;
  workName: string;
  exactQuantity: { value: string; unit: string } | null;
  normReference: string | null;
  verificationState: "VERIFIED" | "APPROVED";
};

export type PlanningBlocker = {
  code: string;
  title: string;
  explanation: string;
  resolution: string;
  candidateId?: string;
  level: "BLOCKING" | "NOTICE";
};

export type SafetySchemeCode =
  | "ROAD_SHOULDER_WORK"
  | "SINGLE_LANE_CLOSURE"
  | "HALF_ROAD_CLOSURE"
  | "ALTERNATING_TRAFFIC"
  | "FULL_CLOSURE";

export type SafetyScheme = {
  id: string;
  code: SafetySchemeCode;
  name: string;
  description: string;
  requiredSafetyWorkers: number;
  requiredSigns: number;
  requiredCones: number;
  requiredBarriers: number;
  requiresPermit: boolean;
};

export type PlanningWorkOption = {
  id: string;
  code: string;
  name: string;
  iqnTopicId: string | null;
  iqnTopicName: string | null;
  normReference: string;
  unit: string;
  requiredWorkers: number;
  laborMinutesPerUnit: number;
};

export type PlanningSourceDefect = {
  id: string;
  sourceReference: string;
  iqnTopic: {
    id: string | null;
    name: string;
  };
  location: {
    chainageStartM: string;
    chainageEndM: string;
  };
  measuredQuantity: {
    value: string;
    unit: string;
  };
};

export type PlanningWorkerOption = {
  id: string;
  fullName: string;
  positionName: string;
  skills: string[];
  availableMinutes: number;
};

export type PlanningOptions = {
  road: RoadOption;
  workVariants: PlanningWorkOption[];
  safetySchemes: SafetyScheme[];
  sourceDefects: PlanningSourceDefect[];
  workers: PlanningWorkerOption[];
};

export type ResourceCheck = {
  kind: "WORKERS" | "WORKER_TIME" | "EQUIPMENT" | "MATERIALS" | "SAFETY_EQUIPMENT" | "PERMIT";
  label: string;
  required: string;
  available: string;
  sufficient: boolean;
  detail?: string;
};

export type WorkerMinutesRemaining = {
  workerId: string;
  fullName: string;
  beforeMinutes: number;
  assignedMinutes: number;
  remainingMinutes: number;
};

export type ManualPlanInput = {
  sourceDefectId?: string;
  roadId: string;
  workVariantId: string;
  exactQuantity: string;
  chainageStartM: string;
  chainageEndM?: string | null;
  laneLabel?: string | null;
  direction?: string | null;
  scheduledDate: string;
  safetySchemeId: string;
  workerIds: string[];
  permitNumber?: string;
};

export type PlanningRunState = "DRAFT" | "EVALUATED" | "APPROVED" | "PUBLISHED" | "CANCELLED" | "SUPERSEDED";

export type PlanningRunSummary = {
  id: string;
  state: PlanningRunState;
  planningMode: "AUTOMATIC" | "MANUAL";
  dateFrom: string;
  dateTo: string;
  itemCount: number;
  blockerCount: number;
  createdAt: string;
  createdByName: string;
  createdByMe: boolean;
  canApprove: boolean;
  canPublish: boolean;
};

export type PlanPreview = {
  draftId: string;
  state: "AWAITING_APPROVAL" | "APPROVED" | "PUBLISHED";
  dateFrom: string;
  dateTo: string;
  planningMode: "AUTOMATIC" | "MANUAL";
  createdByName: string;
  createdAt: string;
  jobs: Array<{
    candidateId: string;
    workName: string;
    scheduledDate: string | null;
    teamName: string | null;
    laborHours: string;
    equipment: string[];
    materials: Array<{ name: string; quantity: string; unit: string }>;
  }>;
  blockers: PlanningBlocker[];
  resourceChecks: ResourceCheck[];
  workerMinutesRemaining: WorkerMinutesRemaining[];
  safetyScheme: SafetyScheme | null;
  resourcesReady: boolean;
  canApprove: boolean;
  canPublish: boolean;
};

export type WorkOrder = {
  id: string;
  number: string;
  workName: string;
  road: { code: string; name: string };
  locationLabel: string;
  scheduledDate: string;
  teamName: string;
  state: "DRAFT" | "ASSIGNED" | "IN_PROGRESS" | "PAUSED" | "COMPLETED" | "VERIFIED" | "CANCELLED";
  exactQuantity: { value: string; unit: string };
};

export type WorkOrderExecutionState = "PENDING_VERIFICATION" | "VERIFIED";

export type WorkOrderExecutionInput = {
  completedQuantity: string;
  unit: string;
  laborEntries: Array<{ workerId: string; workDate: string; actualMinutes: number }>;
  materialUsages: Array<{ materialReservationId: string; quantity: string; usedAt: string }>;
  equipmentUsages: Array<{ equipmentReservationId: string; usageDate: string; actualMachineMinutes: number }>;
  evidence: string[];
  note?: string;
};

export type WorkOrderCompletion = {
  id: string;
  state: WorkOrderExecutionState;
  actualQuantity: { value: string; unit: string };
  workerMinutes: Array<{ workerId: string; minutes: number }>;
  materials: Array<{ materialId: string; quantity: string; unit: string }>;
  equipment: Array<{ equipmentUnitId: string; machineMinutes: number }>;
  evidence: Array<{ url: string; mediaType: "image/jpeg" | "image/png" | "application/pdf" }>;
  note?: string;
  recordedAt: string;
  recordedByName: string;
  canVerify: boolean;
  verifiedAt?: string;
  verifiedByName?: string;
  verificationNote?: string;
};

export type WorkOrderDetail = WorkOrder & {
  normReference: string;
  startedAt?: string;
  startedByName?: string;
  executionResources: {
    workers: Array<{ id: string; fullName: string; positionName: string; workDate: string; plannedMinutes: number }>;
    materials: Array<{ id: string; reservationId: string; code: string; name: string; unit: string; usedAt: string; plannedQuantity: string }>;
    equipment: Array<{ id: string; reservationId: string; inventoryCode: string; name: string; usageDate: string; plannedMachineMinutes: number }>;
  };
  completion: WorkOrderCompletion | null;
};

export type MonthlyCompletionActState = "DRAFT" | "SUBMITTED" | "APPROVED";

export type MonthlyCompletionActSummary = {
  id: string;
  divisionId: string;
  actNumber: string;
  actMonth: string;
  divisionName: string;
  roadLabel: string;
  state: MonthlyCompletionActState;
  createdByMe: boolean;
  submittedByMe: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  itemCount: number;
  laborAmountUzs: string;
  socialAmountUzs: string;
  materialAmountUzs: string;
  equipmentAmountUzs: string;
  totalAmountUzs: string;
  createdAt: string;
  submittedAt?: string;
  approvedAt?: string;
};

export type MonthlyCompletionAct = MonthlyCompletionActSummary & {
  items: Array<{
    id: string;
    workOrderId: string;
    orderNumber: string;
    workName: string;
    normReference: string;
    completedQuantity: { value: string; unit: string };
    iqnLaborNorm: {
      normSetId: string;
      normLineIds: string[];
      basisQuantity: { value: string; unit: string };
      minutesPerBasis: string;
      minutesPerUnit: string;
      totalMinutes: string;
    } | null;
    laborAmountUzs: string;
    socialAmountUzs: string;
    materialAmountUzs: string;
    equipmentAmountUzs: string;
    totalAmountUzs: string;
  }>;
};

export type CostRateKind = "labor" | "material" | "equipment";
export type CostRateStatus = "DRAFT" | "APPROVED";

export type CostRate = {
  id: string;
  divisionId: string;
  rateKind: CostRateKind;
  target: { id: string; code?: string; name: string };
  rateBasis: "monthly_salary" | "material_unit" | "machine_hour";
  pricingUnit: string;
  rateAmountUzs: string;
  scheduleCode?: string;
  bonusRateBps: number;
  trafficAllowanceRateBps: number;
  travelAllowanceRateBps: number;
  socialContributionRateBps: number;
  effectiveFrom: string;
  effectiveUntil: string;
  sourceReference: string;
  versionNo: number;
  state: CostRateStatus;
  createdByMe: boolean;
  canApprove: boolean;
  createdAt: string;
  approvedAt?: string;
};

export type CostRateInput = {
  divisionId: string;
  rateKind: CostRateKind;
  targetId: string;
  rateBasis: CostRate["rateBasis"];
  pricingUnit: string;
  rateAmountUzs: string;
  scheduleCode?: string;
  bonusRateBps?: number;
  trafficAllowanceRateBps?: number;
  travelAllowanceRateBps?: number;
  socialContributionRateBps?: number;
  effectiveFrom: string;
  effectiveUntil: string;
  versionNo: number;
  sourceReference: string;
};

export type MonthlyWorkTimeNorm = {
  id: string;
  divisionId: string;
  workMonth: string;
  scheduleCode: string;
  workingDays: number;
  normMinutes: number;
  sourceReference: string;
  versionNo: number;
  state: CostRateStatus;
  createdByMe: boolean;
  canApprove: boolean;
  createdAt: string;
  approvedAt?: string;
};

export type MonthlyWorkTimeNormInput = {
  divisionId: string;
  workMonth: string;
  scheduleCode: string;
  workingDays: number;
  normMinutes: number;
  versionNo: number;
  sourceReference: string;
};

export type AnnualProgramLine = {
  id: string;
  programId: string;
  year: number;
  road: { code: string; name: string };
  workName: string;
  normReference: string;
  quantity: { planned: string; completed: string; unit: string };
  laborHours: { required: string; completed: string };
  approvalState: "DRAFT" | "APPROVED" | "CLOSED";
};

export type IntegrationReadiness = {
  code: "ROAD_REPAIR_POINT" | "ROADVISION" | "SUPABASE";
  name: string;
  supplies: string[];
  state: "READY" | "NEEDS_CONFIGURATION" | "SYNCING" | "ERROR" | "DISABLED";
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;
  message: string;
  requiredActions: string[];
};

export type ResourceRow = {
  id: string;
  name: string;
  code?: string;
  divisionName?: string;
  detail: string;
  stateLabel: string;
  unit?: string | null;
};

export type RoadOption = {
  id: string;
  code: string;
  name: string;
  divisionName: string;
  lengthM: number;
};

export type MapCoordinate = [longitude: number, latitude: number];

export type MapFeature = {
  id: string;
  layer: "ELEMENT" | "DEFECT" | "WORK_ZONE";
  locationLabel: string;
  kindLabel: string;
  stateLabel: string;
  latitude: number;
  longitude: number;
  chainageStartM?: number;
  chainageEndM?: number;
};

export type RoadMapData = {
  road: {
    id: string;
    code: string;
    name: string;
    lengthM: number;
    geometry: {
      type: "LineString";
      coordinates: MapCoordinate[];
    };
    bounds: [southWest: MapCoordinate, northEast: MapCoordinate];
    chainageMarkers: Array<{
      chainageM: number;
      label: string;
      latitude: number;
      longitude: number;
    }>;
  };
  layers: {
    elements: MapFeature[];
    defects: MapFeature[];
    workZones: MapFeature[];
  };
};

export type TimesheetDayState = "WORK" | "LEAVE" | "SICK" | "ABSENT" | "REST" | "OUTSIDE_ASSIGNMENT";

export type MonthlyTimesheetEntry = {
  day: number;
  minutes: number;
  state: TimesheetDayState;
};

export type MonthlyTimesheetRow = {
  workerId: string;
  fullName: string;
  personnelNumber?: string;
  positionName: string;
  entries: MonthlyTimesheetEntry[];
  totalMinutes: number;
};

export type MonthlyTimesheet = {
  year: number;
  month: number;
  daysInMonth: number;
  divisionName: string;
  rows: MonthlyTimesheetRow[];
};

export type Paged<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};
