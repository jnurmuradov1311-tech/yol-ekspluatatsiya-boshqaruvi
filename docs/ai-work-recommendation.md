# AI vazifasi

Yo‘l ustasi nuqsonni yozadi. RoadVision topilmasini mas’ul xodim tekshirib tasdiqlaydi. Shundan keyingina boshliq rejalashtirish oynasida **AI tavsiyasi**ni so‘rashi mumkin. AI tasdiqlangan nuqson tavsifi, o‘lchovi va shu sanada amal qiladigan, ekspert tasdiqlagan IQN ish variantlarini solishtiradi. U uchtagacha mos ish turini qisqa sabab bilan taklif qiladi yoki qaysi o‘lchov yetishmayotganini ko‘rsatadi.

Ish turini boshliq tanlaydi. Xodim, material va mashina talabi serverdagi IQN hisoblash qoidalaridan olinadi. AI miqdor, narx yoki normani o‘ylab topmaydi; ish haqi, yo‘l yopilishi, resurs sarfi va topshiriqni ijroga berishni tasdiqlamaydi. Oddiy ro‘yxatdan ish tanlash uchun AI talab qilinmaydi.

## Server sozlamalari

`apps/api/.env.example` dagi `WORK_RECOMMENDATION_AI_ENABLED`, `OPENAI_API_KEY`, `OPENAI_WORK_RECOMMENDATION_MODEL` va `WORK_RECOMMENDATION_AI_TIMEOUT_SECONDS` server sozlamalaridir. Model va kalit kod bilan birga berilmaydi. Kalitni brauzer, mobil ilova, ZIP yoki GitHub ichiga kiritmang. Tashkilot tasdiqlagan OpenAI loyihasining maxfiy kaliti va Structured Outputs imkoniyatli model serverga berilgach, modul yoqiladi. Laravel konfiguratsiya keshi qayta yaratiladi. Provayder ulanishi haqiqiy tashkilot hisobida alohida tekshiriladi; avtomatlashtirilgan testlar provayderning sun’iy javoblaridan foydalanadi.

Modul o‘chirilgan yoki sozlanmagan bo‘lsa **AI ulanmagan** xabari ko‘rinadi. Kalit noto‘g‘ri bo‘lsa, vaqt tugasa yoki javob tekshiruvdan o‘tmasa tavsiya yaratilmaydi. Qo‘lda ish tanlash davom etadi. Katalog mosligi asosidagi oddiy tavsiya AI nomi bilan ko‘rsatilmaydi.

## API va nazorat

`POST /api/v1/planning/ai-work-recommendation` tanasi: `sourceDefectId`, ixtiyoriy `scheduledDate` (`YYYY-MM-DD`). Javob `data.status`: `READY`, `NO_MATCH`, `NEEDS_MEASUREMENT` yoki `UNAVAILABLE`. `candidates` faqat serverdagi ruxsat etilgan `workVariantId`, `workName`, `normReference`, `reason` maydonlaridan iborat. `requiresHumanApproval` doim `true`. Tavsiyani olish nuqson holatini yoki rejani o‘zgartirmaydi; tanlangan ishni qo‘llashda odatdagi rejalashtirish tekshiruvlari qayta bajariladi.

So‘rov vakolat va yo‘l bo‘limi bo‘yicha cheklanadi. Provayderga faqat tasdiqlangan nuqsonning qisqartirilgan texnik tavsifi, o‘lchovi, piketi va mos katalog yuboriladi; xodimlar ro‘yxati, ish haqi, foydalanuvchi ismi, foto yoki fayl manzillari yuborilmaydi. Matn va kataloglar buyruq sifatida ishlatilmaydi. Provayder uchun vosita chaqirish o‘chirilgan; qat’iy JSON sxema va server qayta tekshiruvi noma’lum ish IDsi, ortiqcha maydon, takror va to‘liq bo‘lmagan javobni rad etadi. Responses so‘rovida `store: false` beriladi; bu sozlama provayderning barcha ma’lumot saqlash siyosatini bekor qilmaydi.

Har so‘rovning tavsiya IDsi, foydalanuvchi IDsi, manba versiyasi, manba/katalog xeshi, natija, model va provayder javob IDsi server jurnaliga yoziladi. API kaliti, nuqsonning to‘liq matni va provayderning xom javobi jurnalga yozilmaydi. Ishning tasdiqlanishi va ijrosi odatdagi tizim auditida alohida qoladi. Ishlab chiqarishda server jurnallarini markaziy saqlash va saqlanish muddatini tashkilot belgilaydi.

Texnik asos: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses). Rasmiy hujjatlar 2026-09-27 kuni tekshirildi.
