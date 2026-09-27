import type {WorkGuide,WorkGuideInput} from "./work-guides";
import type { ExcelReport } from "./excel-report";
import type { CostLedger } from './cost-ledger';
import type { PayrollAdjustment, PayrollSnapshot, PayrollHistoryRow } from "./payroll";
import type { WorkerEquipmentCard, WorkerEquipmentIssue } from "./worker-equipment";
import type {
  AIWorkRecommendation,
  DefectParameters,
  AdminNetworkSummary,
  AdminOrganizationHierarchy,
  AnnualProgramLine,
  ApiEnvelope,
  ApiProblem,
  ConfirmedDefect,
  ConfirmedDefectState,
  CostRate,
  CostRateInput,
  RoadMapData,
  DashboardSummary,
  IntegrationReadiness,
  ManualInspection,
  ManualInspectionInput,
  InspectionEvidenceUpload,
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
  MfaChallenge,
  RoadVisionFinding,
  User,
  WorkOrder,
  WorkOrderDetail,
  WorkOrderExecutionInput,
  WorkOrderEvidenceUpload,
} from "./types";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api/v1").replace(/\/$/, "");
const FIXTURES_ENABLED = process.env.NEXT_PUBLIC_E2E_FIXTURES === "true";
const ALL_PAGES_PAGE_SIZE = 100;
const ALL_PAGES_SAFETY_LIMIT = 1_000;

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  csrf?: boolean;
  idempotent?: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, string[]>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function cookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  const match = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

function idempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function fixtureRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const fixtureModule = await import("./fixtures");
  return fixtureModule.handleFixtureRequest<T>(path, options);
}

async function httpRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Requested-With", "XMLHttpRequest");

  const multipart = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body !== undefined && !multipart) headers.set("Content-Type", "application/json");

  if (options.csrf) {
    let token = cookieValue("roadops_csrf");
    if (!token) {
      const response = await fetch(`${API_BASE}/auth/csrf`, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      });
      const payload = (await response.json()) as ApiEnvelope<{ csrfToken: string }> | ApiProblem;
      if (!response.ok || !("data" in payload) || !payload.data) {
        throw new ApiError("Himoya kalitini olish imkoni bo‘lmadi.", response.status, "CSRF_BOOTSTRAP_FAILED");
      }
      token = payload.data.csrfToken;
    }
    headers.set("X-CSRF-Token", token);
  }

  if (options.idempotent && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    headers.set("Idempotency-Key", idempotencyKey());
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    method,
    headers,
    credentials: "include",
    cache: "no-store",
    body: options.body === undefined ? undefined : multipart ? options.body as FormData : JSON.stringify(options.body),
  });

  if (response.status === 204) return undefined as T;

  const payload = (await response.json()) as ApiEnvelope<T> | ApiProblem;
  if (!response.ok || "error" in payload) {
    const problem = "error" in payload ? payload.error : undefined;
    throw new ApiError(
      problem?.message ?? "So‘rovni bajarib bo‘lmadi.",
      response.status,
      problem?.code ?? "REQUEST_FAILED",
      problem?.details,
      problem?.requestId ?? response.headers.get("X-Request-Id") ?? undefined,
    );
  }
  return payload.data;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (FIXTURES_ENABLED) return fixtureRequest<T>(path, options);
  return httpRequest<T>(path, options);
}

function paginationPath(path: string, page: number, pageSize: number): string {
  const [pathname, query = ""] = path.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return `${pathname}?${params.toString()}`;
}

function malformedPagination(message: string): ApiError {
  return new ApiError(message, 502, "MALFORMED_PAGINATION");
}

