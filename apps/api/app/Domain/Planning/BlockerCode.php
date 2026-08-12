<?php

namespace App\Domain\Planning;

enum BlockerCode: string
{
    case ROAD_MAPPING_MISSING = 'ROAD_MAPPING_MISSING';
    case NO_ACTIVE_UNIT_ASSIGNMENT = 'NO_ACTIVE_UNIT_ASSIGNMENT';
    case IQN_MAPPING_MISSING = 'IQN_MAPPING_MISSING';
    case IQN_VARIANT_UNDETERMINED = 'IQN_VARIANT_UNDETERMINED';
    case IQN_VARIANT_NOT_APPROVED = 'IQN_VARIANT_NOT_APPROVED';
    case QUANTITY_MISSING = 'QUANTITY_MISSING';
    case UNIT_INCOMPATIBLE = 'UNIT_INCOMPATIBLE';
    case WORK_TEMPLATE_MISSING = 'WORK_TEMPLATE_MISSING';
    case WORKER_HOURS_INSUFFICIENT = 'WORKER_HOURS_INSUFFICIENT';
    case REQUIRED_SKILL_MISSING = 'REQUIRED_SKILL_MISSING';
    case EQUIPMENT_UNAVAILABLE = 'EQUIPMENT_UNAVAILABLE';
    case OPERATOR_UNAVAILABLE = 'OPERATOR_UNAVAILABLE';
    case MATERIAL_SHORTAGE = 'MATERIAL_SHORTAGE';
    case SAFETY_EQUIPMENT_SHORTAGE = 'SAFETY_EQUIPMENT_SHORTAGE';
    case TRAFFIC_CONTROL_PLAN_MISSING = 'TRAFFIC_CONTROL_PLAN_MISSING';
    case ROAD_ZONE_CONFLICT = 'ROAD_ZONE_CONFLICT';
    case PERMIT_REQUIRED = 'PERMIT_REQUIRED';
    case FINDING_NOT_VERIFIED = 'FINDING_NOT_VERIFIED';
    case SOURCE_DATA_STALE = 'SOURCE_DATA_STALE';

    public function messageUz(): string
    {
        return match ($this) {
            self::ROAD_MAPPING_MISSING => "Yo'l tashqi manbadagi yo'l bilan moslanmagan.",
            self::NO_ACTIVE_UNIT_ASSIGNMENT => "Tanlangan sanada yo'lga faol yo'l bo'limi biriktirilmagan.",
            self::IQN_MAPPING_MISSING => "Nuqson uchun tasdiqlangan IQN ish turi mosligi yo'q.",
            self::IQN_VARIANT_UNDETERMINED => "IQN variantini tanlash uchun o'lchov yoki shart yetishmaydi.",
            self::IQN_VARIANT_NOT_APPROVED => 'IQN varianti soha egasi tomonidan tasdiqlanmagan.',
            self::QUANTITY_MISSING => "Ish miqdorini hisoblash uchun o'lchov yetishmaydi.",
            self::UNIT_INCOMPATIBLE => "O'lchov birligi IQN bazis birligiga mos emas.",
            self::WORK_TEMPLATE_MISSING => "Tasdiqlangan brigada va resurs shabloni yo'q.",
            self::WORKER_HOURS_INSUFFICIENT => 'Davrda 420 daqiqalik kunlik chegarani buzmasdan yetarli ish vaqti topilmadi.',
            self::REQUIRED_SKILL_MISSING => 'Kerakli malakaga ega faol ishchi topilmadi.',
            self::EQUIPMENT_UNAVAILABLE => "Kerakli texnika davrda bo'sh va soz holatda emas.",
            self::OPERATOR_UNAVAILABLE => 'Texnika uchun amaldagi ruxsatga ega operator topilmadi.',
            self::MATERIAL_SHORTAGE => 'Mavjud va band qilinmagan material miqdori yetarli emas.',
            self::SAFETY_EQUIPMENT_SHORTAGE => "Belgi, konus yoki to'siq kabi xavfsizlik jihozi yetarli emas.",
            self::TRAFFIC_CONTROL_PLAN_MISSING => 'Tasdiqlangan harakatni tashkil etish sxemasi biriktirilmagan.',
            self::ROAD_ZONE_CONFLICT => "Shu yo'nalish va piket oralig'ida boshqa ish zonasi bilan to'qnashuv bor.",
            self::PERMIT_REQUIRED => "Yo'lni cheklash yoki yopish uchun ruxsat talab qilinadi.",
            self::FINDING_NOT_VERIFIED => 'RoadVision kuzatuvi inson tomonidan tasdiqlanmagan.',
            self::SOURCE_DATA_STALE => 'Manba sinxronizatsiyasi eskirgan; rejalashdan oldin yangilang.',
        };
    }

    public function remedyUz(): string
    {
        return match ($this) {
            self::ROAD_MAPPING_MISSING => "Yo'l ta'mirlash punkti identifikatori va geometriyasini moslang.",
            self::NO_ACTIVE_UNIT_ASSIGNMENT => "Manba tizimida yo'l–bo'lim birikmasi va amal sanasini to'g'rilang.",
            self::IQN_MAPPING_MISSING => 'Soha egasi nuqson–IQN mosligini tasdiqlasin.',
            self::IQN_VARIANT_UNDETERMINED, self::QUANTITY_MISSING => 'Talab qilingan uzunlik, maydon, chuqurlik, son yoki usulni kiriting.',
            self::IQN_VARIANT_NOT_APPROVED => "Variantni IQN ko'rik navbatida tasdiqlang yoki rad eting.",
            self::UNIT_INCOMPATIBLE => "Mos o'lchov kiriting yoki tasdiqlangan birlik konversiyasini yarating.",
            self::WORK_TEMPLATE_MISSING => 'Brigada rollari va resurs retseptini tasdiqlang.',
            self::WORKER_HOURS_INSUFFICIENT => 'Davrni kengaytiring yoki tasdiqlangan boshqa brigada jalb qiling.',
            self::REQUIRED_SKILL_MISSING => "Malakali ishchini biriktiring yoki bo'limlararo jalbni tasdiqlang.",
            self::EQUIPMENT_UNAVAILABLE => "Texnikani sozlang, bandligini o'zgartiring yoki boshqa texnika biriktiring.",
            self::OPERATOR_UNAVAILABLE => 'Amaldagi litsenziyali operatorni biriktiring.',
            self::MATERIAL_SHORTAGE => "Ombor kirimini rasmiylashtiring yoki mavjud rezervni qayta ko'ring.",
            self::SAFETY_EQUIPMENT_SHORTAGE => 'Xavfsizlik jihozlarini omborga kiriting yoki boshqa sanani tanlang.',
            self::TRAFFIC_CONTROL_PLAN_MISSING => 'Ish zonasi turiga mos sxemani xavfsizlik xodimiga tasdiqlating.',
            self::ROAD_ZONE_CONFLICT => "Vaqt yoki piket oralig'ini o'zgartiring.",
            self::PERMIT_REQUIRED => 'Vakolatli shaxs tasdiqlagan ruxsatni biriktiring.',
            self::FINDING_NOT_VERIFIED => 'Kuzatuvni tekshirib, tasdiqlang yoki rad eting.',
            self::SOURCE_DATA_STALE => 'Integratsiyani qayta sinxronlang va reconciliation xatolarini yoping.',
        };
    }
}
