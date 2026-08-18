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
use stdClass;

final class WorkOrderController extends Controller
{
    public function index(Request $request, ApiScope $scope): JsonResponse
    {
        $pagination = Pagination::from($request);
        $validated = $request->validate([
            'state' => ['sometimes', 'string', 'in:DRAFT,ASSIGNED,IN_PROGRESS,PAUSED,COMPLETED,VERIFIED,CANCELLED'],
        ]);
        $state = isset($validated['state']) ? (string) $validated['state'] : null;
        $statuses = match ($state) {
            'ASSIGNED' => '{issued,accepted}',
            'IN_PROGRESS' => '{in_progress}',
            'PAUSED' => '{paused}',
            'COMPLETED' => '{completed,verified}',
            'CANCELLED' => '{cancelled}',
            default => '{}',
        };
        $allStates = $state === null ? 1 : 0;
        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $baseSql = <<<'SQL'
                select wo.id, wo.order_number, wo.status,
                       coalesce(wi.normalized_name, dt.name, 'Ish turi ko‘rsatilmagan') work_name,
                       rv.official_code road_code, rv.name road_name,
                       lower(pi.chainage_span) chainage_from, upper(pi.chainage_span) chainage_to,
                       (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date scheduled_date,
                       coalesce((
                           select string_agg(distinct wv.full_name, ', ' order by wv.full_name)
                           from roadops.work_assignments wa
                           join roadops.worker_versions wv on wv.worker_id = wa.worker_id and wv.valid_until is null
                           where wa.plan_item_id = pi.id and wa.status <> 'cancelled'
                       ), 'Brigada biriktirilmagan') team_name,
                       pi.work_quantity, pi.work_unit
                from roadops.work_orders wo
                join roadops.plan_items pi on pi.id = wo.plan_item_id
                join roadops.planning_runs pr on pr.id = pi.planning_run_id
                join roadops.road_versions rv on rv.road_id = pi.road_id and rv.valid_until is null
                left join roadops.iqn_work_variants v on v.id = pi.work_variant_id
                left join roadops.iqn_work_items wi on wi.id = v.work_item_id
                left join roadops.defect_cases dc on dc.id = pi.defect_case_id
                left join roadops.defect_types dt on dt.id = dc.defect_type_id
                where pr.division_id = any(?::uuid[])
                  and (?::integer = 1 or wo.status = any(?::text[]))
            SQL;
        $bindings = [$divisionIds, $allStates, $statuses];
        $total = (int) DB::scalar(
            'select count(*) from ('.$baseSql.') scoped_work_orders',
            $bindings,
        );
        $rows = DbRows::select(
            $baseSql.' order by coalesce(lower(pi.scheduled_window), wo.issued_at), wo.order_number, wo.id limit ? offset ?',
            [...$bindings, $pagination->pageSize, $pagination->offset()],
        );

        return PagedResponse::make(array_map(fn (stdClass $row): array => [
            'id' => (string) $row->id,
            'number' => (string) $row->order_number,
            'workName' => (string) $row->work_name,
            'road' => ['code' => (string) $row->road_code, 'name' => (string) $row->road_name],
            'locationLabel' => sprintf(
                'km %.3f–%.3f',
                (float) $row->chainage_from / 1000,
                (float) $row->chainage_to / 1000,
            ),
            'scheduledDate' => $row->scheduled_date === null ? '' : (string) $row->scheduled_date,
            'teamName' => (string) $row->team_name,
            'state' => $this->state((string) $row->status),
            'exactQuantity' => [
                'value' => $row->work_quantity === null ? '0' : (string) $row->work_quantity,
                'unit' => $row->work_unit === null ? '—' : (string) $row->work_unit,
            ],
        ], $rows), $pagination->page, $pagination->pageSize, $total);
    }

    private function state(string $state): string
    {
        return match ($state) {
            'issued', 'accepted' => 'ASSIGNED',
            'in_progress' => 'IN_PROGRESS',
            'paused' => 'PAUSED',
            'completed' => 'COMPLETED',
            'verified' => 'VERIFIED',
            'cancelled' => 'CANCELLED',
            default => 'DRAFT',
        };
    }
}
