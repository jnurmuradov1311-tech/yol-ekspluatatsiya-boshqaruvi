# Yagona yo‘l web ilovasi

Next.js frontend barcha ish ma’lumotini PHP xizmatining bir xil origin ostidagi `/api/v1` yo‘lidan oladi. Brauzerda sessiya cookie orqali, yozuvchi so‘rovlar esa CSRF va `Idempotency-Key` sarlavhalari orqali himoyalanadi.

## Ishga tushirish

```bash
npm ci
cp .env.example .env.local
npm run dev
```

PHP alohida xizmat bo‘lsa, `BACKEND_INTERNAL_URL` Next.js server proksisini yoqadi. Brauzer uchun `NEXT_PUBLIC_API_BASE_URL=/api/v1` qiymatini o‘zgartirmang.

## Tekshiruv

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`NEXT_PUBLIC_E2E_FIXTURES=true` faqat Playwright sinovlarida ishlatiladi. Bu qiymat qo‘yilganda interfeysda doimiy ogohlantirish ko‘rinadi; ishlab chiqarish muhitida uni yoqish mumkin emas.

## Muhit qiymatlari

- `BACKEND_INTERNAL_URL` — PHP xizmatining faqat server ko‘radigan manzili.
- `NEXT_PUBLIC_API_BASE_URL` — bir xil origin ostidagi API prefiksi.
- `NEXT_PUBLIC_MAP_STYLE_URL` — tashkilotning MapLibre uslub fayli manzili.
- `NEXT_PUBLIC_E2E_FIXTURES` — faqat avtomatik sinov uchun.

## Mobil ilova

Shu frontend HTTPSda Android/iPhone bosh ekraniga o‘rnatiladigan PWA sifatida ishlaydi. `manifest.webmanifest`, `/mobile/*` va `/sw.js` web serverdan beriladi. Xususiy sahifalar, API javoblari va fayllar service worker keshiga yozilmaydi. Internet uzilganda ochiq offline sahifa ko‘rsatiladi; yozuv saqlangan deb aytilmaydi.

O‘rnatish va qabul sinovi: [mobil chiqarish yo‘riqnomasi](../../docs/mobile-release.md). Bu kod imzolangan APK/IPA yoki do‘kondagi native ilova deb hisoblanmaydi.

## Asosiy ekranlar

- `/malumot-kiritish`: usta nuqsonni kiritib boshliqqa yuboradi; aktivni qo‘lda majburiy tanlamaydi.
- `/nuqsonlar`: RoadVision topilmalarini inson tekshiradi.
- `/rejalashtirish`: IQN ishi, muddat, harakat tartibi va resurslar; AI tavsiyasi ixtiyoriy.
- `/yol-harakati`: yo‘nalish/tasma, yopilish vaqti va YTPga yuborish holati.
- `/ish-turlari`: ishga yo‘riqnoma/video biriktirish.
- `/topshiriqlar`: ijro va tekshirish; natija keyingi hisoblarga bog‘lanadi.
