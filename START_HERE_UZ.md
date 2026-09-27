# Yagona yo‘l — kodni ochish va ishga tushirish

## Ish jarayoni

**Nuqson kiritish → boshliq tekshiradi → ish va muddat → xodim va resurslar → ijro → bajarilgan ishni tasdiqlash.**

1. Usta yo‘l, kilometr, nuqson turi va hajmni kiritadi. Foto/video biriktirishi mumkin. «Boshliqqa yuborish» bitta amal. Ustadan alohida bazadagi element yoki IQN ish turini tanlash talab qilinmaydi.
2. Tizim joy va nuqson bo‘yicha aktivni bazadan aniqlaydi. Moslik noaniq bo‘lsa qayd yo‘qolmaydi: boshliq tasdiqlashda joyni aniqlashtiradi. Hisob fizik hajm va yil/oy limitlariga tekshiriladi.
3. Boshliq tasdiqlangan nuqson uchun IQN ishini tanlaydi. Ixtiyoriy AI tavsiyasi shu yerda alohida ochiladi. Xodim, material va texnika talabi tasdiqlangan me’yorlardan hisoblanadi.
4. Ish sanasi va har kungi vaqti belgilanadi. Yo‘l ochiq, qisman yoki to‘liq yopiq bo‘lishi tanlanadi; yopilsa yo‘nalish, tasma va zarur ruxsat ma’lumoti kiritiladi. Ijroga berilgan yopilish «Yo‘l harakati»da ko‘rinadi.
5. Xodim yetishmasa davom etilmaydi. Material yoki texnika yetishmasa talabnoma ochiladi. Mavjud resurs biriktirilgach boshliq topshiriqni ijroga beradi.
6. Usta haqiqiy hajm, ish vaqti va sarfni kiritadi; boshliq tekshiradi. Tasdiqlangan yozuvlar tabel, oylik, xarajatlar va dalolatnomaga asos bo‘ladi.

«Ish yo‘riqnomalari» bo‘limida ish turiga PDF/rasm, MP4 yoki HTTPS havola biriktiriladi. Shu material topshiriqni rejalashtirish va bajarishda ochiladi.

## AI nimani bajaradi?

**RoadVision** foto/video tahlilidan topilmalar beradi; mas’ul xodim ularni tekshiradi. **AI tavsiyasi** tasdiqlangan nuqson uchun katalogdagi mos IQN ishlarini taklif qiladi. **IQN hisoblash** esa ish hajmidan xodim, material va texnika talabini hisoblaydi. Yakuniy tanlov va ijroga berish boshliqning vazifasi.

AI provayderi ulanmaganida tizim buni ochiq ko‘rsatadi, qo‘lda ish tanlash ishlashda davom etadi. Demo katalog mosligini haqiqiy AI javobi deb taqdim etmaydi. Server sozlash tartibi: `docs/ai-work-recommendation.md`.

## Papkalar

- `apps/demo-preview` — Sites namoyishi. Ma’lumotlar shu brauzerda saqlanadi, haqiqiy tashkilot bazasi bilan umumiy emas.
- `apps/web` — server API bilan ishlaydigan web va telefonga o‘rnatiladigan PWA interfeysi.
- `apps/api` — Laravel API, hisob xizmatlari va PostgreSQL migratsiyalari.
- `packages/contracts` — API shartnomalari va integratsiya namunalari.
- `infra` — serverlarni ishga tushirish sozlamalari.
- `docs` — ish tartibi, IQN manbalari, hisob qoidalari va ulanish yo‘riqnomalari.

## Demoni mahalliy ochish

Node.js 22.13 yoki yangiroq kerak.

```sh
cd apps/demo-preview
npm ci
npm run dev
```

Terminalda ko‘rsatilgan manzilni oching. Kirish ma’lumotlari tayyor. «Sinov roli» orqali boshliq, bosh muhandis va usta jarayonlari ko‘riladi.

## Haqiqiy serverda ishga tushirish

Asosiy `README.md`dagi Docker Compose va `make migrate` tartibidan foydalaning. `.env.example` fayllari sozlash namunalari; maxfiy kalitlar, parollar va haqiqiy tashkilot ma’lumotlari berilmagan. Kutubxonalar `package-lock.json` / `composer.lock` orqali o‘rnatiladi; `node_modules`, `vendor` va vaqtinchalik qurilish fayllari ZIPga kiritilmaydi.

Server uchun HTTPS domeni, PostgreSQL, Redis, PHP API/worker/scheduler, doimiy xususiy fayl saqlash joyi, tashkilot rollari va haqiqiy IQN/xodim/ombor/tarif ma’lumotlari kerak. `NEXT_PUBLIC_E2E_FIXTURES` ishlab chiqarish muhitida yoqilmaydi. RoadVision, RAMS/YTP va AI ulanishlari alohida sozlanadi; YTPga yuborish holati qabul tasdig‘i bilan tekshiriladi. Bank to‘lovi va yetkazib beruvchi hisob-fakturasi hozircha ulanmagan.

## Telefonga o‘rnatish

HTTPS saytni oching. Androidda brauzer menyusi → «Ilovani o‘rnatish». iPhoneda Safari → «Ulashish» → «Bosh ekranga qo‘shish». Telefon ham web tizimdagi akkaunt va ma’lumotdan foydalanadi. Ishlarni ko‘rish va yuborish uchun internet kerak; offline holatda yozuv yuborildi deb ko‘rsatilmaydi.

Bu paket PWA kodini beradi; imzolangan APK/AAB/IPA yoki do‘konda e’lon qilingan native ilova emas. O‘rnatish va qurilmada qabul sinovi: `docs/mobile-release.md`.

## Reja va hisob qoidalari

- Yillik ehtiyoj aktivlar, holat va IQN davriyligidan hisoblanadi.
- Cheklangan mablag‘ga mos ishlar, shtat, jihoz va resurslar qayta hisoblanadi; qoldirilgan ishlar ko‘rinadi.
- Tasdiqlangan moliyalashtirilgan hajm yillik rejaga o‘tadi. Oylik yig‘indi undan oshmaydi.
- Bir aktiv uchun bir kunlik yozuv fizik sig‘imdan oshmaydi. Takroriy ishlar alohida sanalarda va tasdiqlangan yil/oy hajmi doirasida bo‘ladi.
- Dalolatnoma tekshirilgan ishlarni oladi. «Ф2-Сақлаш» ustunlari, xarajat jamlamasi, yo‘l, uchastka, topshiriq va sana Excel’da ko‘rinadi.

Batafsil: `docs/operations/simple-workflow.md`, `docs/operations/transparent-accounting.md` va `docs/operations/production-readiness.md`.