async function fetchAllPages<T>(path: string): Promise<Paged<T>> {
  const items: T[] = [];

  for (let requestedPage = 1; requestedPage <= ALL_PAGES_SAFETY_LIMIT; requestedPage += 1) {
    const page = await request<Paged<T>>(paginationPath(path, requestedPage, ALL_PAGES_PAGE_SIZE));

    if (
      !page
      || !Array.isArray(page.items)
      || !Number.isSafeInteger(page.page)
      || !Number.isSafeInteger(page.pageSize)
      || !Number.isSafeInteger(page.total)
      || page.page !== requestedPage
      || page.pageSize <= 0
      || page.total < 0
      || page.items.length > page.pageSize
    ) {
      throw malformedPagination("Server sahifalash bo‘yicha yaroqsiz javob qaytardi.");
    }

    if (items.length + page.items.length > page.total) {
      throw malformedPagination("Server sahifalash jami bilan mos kelmaydigan yozuvlarni qaytardi.");
    }

    const isLastPage = page.page * page.pageSize >= page.total;
    if (page.items.length === 0 && !isLastPage) {
      throw malformedPagination("Server keyingi sahifaga o‘tishda yozuv qaytarmadi.");
    }

    items.push(...page.items);

    if (isLastPage) {
      if (items.length !== page.total) {
        throw malformedPagination("Server sahifalash yakunida barcha yozuvlarni qaytarmadi.");
      }

      return {
        items,
        page: 1,
        pageSize: Math.max(items.length, 1),
        total: page.total,
      };
    }
  }

  throw new ApiError(
    "Yozuvlar soni xavfsiz sahifalash chegarasidan oshdi.",
    502,
    "PAGINATION_SAFETY_LIMIT_EXCEEDED",
  );
}

