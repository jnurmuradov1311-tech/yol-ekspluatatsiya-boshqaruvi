# Ishdan xarajatgacha

## Ish ketma-ketligi

1. RoadVision yoki yo‘l ustasi kuzatuv kiritadi. Boshliq tur, joy va hajmni tekshiradi.
2. IQN ishi, muddat va yo‘l harakati tartibi belgilanadi. Ishchi, operator, xavfsizlik xodimi va resurslar alohida hisoblanadi.
3. Xodim yetishmasa reja to‘xtaydi. Material yoki texnika kamomadi talabnomaga tushadi. Talabnoma tasdig‘i ombor kirimi o‘rnini bosmaydi.
4. Boshliq ta’minlangan topshiriqni ijroga beradi. Usta haqiqiy hajm, har bir xodim vaqti va resurs sarfini kiritadi. Nol qatnashuv va ishlatilmagan resurs uchun sabab yoziladi.
5. Boshliq boshqa shaxs kiritgan natijani tekshiradi. Tuzatishga qaytarilsa oldingi qayd va omborning kompensatsiya yozuvi saqlanadi. Tasdiqlangan natija o‘zgartirilmaydi.
6. Tasdiqlangan vaqt tabelga, tabel va tariflar oylikka o‘tadi. Oylik manbalari dalolatnomaga bog‘lanadi.
7. Keyingi ishlar qo‘shimcha dalolatnomaga kiradi. Avvalgi hujjat, tarif nusxasi va oylik to‘lov taqsimoti saqlanadi.

## Har bir summaning asosi

| Xarajat | Hisob manbasi | Tekshirish yo‘li |
|---|---|---|
| Ish haqi | Tasdiqlangan vaqt, amal qilgan tarif, oylik norma, koeffitsiyent va ustamalar | Xodim → vaqt qaydi → topshiriq → oylik nusxasi → dalolatnoma |
| Ijtimoiy ajratma | Ish haqi va belgilangan stavka | Oylik komponenti → xarajat satri |
| Material | Haqiqiy sarf va birlikka mos narx | Sarf → ombor tranzaksiyasi → narx versiyasi → topshiriq |
| Mashina-mexanizm | Haqiqiy mashina vaqti va mashina-soat tarifi | Inventar raqam → bandlik → foydalanish qaydi → tarif |

`/cost-ledger` qoralama, tasdiqqa yuborilgan va tasdiqlangan summalarni alohida qaytaradi. Tasdiqlangan jami ichida ijtimoiy ajratma ikkinchi marta qo‘shilmaydi. Pul qiymatlari API orqali aniq o‘nlik satr sifatida uzatiladi. Sahifalash jami summani qisqartirmaydi.

`/machine-usage` reja, kiritilgan va tasdiqlangan vaqtni ajratadi. Kiritilmagan vaqt `null`; ishlatilmagan texnika `0` va sabab bilan qayd etiladi. Oylik texnika hisobi foydalanish sanasiga, xarajat hisobi dalolatnoma oyiga tegishli.

Bu registr hisoblangan tannarxni ko‘rsatadi. Bank to‘lovi, yetkazib beruvchi hisob-fakturasi va alohida boshqa xarajatlar bu registrga ulanmagan. Mashina-soat narxining tarkibi tarif manbasida ko‘rsatiladi; yonilg‘i narxga kiritilgan bo‘lsa uni ikkinchi marta material sifatida hisoblamaslik kerak.

## Oylik va dalolatnoma nazorati

- Hisob har bir vaqt yozuvi bo‘yicha tiyinigacha yaxlitlanadi; oylik va dalolatnoma bir xil ajratmalardan foydalanadi.
- Bayram, ovqat va bir martalik to‘lovlarning oylik jami bir marta taqsimlanadi. Keyingi dalolatnoma faqat qolgan qismini oladi.
- Dalolatnomaga kirgan hisobni koeffitsiyent yoki tarif bilan yashirin qayta yozish bloklanadi. Keyingi ish avvalgi nusxani o‘zgartirmaydi.
- Bir bajarilish ikki dalolatnomaga kirmaydi. Bir oyda bitta faol qoralama bo‘ladi; qo‘shimcha hujjatdan oldin oldingi hujjat tasdiqlanadi.
- Qoralama eskirsa qayta hisoblanadi. Yillik jami noyob ish manbalari asosida olinadi.
- Excel’dagi manba registri vaqt/sarf yozuvi, tarif versiyasi va oylik nusxasigacha olib boradi.

## Ishlab chiqarish va Sites

`apps/api` va `apps/web` — PostgreSQLga ulangan ishlab chiqarish ilovasi. `apps/demo-preview` — Sites’da ko‘rsatiladigan mustaqil Vinext demo, to‘liq manba kodi va qulflangan kutubxonalari bilan saqlanadi. Demo brauzerdagi namunalarni saqlaydi; u ishlab chiqarish bazasi yoki bank hisobi emas. IQN katalogi, aktivlar budjeti, yillik limitlar va ikki yozuvdagi eksportning Sites nusxasi shu katalogda.

Ishlab chiqarishga o‘tkazishda IQN nashrini ekspert tasdiqlashi, haqiqiy shtat/ombor/tariflarni yuklash va tashqi adapterlarni sozlash zarur. Hisob-kitob stavkalari qonuniy amaldagi stavka deb avtomatik e’lon qilinmaydi; ularning tasdiqlangan manbasi kiritiladi.
