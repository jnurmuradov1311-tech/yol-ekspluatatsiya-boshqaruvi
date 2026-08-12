<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Security\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class SettingsController extends Controller
{
    public function show(): JsonResponse
    {
        $rows = DB::table('roadops.system_settings')
            ->pluck('setting_value', 'setting_key');

        return response()->json(['data' => [
            'timezone' => $this->scalar($rows->get('timezone'), 'Asia/Tashkent'),
            'planningHorizonDays' => $this->scalar($rows->get('planning_horizon_days'), '14'),
        ]]);
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'timezone' => ['required', 'in:Asia/Tashkent'],
            'planningHorizonDays' => ['required', 'integer', 'min:1', 'max:90'],
        ]);
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        $after = [
            'timezone' => $validated['timezone'],
            'planningHorizonDays' => (string) $validated['planningHorizonDays'],
        ];
        DB::transaction(function () use ($validated, $context): void {
            DB::update(
                <<<'SQL'
                    update roadops.system_settings
                    set setting_value = to_jsonb(?::text), updated_by = ?::uuid,
                        updated_at = clock_timestamp()
                    where setting_key = 'timezone'
                SQL,
                [$validated['timezone'], $context->userId],
            );
            DB::update(
                <<<'SQL'
                    update roadops.system_settings
                    set setting_value = to_jsonb(?::integer), updated_by = ?::uuid,
                        updated_at = clock_timestamp()
                    where setting_key = 'planning_horizon_days'
                SQL,
                [$validated['planningHorizonDays'], $context->userId],
            );
        });

        return response()->json(['data' => $after]);
    }

    private function scalar(mixed $value, string $fallback): string
    {
        if ($value === null) {
            return $fallback;
        }
        if (is_string($value)) {
            $decoded = json_decode($value, true);

            return is_scalar($decoded) ? (string) $decoded : $fallback;
        }

        return is_scalar($value) ? (string) $value : $fallback;
    }
}
