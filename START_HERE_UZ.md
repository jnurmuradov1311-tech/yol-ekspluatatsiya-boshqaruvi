# RoadOps — to‘liq kod

## Qaysi papka nima?

- `apps/demo-preview` — Sites’da ko‘rsatilgan to‘liq interfeys va ishlaydigan namoyish jarayonlari: aktivlar, saqlash budjeti, yillik/oylik reja, topshiriq, tabel, oylik, dalolatnoma, Excel.
- `apps/web` — ishlab chiqarish uchun Next.js interfeysi.
- `apps/api` — Laravel API va PostgreSQL migratsiyalari, rejalash va hisob xizmatlari.
- `packages/contracts` — API shartnomalari va integratsiya namunalari.
- `infra` — serverlarni ishga tushirish sozlamalari.
- `docs` — manbalar, hisob qoidalari, integratsiya va sinov yo‘riqnomalari.

## Demoni mahalliy ochish

Node.js 22.13 yoki yangiroq kerak.

```sh
cd apps/demo-preview
npm ci
npm run dev
```

Terminalda ko‘rsatilgan manzilni oching. Kirish ma’lumotlari tayyor. “Sinov roli” orqali boshliq, bosh muhandis va yo‘l ustasi jarayonlarini sinash mumkin. Ma’lumotlar shu brauzerda saqlanadi. Haqiqiy server bazasi bilan umumiy emas.

## Ishlab chiqarish tizimi

Asosiy `README.md`dagi Docker Compose va `make migrate` tartibidan foydalaning. `.env.example` fayllari faqat sozlash namunalari. Haqiqiy parollar, API kalitlari va bank ma’lumotlari bu paketga kiritilmagan. Kutubxonalar `package-lock.json` / `composer.lock` orqali o‘rnatiladi; `node_modules`, `vendor` va vaqtinchalik qurilish fayllari ZIPga kiritilmaydi.

Sites demo hamda ishlab chiqarish API ikki alohida ishga tushirish yo‘lidir. Haqiqiy RAMS/YTP, RoadVision, AI, ombor, tariflar va xodim ma’lumotlari uchun tashkilot ulanishlari sozlanadi. Bank to‘lovlari va yetkazib beruvchilar hisob-fakturalari hozircha ulanmagan.

## Yangi qoidalar

- Ehtiyoj aktivlar, holat va IQN davriyligidan hisoblanadi.
- Cheklangan mablag‘ga mos ishlar, shtat, jihoz va resurslar qayta hisoblanadi; qoldirilgan ishlar ko‘rinadi.
- Tasdiqlangan moliyalashtirilgan hajm yillik rejaga o‘tadi. Oylik yig‘indi undan oshmaydi.
- Bitta aktivga bir kunda bazadagidan ortiq ish yozilmaydi. Takroriy ish alohida sanada, tasdiqlangan yil/oy hajmi doirasida bo‘ladi.
- Dalolatnoma faqat tekshirilgan ishlarni oladi. Ф2-Сақлаш ustunlari, xarajat jamlamasi, yo‘l/uchastka, topshiriq va sana Excel’da ko‘rinadi.

Batafsil: `apps/demo-preview/docs/inventory-funded-plan.md`, `apps/api/database/README.md` va `docs/operations/transparent-accounting.md`.
