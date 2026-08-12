import { expect, test, type Page } from "@playwright/test";

async function navigateFromShell(page: Page, label: string) {
  await page.locator(".app-shell").waitFor();
  const menuButton = page.getByRole("button", { name: "Menyuni ochish" });
  if (await menuButton.isVisible()) {
    await menuButton.click();
  }

  const destination = page.getByRole("link", { name: label, exact: true });
  await expect(destination).toBeVisible();
  await destination.click();
}

test("TOTP himoyasi yoqilgan hisobni ikkinchi bosqichda tekshiradi", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("mfa@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await expect(page.getByLabel("Autentifikator kodi")).toBeVisible();
  await page.getByLabel("Autentifikator kodi").fill("123456");
  await page.getByRole("button", { name: "Kodni tasdiqlash" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("operator reviews dashboard and receives an exact planning blocker", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("E2E SINOV REJIMI")).toBeVisible();
  await page.getByLabel("Elektron pochta").fill("operator@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Bosh sahifa" })).toBeVisible();
  await navigateFromShell(page, "Rejalashtirish");
  await expect(page.getByRole("tab", { name: /Barchasi/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /RoadVision AI/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Yo‘l ustasi/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Yillik dastur/ })).toBeVisible();
  await page.getByText("Suv qochirish arig‘ini tozalash").click();
  const calculatePlan = page.getByRole("button", { name: "Avtomatik rejani hisoblash" });
  await calculatePlan.scrollIntoViewIfNeeded();
  await calculatePlan.click();

  await expect(page.getByRole("heading", { name: "Reja varianti" })).toBeVisible();
  await expect(page.getByText("Aniq ish hajmi yetishmaydi")).toBeVisible();
  await expect(page.getByText(/Dalilni o‘lchang/)).toBeVisible();
  await expect(page.getByText("Kunlik ish vaqti", { exact: true })).toBeVisible();
  await expect(page.getByText(/420 daqiqagacha/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Excel yuklash" })).toHaveAttribute("href", "/api/v1/reports/plans.xlsx");
  await expect(page.getByRole("button", { name: "Rejani tasdiqlash" })).toBeDisabled();
});

test("independent approver opens a persisted plan, approves it, then publishes", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("approver@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Rejalashtirish");

  const handoffRow = page.getByRole("row").filter({ hasText: "Dilshod Ergashev" });
  await handoffRow.getByRole("button", { name: "Ko‘rish" }).click();
  await expect(page.getByRole("heading", { name: "Reja varianti" })).toBeVisible();
  await expect(page.getByText("Resurslar yetarli")).toBeVisible();
  const approvePlan = page.getByRole("button", { name: "Rejani tasdiqlash" });
  await approvePlan.scrollIntoViewIfNeeded();
  await approvePlan.click();
  await page.getByRole("button", { name: "Topshiriqlarni chiqarish" }).click();
  await expect(page.getByText("Topshiriqlar chiqarildi", { exact: false })).toBeVisible();
});

test("RoadVision decision removes the reviewed record from the active queue", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("operator@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "RoadVision AI topilmalari");
  await page.getByRole("button", { name: "Ko‘rish" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const approveFinding = dialog.getByRole("button", { name: "Tasdiqlash" });
  await approveFinding.scrollIntoViewIfNeeded();
  await approveFinding.click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("confirmed defect register keeps RoadVision and manual sources explicit", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("operator@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Tasdiqlangan nuqsonlar");

  await expect(page.getByText("0+000 — 67+000", { exact: true })).toBeVisible();
  const register = page.getByRole("region", { name: "Tasdiqlangan nuqsonlar registri" });
  await expect(register.getByText("RV-E2E-1001")).toBeVisible();
  await expect(register.getByText("RoadVision AI", { exact: true })).toBeVisible();
  await expect(register.getByText("D001 · Toshkent halqa avtomobil yo‘li")).toBeVisible();
  await page.getByRole("tab", { name: "Rejaga kiritilgan" }).click();
  await expect(register.getByText("KORIK-2026-0086")).toBeVisible();
  await expect(register.getByText("Yo‘l ustasi ko‘rigi", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Excel yuklash" })).toHaveAttribute("href", "/api/v1/reports/confirmed-defects.xlsx");
});

test("manual planning keeps selected-road safety and staffing gates visible", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("operator@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Rejalashtirish");
  await page.getByRole("tab", { name: "Qo‘lda reja" }).click();

  const roadContext = page.locator(".road-context");
  await expect(roadContext.getByText("D001 · Toshkent halqa avtomobil yo‘li")).toBeVisible();
  await expect(roadContext.getByText("0+000 — 67+000")).toBeVisible();
  for (const scheme of ["Yo‘l yoqasida ishlash", "Bir tasmani yopish", "Yo‘lning yarmini yopish", "Navbatma-navbat harakat", "Yo‘lni to‘liq yopish"]) {
    await expect(page.getByText(scheme, { exact: true })).toBeVisible();
  }
  await page.getByLabel("IQN bo‘yicha ish turi").selectOption("work-pothole");
  await page.getByLabel("Ish hajmi, m²").fill("10");
  await page.getByLabel("Boshlanish nuqtasi, metr").fill("12000");
  await page.getByLabel("Tugash nuqtasi, metr").fill("12020");
  await page.getByText("Bir tasmani yopish", { exact: true }).click();
  await expect(page.getByText("Brigada yetarli emas")).toBeVisible();

  for (const worker of ["Aziz Shermatov", "Kamola Umarova", "Bekzod Rahimov", "Madina Tolipova", "Rustam Qodirov"]) {
    await page.getByText(worker, { exact: true }).click();
  }
  await expect(page.getByText("Brigada yetarli")).toBeVisible();
  await page.getByRole("button", { name: "Qo‘lda rejani tekshirish" }).click();
  await expect(page.getByText("Resurslar yetarli")).toBeVisible();
  await expect(page.getByText("Kunlik 420 daqiqalik limit")).toBeVisible();
});

test("monthly timesheet renders every day and exposes Excel export", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("operator@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Tabel");
  await page.getByRole("combobox", { name: "Oy", exact: true }).selectOption("8");

  await expect(page.getByRole("columnheader", { name: "1", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "31", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Excel yuklash" })).toHaveAttribute("href", /reports\/timesheet\.xlsx/);
});

test("selected synchronized road renders on the operational map", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("operator@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Xarita");

  await expect(page.getByLabel("Xaritadagi yo‘l")).toHaveValue("road-d001");
  await expect(page.getByText("67 km", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "D001 to‘liq yo‘l xaritasi" })).toBeVisible();
  await expect(page.getByText("D001 yo‘li", { exact: true })).toBeVisible();
});
