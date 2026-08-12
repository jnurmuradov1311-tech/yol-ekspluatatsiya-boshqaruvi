# Manba tizimlari shartnomasi

## Yo'l ta'mirlash punkti

Kerakli obyektlar:

- `road_unit`: tashqi ID, nom, ota bo'lim, profil, holat, revision;
- `road`: tashqi ID, kod, nom, uzunlik, chiziqli geometriya, revision;
- `road_assignment`: yo'l, bo'lim, boshlanish/tugash piketi, yo'nalish, amal sanalari;
- `road_element`: tashqi ID, tur, joylashuv/geometriya, o'lcham yoki son, lifecycle;
- `employee`: tashqi ID, bo'lim, lavozim, faol sanalar;
- `employee_skill`: malaka/litsenziya va amal sanasi;
- har bir obyekt uchun `updated_at`, monoton revision va retired/deleted belgisi.

Adapter cursorli delta sync, webhook inbox va davriy to'liq reconciliationni qo'llaydi. Manba yozuvi lokal API orqali tahrirlanmaydi. Tuzatish `source_discrepancies` navbatiga yoziladi.

## RoadVision

Workbook taksonomiya beradi, natija API shartnomasi bermaydi. Adapter ikkita aniq rejimni qo'llaydi:

- `s3_manifest`: vendor tasdiqlagan JSON manifestlarni S3 prefiksidan oladi;
- `vendor_api`: OAuth2/mTLS bilan cursorli rasmiy endpoint.

Har eventda barqaror `event_id`, `detection_id`, revision, schema version, model versiya, atribut kodi, vaqt, koordinata/piketaj, o'lchov va media checksum bo'lishi kerak. Webhook bo'lsa HMAC timestamp tekshiriladi.

RoadVision atributi oldindan quyidagidan biriga tasdiqlanadi: `DEFECT_CANDIDATE`, `ASSET_OBSERVATION`, `SAFETY_OBSERVATION`, `IGNORE`. Faqat inson tasdiqlagan `DEFECT_CANDIDATE` tekshirilgan nuqsonga bog'lanadi.

