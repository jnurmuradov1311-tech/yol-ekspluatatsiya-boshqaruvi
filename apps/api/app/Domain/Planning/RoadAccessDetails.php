<?php

namespace App\Domain\Planning;

final class RoadAccessDetails
{
    /** @return array<string, list<string>> */
    public static function errors(string $access, string $direction, string $lane, string $permit): array
    {
        if ($access === 'OPEN') {
            return [];
        }
        $errors = [];
        if (trim($direction) === '') {
            $errors['direction'] = ['Yopiladigan harakat yo‘nalishini belgilang.'];
        }
        if ($access === 'PARTIAL' && trim($lane) === '') {
            $errors['laneLabel'] = ['Yopiladigan aniq tasma raqami yoki nomini kiriting.'];
        }
        if ($access === 'CLOSED' && trim($permit) === '') {
            $errors['permitNumber'] = ['To‘liq yopish uchun ruxsatnoma raqamini kiriting.'];
        }

        return $errors;
    }
}
