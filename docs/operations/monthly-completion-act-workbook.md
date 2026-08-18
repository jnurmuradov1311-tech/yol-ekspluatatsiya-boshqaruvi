# Oylik bajarilgan ishlar dalolatnomasi

Eksport foydalanuvchi taqdim etgan `88-йўл бўлими (2) Бахтиёр ака.xlsx`
namunasining foydali hisob qatlamlarini saqlaydi. Namunaning o‘zi operatsion
shablon sifatida ko‘chirilmaydi: undagi `Харажат!T39:T43` formulalari mavjud
bo‘lmagan satrlarga murojaat qilgani uchun `#NAME?` beradi. Tizim qiymatlarni
tasdiqlangan haqiqiy sarf va muzlatilgan tarif nusxalaridan qayta yig‘adi.

## Olti varaq

| Tizim varag‘i | Manba varag‘i | Tizimdagi mazmun |
| --- | --- | --- |
| `Dalolatnoma` | `Ф2-Сақлаш` | bir yo‘l + IQN ish varianti + birlik bo‘yicha jamlangan topshiriqlar, IQN normativ va haqiqiy ishchi-soat hamda muzlatilgan xarajatlar |
| `Ish haqi` | `Харажат` | tabel raqami, xodim, lavozim, norma/haqiqiy kun-soat, oylik tarif, ish haqi, uchta ustama, ijtimoiy ajratma va jami |
| `Tabel` | `Табель` | dalolatnoma oyining `1..oy oxiri` kunlik haqiqiy soat gridi, oy kun/soat jami va davrdan tashqari bog‘langan vaqt |
| `Materiallar` | `Материал` | topshiriq, material kodi, birlik, haqiqiy miqdor, muzlatilgan birlik narxi va jami |
| `Mashina-mexanizm` | `ММФ` | topshiriq, inventar kodi, haqiqiy mashina-soat, muzlatilgan mashina-soat narxi va jami |
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

## Ataylab taxmin qilinmaydigan maydonlar

Eski namunada bor, lekin amaldagi tasdiqlangan tizim sxemasida yo‘q bo‘lgan
quyidagi qiymatlar hisoblanmaydi:

- malaka darajasi va malaka koeffitsienti — `Qayd etilmagan`;
- bayram puli — `0` va `qayd etilmagan` belgisi;
- bir martalik mukofot, ishdan bo‘shash to‘lovi, kasallik varaqasi, mehnat
  ta’tili va moddiy yordam — birlashtirilgan, aniq nomlangan ustunda `0`;
- alohida transport xarajati, boshqa xarajat va QQS — `Umumiy xarajat`
  varag‘ida `0` va `qayd etilmagan` belgisi.

Ushbu nollar buxgalteriya taxmini emas; tegishli tasdiqlangan ma’lumot modeli
yo‘qligini oshkora ko‘rsatadi. Kelajakda bu qiymatlar hisobga olinishi uchun
ularning manbasi, versiyalanishi, mustaqil tasdiqlanishi va dalolatnoma nusxasida
muzlatilishi alohida loyihalanishi kerak.

## Oy to‘liqligi va kech tasdiqlangan ish

Dalolatnoma yaratish API-si topshiriqlar subsetini qabul qilmaydi: tanlangan
bo‘lim va oy bo‘yicha dalolatnomaga hali olinmagan barcha mos `VERIFIED` ishlar
bitta tranzaksiyada qo‘shiladi. Yuborish va yakuniy tasdiqlash paytida tizim shu
oy/bo‘limdagi har bir joriy `VERIFIED` ish dalolatnomada borligini yana tekshiradi.

Yuborilgan dalolatnoma immutable. Shu sababli oy dalolatnomasi yuborilgan yoki
tasdiqlanganidan keyin o‘sha oyga tegishli ishni `VERIFIED` holatiga o‘tkazish
DB darajasida `MONTHLY_ACT_MONTH_CLOSED_FOR_LATE_VERIFICATION` bilan rad
etiladi. Bu yopiq snapshotga yashirin qo‘shimcha yoki dalolatnomadan tashqarida
qolgan tasdiqlangan ish paydo bo‘lishiga yo‘l qo‘ymaydi. Nazoratli
bekor qilish/tuzatish jarayoni alohida joriy etilmaguncha ish oy yopilishidan
oldin tekshirilishi shart.
