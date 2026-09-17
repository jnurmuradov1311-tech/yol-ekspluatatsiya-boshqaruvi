// User-supplied IQN 02-24 Annex 1; frequency is annual count, not the time norm basis.
export const recurrence = { mowing:2, drain:2, culvert:2, signWash:10, barrierWash:14, pavilionWash:10, pavilionPaint:2, lightingWash:14 };
export const conditionShares = {GOOD:.0005,FAIR:.007,POOR:.015,CRITICAL:.025};
export const importanceLabels = {INTERNATIONAL:'Xalqaro',STATE:'Davlat',LOCAL:'Mahalliy'};
export const conditionLabels = {GOOD:'I — yaxshi',FAIR:'II — qoniqarli',POOR:'III — yomon',CRITICAL:'IV — jiddiy shikastlangan'};
export const assetLabels = {PAVEMENT:'Qoplama',GRASS:'Ko‘kalamzor',DRAIN:'Suv qochirish novi',CULVERT:'Quvur',SIGN:'Yo‘l belgisi',PAVILION:'Bekat pavilyoni',BARRIER:'Metall to‘siq',CURB:'Bordyur',LIGHTING:'Yoritish',OTHER:'Boshqa aktiv'};
export const equipmentNorms = [
 {
  "id": "suit",
  "name": "Maxsus kostyum-shim",
  "months": 12,
  "unit": "to‘plam",
  "quantity": 1,
  "scope": "personal",
  "row": 1,
  "roles": [
   "mashinist",
   "haydovchi",
   "yol_ishchisi",
   "yol_ustasi",
   "energetik",
   "mexanik",
   "hht_muhandisi"
  ],
  "assumed": true
 },
 {
  "id": "gloves",
  "name": "Qo‘lqop",
  "months": 1,
  "unit": "juft",
  "quantity": 1,
  "scope": "personal",
  "row": 2,
  "roles": [
   "mashinist",
   "haydovchi",
   "yol_ishchisi",
   "yol_ustasi",
   "energetik",
   "mexanik",
   "ytb_boshligi"
  ],
  "assumed": true
 },
 {
  "id": "shoes",
  "name": "Maxsus poyafzal",
  "months": 12,
  "unit": "juft",
  "quantity": 1,
  "scope": "personal",
  "row": 3,
  "roles": [
   "mashinist",
   "haydovchi",
   "yol_ishchisi",
   "yol_ustasi",
   "energetik",
   "mexanik",
   "ytb_boshligi"
  ],
  "assumed": true
 },
 {
  "id": "vest",
  "name": "Ogohlantiruvchi nimcha",
  "months": 6,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 4,
  "roles": [
   "mashinist",
   "haydovchi",
   "yol_ishchisi",
   "yol_ustasi",
   "energetik",
   "mexanik",
   "hht_muhandisi",
   "ytb_boshligi"
  ],
  "assumed": true
 },
 {
  "id": "warm",
  "name": "Fufayka-kurtka",
  "months": 24,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 5,
  "roles": [
   "mashinist",
   "haydovchi",
   "yol_ishchisi",
   "yol_ustasi",
   "energetik",
   "mexanik",
   "hht_muhandisi",
   "ytb_boshligi"
  ],
  "assumed": true
 },
 {
  "id": "rain",
  "name": "Brezent plashch",
  "months": 36,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 6,
  "roles": [
   "yol_ishchisi",
   "yol_ustasi",
   "energetik",
   "mexanik",
   "hht_muhandisi",
   "ytb_boshligi"
  ],
  "assumed": true
 },
 {
  "id": "signal",
  "name": "Ishora kostyumi",
  "months": 12,
  "unit": "to‘plam",
  "quantity": 1,
  "scope": "personal",
  "row": 7,
  "roles": [
   "mashinist",
   "haydovchi",
   "yol_ishchisi",
   "yol_ustasi",
   "energetik",
   "mexanik",
   "hht_muhandisi",
   "ytb_boshligi"
  ],
  "assumed": true
 },
 {
  "id": "soap",
  "name": "Sovun",
  "months": 1,
  "unit": "kg",
  "quantity": 0.2,
  "scope": "personal",
  "row": 8,
  "roles": [
   "mashinist",
   "haydovchi",
   "yol_ishchisi",
   "yol_ustasi",
   "energetik",
   "mexanik",
   "hht_muhandisi",
   "ytb_boshligi"
  ],
  "assumed": false
 },
 {
  "id": "hat",
  "name": "Bosh kiyimi",
  "months": 12,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 9,
  "roles": [
   "mashinist",
   "haydovchi",
   "yol_ishchisi",
   "yol_ustasi",
   "energetik",
   "mexanik",
   "ytb_boshligi"
  ],
  "assumed": true
 },
 {
  "id": "shovel",
  "name": "Lopata-kurak",
  "months": 6,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 10,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": true
 },
 {
  "id": "forkshovel",
  "name": "Lopata-panshaxa",
  "months": 6,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 11,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": true
 },
 {
  "id": "handle",
  "name": "Dasta",
  "months": 6,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 12,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": true
 },
 {
  "id": "broom",
  "name": "Supurgi",
  "months": 6,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 13,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": true
 },
 {
  "id": "cloth",
  "name": "Pol lattasi",
  "months": 2,
  "unit": "m",
  "quantity": 2,
  "scope": "division",
  "row": 14,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": false
 },
 {
  "id": "brush",
  "name": "Bo‘yoq cho‘tkasi",
  "months": 6,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 15,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": true
 },
 {
  "id": "largebrush",
  "name": "Maklovitsa",
  "months": 2,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 16,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": true
 },
 {
  "id": "bucket",
  "name": "Chelak",
  "months": 12,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 17,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": true
 },
 {
  "id": "hoe",
  "name": "Ketmon",
  "months": 24,
  "unit": "dona",
  "quantity": 4,
  "scope": "division",
  "row": 18,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": false
 },
 {
  "id": "adze",
  "name": "Tesha",
  "months": 24,
  "unit": "dona",
  "quantity": 4,
  "scope": "division",
  "row": 19,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": false
 },
 {
  "id": "sickle",
  "name": "O‘roq",
  "months": 48,
  "unit": "dona",
  "quantity": 3,
  "scope": "division",
  "row": 20,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": false
 },
 {
  "id": "axe",
  "name": "Bolta",
  "months": 36,
  "unit": "dona",
  "quantity": 3,
  "scope": "division",
  "row": 21,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": false
 },
 {
  "id": "hammer",
  "name": "Bolg‘a",
  "months": 48,
  "unit": "dona",
  "quantity": 3,
  "scope": "division",
  "row": 22,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": false
 },
 {
  "id": "saw",
  "name": "Arra",
  "months": 36,
  "unit": "dona",
  "quantity": 3,
  "scope": "division",
  "row": 23,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": false
 },
 {
  "id": "shears",
  "name": "Tok qaychi",
  "months": 36,
  "unit": "dona",
  "quantity": 3,
  "scope": "division",
  "row": 24,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": false
 },
 {
  "id": "fork",
  "name": "Panshaxa",
  "months": 36,
  "unit": "dona",
  "quantity": 4,
  "scope": "division",
  "row": 25,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": false
 },
 {
  "id": "tape",
  "name": "Ruletka",
  "months": 36,
  "unit": "dona",
  "quantity": 2,
  "scope": "division",
  "row": 26,
  "roles": [
   "energetik"
  ],
  "assumed": false
 },
 {
  "id": "crowbar",
  "name": "Lom",
  "months": 36,
  "unit": "dona",
  "quantity": 4,
  "scope": "division",
  "row": 27,
  "roles": [
   "yol_ishchisi"
  ],
  "assumed": false
 },
 {
  "id": "chainsaw",
  "name": "Benzoarra",
  "months": 24,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 28,
  "roles": [
   "hht_muhandisi"
  ],
  "assumed": true
 },
 {
  "id": "planer",
  "name": "Elektr randa",
  "months": 24,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 29,
  "roles": [
   "hht_muhandisi"
  ],
  "assumed": true
 },
 {
  "id": "boots",
  "name": "Rezina etik",
  "months": 6,
  "unit": "juft",
  "quantity": 1,
  "scope": "personal",
  "row": 30,
  "roles": [
   "yol_ishchisi",
   "yol_ustasi",
   "hht_muhandisi"
  ],
  "assumed": true
 },
 {
  "id": "pliers",
  "name": "Ombur",
  "months": 36,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 31,
  "roles": [
   "energetik"
  ],
  "assumed": true
 },
 {
  "id": "screwdriver",
  "name": "Otvertka",
  "months": 36,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 32,
  "roles": [
   "energetik"
  ],
  "assumed": true
 },
 {
  "id": "tester",
  "name": "Tester",
  "months": 48,
  "unit": "dona",
  "quantity": 1,
  "scope": "personal",
  "row": 33,
  "roles": [
   "energetik"
  ],
  "assumed": true
 },
 {
  "id": "cart",
  "name": "Aravacha yoki zambil",
  "months": 36,
  "unit": "dona",
  "quantity": 1,
  "scope": "division",
  "row": 34,
  "roles": [],
  "assumed": false
 },
 {
  "id": "varnish",
  "name": "Qora lak",
  "months": null,
  "unit": "dona",
  "quantity": 1,
  "scope": "work",
  "row": 35,
  "roles": [],
  "assumed": false
 },
 {
  "id": "paints",
  "name": "Rangli bo‘yoqlar",
  "months": null,
  "unit": "dona",
  "quantity": 1,
  "scope": "work",
  "row": 36,
  "roles": [],
  "assumed": false
 },
 {
  "id": "lime",
  "name": "Ohak",
  "months": null,
  "unit": "dona",
  "quantity": 1,
  "scope": "work",
  "row": 37,
  "roles": [],
  "assumed": false
 },
 {
  "id": "cones",
  "name": "Ogohlantiruvchi konussimon belgi",
  "months": null,
  "unit": "dona",
  "quantity": 15,
  "scope": "division",
  "row": 38,
  "roles": [],
  "assumed": false
 },
 {
  "id": "fence",
  "name": "Ko‘chma shtaketnik",
  "months": 36,
  "unit": "dona",
  "quantity": 4,
  "scope": "division",
  "row": 39,
  "roles": [],
  "assumed": false
 },
 {
  "id": "temporary-signs",
  "name": "Vaqtinchalik yo‘l belgisi",
  "months": null,
  "unit": "dona",
  "quantity": 8,
  "scope": "worksite",
  "row": 40,
  "roles": [],
  "assumed": false
 },
 {
  "id": "asphalt",
  "name": "Asfalt yoki qora qorishma",
  "months": null,
  "unit": "dona",
  "quantity": 1,
  "scope": "work",
  "row": 41,
  "roles": [],
  "assumed": false
 },
 {
  "id": "cement",
  "name": "Sement",
  "months": null,
  "unit": "dona",
  "quantity": 1,
  "scope": "work",
  "row": 42,
  "roles": [],
  "assumed": false
 },
 {
  "id": "metal",
  "name": "Metall buyumlar",
  "months": null,
  "unit": "dona",
  "quantity": 1,
  "scope": "work",
  "row": 43,
  "roles": [],
  "assumed": false
 },
 {
  "id": "trimmer",
  "name": "Yovvoyi o‘tlarni o‘rish moslamasi",
  "months": 12,
  "unit": "dona",
  "quantity": 5,
  "scope": "division",
  "row": 44,
  "roles": [],
  "assumed": false
 }
];
