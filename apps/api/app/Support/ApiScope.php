<?php

namespace App\Support;

use App\Security\AuthContext;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

final class ApiScope
{
    /** @return list<string> */
    public function roadUnitIds(Request $request): array
    {
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        $requested = trim((string) $request->query('roadUnitId', ''));
        if ($requested === '') {
            return $context->roadUnitIds;
        }
        if (! preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $requested)) {
            throw ValidationException::withMessages(['roadUnitId' => ["Yo'l bo'limi IDsi yaroqsiz."]]);
        }
        if (! $context->canAccessRoadUnit($requested)) {
            abort(403, "Bu yo'l bo'limiga ruxsat yo'q.");
        }

        return [$requested];
    }

    /** @param list<string> $ids */
    public function pgUuidArray(array $ids): string
    {
        foreach ($ids as $id) {
            if (! preg_match('/^[0-9a-f-]{36}$/i', $id)) {
                throw new \InvalidArgumentException('Invalid UUID in API scope.');
            }
        }

        return '{'.implode(',', $ids).'}';
    }
}
