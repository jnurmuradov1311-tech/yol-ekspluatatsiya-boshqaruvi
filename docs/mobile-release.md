# Mobil ilovani ishga tushirish

`apps/web` Android va iPhone bosh ekraniga o‘rnatiladigan PWA ilovadir. Telefon va kompyuter bir xil server, foydalanuvchi huquqlari va ma’lumotlardan foydalanadi. Bu nusxa APK yoki App Store paketi emas.

## Ishlaydigan imkoniyatlar

- Telefon ekranida pastki menyu: bosh sahifa, nuqson kiritish (ruxsat bo‘lmasa nuqsonlar), topshiriqlar va barcha bo‘limlar.
- Nuqson kiritish, topshiriqni ko‘rish, bajarilgan ish va fayllarni serverga yuborish mavjud web oqimi orqali bajariladi.
- Ekran chetlari va iPhone pastki boshqaruv chizig‘i uchun xavfsiz bo‘shliq; formalar 16 px, asosiy tugmalar kamida 44 px.
- Internet uzilganda aniq xabar va xavfsiz qayta ochish sahifasi. Offline yozuv yuborish yoki keyinchalik avtomatik yuborish mavjud emas. Saqlangani server javobi bilan tasdiqlanadi.
- Qurilmaga ish haqi, topshiriq, foto, hisobot yoki API javoblari service worker orqali saqlanmaydi. Faqat ochiq offline sahifa va ilova belgilariga kesh bor.

## Serverga joylash

1. `apps/web/README.md` va asosiy `README.md` bo‘yicha API hamda web serverni sozlang. `NEXT_PUBLIC_E2E_FIXTURES` ishlab chiqarish muhitida yoqilmasin.
2. Web ilova ishonchli **HTTPS** domenida ochilsin. `BACKEND_INTERNAL_URL` shu muhitning haqiqiy API serveriga yo‘nalsin. Brauzer APIga web domenidagi `/api/v1` orqali murojaat qiladi.
3. `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` va `npm run start` bajariladi. Buildni ishlab chiqarish uchun ajratilgan muhitda yarating.
4. Teskari proksi `/sw.js`, `/manifest.webmanifest` va `/mobile/*` fayllarini web serverga uzatsin. `/sw.js` uchun `no-cache, no-store, must-revalidate` sarlavhasini saqlang.
5. Cookie xavfsizligi, TLS, kirish va chiqish, foydalanuvchi huquqlari hamda fayl yuklashni haqiqiy domen bilan tekshiring.

## Telefonga o‘rnatish

**Android:** HTTPS saytni Chrome orqali oching → «Yana» → «Ilovani o‘rnatish». Brauzer taklif qilsa «Telefonga o‘rnatish»ni bosing. Aks holda Chrome menyusidagi «Ilovani o‘rnatish»dan foydalaning.

**iPhone:** saytni Safari orqali oching → «Ulashish» → «Bosh ekranga qo‘shish». O‘rnatilgach bosh ekrandagi «Yagona yo‘l» belgisini oching.

Ilova ichida tashkilotning haqiqiy akkaunti bilan kiriladi. Sites namoyish nusxasi va ishlab chiqarish serveri alohida muhitlardir.

## Qabul qilish tekshiruvi

- 360–430 px ekranda pastki menyu va saqlash tugmalari ko‘rinadi; gorizontal jadvallar o‘z hududida suriladi.
- Usta nuqson kiritadi; boshliq uni tekshiradi, ish, vaqt, yo‘l yopilishi va resurslarni belgilab ijroga beradi; usta natijani topshiradi.
- Surat/video fayli yuklanadi. Xato bo‘lsa yozuv yuborildi deb ko‘rsatilmaydi.
- Internet uzilib qaytganda sahifa qayta ochiladi. Avvalgi foydalanuvchining ma’lumotlari offline sahifada ko‘rinmaydi.
- Chiqish va boshqa akkaunt bilan kirishda avvalgi tashkilot yozuvlari qaytmaydi.
- Haqiqiy Android va iPhone bilan o‘rnatish hamda fayl yuklash yakuniy qabul sinovida tekshiriladi.

## Google Play va App Store

Hozirgi kod browser orqali o‘rnatiladigan mobil ilovani beradi. Imzolangan AAB/APK va iOS IPA, do‘kon akkaunti, tashkilot sertifikatlari va do‘kon tekshiruvi ushbu paketga kirmaydi. Native do‘kon paketi alohida talab etilsa, ichiga yig‘ilgan web resurslari, native autentifikatsiya va fayl adapterlari bilan alohida release kerak. Capacitor `server.url` orqali ishlab turgan saytni shunchaki o‘rash bu yerda tayyor ishlab chiqarish ilovasi sifatida qo‘shilmadi: rasmiy hujjat ushbu parametrni live reload uchun deb belgilaydi.

Manbalar: [Next.js PWA](https://nextjs.org/docs/app/guides/progressive-web-apps), [Capacitor konfiguratsiyasi](https://capacitorjs.com/docs/config).
