# Oylik bajarilgan ishlar dalolatnomasi

Eksport foydalanuvchi taqdim etgan `88-йўл бўлими (2) Бахтиёр ака.xlsx`
namunasining foydali hisob qatlamlarini saqlaydi. Namunaning o‘zi operatsion
shablon sifatida ko‘chirilmaydi: undagi `Харажат!T39:T43` formulalari mavjud
bo‘lmagan satrlarga murojaat qilgani uchun `#NAME?` beradi. Tizim qiymatlarni
tasdiqlangan haqiqiy sarf va muzlatilgan tarif nusxalaridan qayta yig‘adi.

## Hisobot varaqlari

| Tizim varag‘i | Manba varag‘i | Tizimdagi mazmun |
| --- | --- | --- |
| `Dalolatnoma` | `Ф2-Сақлаш` | bir yo‘l + IQN ish varianti + birlik bo‘yicha jamlangan topshiriqlar, IQN normativ va haqiqiy ishchi-soat hamda muzlatilgan xarajatlar |
| `Ish haqi` | `Харажат` | tabel raqami, xodim, lavozim, norma/haqiqiy kun-soat, oylik tarif, ish haqi, uchta ustama, ijtimoiy ajratma va jami |
| `Tabel` | `Табель` | dalolatnoma oyining `1..oy oxiri` kunlik haqiqiy soat gridi, oy kun/soat jami va davrdan tashqari bog‘langan vaqt |
| `Materiallar` | `Материал` | topshiriq, material kodi, birlik, haqiqiy miqdor, muzlatilgan birlik narxi va jami |
| `Mashina-mexanizm` | `ММФ` | topshiriq, inventar kodi, haqiqiy mashina-soat, muzlatilgan mashina-soat narxi va jami |
| `Xarajat manbalari` | — | har bir sarfning topshirig‘i, yo‘li, sanasi, miqdori, tarifi, birlamchi yozuvi va oylik hisobiga havolasi |
| `Umumiy xarajat` | `Харажат` / `Умумий харажат` | ish haqi, ijtimoiy ajratma, material, mashina-mexanizm va oylik jami |

`Tabel` kataklarida `+`, `O`, `B/S` kabi taxminiy belgilar emas, tasdiqlangan
`actual_minutes / 60` soati yoziladi. Bir xodimning bir kunda bir necha
topshiriqda ishlagan vaqti qo‘shiladi. Dalolatnoma oyidan tashqaridagi, lekin shu
ishga bog‘langan tasdiqlangan vaqt yashirilmaydi: alohida ustunda ko‘rsatiladi.

## Hisoblash manbalari

- Asosiy ish haqi: `oylik tarif × tasdiqlangan haqiqiy daqiqa / tasdiqlangan
  oylik norma daqiqasi`.
- Mukofot, harakat tig‘izligi va ko‘chib ishlash to‘lovi: tasdiqlangan stavka
  versiyasidagi bazis-punkt foizi bo‘yicha alohida muzlatiladi.
- Ijtimoiy ajratma: asosiy ish haqi va uchta tasdiqlangan ustama yig‘indisiga
  tasdiqlangan ijtimoiy ajratma foizi qo‘llanadi.
- Material: `tasdiqlangan haqiqiy miqdor × tasdiqlangan birlik narxi`.
- Mashina-mexanizm: `tasdiqlangan haqiqiy mashina-daqiqa / 60 × tasdiqlangan
  mashina-soat narxi`.
- IQN normativ mehnat: `linear` formulali ish varianti uchun bajarilgan sana
  bo‘yicha amal qiluvchi tasdiqlangan norma to‘plamidagi barcha `labor` satrlari yig‘indisi bo‘yicha
  `bajarilgan hajm / IQN bazis hajmi × bazisdagi mehnat daqiqasi`.

IQN norma to‘plami, foydalanilgan mehnat norma satrlari, bazis hajmi/birligi,
bir bazis va bir ish birligiga daqiqa hamda jami normativ daqiqa dalolatnoma
bandida muzlatiladi. Amal qiluvchi tasdiqlangan mehnat normasi yoki aynan mos
birlik topilmasa dalolatnoma yaratilmaydi; tizim qiymatni taxmin qilmaydi.
DB validatori bu qiymatlarni tasdiqlangan norma satrlaridan mustaqil qayta
hisoblaydi, soxta yoki boshqa variant/sanaga tegishli snapshotni rad etadi.
Ularning barchasi dalolatnomaning SHA-256 canonical snapshot hashiga kiradi.
`incremental`, `fixed_period`, `range` va boshqa chiziqli bo‘lmagan IQN
formulalari uchun barcha formula kirishlari alohida muzlatilib, aynan qayta
hisoblash joriy etilmaguncha tizim ularni chiziqli deb taxmin qilmaydi va
dalolatnoma yaratishni yopiq tarzda rad etadi.

