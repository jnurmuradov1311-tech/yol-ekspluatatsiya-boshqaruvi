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

export type FindingState = "PENDING_REVIEW" | "VERIFIED" | "REJECTED" | "DUPLICATE";

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
  evidenceUrl?: string;
  evidenceMediaType?: "image/jpeg" | "image/png" | "video/mp4";
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
  defectTypes: Array<{
    id: string;
    code: string;
    name: string;
    unit: string;
  }>;
};

export type ManualInspectionInput = {
  roadId: string;
  defectTypeId: string;
  observedDate: string;
  chainageStartM: string;
  chainageEndM?: string;
  direction?: string;
  laneLabel?: string;
  observedIssue: string;
  exactQuantity: string;
  unit: string;
  note?: string;
  evidence?: Array<{
    objectUri: string;
    contentType: string;
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
  normReference: string;
  unit: string;
  requiredWorkers: number;
  laborMinutesPerUnit: number;
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
  roadId: string;
  workVariantId: string;
  exactQuantity: string;
  chainageStartM: string;
  chainageEndM: string;
  laneLabel: string;
  direction: string;
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
  state: "DRAFT" | "ASSIGNED" | "IN_PROGRESS" | "PAUSED" | "COMPLETED" | "CANCELLED";
  exactQuantity: { value: string; unit: string };
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
