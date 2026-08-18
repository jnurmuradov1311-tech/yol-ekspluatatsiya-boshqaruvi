<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\DbRows;
use DateTimeImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use JsonException;
use RuntimeException;

final class AdminOrganizationHierarchyController extends Controller
{
    public function __invoke(): JsonResponse
    {
        try {
            $snapshot = DbRows::selectOneOrFail(
                'select * from roadops.admin_organization_hierarchy()',
            );
        } catch (QueryException $exception) {
            if ((string) $exception->getCode() !== '42501') {
                throw $exception;
            }

            return response()->json(['error' => [
                'code' => 'PERMISSION_DENIED',
                'message' => 'Bu amal uchun global administrator ruxsati kerak.',
            ]], 403);
        }

        return response()->json(['data' => [
            'asOf' => (new DateTimeImmutable((string) $snapshot->as_of))->format(DATE_ATOM),
            'officialNetworkLengthKm' => (int) $snapshot->official_network_length_km,
            'summary' => [
                'synchronizedRepublicCount' => (int) $snapshot->synchronized_republic_count,
                'synchronizedRegionCount' => (int) $snapshot->synchronized_region_count,
                'synchronizedEnterpriseCount' => (int) $snapshot->synchronized_enterprise_count,
                'synchronizedDivisionCount' => (int) $snapshot->synchronized_division_count,
                'unlinkedNodeCount' => (int) $snapshot->unlinked_node_count,
                'hierarchyComplete' => self::databaseBoolean($snapshot->hierarchy_complete),
            ],
            'tree' => self::jsonArray($snapshot->hierarchy_tree),
            'unlinkedNodes' => self::jsonArray($snapshot->unlinked_nodes),
        ]]);
    }

    /** @return list<array<string, mixed>> */
    private static function jsonArray(mixed $value): array
    {
        try {
            $decoded = json_decode((string) $value, true, 512, JSON_THROW_ON_ERROR);
        } catch (JsonException $exception) {
            throw new RuntimeException('Hierarchy snapshot contains invalid JSON.', 0, $exception);
        }

        if (! is_array($decoded) || ! array_is_list($decoded)) {
            throw new RuntimeException('Hierarchy snapshot must contain a JSON array.');
        }

        return $decoded;
    }

    private static function databaseBoolean(mixed $value): bool
    {
        return in_array($value, [true, 1, '1', 't', 'true'], true);
    }
}
