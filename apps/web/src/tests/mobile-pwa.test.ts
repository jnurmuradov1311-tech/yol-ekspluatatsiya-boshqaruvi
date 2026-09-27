// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import manifest from "../app/manifest";

type FetchEvent = { request: { url: string; method: string; mode: string }; respondWith: ReturnType<typeof vi.fn> };

function worker() {
  const listeners: Record<string, (event: FetchEvent | { waitUntil: ReturnType<typeof vi.fn> }) => void> = {};
  const addAll = vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn().mockResolvedValue(new Response("Live response"));
  const match = vi.fn().mockResolvedValue(new Response("Offline page"));
  const remove = vi.fn().mockResolvedValue(true);
  const claim = vi.fn().mockResolvedValue(undefined);
  runInNewContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), {
    self: { location: { origin: "https://roads.example" }, clients: { claim }, addEventListener: (name: string, callback: typeof listeners[string]) => { listeners[name] = callback; } },
    caches: { open: vi.fn().mockResolvedValue({ addAll }), match, keys: vi.fn().mockResolvedValue(["roadops-public-v0", "roadops-public-v1", "unrelated-cache"]), delete: remove },
    fetch, URL, Response,
  });
  const event = (path: string, method = "GET", mode = "cors") => {
    const result: FetchEvent = { request: { url: `https://roads.example${path}`, method, mode }, respondWith: vi.fn() };
    listeners.fetch!(result);
    return result;
  };
  return { listeners, event, addAll, fetch, match, remove, claim };
}

describe("Installed mobile application", () => {
  it("has an installable manifest and real square PNG icons of the declared sizes", () => {
    const value = manifest();
    expect(value).toMatchObject({ id: "/", start_url: "/", scope: "/", display: "standalone" });
    expect(value.icons).toEqual(expect.arrayContaining([expect.objectContaining({ sizes: "192x192" }), expect.objectContaining({ sizes: "512x512", purpose: "maskable" })]));
    for (const icon of value.icons ?? []) {
      const file = readFileSync(new URL(`../../public${icon.src}`, import.meta.url));
      expect(file.subarray(1, 4).toString()).toBe("PNG");
      const [width, height] = (icon.sizes ?? "").split("x").map(Number);
      expect(file.readUInt32BE(16)).toBe(width);
      expect(file.readUInt32BE(20)).toBe(height);
    }
  });

  it("precaches public installation assets only", async () => {
    const value = worker();
    const waitUntil = vi.fn();
    value.listeners.install!({ waitUntil });
    await waitUntil.mock.calls[0]![0];
    expect(value.addAll.mock.calls[0]![0]).toEqual([
      "/mobile/offline.html", "/mobile/icon-192.png", "/mobile/icon-512.png", "/mobile/maskable-512.png", "/mobile/apple-touch-icon.png",
    ]);
  });

  it("never intercepts private API data, uploads, mutations, or JavaScript modules", () => {
    const value = worker();
    for (const path of ["/api/v1/me", "/api/v1/payroll/export", "/api/v1/media/private-photo", "/_next/static/app.js"]) {
      expect(value.event(path).respondWith).not.toHaveBeenCalled();
    }
    expect(value.event("/api/v1/payroll/export", "GET", "navigate").respondWith).not.toHaveBeenCalled();
    expect(value.event("/topshiriqlar/1", "POST", "navigate").respondWith).not.toHaveBeenCalled();
    expect(value.fetch).not.toHaveBeenCalled();
  });

  it("uses live navigation responses, including auth failures, without caching them", async () => {
    const value = worker();
    value.fetch.mockResolvedValueOnce(new Response("Unauthenticated", { status: 401 }));
    const event = value.event("/topshiriqlar/1", "GET", "navigate");
    const response = await event.respondWith.mock.calls[0]![0];
    expect(response.status).toBe(401);
    expect(value.match).not.toHaveBeenCalled();
  });

  it("shows the public offline page only when a page navigation cannot reach the network", async () => {
    const value = worker();
    value.fetch.mockRejectedValueOnce(new TypeError("Network unavailable"));
    const event = value.event("/topshiriqlar/1", "GET", "navigate");
    const response = await event.respondWith.mock.calls[0]![0];
    expect(await response.text()).toBe("Offline page");
    expect(value.match).toHaveBeenCalledWith("/mobile/offline.html");
  });

  it("removes only old versions of its own public cache", async () => {
    const value = worker();
    const waitUntil = vi.fn();
    value.listeners.activate!({ waitUntil });
    await waitUntil.mock.calls[0]![0];
    expect(value.remove.mock.calls).toEqual([["roadops-public-v0"]]);
    expect(value.claim).toHaveBeenCalledOnce();
  });
});