export const api = {
  workGuides: (workVariantId:string,roadUnitId:string) => request<{items:WorkGuide[];canManage:boolean}>(`/work-guides?${new URLSearchParams({workVariantId,roadUnitId})}`),
  addWorkGuide: (input:WorkGuideInput) => {const body=new FormData();body.append('workVariantId',input.workVariantId);body.append('roadUnitId',input.roadUnitId);body.append('title',input.title);body.append('kind',input.kind);if(input.file)body.append('file',input.file);if(input.url)body.append('url',input.url);return request<WorkGuide>('/work-guides',{method:'POST',body,csrf:true,idempotent:true});},
  deleteWorkGuide:(id:string,roadUnitId:string)=>request<{id:string;deleted:boolean}>(`/work-guides/${encodeURIComponent(id)}?${new URLSearchParams({roadUnitId})}`,{method:'DELETE',csrf:true,idempotent:true}),

  fixturesEnabled: FIXTURES_ENABLED,
  demoRole: (role: "chief" | "engineer" | "foreman") => request<User>("/demo/role", {method:"POST",body:{role}}),
  demoReceive: (id:string) => request<ResourceRequisition>(`/demo/requisitions/${encodeURIComponent(id)}/receive`, {method:"POST"}),
  demoClosures: () => request<Array<{id:string;number:string;location:string;date:string;from?:string;to?:string;access:string;state:string;externalSent:boolean;roadCode?:string;direction?:string;laneLabel?:string}>>("/demo/closures"),
  login: (email: string, password: string, totpCode?: string) =>
    request<User | MfaChallenge>("/auth/login", { method: "POST", body: { email, password, ...(totpCode ? { totpCode } : {}) }, idempotent: true }),
  me: () => request<User>("/auth/me"),
  logout: () => request<void>("/auth/logout", { method: "POST", csrf: true, idempotent: true }),
  dashboard: () => request<DashboardSummary>("/dashboard/summary"),
  adminNetworkSummary: () => request<AdminNetworkSummary>("/admin/network-summary"),
  adminOrganizationHierarchy: () => request<AdminOrganizationHierarchy>("/admin/organization-hierarchy"),
  findings: (state = "PENDING_REVIEW") =>
    fetchAllPages<RoadVisionFinding>(`/roadvision/findings?state=${encodeURIComponent(state)}`),
  decideFinding: (
    id: string,
    decision: "VERIFIED" | "REJECTED" | "DUPLICATE",
    note: string,
    measuredQuantity?: { value: string; unit: string },
    parameters?: DefectParameters,
    defectTypeId?: string,
    roadElementId?:string,
  ) =>
    request<RoadVisionFinding>(`/roadvision/findings/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: { decision, note, ...(measuredQuantity ? { measuredQuantity } : {}), ...(parameters?{parameters}:{}), ...(defectTypeId?{defectTypeId}:{}),...(roadElementId?{roadElementId}:{}) },
      csrf: true,
      idempotent: true,
    }),
  confirmedDefects: (state: ConfirmedDefectState = "OPEN") =>
    fetchAllPages<ConfirmedDefect>(`/defects?state=${encodeURIComponent(state)}`),
  manualInspections: (state: ManualInspectionState) =>
    fetchAllPages<ManualInspection>(`/manual-inspections?state=${encodeURIComponent(state)}`),
  uploadInspectionEvidence: async (file: File): Promise<InspectionEvidenceUpload> => {
    if (!['image/jpeg','image/png','video/mp4'].includes(file.type) || !file.size || file.size > 20*1024*1024) throw new Error('JPEG, PNG yoki MP4 fayl tanlang. Hajmi 20 MB dan oshmasin.');
    if (FIXTURES_ENABLED) {
      const {saveBrowserFile} = await import('../browser-files');
      const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
      return {objectUri:await saveBrowserFile(file),contentType:file.type,sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),capturedAt:new Date().toISOString()};
    }
    const body = new FormData(); body.append('file',file);
    return request<InspectionEvidenceUpload>('/manual-inspections/evidence',{method:'POST',body,csrf:true});
  },
  uploadWorkOrderEvidence: (orderId:string,file:File) => {
    const body=new FormData();body.append('file',file);
    return request<WorkOrderEvidenceUpload>(`/work-orders/${encodeURIComponent(orderId)}/evidence`,{method:'POST',body,csrf:true});
  },
  manualInspectionOptions: () => request<ManualInspectionOptions>("/manual-inspections/options"),
  submitManualInspection: (id: string) =>
    request<ManualInspection>(`/manual-inspections/${encodeURIComponent(id)}/submit`, {
      method: "POST",
      csrf: true,
      idempotent: true,
    }),
  decideManualInspection: (id: string, decision: "VERIFIED" | "REJECTED", note: string, roadElementId?: string) =>
    request<ManualInspection>(`/manual-inspections/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: { decision, note, roadElementId },
      csrf: true,
      idempotent: true,
    }),
  planningCandidates: () => fetchAllPages<PlanningCandidate>("/planning/candidates"),
  planningOptions: (roadId: string, scheduledDate?: string, replacesDraftId?: string) => {
    const params = new URLSearchParams({ roadId });
    if (scheduledDate) params.set("scheduledDate", scheduledDate);
    if (replacesDraftId) params.set("replacesDraftId", replacesDraftId);
    return request<PlanningOptions>(`/planning/options?${params.toString()}`);
  },
  previewPlan: (candidateIds: string[], dateFrom: string, dateTo: string) =>
    request<PlanPreview>("/planning/preview", {
      method: "POST",
      body: { candidateIds, dateFrom, dateTo },
      csrf: true,
      idempotent: true,
    }),
  aiWorkRecommendation: (sourceDefectId:string,scheduledDate:string,parameters?:DefectParameters,resourcePlan?:ManualPlanInput["resourcePlan"],inspectionNote='',signal?:AbortSignal) => request<AIWorkRecommendation>("/planning/ai/recommendation",{method:"POST",body:{sourceDefectId,scheduledDate,parameters,resourcePlan,inspectionNote,...(FIXTURES_ENABLED?{useAI:true}:{})},csrf:true,signal}),
  importRoadVisionDemo: () => request<{added:number;duplicates:number}>("/roadvision/demo/import",{method:"POST",body:{batchId:"roadvision-demo-iqn-v1"},csrf:true,idempotent:true}),
  previewManualPlan: (payload: ManualPlanInput) =>
    request<PlanPreview>("/planning/manual/preview", {
      method: "POST",
      body: payload,
      csrf: true,
      idempotent: true,
    }),
  plans: () => fetchAllPages<PlanningRunSummary>("/planning/plans"),
  plan: (draftId: string) =>
    request<PlanPreview>(`/planning/plans/${encodeURIComponent(draftId)}`),
  approvePlan: (draftId: string) =>
    request<{ planId: string; state: "APPROVED" }>(`/planning/plans/${encodeURIComponent(draftId)}/approve`, {
      method: "POST",
      csrf: true,
      idempotent: true,
    }),
  publishPlan: (draftId: string) =>
    request<{ planId: string; state?: "PUBLISHED" }>(`/planning/plans/${encodeURIComponent(draftId)}/publish`, {
      method: "POST",
      csrf: true,
      idempotent: true,
    }),
  requestPlanResources: (draftId: string) => request<PlanPreview>(`/planning/plans/${encodeURIComponent(draftId)}/resources/request`, { method: "POST", body: {}, csrf: true, idempotent: true }),
  recheckPlanResources: (draftId: string) => request<PlanPreview>(`/planning/plans/${encodeURIComponent(draftId)}/resources/recheck`, { method: "POST", body: {}, csrf: true, idempotent: true }),
  resourceRequisitions: () => fetchAllPages<ResourceRequisition>("/resource-requisitions"),
  decideResourceRequisition: (id: string, decision: "APPROVE" | "REJECT", note: string) => request<ResourceRequisition>(`/resource-requisitions/${encodeURIComponent(id)}/decision`, { method: "POST", body: { decision, note }, csrf: true, idempotent: true }),
  workerEquipment: (id: string) => request<WorkerEquipmentCard>(`/workers/${encodeURIComponent(id)}/equipment`),
  issueWorkerEquipment: (id: string, payload: WorkerEquipmentIssue) => request<{ id: string }>(`/workers/${encodeURIComponent(id)}/equipment`, { method: "POST", body: payload, csrf: true, idempotent: true }),
  planInput: (id:string) => request<ManualPlanInput>(`/planning/plans/${encodeURIComponent(id)}/input`),
  reportMonths: () => request<{items:Array<{period:string;count:number}>}>("/reports/months"),
  excelReport: (query:{id?:string;period?:string}) => request<ExcelReport>(`/reports/excel-data?${new URLSearchParams(query as Record<string,string>)}`),
  payrollWorksheet: (period: string) => request<{snapshot:PayrollSnapshot|null; workers:Array<{id:string;fullName:string;positionName:string}>}>(`/payroll/worksheet?period=${encodeURIComponent(period)}`),
  payrollPreview: (divisionId: string, period: string, policyReference: string, adjustments: PayrollAdjustment[]) => request<PayrollSnapshot>("/payroll/preview", { method: "POST", body: { divisionId, period, policyReference, adjustments }, csrf: true, idempotent: true }),
  payrollHistory: (period: string) => fetchAllPages<PayrollHistoryRow>(`/payroll/history?period=${encodeURIComponent(period)}`),
  payrollSnapshot: (id: string) => request<PayrollSnapshot>(`/payroll/${encodeURIComponent(id)}`),
  generateAnnualProgram: (year: number) => request<{ programId: string; year: number; state: string; lineCount: number; reused: boolean; coverage: { inventoryElements: number; mappedElements: number; unmappedElements: number } }>("/annual-programs/generate", { method: "POST", body: { year }, csrf: true, idempotent: true }),
  approveAnnualProgram: (id: string) => request<{programId: string; state: string}>(`/annual-programs/${encodeURIComponent(id)}/approve`, { method: "POST", body: {}, csrf: true, idempotent: true }),
  workOrders: () => fetchAllPages<WorkOrder>("/work-orders"),
  workOrder: (id: string) => request<WorkOrderDetail>(`/work-orders/${encodeURIComponent(id)}`),
  cancelWorkOrder:(id:string)=>request<WorkOrderDetail>(`/work-orders/${encodeURIComponent(id)}/cancel`,{method:'POST',body:{},csrf:true}),
  rescheduleWorkOrder: (id: string, scheduledDate: string) =>
    request<WorkOrderDetail>(`/work-orders/${encodeURIComponent(id)}/reschedule`, {
      method: "POST",
      body: { scheduledDate },
      csrf: true,
      idempotent: true,
    }),
  startWorkOrder: (id: string) =>
    request<WorkOrderDetail>(`/work-orders/${encodeURIComponent(id)}/start`, {
      method: "POST",
      body: {},
      csrf: true,
      idempotent: true,
    }),
  completeWorkOrder: (id: string, payload: WorkOrderExecutionInput) =>
    request<WorkOrderDetail>(`/work-orders/${encodeURIComponent(id)}/complete`, {
      method: "POST",
      body: payload,
      csrf: true,
      idempotent: true,
    }),
  verifyWorkOrder: (id: string, note: string) =>
    request<WorkOrderDetail>(`/work-orders/${encodeURIComponent(id)}/verify`, {
      method: "POST",
      body: { note },
      csrf: true,
      idempotent: true,
    }),
  returnWorkOrder: (id: string, note: string) => request<WorkOrderDetail>(`/work-orders/${encodeURIComponent(id)}/return`, {method: "POST", body: {note}, csrf: true, idempotent: true}),
  monthlyCompletionActs: (actMonth: string) =>
    fetchAllPages<MonthlyCompletionActSummary>(`/monthly-completion-acts?actMonth=${encodeURIComponent(actMonth)}`),
  costLedger: (period:string) => request<CostLedger>(`/cost-ledger?period=${encodeURIComponent(period)}`),
  monthlyCompletionAct: (id: string) =>
    request<MonthlyCompletionAct>(`/monthly-completion-acts/${encodeURIComponent(id)}`),
  generateMonthlyCompletionAct: (divisionId: string, actMonth: string) =>
    request<MonthlyCompletionAct>("/monthly-completion-acts", {
      method: "POST",
      body: { divisionId, actMonth },
      csrf: true,
      idempotent: true,
    }),
  submitMonthlyCompletionAct: (id: string) =>
    request<MonthlyCompletionAct>(`/monthly-completion-acts/${encodeURIComponent(id)}/submit`, {
      method: "POST",
      body: {},
      csrf: true,
      idempotent: true,
    }),
  approveMonthlyCompletionAct: (id: string) =>
    request<MonthlyCompletionAct>(`/monthly-completion-acts/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: {},
      csrf: true,
      idempotent: true,
    }),
  monthlyCompletionActExportUrl: (id: string) =>
    `${API_BASE}/monthly-completion-acts/${encodeURIComponent(id)}/export.xlsx`,
  costRates: () => fetchAllPages<CostRate>("/cost-rates"),
  createCostRate: (payload: CostRateInput) =>
    request<CostRate>("/cost-rates", {
      method: "POST",
      body: payload,
      csrf: true,
      idempotent: true,
    }),
  approveCostRate: (id: string) =>
    request<CostRate>(`/cost-rates/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: {},
      csrf: true,
      idempotent: true,
    }),
  monthlyWorkTimeNorms: (month: string) =>
    fetchAllPages<MonthlyWorkTimeNorm>(`/monthly-work-time-norms?workMonth=${encodeURIComponent(`${month}-01`)}`),
  createMonthlyWorkTimeNorm: (payload: MonthlyWorkTimeNormInput) =>
    request<MonthlyWorkTimeNorm>("/monthly-work-time-norms", {
      method: "POST",
      body: payload,
      csrf: true,
      idempotent: true,
    }),
  approveMonthlyWorkTimeNorm: (id: string) =>
    request<MonthlyWorkTimeNorm>(`/monthly-work-time-norms/${encodeURIComponent(id)}/approve`, {
      method: "POST",
      body: {},
      csrf: true,
      idempotent: true,
    }),
  budgetProgram:(year:number)=>request<ReturnType<typeof import('../funding/annual').annualView>&{years:number[];revisions:{id:string;year:number;revision:number;state:string;approvedAt:string;total:number}[]}>(`/budget-programs?year=${year}`),
  approveBudget:(snapshot:import('../funding/types').AssetSnapshot,policy:import('../funding/types').FundingPolicy,limit:number|null)=>request<{program:import('../funding/annual').BudgetProgram;reused:boolean}>('/budget-programs/approve',{method:'POST',body:{snapshot,policy,limit},csrf:true}),
  assetInventory:()=>request<import('../funding/types').AssetSnapshot>('/asset-inventory'),
  saveAssetInventory:(snapshot:import('../funding/types').AssetSnapshot)=>request<import('../funding/types').AssetSnapshot>('/asset-inventory',{method:'POST',body:snapshot,csrf:true}),
  allocateBudgetMonths:(year:number,lineId:string,monthly:number[])=>request<import('../funding/annual').BudgetProgram>('/budget-programs/months',{method:'POST',body:{year,lineId,monthly},csrf:true}),
  annualProgram: (year: number) => fetchAllPages<AnnualProgramLine>(`/annual-programs?year=${year}`),
  integrations: () => request<IntegrationReadiness[]>("/integrations/readiness"),
  syncIntegration: (code: IntegrationReadiness["code"]) =>
    request<IntegrationReadiness>(`/integrations/${encodeURIComponent(code)}/sync`, {
      method: "POST",
      csrf: true,
      idempotent: true,
    }),
  resources: (kind: "workers" | "equipment" | "warehouse" | "materials" | "timesheets") =>
    fetchAllPages<ResourceRow>(`/resources/${kind}`),
  monthlyTimesheet: (year: number, month: number) =>
    request<MonthlyTimesheet>(`/timesheets/monthly?year=${year}&month=${month}`),
  roads: () => fetchAllPages<RoadOption>("/roads?active=true"),
  submitInspection: (payload: ManualInspectionInput) =>
    request<{ id: string }>("/manual-inspections", {
      method: "POST",
      body: payload,
      csrf: true,
      idempotent: true,
    }),
  mapData: (roadId: string) => request<RoadMapData>(`/map/records?roadId=${encodeURIComponent(roadId)}`),
  settings: () => request<Record<string, string>>("/settings"),
  saveSettings: (payload: Record<string, string>) =>
    request<Record<string, string>>("/settings", {
      method: "PATCH",
      body: payload,
      csrf: true,
      idempotent: true,
    }),
};
