import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./client";
import type { ManualInspectionInput } from "./types";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

describe("API client security headers", () => {
  beforeEach(() => {
    document.cookie = "roadops_csrf=; Max-Age=0; path=/";
    vi.restoreAllMocks();
  });

  it("logs in without a CSRF bootstrap request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: { id: "u1", fullName: "User", roleLabel: "Operator", permissions: [], globalPermissions: [] } }));
    await api.login("user@example.uz", "secret");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/v1/auth/login");
    expect(new Headers(options?.headers).has("X-CSRF-Token")).toBe(false);
    expect(new Headers(options?.headers).has("Idempotency-Key")).toBe(true);
    expect(options?.credentials).toBe("include");
  });

  it("returns the TOTP challenge from an accepted login request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: { mfaRequired: true, factorType: "totp" } }, 202));
    await expect(api.login("user@example.uz", "secret")).resolves.toEqual({ mfaRequired: true, factorType: "totp" });
  });

  it("sends the six digit TOTP value on the second login step", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: { id: "u1", fullName: "User", roleLabel: "Operator", permissions: [], globalPermissions: [] } }));
    await api.login("user@example.uz", "secret", "123456");
    const [, options] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(options?.body))).toMatchObject({ totpCode: "123456" });
  });

  it("sends the readable CSRF cookie and a unique write key on review decisions", async () => {
    document.cookie = "roadops_csrf=test-csrf; path=/";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: { id: "f1" } }));
    await api.decideFinding("f1", "VERIFIED", "dalil tekshirildi", { value: "12.4", unit: "m²" });
    const [, options] = fetchMock.mock.calls[0]!;
    const headers = new Headers(options?.headers);
    expect(headers.get("X-CSRF-Token")).toBe("test-csrf");
    expect(headers.get("Idempotency-Key")).toBeTruthy();
    expect(JSON.parse(String(options?.body))).toMatchObject({
      decision: "VERIFIED",
      measuredQuantity: { value: "12.4", unit: "m²" },
    });
  });

  it("preserves backend error details and request id", async () => {
    document.cookie = "roadops_csrf=test-csrf; path=/";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: { code: "INVALID_INPUT", message: "Maydon xato", details: { roadId: ["Majburiy"] }, requestId: "req-41" } }, 422));
    const payload = {
      roadId: "road-1",
      iqnTopicId: "02000000-0000-4000-8000-000000000002",
      observedDate: "2026-08-12",
      chainageStartM: "1250",
      exactQuantity: "2.5",
      unit: "m2",
    } satisfies ManualInspectionInput;
    await expect(api.submitInspection(payload)).rejects.toMatchObject({ status: 422, code: "INVALID_INPUT", requestId: "req-41" } satisfies Partial<ApiError>);
  });

  it("sends an explicit synchronized road to planning and map reads", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => jsonResponse({ data: {} }));
    const roadId = "2af83950-92b8-4e69-9891-5b590b413f52";

    await api.planningOptions(roadId, "2026-08-14");
    await api.mapData(roadId);

    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/v1/planning/options?roadId=${roadId}&scheduledDate=2026-08-14`);
    expect(String(fetchMock.mock.calls[1]![0])).toBe(`/api/v1/map/records?roadId=${roadId}`);
  });

  it("reschedules a work order through the protected execution endpoint", async () => {
    document.cookie = "roadops_csrf=test-csrf; path=/";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: {} }));
    const orderId = "11111111-1111-4111-8111-111111111111";

    await api.rescheduleWorkOrder(orderId, "2026-08-19");

    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`/api/v1/work-orders/${orderId}/reschedule`);
    expect(options?.method).toBe("POST");
    expect(new Headers(options?.headers).get("X-CSRF-Token")).toBe("test-csrf");
    expect(JSON.parse(String(options?.body))).toEqual({ scheduledDate: "2026-08-19" });
  });

  it("reads persisted planning handoff lists and details", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "http://roadops.local");
      if (url.pathname.endsWith("/planning/plans")) {
        return jsonResponse({ data: { items: [], page: 1, pageSize: 100, total: 0 } });
      }
      return jsonResponse({ data: {} });
    });
    const planId = "11111111-1111-4111-8111-111111111111";

    await api.plans();
    await api.plan(planId);

    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/v1/planning/plans?page=1&pageSize=100");
    expect(String(fetchMock.mock.calls[1]![0])).toBe(`/api/v1/planning/plans/${planId}`);
  });

  it("preserves filters and aggregates every server page", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "http://roadops.local");
      const requestedPage = Number(url.searchParams.get("page"));
      const items = requestedPage === 1
        ? [{ id: "finding-1" }, { id: "finding-2" }]
        : [{ id: "finding-3" }];
      return jsonResponse({ data: { items, page: requestedPage, pageSize: 2, total: 3 } });
    });

    const result = await api.findings("VERIFIED");

    expect(result).toMatchObject({
      items: [{ id: "finding-1" }, { id: "finding-2" }, { id: "finding-3" }],
      page: 1,
      pageSize: 3,
      total: 3,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/v1/roadvision/findings?state=VERIFIED&page=1&pageSize=100");
    expect(String(fetchMock.mock.calls[1]![0])).toBe("/api/v1/roadvision/findings?state=VERIFIED&page=2&pageSize=100");
  });

  it("fails closed when a paged endpoint stops making progress", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      data: { items: [], page: 1, pageSize: 1, total: 2 },
    }));

    await expect(api.workOrders()).rejects.toMatchObject({
      status: 502,
      code: "MALFORMED_PAGINATION",
    } satisfies Partial<ApiError>);
  });

  it("keeps an existing query while adding bounded pagination", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      data: { items: [], page: 1, pageSize: 100, total: 0 },
    }));

    await api.annualProgram(2026);

    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/v1/annual-programs?year=2026&page=1&pageSize=100");
  });
});
