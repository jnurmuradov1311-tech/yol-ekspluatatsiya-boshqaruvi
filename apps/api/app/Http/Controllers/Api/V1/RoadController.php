<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\ApiScope;
use App\Support\DbRows;
use App\Support\PagedResponse;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use stdClass;

final class RoadController extends Controller
{
    public function __invoke(Request $request, ApiScope $scope): JsonResponse
    {
        $pagination = Pagination::from($request);
        $active = $this->activeFilter($request);
        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $roadActivitySql = $active
            ? '(r.retired_at is null or r.retired_at > statement_timestamp())'
            : 'r.retired_at is not null and r.retired_at <= statement_timestamp()';
        $fromSql = str_replace('__ROAD_ACTIVITY__', $roadActivitySql, <<<'SQL'
            from roadops.roads r
            join roadops.road_versions rv on rv.road_id = r.id
              and rv.valid_from <= statement_timestamp()
              and (rv.valid_until is null or rv.valid_until > statement_timestamp())
            join roadops.road_division_assignments assignment on assignment.road_id = r.id
              and assignment.division_id = any(?::uuid[])
              and assignment.valid_from <= statement_timestamp()
              and (assignment.valid_until is null
                   or assignment.valid_until > statement_timestamp())
            join roadops.road_division_versions dv on dv.division_id = assignment.division_id
              and dv.valid_from <= statement_timestamp()
              and (dv.valid_until is null or dv.valid_until > statement_timestamp())
            where __ROAD_ACTIVITY__
        SQL);
        $total = (int) DB::scalar(
            'select count(distinct r.id) '.$fromSql,
            [$divisionIds],
        );
        $rows = DbRows::select(
            <<<'SQL'
                select r.id, rv.official_code, rv.name, rv.length_m,
                       string_agg(distinct dv.name, ', ' order by dv.name) division_name
            SQL.' '.$fromSql.' group by r.id, rv.official_code, rv.name, rv.length_m
                order by lower(rv.official_code), lower(rv.name), r.id limit ? offset ?',
            [$divisionIds, $pagination->pageSize, $pagination->offset()],
        );
        $items = array_map(static fn (stdClass $road): array => [
            'id' => (string) $road->id,
            'code' => (string) $road->official_code,
            'name' => (string) $road->name,
            'divisionName' => (string) $road->division_name,
            'lengthM' => (int) $road->length_m,
        ], $rows);

        return PagedResponse::make($items, $pagination->page, $pagination->pageSize, $total);
    }

    private function activeFilter(Request $request): bool
    {
        $value = $request->query('active', 'true');
        if ($value === true || $value === 1 || $value === '1' || $value === 'true') {
            return true;
        }
        if ($value === false || $value === 0 || $value === '0' || $value === 'false') {
            return false;
        }

        throw ValidationException::withMessages([
            'active' => ['Qiymat true yoki false bo‘lishi kerak.'],
        ]);
    }
}
