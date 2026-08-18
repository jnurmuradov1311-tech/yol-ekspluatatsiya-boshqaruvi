# Manba tizimlari shartnomasi

## Yo'l ta'mirlash punkti

Kerakli obyektlar:

- `organization_unit`: tashqi ID, kod, nom, daraja (`REPUBLIC`, `REGION`,
  `ENTERPRISE`), holat, revision va amal sanalari;
- `organization_parent_assignment`: `REGION -> REPUBLIC` yoki
  `ENTERPRISE -> REGION`, barqaror tashqi ID, revision va amal sanalari;
- `road_unit`: tashqi ID, nom, profil, holat, revision;
- `division_enterprise_assignment`: yo'l bo'limi, korxona, revision va amal
  sanalari;
- `road`: tashqi ID, kod, nom, uzunlik, chiziqli geometriya, revision;
- `road_assignment`: yo'l, bo'lim, boshlanish/tugash piketi, yo'nalish, amal sanalari;
- `road_element`: tashqi ID, tur, joylashuv/geometriya, o'lcham yoki son, lifecycle;
- `employee`: tashqi ID, bo'lim, lavozim, faol sanalar;
- `employee_skill`: malaka/litsenziya va amal sanasi;
- har bir obyekt uchun `updated_at`, monoton revision va retired/deleted belgisi.

Adapter cursorli delta sync, webhook inbox va davriy to'liq reconciliationni qo'llaydi. Manba yozuvi lokal API orqali tahrirlanmaydi. Tuzatish `source_discrepancies` navbatiga yoziladi.

Amaldagi taklif etilgan YTP payloadi tashkilot darajalari va bog'lanishlarini
hali normativ tarzda bermaydi. Shu sabab `region_code`, nom, manzil yoki erkin
profil maydonidan ierarxiya taxmin qilinmaydi. Manba egasi tashqi ID, revision,
retirement va effective-date semantikasini tasdiqlab, validator hamda projector
birgalikda yangilanmaguncha ishlab chiqarish ierarxiya importi o'chiq qoladi.
Aniq darvoza `packages/contracts/external/ytp/organization-hierarchy-import.md`
faylida qayd etilgan.

## RoadVision

Workbook taksonomiya beradi, natija API shartnomasi bermaydi. Adapter ikkita aniq rejimni qo'llaydi:

- `s3_manifest`: vendor tasdiqlagan JSON manifestlarni S3 prefiksidan oladi;
- `vendor_api`: OAuth2/mTLS bilan cursorli rasmiy endpoint.

Har eventda barqaror `event_id`, `detection_id`, revision, schema version, model versiya, atribut kodi, vaqt, koordinata/piketaj, o'lchov va media checksum bo'lishi kerak. Webhook bo'lsa HMAC timestamp tekshiriladi.

Media obyektlari brauzerga `s3://` manzil bilan berilmaydi. Har bir obyekt alohida
indeksli, autentifikatsiyalangan same-origin endpoint orqali oqim qilinadi. Saqlangan
SHA-256 S3 dagi native `ChecksumType=FULL_OBJECT` SHA-256 bilan mos kelishi shart.
`x-amz-meta-sha256` mavjud bo'lsa qo'shimcha taqqoslanadi, ammo S3 hisoblagan
checksum o'rnini bosa olmaydi; checksum yo'q, composite yoki mos kelmasa oqim
yopiq qoladi. Qo'lda ko'rik dalillari RoadVision'dan alohida bucket, region va
prefiksda saqlanadi.

Deploymentda RoadVision uchun `ROADVISION_S3_BUCKET`, `ROADVISION_S3_REGION`,
`ROADVISION_S3_PREFIX`, `ROADVISION_EVIDENCE_MAX_BYTES`; qo'lda ko'rik uchun esa
`MANUAL_EVIDENCE_S3_BUCKET`, `MANUAL_EVIDENCE_S3_REGION`,
`MANUAL_EVIDENCE_S3_PREFIX`, `MANUAL_EVIDENCE_MAX_BYTES` alohida beriladi.
Prefikslar bo'sh bo'lsa yoki obyekt configured prefiksdan tashqarida bo'lsa API
ochilmaydi.

RoadVision atributi oldindan quyidagidan biriga tasdiqlanadi: `DEFECT_CANDIDATE`, `ASSET_OBSERVATION`, `SAFETY_OBSERVATION`, `IGNORE`. Faqat inson tasdiqlagan `DEFECT_CANDIDATE` tekshirilgan nuqsonga bog'lanadi.
