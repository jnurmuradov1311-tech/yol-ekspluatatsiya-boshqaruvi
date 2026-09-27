<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Throwable;

final class InventoryViolation
{
    public static function response(Throwable $exception): ?JsonResponse
    {
        foreach ([
            'INVENTORY_ASSET_TYPE_MISMATCH' => 'Element turi ko‘rikda qayd etilgan nuqsonga mos emas.',
            'INVENTORY_REVIEW_REQUIRED' => 'Ko‘rik saqlandi. Tasdiqlashdan oldin joylashuvni yo‘l elementlari bazasi bilan aniqlashtiring.',
            'INVENTORY_ASSET_REQUIRED' => 'Dona hisobidagi ko‘rik uchun yo‘l elementini tanlang.',
            'INVENTORY_ASSET_NOT_EFFECTIVE' => 'Element tanlangan sanada ushbu yo‘lda mavjud emas.',
            'INVENTORY_MEASURE_MISSING' => 'Elementning shu birlikdagi o‘lchovi bazada yo‘q. Inventar ma’lumotini to‘ldiring.',
            'INVENTORY_UNIT_MISMATCH' => 'Ish birligi tasdiqlangan IQN va inventar o‘lchoviga mos emas.',
            'INVENTORY_MAPPING_REQUIRED' => 'Ishning inventar va IQN o‘lchovi bilan bog‘lanishi tasdiqlanishi kerak.',
            'INVENTORY_QUANTITY_EXCEEDED' => 'Hajm shu uchastkadagi elementlar yoki kunlik qoldiqdan oshdi.',
            'ANNUAL_QUANTITY_EXCEEDED' => 'Oylik topshiriqlar yig‘indisi tasdiqlangan reja hajmidan oshdi.',
            'ANNUAL_ITEM_SCOPE_MISMATCH' => 'Ishning yo‘li, sanasi yoki birligi yillik reja bandiga mos emas.',
        ] as $code => $message) {
            if (str_contains($exception->getMessage(), $code)) {
                return response()->json(['error' => ['code' => $code, 'message' => $message]], 422);
            }
        }

        return null;
    }
}
