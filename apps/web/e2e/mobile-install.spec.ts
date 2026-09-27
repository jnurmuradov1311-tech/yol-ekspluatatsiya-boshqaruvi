import { expect, test } from "@playwright/test";

test("mobil o‘rnatish manifesti va belgilar web serverda mavjud", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.scope).toBe("/");
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.ok()).toBe(true);
    expect(image.headers()["content-type"]).toContain("image/png");
  }
  const worker = await request.get("/sw.js");
  expect(worker.ok()).toBe(true);
  expect(worker.headers()["cache-control"]).toContain("no-store");
  expect(worker.headers()["service-worker-allowed"]).toBe("/");
});

test("o‘rnatilgan ilova internet uzilganda shaxsiy yozuvlarni ochmaydi", async ({ page, context }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION !== "true", "Service worker faqat ishlab chiqarish buildida ishlaydi.");
  await page.goto("/login");
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active)), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const cachePaths = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("roadops-public-"));
    return (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat();
  });
  expect(cachePaths.every((path) => path.startsWith("/mobile/"))).toBe(true);
  await context.setOffline(true);
  await page.goto("/topshiriqlar");
  await expect(page.getByRole("heading", { name: "Internet uzildi" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Qayta ochish" })).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("link", { name: "Qayta ochish" }).click();
  await expect(page.getByRole("button", { name: "Kirish", exact: true })).toBeVisible();
});
