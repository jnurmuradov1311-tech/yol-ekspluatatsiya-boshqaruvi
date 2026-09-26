# Aktivdan moliyalashtirilgan rejagacha

1. Yo‘llar va aktivlar bazasi RAMS API yoki JSON eksportidan olinadi. Har aktivda barqaror ID, yo‘l, uchastka boshi/oxiri (metr), o‘lchangan hajm/birlik va holat bo‘ladi. `physicalCount` yuzasi alohida o‘lchangan obyektning butun sonini bildiradi.
2. IQN 02 bo‘yicha bir martalik hajm × davriylik yillik ehtiyojni beradi. Qoplamada manbaga bog‘langan holat ulushi hamda o‘lchangan nuqson hajmi hisobga olinadi. Aniqlashtirilmagan norma, resurs yoki birlik yashirin nolga almashtirilmaydi.
3. Mablag‘ kam bo‘lsa aktiv holati, yo‘l ahamiyati va holati bo‘yicha tartiblangan ishlar tanlanadi. Yuqori ustuvor ish qoplanmaguncha keyingi bandga o‘tilmaydi. Qolgan summa butun elementga yetmasa taqsimlanmaydi. Har tanlov uchun yaxlitlangan shtat, IQN 03 jihozlari, ish haqi, material, texnika va doimiy xarajatlar qayta hisoblanadi. Bu tashkiliy taqsimlash siyosati, IQN koeffitsiyenti emas.
4. IQN qamrovi to‘liq ehtiyojga nisbatan tekshiriladi. Tasdiqlangan yillik rejaga moliyalashtirilgan hajm o‘tadi; qoldirilgan ishlar alohida saqlanadi. Oylik yig‘indi yillik hajmdan oshmaydi. Faqat tasdiqlangan ijro bajarilish foizini oshiradi.
5. Ko‘rik aniq aktivga bog‘lanadi. Jamlangan uchastkaning faqat bir qismi ishlansa, shu qismning alohida o‘lchovi bazada bo‘lishi kerak. Birliklar taxminan almashtirilmaydi; masalan dona va m² boshqa o‘lchovlardir.
6. Bir aktiv/ish/kunda band va bajarilgan hajm bir martalik sig‘imdan oshmaydi. Boshqa kundagi takroriy ish yillik/oylik limit ichida mumkin. Bekor qilish va qisman tasdiqlangan ijro foydalanilmagan hajmni bo‘shatadi. Bir xil kundagi yozuvlarni ajratish limitni chetlab o‘tmaydi.
7. Oylik dalolatnomaga faqat tekshirilgan ish kiradi. Ф2-Сақлаш manba ustunlari saqlanadi; yo‘l, uchastka, topshiriq, sana va xarajat jamlamasi qo‘shiladi. Qo‘shimcha dalolatnoma oldingi ishlarni qayta qo‘shmaydi. Hisobot tanlangan lotin/kirill yozuvida yuklanadi.

Sites — brauzerda saqlanadigan namoyish; ishlab chiqarish Laravel/PostgreSQL bazasidan mustaqil. RAMS va AI uchun haqiqiy ulanish ma’lumotlari serverda sozlanishi kerak. Bank to‘lovlari va yetkazib beruvchi hisob-fakturalari ulanmagan.
