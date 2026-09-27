# Ish turiga yo‘riqnoma va video biriktirish

Yo‘riqnoma foydalanuvchining PDF, JPG, PNG, WebP yoki MP4 fayli yoki HTTPS havolasidan olinadi. Tizim ko‘rsatma mazmunini o‘zi to‘qib chiqarmaydi. Fayl IQN ish variantiga va yo‘l bo‘limiga bog‘lanadi. Tanlangan ishning yo‘riqnomasi rejalashtirishda ham, ijroda ham shu ro‘yxatdan ochiladi.

## API

Barcha endpointlar `/api/v1` ichida va `roadops.auth` bilan himoyalanadi. Controller har bir yo‘l bo‘limi bo‘yicha bazadagi huquqni qayta tekshiradi. Ko‘rish uchun `planning.read` yoki `execution.read`, biriktirish/arxivlash uchun `planning.write` yoki `catalog.manage` kerak.

- `GET /work-guides?workVariantId=<uuid>&roadUnitId=<uuid>` → `{data:{items:WorkGuide[],canManage:boolean}}`.
- `POST /work-guides`: `multipart/form-data` fayl uchun yoki JSON havola uchun. Majburiy maydonlar: `workVariantId`, `roadUnitId`, `title`, `kind` (`DOCUMENT` yoki `VIDEO`). `file` yoki `url` dan bittasi. `X-CSRF-Token` va 8–128 belgili `Idempotency-Key` kerak. Javob `{data:WorkGuide}`, yangi yozuvda 201, aynan takror so‘rovda 200.
- `GET /work-guides/{id}/content?roadUnitId=<uuid>` → asl fayl baytlari; sessiya tekshiriladi, MP4 uchun HTTP Range ishlaydi.
- `DELETE /work-guides/{id}?roadUnitId=<uuid>` → `{data:{id,deleted:true}}`; CSRF va idempotency talab qilinadi. Fayl va audit tarixi saqlanadi, faol ro‘yxat va faylga kirish yopiladi.

`WorkGuide`: `id`, `roadUnitId`, `workVariantId`, `title`, `kind`, `sourceType` (`FILE` yoki `LINK`), `url`, `fileName`, `contentType`, `byteSize`, `createdAt`. Oxirgi uchta fayl maydoni havolada `null`. Ichki disk manzili mijozga berilmaydi.

`FILE` uchun `url` allaqachon bo‘lim parametri kiritilgan vakolatli yuklab olish manzilidir. `LINK` havolasi yangi oynada `rel="noopener noreferrer"` bilan ochiladi; API havolani yuklab olmaydi, oldindan ko‘rish uchun ham tashqi so‘rov yubormaydi. PDF yuklab olinadi; video va rasmlar shu vakolatli manzildan ko‘riladi.

## Route ulash

```php
use App\Http\Controllers\Api\V1\WorkGuideController;

// Existing roadops.auth group:
Route::get('/work-guides', [WorkGuideController::class, 'index']);
Route::post('/work-guides', [WorkGuideController::class, 'store'])
    ->middleware(['roadops.csrf', 'throttle:20,1']);
Route::get('/work-guides/{id}/content', [WorkGuideController::class, 'content'])
    ->middleware('throttle:120,1');
Route::delete('/work-guides/{id}', [WorkGuideController::class, 'destroy'])
    ->middleware(['roadops.csrf', 'roadops.idempotency']);
```

POST endpointga umumiy `roadops.idempotency` qo‘shilmaydi: bu controller faylning SHA256 summasini ham hisobga olgan alohida takror so‘rov nazoratiga ega. Bir kalit boshqa fayl yoki mazmun bilan qayta yuborilsa 409 qaytadi. `FormData` yuborilganda `Content-Type` qo‘lda yozilmaydi — brauzer multipart chegarasini o‘zi belgilaydi.

## Serverda ishga tushirish

- `20260928000200_work_guides.sql` migratsiyasi qo‘llanadi.
- `/var/www/storage/app/private` doimiy diskka ulanadi. API foydalanuvchisi UID/GID 10001 uchun yozish huquqi bo‘lsin. Ushbu katalog web server tomonidan bevosita ochilmaydi; `storage:link` bilan ommaga chiqarilmaydi.
- Disk va PostgreSQL zaxirasi birga saqlanadi. Bir nechta API nusxasi ishlasa, ular bir xil doimiy diskni ko‘rishi kerak.
- `upload_max_filesize=100M`, `post_max_size=105M`; Nginx `client_max_body_size 105m`; API vaqtinchalik disk hajmi kamida 256 MB. Reverse proxy va hosting limitlari ham mos bo‘lsin.
- Yo‘riqnoma/rasm 20 MiB, video 100 MiB. Kengaytma yoki brauzer bergan MIMEga ishonilmaydi: server fayl baytlarini tekshiradi. HTML/SVG/skriptlar qabul qilinmaydi.
- Tasdiqlangan manbani foydalanuvchi o‘zi biriktiradi. Havola egasi keyin uning mazmunini o‘zgartirishi mumkin; o‘zgarmas nusxa uchun faylni yuklash kerak.

`026_work_guides.sql` bazada bo‘limlar bo‘yicha ajratish, ishchining ko‘rish huquqi, ruxsatsiz yozish, faylsiz metadata yozuvi, audit va arxivlashni tekshiradi. PHP sinovlari haqiqiy fayl baytlari, Range, MIME, hajm, yo‘l, checksum, huquq va takror yuborishni tekshiradi.
