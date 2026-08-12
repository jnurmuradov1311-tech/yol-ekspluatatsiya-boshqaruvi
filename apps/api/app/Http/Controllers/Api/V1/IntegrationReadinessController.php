<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Integrations\IntegrationReadiness;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

final class IntegrationReadinessController extends Controller
{
    public function __invoke(IntegrationReadiness $readiness): JsonResponse
    {
        return response()->json(['data' => $readiness->all()]);
    }
}
