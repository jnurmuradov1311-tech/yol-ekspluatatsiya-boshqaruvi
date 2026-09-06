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
  const mobileMenuButton = page.getByRole("button", { name: "Menyuni ochish" });
  if (await mobileMenuButton.isVisible()) {
    await mobileMenuButton.click();
    await page.keyboard.press("Escape");
    await expect(mobileMenuButton).toBeFocused();
  }
  await navigateFromShell(page, "Xodimlar");
  const resourceSearch = page.getByLabel("Resurslarni qidirish");
  await resourceSearch.fill("mavjud bo‘lmagan xodim");
  await expect(page.getByText("Mos yozuv topilmadi")).toBeVisible();
  await page.getByRole("button", { name: "Qidiruvni tozalash" }).click();
  await expect(resourceSearch).toHaveValue("");
  await expect(page.getByText("Aziz Shermatov", { exact: true })).toBeVisible();
  await navigateFromShell(page, "Rejalashtirish");
  await page.getByRole("tab", { name: "Bir nechta ishni rejalashtirish" }).click();
  await expect(page.getByRole("tab", { name: /Barchasi/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /RoadVision AI/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Yo‘l ustasi/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Yillik dastur/ })).toBeVisible();
  await page.getByText("Suv qochirish arig‘ini tozalash").click();
  await expect(page.locator(".selected-count")).toHaveText("1 ta tanlangan");
  await page.getByRole("button", { name: "Tanlovni tozalash" }).click();
  await expect(page.locator(".selected-count")).toHaveText("0 ta tanlangan");
  const calculatePlan = page.getByRole("button", { name: "Avtomatik rejani hisoblash" });
  await expect(calculatePlan).toBeDisabled();
  await page.getByText("Suv qochirish arig‘ini tozalash").click();
  await calculatePlan.scrollIntoViewIfNeeded();
  await calculatePlan.click();

  await expect(page.getByRole("heading", { name: "Reja varianti" })).toBeVisible();
  await expect(page.getByText("Aniq ish hajmi yetishmaydi")).toBeVisible();
  await expect(page.getByText(/Dalilni o‘lchang/)).toBeVisible();
  await expect(page.getByText("Kunlik ish vaqti", { exact: true })).toBeVisible();
  await expect(page.getByText(/420 daqiqagacha/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Excel yuklash" })).toHaveAttribute("href", "/api/v1/reports/plans.xlsx");
  await expect(page.getByRole("button", { name: "Rejani tasdiqlash" })).toBeDisabled();
  await page.getByRole("button", { name: "Tanlovni tozalash" }).click();
  await expect(page.getByRole("heading", { name: "Reja varianti" })).not.toBeVisible();
});

