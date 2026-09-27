<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\ApiScope;
use App\Support\DbRows;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class RoadAccessController extends Controller
{
    public function index(Request $request, ApiScope $scope): JsonResponse
    {
        $input = $request->validate([
            'dateFrom' => ['required', 'date_format:Y-m-d'],
            'dateTo' => ['required', 'date_format:Y-m-d', 'after_or_equal:dateFrom'],
        ]);
        $rows = DbRows::select(
            <<<'SQL'
                select roadops.road_access_details(pi.id) details
                from roadops.plan_items pi
                join roadops.planning_runs run on run.id = pi.planning_run_id
                join roadops.safety_schemes scheme on scheme.id = pi.safety_scheme_id
                where run.division_id = any(?::uuid[]) and run.status = 'published'
                  and scheme.scheme_kind <> 'shoulder_work'
                  and pi.scheduled_window && tstzrange(?::date::timestamp at time zone 'Asia/Tashkent',
                    (?::date + interval '1 day') at time zone 'Asia/Tashkent', '[)')
                order by lower(pi.scheduled_window), pi.id
                limit 501
            SQL,
            [$scope->pgUuidArray($scope->roadUnitIds($request)), $input['dateFrom'], $input['dateTo']],
        );

        return response()->json(['data' => [
            'items' => array_map(static fn ($row): array => json_decode((string) $row->details, true, 512, JSON_THROW_ON_ERROR), array_slice($rows, 0, 500)),
            'truncated' => count($rows) > 500,
        ]]);
    }
}
