<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\DbRows;
use DateTimeImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;

final class AdminNetworkSummaryController extends Controller
{
    public function __invoke(): JsonResponse
    {
        try {
            $summary = DbRows::selectOneOrFail(
                'select * from roadops.admin_network_summary()',
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
            'asOf' => (new DateTimeImmutable((string) $summary->as_of))->format(DATE_ATOM),
            'officialNetworkLengthKm' => (int) $summary->official_network_length_km,
            'synchronizedRoadLengthKm' => (string) $summary->synchronized_road_length_km,
            'synchronizedRoadCount' => (int) $summary->synchronized_road_count,
            'synchronizedDivisionCount' => (int) $summary->synchronized_division_count,
        ]]);
    }
}
