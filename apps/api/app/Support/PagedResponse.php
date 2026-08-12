<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;

final class PagedResponse
{
    /** @param list<array<string, mixed>> $items */
    public static function make(array $items, int $page, int $pageSize, int $total): JsonResponse
    {
        return response()->json(['data' => [
            'items' => $items,
            'page' => $page,
            'pageSize' => $pageSize,
            'total' => $total,
        ]]);
    }
}
