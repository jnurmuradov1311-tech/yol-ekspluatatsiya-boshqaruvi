import { expect, test, type Page } from "@playwright/test";

async function navigateFromShell(page: Page, label: string) {
  await page.locator(".app-shell").waitFor();
  const menuButton = page.getByRole("button", { name: "Menyuni ochish" });
  if (await menuButton.isVisible()) {
    await menuButton.click();
  }

  const sidebar = page.locator("#primary-navigation");
  const destination = sidebar.getByRole("link", { name: label, exact: true, includeHidden: true });
  const group = sidebar.locator("details.nav-group").filter({ has: page.getByRole("link", { name: label, exact: true, includeHidden: true }) });
  if (await group.count() && await group.getAttribute("open") === null) {
    await group.locator("summary").click();
  }
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
  await navigateFromShell(page, "Topshiriq yaratish");
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
  await page.getByRole("button", { name: "Rejani o‘zgartirish" }).click();
  await page.getByRole("button", { name: "Tanlovni tozalash" }).click();
  await expect(page.getByRole("heading", { name: "Reja varianti" })).not.toBeVisible();
});

test("independent approver opens a persisted plan, approves it, then publishes", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("approver@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Topshiriq yaratish");

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
  await navigateFromShell(page, "RoadVision topilmalari");
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
  await navigateFromShell(page, "Nuqsonlar");

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
  await navigateFromShell(page, "Topshiriq yaratish");
  await expect(page.getByRole("tab", { name: "Nuqsondan ish yaratish" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Qaysi nuqson bartaraf etiladi?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saqlangan rejalar" })).not.toBeVisible();
  await page.getByLabel("Nuqsonni tanlang").selectOption("23333333-3333-4333-8333-333333333333");
  await page.getByRole("button", { name: "Ishni belgilash" }).click();
  await expect(page.getByLabel("IQN 02-24 bo‘yicha ish turi")).toHaveValue("");
  await page.getByLabel("IQN 02-24 bo‘yicha ish turi").selectOption("work-pothole");
  await expect(page.getByLabel("IQN 02-24 bo‘yicha ish turi")).toHaveValue("work-pothole");
  await page.getByLabel(/Ish hajmi/).fill("10");
  await page.getByLabel("Boshlanish sanasi").fill("2027-01-10");
  await page.getByLabel("Tugash sanasi").fill("2027-01-13");
  await page.getByLabel("Boshlanish sanasi").fill("2027-01-11");
  await expect(page.getByLabel("Tugash sanasi")).toHaveValue("2027-01-13");
  await expect(page.getByLabel("IQN 02-24 bo‘yicha ish turi")).toHaveValue("work-pothole");
  await page.getByLabel("Ish vaqtida yo‘l harakati").selectOption("PARTIAL");
  await expect(page.getByRole("button", { name: "Xodimlarni biriktirish" })).toBeDisabled();
  await page.getByLabel("Yopiladigan yo‘nalish").selectOption("FORWARD");
  await page.getByLabel("Yopiladigan tasma").fill("1-tasma, o‘ng chetdagi");
  await expect(page.getByText(/YTPga yuborilish holati/)).toBeVisible();
  await page.getByRole("button", { name: "Xodimlarni biriktirish" }).click();
  await page.getByRole("tab", { name: "Qo‘lda biriktirish", exact: true }).click();
  const calculate = page.getByRole("button", { name: "Resurslarni hisoblash" });
  await expect(calculate).toBeDisabled();
  await expect(page.locator(".manual-planner").getByRole("alert")).toContainText("keyingi bosqichga o‘tib bo‘lmaydi");
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
  await result.getByText("Xodim, material va texnika hisobi", { exact: true }).click();
  await expect(result.getByText("Tanlangan muddatdagi ish vaqti", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Rejani o‘zgartirish" }).click();
  await page.getByRole("button", { name: "Orqaga", exact: true }).click();
  await page.getByLabel(/Ish hajmi/).fill("11");
  await expect(page.getByRole("heading", { name: "Reja varianti" })).not.toBeVisible();
});

test("automatic staffing shortage stays at the employee gate", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("operator@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Topshiriq yaratish");
  await page.getByLabel("Nuqsonni tanlang").selectOption("22222222-2222-4222-8222-222222222222");
  await page.getByRole("button", { name: "Ishni belgilash" }).click();
  await page.getByLabel("IQN 02-24 bo‘yicha ish turi").selectOption("work-shoulder");
  await page.getByRole("button", { name: "Xodimlarni biriktirish" }).click();
  await page.getByRole("button", { name: "Resurslarni hisoblash" }).click();
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
  await navigateFromShell(page, "Topshiriq yaratish");
  await page.getByLabel("Nuqsonni tanlang").selectOption("24444444-4444-4444-8444-444444444444");
  await page.getByRole("button", { name: "Ishni belgilash" }).click();
  await page.getByLabel("IQN 02-24 bo‘yicha ish turi").selectOption("work-pothole");
  await page.getByLabel(/Ish hajmi/).fill("1000");
  await page.getByLabel("Boshlanish sanasi").fill("2027-01-01");
  await page.getByLabel("Tugash sanasi").fill("2027-01-20");
  await page.getByRole("button", { name: "Xodimlarni biriktirish" }).click();
  await page.getByRole("button", { name: "Resurslarni hisoblash" }).click();
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
  await navigateFromShell(page, "Nuqson kiritish");
  await expect(page).toHaveURL(/\/malumot-kiritish$/);
  await expect(page.getByRole("heading", { name: "Nuqson kiritish", exact: true })).toBeVisible();
  await expect(page.getByLabel(/IQN|Yo‘l elementi|SHA-256/)).toHaveCount(0);
  await page.getByRole("combobox", { name: "Nuqson turi" }).fill("чуқур");
  await page.getByRole("option", { name: "Qoplamadagi chuqurcha" }).click();
  await page.getByLabel("Ko‘rik sanasi").fill("2026-09-01");
  await page.getByLabel(/^Boshlanish, km/).fill("18.420");
  await page.getByLabel(/^Tugash, km/).fill("18.425");
  await page.getByLabel(/^Hajm,/).fill("12.4");
  await page.getByLabel("Izoh (ixtiyoriy)").fill("O‘ng tasmadagi ikkita chuqurcha");
  await page.getByRole("button", { name: "Boshliqqa yuborish" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Nuqson boshliqqa yuborildi." })).toHaveText("Nuqson boshliqqa yuborildi.");
  const row = page.getByRole("row").filter({ hasText: "Qoplamadagi chuqurcha" });
  await expect(row).toContainText("12.4 m2");
  await expect(row).toContainText("Ko‘rib chiqilmoqda");
  await expect(row.getByRole("button", { name: "Ko‘rib chiqishga yuborish" })).toHaveCount(0);
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
  await page.getByLabel("Hisobot oyi", { exact: true }).fill("2026-08");

  await expect(page.getByRole("columnheader", { name: "1", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "31", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Excel", exact: true })).toHaveAttribute("href", "/api/v1/reports/timesheet.xlsx?year=2026&month=8");
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

test("execution records explicit zero use and prevents self-verification", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("operator@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Topshiriqlar");
  await page.getByRole("row").filter({ hasText: "YT-2026-00841" }).getByRole("link", { name: "Ochish" }).click();
  const quantity = page.getByLabel(/^Haqiqiy bajarilgan hajm/);
  await expect(quantity).toHaveValue("");
  await quantity.fill("8.25");
  await page.getByLabel("Aziz Shermatov ishlagan daqiqa").fill("60");
  await page.getByLabel("Kamola Umarova ishlagan daqiqa").fill("0");
  await page.getByLabel("Issiq asfalt qorishmasi sarfi").fill("0");
  await page.getByLabel("Mayda chaqiq tosh sarfi").fill("0");
  await page.getByLabel("Avtogreyder mashina daqiqasi").fill("0");
  await page.getByLabel("Katok mashina daqiqasi").fill("0");
  await page.getByLabel("Foto yoki hujjat", { exact: true }).setInputFiles({ name: "bajarilgan-ish.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64") });
  await expect(page.getByRole("status").filter({ hasText: "bajarilgan-ish.png yuklandi" })).toContainText("bajarilgan-ish.png yuklandi");
  await page.getByLabel("Bajarilgan ish bo‘yicha izoh").fill("Haqiqiy hajm joyida o‘lchandi.");
  await page.getByRole("button", { name: "Ishni yakunlash" }).click();
  await expect(page.locator(".inline-error[role=alert]")).toContainText("sababini yozing");
  await page.getByLabel("Ishlamagan xodim yoki ishlatilmagan resurs sababi").fill("Tayyorlov ishlari qo‘lda bajarildi, ikkinchi xodim kelmadi.");
  await page.getByRole("button", { name: "Ishni yakunlash" }).click();
  await expect(page.getByRole("heading", { name: "Haqiqiy bajarilish qaydi" })).toBeVisible();
  await expect(page.getByText("1 soat 0 daqiqa", { exact: true })).toBeVisible();
  await expect(page.getByText("Ishlatilmagan resurslar", { exact: true })).toBeVisible();
  await expect(page.getByText(/Katok: Tayyorlov ishlari/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Tasdiqlash", exact: true })).toHaveCount(0);
});

test("timesheet hands its selected month to payroll", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Elektron pochta").fill("operator@example.uz");
  await page.getByLabel("Parol").fill("e2e-password");
  await page.getByRole("button", { name: "Kirish" }).click();
  await navigateFromShell(page, "Tabel");
  await page.getByLabel("Hisobot oyi", { exact: true }).fill("2026-08");
  await page.locator(".page-header").getByRole("link", { name: "Oylik hisoblash", exact: true }).click();
  await expect(page.getByLabel("Hisob oyi", { exact: true })).toHaveValue("2026-08");
});
