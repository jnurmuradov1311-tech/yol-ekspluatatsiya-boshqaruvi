import type {
  AnnualProgramLine,
  ApiEnvelope,
  ApiProblem,
  ConfirmedDefect,
  ConfirmedDefectState,
  RoadMapData,
  DashboardSummary,
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
  MfaChallenge,
  RoadVisionFinding,
  User,
  WorkOrder,
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

  if (options.body !== undefined) headers.set("Content-Type", "application/json");

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
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
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
  fixturesEnabled: FIXTURES_ENABLED,
  login: (email: string, password: string, totpCode?: string) =>
    request<User | MfaChallenge>("/auth/login", { method: "POST", body: { email, password, ...(totpCode ? { totpCode } : {}) }, idempotent: true }),
  me: () => request<User>("/auth/me"),
  logout: () => request<void>("/auth/logout", { method: "POST", csrf: true, idempotent: true }),
  dashboard: () => request<DashboardSummary>("/dashboard/summary"),
  findings: (state = "PENDING_REVIEW") =>
    fetchAllPages<RoadVisionFinding>(`/roadvision/findings?state=${encodeURIComponent(state)}`),
  decideFinding: (
    id: string,
    decision: "VERIFIED" | "REJECTED" | "DUPLICATE",
    note: string,
    measuredQuantity?: { value: string; unit: string },
  ) =>
    request<RoadVisionFinding>(`/roadvision/findings/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: { decision, note, ...(measuredQuantity ? { measuredQuantity } : {}) },
      csrf: true,
      idempotent: true,
    }),
  confirmedDefects: (state: ConfirmedDefectState = "OPEN") =>
    fetchAllPages<ConfirmedDefect>(`/defects?state=${encodeURIComponent(state)}`),
  manualInspections: (state: ManualInspectionState) =>
    fetchAllPages<ManualInspection>(`/manual-inspections?state=${encodeURIComponent(state)}`),
  manualInspectionOptions: () => request<ManualInspectionOptions>("/manual-inspections/options"),
  submitManualInspection: (id: string) =>
    request<ManualInspection>(`/manual-inspections/${encodeURIComponent(id)}/submit`, {
      method: "POST",
      csrf: true,
      idempotent: true,
    }),
  decideManualInspection: (id: string, decision: "VERIFIED" | "REJECTED", note: string) =>
    request<ManualInspection>(`/manual-inspections/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: { decision, note },
      csrf: true,
      idempotent: true,
    }),
  planningCandidates: () => fetchAllPages<PlanningCandidate>("/planning/candidates"),
  planningOptions: (roadId: string, scheduledDate?: string) => {
    const params = new URLSearchParams({ roadId });
    if (scheduledDate) params.set("scheduledDate", scheduledDate);
    return request<PlanningOptions>(`/planning/options?${params.toString()}`);
  },
  previewPlan: (candidateIds: string[], dateFrom: string, dateTo: string) =>
    request<PlanPreview>("/planning/preview", {
      method: "POST",
      body: { candidateIds, dateFrom, dateTo },
      csrf: true,
      idempotent: true,
    }),
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
  workOrders: () => fetchAllPages<WorkOrder>("/work-orders"),
  annualProgram: (year: number) => fetchAllPages<AnnualProgramLine>(`/annual-programs?year=${year}`),
  integrations: () => request<IntegrationReadiness[]>("/integrations/readiness"),
  syncIntegration: (code: IntegrationReadiness["code"]) =>
    request<IntegrationReadiness>(`/integrations/${encodeURIComponent(code)}/sync`, {
      method: "POST",
      csrf: true,
      idempotent: true,
    }),
  resources: (kind: "workers" | "equipment" | "warehouse" | "timesheets") =>
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