test("independent approver opens a persisted plan, approves it, then publishes", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("approver@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Rejalashtirish");

  await page.getByText("Saqlangan rejalar va tarix", { exact: true }).click();
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
  await page.getByRole("button", { name: "Batafsil" }).first().click();
  await page.getByRole("button", { name: "Ko‘rib chiqish" }).first().click();
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

  const scope = page.locator(".scope-meta");
  await expect(scope).toContainText("1-son yo‘l bo‘limi");
  await expect(scope).toContainText("Biriktirilgan yo‘llar va kesimlar");
  const register = page.getByRole("region", { name: "Tasdiqlangan nuqsonlar registri" });
  await expect(register.getByText("RV-E2E-1001")).toBeVisible();
  await expect(register.getByText("RoadVision AI", { exact: true })).toBeVisible();
  await expect(register.getByText("D001 · Toshkent halqa avtomobil yo‘li")).toBeVisible();
  await page.getByRole("tab", { name: "Rejaga kiritilgan" }).click();
  await expect(register.getByText("KORIK-2026-0086")).toBeVisible();
  await expect(register.getByText("Yo‘l ustasi ko‘rigi", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Excel yuklash" })).toHaveAttribute("href", "/api/v1/reports/confirmed-defects.xlsx");
});

test("defect workflow preserves dates and blocks resources until enough staff are assigned", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("operator@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Rejalashtirish");
  await expect(page.getByRole("tab", { name: "Nuqsondan ish yaratish" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Qaysi nuqson bartaraf etiladi?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saqlangan rejalar" })).not.toBeVisible();
  await page.getByLabel("Nuqsonni tanlang").selectOption("23333333-3333-4333-8333-333333333333");
  await page.getByRole("button", { name: "Ishni belgilash" }).click();
  await expect(page.getByLabel("IQN 02-24 bo‘yicha ish turi")).toHaveValue("");
  await page.getByRole("button", { name: "Algoritm tavsiyasi" }).click();
  await expect(page.getByLabel("IQN 02-24 bo‘yicha ish turi")).toHaveValue("work-pothole");
  await page.getByLabel(/Ish hajmi/).fill("10");
  await page.getByLabel("Boshlanish sanasi").fill("2027-01-10");
  await page.getByLabel("Tugash sanasi").fill("2027-01-13");
  await page.getByLabel("Boshlanish sanasi").fill("2027-01-11");
  await expect(page.getByLabel("Tugash sanasi")).toHaveValue("2027-01-13");
  await expect(page.getByLabel("IQN 02-24 bo‘yicha ish turi")).toHaveValue("work-pothole");
  await page.getByLabel("Ish vaqtida yo‘l harakati").selectOption("PARTIAL");
  await expect(page.getByText(/yopilish joyi va muddati yo‘l ta’mirlash punkti/)).toBeVisible();
  await page.getByRole("button", { name: "Xodimlarni biriktirish" }).click();
  await page.getByRole("tab", { name: "Qo‘lda biriktirish", exact: true }).click();
  const calculate = page.getByRole("button", { name: "Xodimlarni tekshirish va resurslarni hisoblash" });
  await expect(calculate).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("keyingi bosqichga o‘tib bo‘lmaydi");
  for (const worker of ["Aziz Shermatov", "Kamola Umarova", "Bekzod Rahimov"]) {
    await page.getByRole("checkbox", { name: new RegExp(worker) }).check();
  }
  await expect(calculate).toBeDisabled();
  for (const worker of ["Madina Tolipova", "Rustam Qodirov"]) {
    await page.getByRole("checkbox", { name: new RegExp(worker) }).check();
  }
  await expect(calculate).toBeEnabled();
  await calculate.click();
  const result = page.locator(".plan-preview");
  await expect(result.getByText("Resurslar yetarli", { exact: true })).toBeVisible();
  await expect(result).toContainText("2027-01-11 — 2027-01-13");
  await expect(result.getByText("Tanlangan muddatdagi ish vaqti", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Orqaga", exact: true }).click();
  await page.getByLabel(/Ish hajmi/).fill("11");
  await expect(page.getByRole("heading", { name: "Reja varianti" })).not.toBeVisible();
});

test("automatic staffing shortage stays at the employee gate", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("operator@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Rejalashtirish");
  await page.getByLabel("Nuqsonni tanlang").selectOption("22222222-2222-4222-8222-222222222222");
  await page.getByRole("button", { name: "Ishni belgilash" }).click();
  await page.getByRole("button", { name: "Algoritm tavsiyasi" }).click();
  await page.getByRole("button", { name: "Xodimlarni biriktirish" }).click();
  await page.getByRole("button", { name: "Xodimlarni tekshirish va resurslarni hisoblash" }).click();
  const result = page.locator(".plan-preview");
  await expect(result.getByRole("alert")).toContainText("Material va texnika bosqichiga o‘tish bloklandi");
  await expect(result.getByText("Brigada tarkibi", { exact: true })).toBeVisible();
  await expect(result.getByRole("button", { name: "Bosh muhandisga talabnoma" })).not.toBeVisible();
  await expect(result.getByText("Material", { exact: true })).not.toBeVisible();
  await expect(result.getByRole("button", { name: "Rejani tasdiqlash" })).toBeDisabled();
});

test("material shortage creates one chief engineer requisition after staffing passes", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("operator@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Rejalashtirish");
  await page.getByLabel("Nuqsonni tanlang").selectOption("24444444-4444-4444-8444-444444444444");
  await page.getByRole("button", { name: "Ishni belgilash" }).click();
  await page.getByRole("button", { name: "Algoritm tavsiyasi" }).click();
  await page.getByLabel(/Ish hajmi/).fill("1000");
  await page.getByLabel("Boshlanish sanasi").fill("2027-01-01");
  await page.getByLabel("Tugash sanasi").fill("2027-01-20");
  await page.getByRole("button", { name: "Xodimlarni biriktirish" }).click();
  await page.getByRole("button", { name: "Xodimlarni tekshirish va resurslarni hisoblash" }).click();
  const result = page.locator(".plan-preview");
  await expect(result.getByText("Resurs yetishmayapti", { exact: true })).toBeVisible();
  const request = result.getByRole("button", { name: "Bosh muhandisga talabnoma" });
  await request.click();
  await expect(result.getByText(/Talabnomalar: 1 ta/)).toBeVisible();
  await request.click();
  await expect(result.getByText(/Talabnomalar: 1 ta/)).toBeVisible();
  await result.getByRole("button", { name: "Qoldiqni qayta tekshirish" }).click();
  await expect(result.getByText("Resurs yetishmayapti", { exact: true })).toBeVisible();
  await expect(result.getByRole("button", { name: "Rejani tasdiqlash" })).toBeDisabled();
});

test("road master records a physical defect without choosing IQN work", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("operator@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Yo‘l ustasi ko‘rigi");
  await expect(page.getByLabel(/IQN/)).toHaveCount(0);
  await page.getByLabel("Nuqson turi", { exact: true }).selectOption("defect-pothole");
  await page.getByLabel("Aniqlangan nuqson", { exact: true }).fill("O‘ng tasmadagi ikkita chuqurcha");
  await page.getByLabel("Ko‘rik sanasi").fill("2026-09-01");
  await page.getByLabel("Lokatsiya", { exact: true }).fill("18420");
  await page.getByLabel(/O‘lchangan nuqson hajmi/).fill("12.4");
  await expect(page.getByLabel("O‘lchov birligi")).toHaveValue("m2");
  await page.getByRole("button", { name: "Qoralamani saqlash" }).click();
  const row = page.getByRole("row").filter({ hasText: "O‘ng tasmadagi ikkita chuqurcha" });
  await expect(row).toContainText("12.4 m2");
  await row.getByRole("button", { name: "Ko‘rib chiqishga yuborish" }).click();
  await expect(page.getByText(/KORIK-2026-\d+ ko‘rib chiqishga yuborildi/)).toBeVisible();
});

test("employee issue uses IQN lifetime from assignment date and reduces stock", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("operator@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Xodimlar");
  await page.getByRole("link", { name: "Aziz Shermatov" }).click();
  await expect(page.getByRole("heading", { name: "Aziz Shermatov — kartochka" })).toBeVisible();
  const vest = page.locator(".employee-card-item").filter({ hasText: "Ogohlantiruvchi nimcha" });
  await expect(vest).toContainText("2026-03-31");
  await expect(vest).toContainText("2026-09-30");
  await expect(vest).toContainText("3-jadval, 4-qator");
  await page.getByLabel("Mavjud jihoz").selectOption("ppe-material-2:ppe-stock-1");
  await page.getByLabel("Berilgan sana").fill("2026-01-31");
  await expect(page.getByRole("combobox", { name: "Xodimning kasbi" })).toHaveCount(0);
  await page.getByRole("button", { name: "Jihozni biriktirish" }).click();
  const gloves = page.locator(".employee-card-item").filter({ hasText: "Qo‘lqop" });
  await expect(gloves).toContainText("2026-02-28");
  await expect(gloves).toContainText("1 oy");
  await expect(page.getByLabel("Mavjud jihoz").locator('option[value="ppe-material-2:ppe-stock-1"]')).toContainText("9 dona");
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
  await expect(page.getByLabel("Xaritadagi yo‘l").locator("option:checked")).toContainText("D001 · Toshkent halqa avtomobil yo‘li");
  const selectedRoadLength = page.locator(".map-kpi-strip .card").filter({ hasText: "Xaritadagi yo‘l" });
  await expect(selectedRoadLength).toBeVisible();
  await expect(selectedRoadLength).toContainText("67 km");
  await expect(page.getByRole("region", { name: "D001 to‘liq yo‘l xaritasi" })).toBeVisible();
  await expect(page.getByText("D001 yo‘li", { exact: true })).toBeVisible();
});
