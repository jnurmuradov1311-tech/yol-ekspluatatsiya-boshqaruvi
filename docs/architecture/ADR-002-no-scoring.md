# ADR-002: ball, indeks va AI qarorini olib tashlash

Status: qabul qilindi  
Sana: 2026-08-12

## Qaror

Operativ model, API, UI va eksportlarda quyidagilar bo'lmaydi:

- ustuvorlik balli yoki darajasi;
- qoplama/holat indeksi;
- 0–100 holat bahosi;
- RoadVision ishonch foizi;
- LLM tomonidan ish tanlash yoki brigada taqsimlash.

Vendorning texnik raw payloadi o'zgartirilmasdan yopiq audit saqlovida qolishi mumkin, lekin uning ehtimollik maydonlari UI yoki plannerga uzatilmaydi.

## Rejalashtirish tartibi

Manager aniq ketma-ketlik bersa shu ketma-ketlik; aks holda tasdiqlangan sana va o'zgarmas yozuv IDsi qo'llanadi. Bu texnik deterministik tartib, ustuvorlik emas.

