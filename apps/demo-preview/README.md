# RoadOps Sites demo

Yo‘l nuqsoni → topshiriq → ijro → tabel → oylik va dalolatnoma jarayonining namoyishi.

## Ishga tushirish

Node.js 22.13+ va Linux kerak.

```sh
npm ci
npm run dev
```

## Tekshirish

```sh
npm run typecheck
npm run test:logic
npm run test:interaction
npm run build
node --test tests/rendered-html.test.mjs
```

`npm run build` tekshirilgan Cloudflare Worker artefaktini `dist/` ichiga yig‘adi. Sites konfiguratsiyasi `.openai/hosting.json` ichida. `node_modules`, `dist`, maxfiy muhit fayllari va ishchi keshlar Gitga kiritilmaydi.

## Ma’lumotlar va hisob

- IQN 02-24 katalogi va resurs retseptlari: `src/lib/iqn/`.
- IQN 03-24 jihozlari, aktivlar budjeti va yillik limitlar: `src/lib/funding/`.
- Bog‘langan demo jarayoni, tarix va hisob nusxalari: `src/lib/api/fixtures.ts`.
- Oylik va dalolatnoma Excel shakli: `src/lib/excel/`.
- Xarajatlar va mashina hisobi: `/xarajatlar`, `/texnika`.
- Lotin/kirill tanlovi hisobot matnlariga ham qo‘llanadi.

Demo yozuvlari shu brauzerning mahalliy xotirasida saqlanadi. Ular umumiy server bazasi yoki himoyalangan buxgalteriya registri emas. Haqiqiy API ilovasi asosiy GitHub repozitoriysining `apps/api` va `apps/web` kataloglarida.

Bank to‘lovlari ulanmagan. Xarajatlar hisoblangan tannarxni ifodalaydi. Tarifi yoki IQN resurs me’yori yetishmasa ma’lumot aniqlashtiriladi; taxminiy raqam tasdiqlangan norma sifatida qo‘llanmaydi.

AI kaliti sozlanmasa interfeys namuna tavsiyasini ochiq belgilaydi. Haqiqiy AI/RAMS ulanishlari faqat server muhitidagi maxfiy sozlamalar bilan yoqiladi; kalitlar Gitga kiritilmaydi.
