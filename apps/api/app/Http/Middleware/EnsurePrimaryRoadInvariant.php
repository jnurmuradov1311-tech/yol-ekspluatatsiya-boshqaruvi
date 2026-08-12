<?php

namespace App\Http\Middleware;

use App\Support\DbRows;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class EnsurePrimaryRoadInvariant
{
    private const PRIMARY_ROAD_CODE = 'D001';

    private const PRIMARY_ROAD_LENGTH_PATTERN = '/^67000(?:\.0+)?$/D';

    public function handle(Request $request, Closure $next): Response
    {
        if ((string) config('roadops.primary_road_code') !== self::PRIMARY_ROAD_CODE
            || preg_match(
                self::PRIMARY_ROAD_LENGTH_PATTERN,
                (string) config('roadops.primary_road_length_m'),
            ) !== 1) {
            return $this->error(
                'D001_CONFIGURATION_MISMATCH',
                'PRIMARY_ROAD_CODE=D001 va PRIMARY_ROAD_LENGTH_M=67000 qilib sozlanishi shart.',
            );
        }

        $state = DbRows::selectOneOrFail(
            'select candidate_count, exact_count from roadops.primary_road_invariant()',
        );
        if ((int) $state->candidate_count !== 1 || (int) $state->exact_count !== 1) {
            return $this->error(
                'D001_SOURCE_MISSING_OR_AMBIGUOUS',
                'YTP manbasida aynan bitta faol D001 yo‘li va uning uzunligi aniq 67000 metr bo‘lishi shart.',
            );
        }

        return $next($request);
    }

    private function error(string $code, string $message): JsonResponse
    {
        return response()->json(['error' => [
            'code' => $code,
            'message' => $message,
        ]], 503);
    }
}
