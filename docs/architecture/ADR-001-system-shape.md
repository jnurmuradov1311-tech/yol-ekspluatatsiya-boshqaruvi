# ADR-001: tizim shakli va joylashtirish

Status: qabul qilindi  
Sana: 2026-08-12

## Qaror

Tizim modul monolit sifatida quriladi. Barcha biznes qoidalari Laravel/PHP ichida, foydalanuvchi interfeysi esa Next.js/TypeScript ichida bo'ladi. API, queue worker va scheduler alohida jarayon, ammo bir xil versiyalangan kod va domen modelidan foydalanadi.

PostgreSQL, PostGIS va saqlash uchun Supabase ishlatiladi. Operativ jadvallar `roadops` yopiq sxemasida turadi va browser ularga to'g'ridan-to'g'ri kira olmaydi. Web Vercelga; PHP API/worker/scheduler PHP konteynerini doimiy ishlata oladigan hostga joylanadi.

## Sabab

Rejalashtirish stock, ishchi va texnika bandligini bitta tranzaksiyada qayta tekshirishi kerak. Serverless funksiyalarga bo'lingan mikroservislar bu bosqichda tranzaksiya, audit va operatsion qo'llab-quvvatlashni keraksiz murakkablashtiradi.

## Oqibat

- Laravel migratsiyasi yagona sxema manbasi.
- Frontendda biznes qarori yoki yashirin scoring bo'lmaydi.
- Tashqi integratsiyalar inbox/outbox va idempotency orqali ishlaydi.
- Vercel PHP worker yoki scheduler hosti sifatida qaralmaydi.

