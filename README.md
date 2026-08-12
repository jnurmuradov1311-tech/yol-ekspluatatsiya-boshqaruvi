# Yo'l ekspluatatsiyasini boshqarish tizimi

Avtomobil yo'llarini saqlash ishlarini manba ma'lumotlari, tasdiqlangan nuqsonlar, IQN normalari va real resurs cheklovlari asosida rejalashtiradigan ishlab chiqarish tizimi.

Bu repozitoriy demo yoki ball beruvchi dashboard emas. Tizimda ustuvorlik ballari, qoplama indeksi, holatning 0–100 bahosi va AI ishonch foizi operativ qarorlarda mavjud emas. RoadVision kuzatuvi faqat nomzod yozuv bo'lib, inson tasdig'isiz ish yoki reja yarata olmaydi.

Operativ ko'lam YTPdagi yagona faol `D001` yo'li va uning to'liq `67 000` metr uzunligi bilan qat'iy cheklangan. Kod, uzunlik yoki faol yozuvlar soni mos kelmasa API fail-closed ishlaydi; boshqa yo'lga avtomatik o'tmaydi.

## Arxitektura

- `apps/web` — Next.js/TypeScript interfeysi; Vercelga joylashadi.
- `apps/api` — Laravel/PHP API, rejalashtiruvchi, integratsiya worker va scheduler.
- `apps/api/database` — yagona PostgreSQL/Supabase sxema manbasi.
- `packages/contracts` — OpenAPI shartnomasi va tashqi tizim payload namunalari.
- `infra` — PHP API, worker, scheduler, Redis va reverse-proxy konteynerlari.
- `docs` — IQN auditi, integratsiya talablari, xavfsizlik va ishga tushirish qarorlari.

## Ma'lumot egaligi

| Ma'lumot | Asosiy manba | Ushbu tizimdagi xatti-harakat |
|---|---|---|
| Yo'l, uzunlik, geometriya | Yo'l ta'mirlash punkti | Faqat o'qiladigan sinxron nusxa |
| Yo'l bo'limi va profil | Yo'l ta'mirlash punkti | Faqat o'qiladigan, tarix saqlanadi |
| Yo'l elementi | Yo'l ta'mirlash punkti | Faqat o'qiladigan; tafovut ko'rikka yuboriladi |
| Ishchi va bo'limga birikma | Yo'l ta'mirlash punkti | Faqat o'qiladigan, amal qilish sanalari bilan |
| AI kuzatuvi | RoadVision | Nomzod; inson tasdig'i shart |
| Tekshirilgan nuqson | Ushbu tizim | Operativ asosiy yozuv |
| Reja, topshiriq, bajarilish | Ushbu tizim | Operativ asosiy yozuv |
| IQN normalari | Tasdiqlangan raqamlashtirish | Versiyalangan va tarixiy snapshot bilan |

## Rejalashtirish qoidasi

Rejalashtiruvchi faqat foydalanuvchi tanlagan tasdiqlangan nuqsonlarni, tasdiqlangan yillik dastur ishlarini va qo'lda kiritilgan operativ ishlarni oladi. Yashirin saralash yoki ball yo'q. Har bir yozuv uchun natija:

- sana, brigada, texnika, material va harakat xavfsizligi sxemasi bilan `SCHEDULED`; yoki
- mashina o'qiydigan blocker kodi, o'zbekcha izoh va tuzatish amali bilan `BLOCKED`.

Bir ishchiga bir kunda jami rejalashtirilgan va amaldagi vaqt 420 daqiqadan oshmaydi. IQN 02 normasi tarkibidagi tayyorgarlik, dam olish va texnologik tanaffus qayta qo'shilmaydi.

## Mahalliy ishga tushirish

Talablar: Docker Compose v2, Node 22+ (faqat mahalliy web ishlovi uchun).

1. `cp infra/local.env.example .env` bilan mahalliy shablonni nusxalang, `PRIMARY_ROAD_CODE=D001` hamda `PRIMARY_ROAD_LENGTH_M=67000` qiymatlarini o'zgartirmang va
   development uchun maxfiy qiymatlarni to'ldiring. Root `.env.example`
   ishlab chiqarish/Supabase ulanishlari uchun mo'ljallangan.
2. `make migrate` bilan checksummed SQL migratsiyalarini alohida migrator orqali qo'llang.
3. `docker compose up --build` buyrug'ini bajaring.
4. Birinchi administratorni faqat konsol orqali yarating:
   `docker compose exec api php artisan roadops:user:create-admin`.

Ishlab chiqarishda development fixturelar avtomatik yuklanmaydi.

## Muhim integratsiya darvozalari

Quyidagilar berilmaguncha adapterlar `CONFIGURATION_REQUIRED` holatida qoladi va soxta muvaffaqiyat ko'rsatmaydi:

- Yo'l ta'mirlash punkti OpenAPI/sandbox, OAuth ma'lumotlari, delta va o'chirish semantikasi;
- YTPdan keladigan D001 yo‘lining 0–67 000 metrga kalibrlangan LineString geometriyasi va piketaj qoidasi;
- RoadVision natija API/webhook yoki natija manifestining rasmiy shartnomasi;
- IQN variantlari va nuqson–ish mosliklarining soha egasi tasdig'i;
- ishlab chiqarish Supabase, Vercel va PHP konteyner hosti konfiguratsiyasi.

## Tekshiruv

CI PHP format/static analysis/unit/integration testlarini, frontend lint/typecheck/buildni, Postgres migratsiyasini, OpenAPI va IQN yaxlitlik testlarini hamda Playwright E2E ssenariylarini bajaradi.

## Litsenziya va manba hujjatlar

Yuklangan IQN PDF/DOCX va boshqa birlamchi hujjatlar repozitoriyga kiritilmaydi. Tizim faqat tasdiqlangan, audit izi mavjud bo'lgan strukturaviy import natijasini saqlaydi.
