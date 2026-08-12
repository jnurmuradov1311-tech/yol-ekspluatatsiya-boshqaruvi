<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

final class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        try {
            $database = (int) DB::scalar('select 1') === 1 ? 'ok' : 'failed';
        } catch (\Throwable) {
            $database = 'failed';
        }

        return response()->json([
            'data' => [
                'service' => 'roadops-api',
                'status' => $database === 'ok' ? 'ok' : 'degraded',
                'database' => $database,
                'time' => now()->toIso8601String(),
            ],
        ], $database === 'ok' ? 200 : 503);
    }
}
