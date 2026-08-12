<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Integrations\IntegrationReadiness;
use App\Domain\Integrations\SourceSystem;
use App\Http\Controllers\Controller;
use App\Jobs\SyncSourceJob;
use Illuminate\Http\JsonResponse;

final class IntegrationSyncController extends Controller
{
    public function __invoke(string $code): JsonResponse
    {
        $source = match (strtoupper($code)) {
            'YTP', 'ROAD_REPAIR_POINT' => SourceSystem::YTP,
            'ROADVISION' => SourceSystem::ROADVISION,
            default => null,
        };
        if ($source === null) {
            return response()->json([
                'error' => ['code' => 'INTEGRATION_UNKNOWN', 'message' => "Noma'lum integratsiya."],
            ], 404);
        }

        SyncSourceJob::dispatch($source);

        $items = (new IntegrationReadiness)->all();
        $responseCode = $source === SourceSystem::YTP ? 'ROAD_REPAIR_POINT' : 'ROADVISION';
        $item = array_values(array_filter($items, static fn (array $row): bool => $row['code'] === $responseCode))[0];
        $item['state'] = 'SYNCING';

        return response()->json(['data' => $item], 202);
    }
}