Ushbu sxema joriy etilishidan oldin yuborilgan yoki tasdiqlangan dalolatnomalarda
IQN normativ snapshoti `null` bo‘lib qoladi — bu oldingi SHA-256 snapshot hashini
buzmaslik uchun zarur. Bunday eski dalolatnoma Excelga chiqarilganda normativ
kataklar `0` deb talqin qilinmaydi: ular bo‘sh qoladi va varaq izohida ma’lumot
eski snapshotda mavjud emasligi ko‘rsatiladi.

`Dalolatnoma` varag‘i bir xil yo‘l, IQN ish varianti va ish birligidagi bandlarni
bitta qatorga jamlaydi. Oy hajmi, normativ daqiqa va xarajatlar qo‘shiladi;
IQN birlik normasi jami normativ daqiqaning jami oy hajmiga nisbatidan olinadi.
Manba topshiriq raqamlari vergul bilan ajratilgan drill-down matnida saqlanadi.

Ish haqi komponentlari, material narxi va mashina-soat narxi dalolatnoma xarajat
satrida saqlangan nusxadan olinadi. Xodimning sana va oylik ish kuni normasi
tasdiqlangandan keyin o‘zgarmaydigan, dalolatnoma xarajat satriga tashqi kalit
bilan bog‘langan manbalardan olinadi. Eksportdagi foydalanuvchi matnlari Excel
formula sifatida emas, literal matn sifatida yoziladi; faqat tizim yaratgan `SUM`
kataklari formula bo‘ladi.

## Oylik hisobidan dalolatnomaga

Dalolatnoma yaratishdan oldin tegishli ish vaqti oylari uchun oylik hisobi
saqlanadi. Hisoblangan asosiy ish haqi, koeffitsiyent, ustamalar, staj, bayram,
ovqat va boshqa bir martalik to‘lovlar birlamchi tabel yozuvlariga bog‘lanadi.
Har bir sana va tarif bo‘yicha hisob 2 xonagacha HALF_UP usulida yaxlitlanadi;
oylik to‘lovlar haqiqiy daqiqalarga mutanosib taqsimlanadi. Kumulyativ
ulushlarni yaxlitlash orqali oxirgi tiyin ham yo‘qolmaydi.

Dalolatnoma bandida oylik nusxasining IDsi, SHA-256 izi va aynan shu ishga
tegishli komponentlari saqlanadi. Ish haqi va dalolatnoma mehnat xarajatlari
shu yagona manbadan olinadi. Soliq, avans va boshqa ushlanmalar xodimga
beriladigan summani kamaytiradi; ishning ish beruvchi xarajatini ikkinchi
marta kamaytirmaydi. Ijtimoiy ajratma ish beruvchi xarajati sifatida alohida.

Yangi tabel yoki oylik hisobi paydo bo‘lsa, qoralama qayta shakllantiriladi.
Eskirgan oylik manbasi bilan qoralamani yuborish bloklanadi. Yuborilgan yoki
tasdiqlangan dalolatnomadagi summalar o‘zgarmaydi: keyingi hisob avval
qayd etilgan tabel yozuvlarining summalarini aynan saqlaydi, yangi ishlarga
esa qolgan to‘lovni ajratadi. Bir martalik to‘lov takrorlanmaydi.

Hisobotdagi “Jami hisoblangan xarajat” bankdan pul chiqib ketganini
bildirmaydi. Bank to‘lovlari va to‘lov topshiriqnomalari ushbu modulga
ulanmagan. Alohida transport, boshqa xarajatlar yoki QQS manbasi bo‘lmasa,
ular “qayd etilmagan” deb ko‘rsatiladi va taxmin qilinmaydi.

## Asosiy va qo‘shimcha dalolatnoma

Birinchi dalolatnoma yuborilgach, shu oyda yangi bajarilgan ishlar kelishi
mumkin. Ular yangi qo‘shimcha qoralamaga kiradi. Birlamchi topshiriq,
tabel, material sarfi yoki texnika vaqti ikki dalolatnomada takrorlanmaydi.
Bir oyda bitta faol qoralama bo‘ladi; qo‘shimcha hujjatlar ketma-ket
tasdiqlanadi. Har bir hujjat o‘zining o‘zgarmas qiymati va yillik yig‘indi
nusxasini saqlaydi.

Keyingi oy hujjati allaqachon muzlatilgan bo‘lsa, oldingi oyga orqaga
qarab yangi hujjat qo‘shish bloklanadi: tasdiqlangan yillik yig‘indilar
izsiz o‘zgarib ketmaydi. Bunday holat alohida nazoratli tuzatishni talab
qiladi.
