# Ko‘rikni sodda kiritish

Usta yo‘lni, nuqsonni, joylashuvni va o‘lchangan hajmni kiritadi. `unit` uchun bitta kilometr yetarli; metr, kilometr, maydon va hajm uchun boshlanish hamda tugash joyi majburiy. Tizim maydonni shartli 1 metrli kesim deb hisoblamaydi. `submitForReview: true` ko‘rik va kuzatuvni yaratish hamda boshliqqa yuborishni bitta tranzaksiyada bajaradi.

Yangi ko‘riklarda tizim inventar elementini yo‘l, sana, joylashuv va aniq fizik tur bo‘yicha izlaydi. Faqat bitta mos element bo‘lsa avtomatik bog‘laydi. Topilmasa, turi noma’lum bo‘lsa, bir nechta mos kelsa yoki o‘lchovi yetishmasa, ko‘rik `REVIEW_REQUIRED` bilan saqlanadi. Bu AI qarori emas. Usta inventar ro‘yxatini tanlamaydi. Tasdiqlovchi elementni aniqlashtirmaguncha ko‘rik tasdiqlangan nuqsonga aylanmaydi. Tasdiqlangan manba bo‘lmagani uchun rejalashtirishga o‘tmaydi. Eski yozuvlar `LEGACY` sifatida saqlanadi.

Boshliq qaror so‘rovida `roadElementId` yuborib noaniq yozuvni aniqlashtirishi mumkin. Server elementning shu yo‘l, sana, kesim va o‘lchovga mosligini qayta tekshiradi; bitta elementga ortiqcha dona yozishni rad etadi. Tuzatish alohida audit voqeasida saqlanadi. Ko‘rikni kiritgan xodim o‘z yozuvini tasdiqlay olmaydi.

## Foto va video

`POST /api/v1/manual-inspections/evidence` — autentifikatsiya va CSRF bilan multipart yuklash. `file` JPG/PNG/MP4, ko‘pi bilan 20 MiB. `capturedAt`, `latitude`, `longitude` ixtiyoriy; GPS qiymatlari juft kiritiladi. Server MIME turini, o‘lchamni va rasm tuzilishini tekshiradi, SHA-256 ni o‘zi hisoblaydi. Qaytgan deskriptor aynan ko‘rikning `evidence` ro‘yxatiga qo‘shiladi. `uploadToken` 48 soat amal qiladi va faqat yuklagan foydalanuvchiga tegishli; foydalanuvchi fayl manzili yoki checksum kiritmaydi.

Fayl Laravel `local` diskining yopiq `inspection-evidence` katalogida turadi. Saqlangan dalilga kirish faqat ko‘rikning ruxsat bilan tekshiriladigan dalil marshruti orqali; ochiq URL yoki storage symlink yaratilmaydi. Videoda byte-range ko‘rish ishlaydi. Oldingi S3 manbalari mavjud ruxsat siyosati bilan ishlashda davom etadi.

Ishchi muhitda `storage/app/private` doimiy, zaxiralanuvchi va API foydalanuvchisi yozishi mumkin bo‘lgan disk bo‘lishi shart. Bir nechta API nusxasi shu diskni ulashishi kerak. Konteyner fayl tizimini vaqtinchalik saqlash o‘rnida ishlatmaslik kerak. Biriktirilmagan yuklamalarni tozalashda bazadagi dalil manzillarini tekshirish zarur; foydalanilgan dalillarni o‘chirish mumkin emas.

## Ijro dalillari

Bajarilgan ishni topshirishda `POST /api/v1/work-orders/{id}/evidence` orqali JPG, PNG yoki PDF (20 MiB gacha) yuklanadi. Qaytgan `url` mavjud bajarish so‘rovining `evidence` ro‘yxatiga kiritiladi. Foydalanuvchi boshqa serverga fayl yuklab, havolasini qo‘lda yozishi shart emas. Fayl aynan shu topshiriqqa bog‘lanadi; boshqa topshiriq faylini kiritish API va ma’lumotlar bazasida bloklanadi. Fayl turi, o‘lchami va SHA-256 serverda tekshiriladi. Qayta urinishda ayni foydalanuvchi shu topshiriqqa yuklagan bir xil fayl takror yaratilmaydi. Tasdiqlangan/yakunlangan topshiriqqa yangi fayl yuklab bo‘lmaydi.

Yuklangan ijro fayllari `storage/app/private/execution-evidence` katalogida, o‘zgarmas metama’lumoti esa `roadops.work_order_evidence` jadvalida saqlanadi. Ko‘rish huquqi topshiriqning yo‘l bo‘limi doirasi bo‘yicha tekshiriladi. Eski ruxsat etilgan HTTPS omborlaridagi dalillar bilan ishlash saqlangan.
