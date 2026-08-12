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

final class ResourceController extends Controller
{
    public function __invoke(Request $request, ApiScope $scope, string $kind): JsonResponse
    {
        $pagination = Pagination::from($request);
        $ids = $scope->pgUuidArray($scope->roadUnitIds($request));
        [$sql, $countSql] = match ($kind) {
            'workers' => [
                <<<'SQL'
                    select w.id, wv.full_name name, wv.personnel_number code, dv.name division_name,
                           coalesce(wv.position_name, wa.job_title, 'Lavozim kiritilmagan') detail,
                           case wv.employment_state when 'active' then 'Faol' when 'leave' then 'Ta’tilda'
                                when 'suspended' then 'Vaqtincha to‘xtatilgan' else 'Ishdan chiqqan' end state_label
                    from roadops.workers w
                    join roadops.worker_versions wv on wv.worker_id = w.id and wv.valid_until is null
                    join roadops.worker_division_assignments wa
                      on wa.worker_id=w.id
                     and wa.valid_from <= (statement_timestamp() at time zone 'Asia/Tashkent')::date
                     and (wa.valid_until is null
                          or wa.valid_until > (statement_timestamp() at time zone 'Asia/Tashkent')::date)
                    join roadops.road_division_versions dv on dv.division_id = wa.division_id and dv.valid_until is null
                    where wa.division_id = any(?::uuid[]) and w.retired_at is null
                    order by dv.name, wv.full_name, w.id, wa.division_id
                SQL,
                <<<'SQL'
                    select count(*)
                    from roadops.workers w
                    join roadops.worker_versions wv
                      on wv.worker_id=w.id and wv.valid_until is null
                    join roadops.worker_division_assignments wa
                      on wa.worker_id=w.id
                     and wa.valid_from <= (statement_timestamp() at time zone 'Asia/Tashkent')::date
                     and (wa.valid_until is null
                          or wa.valid_until > (statement_timestamp() at time zone 'Asia/Tashkent')::date)
                    join roadops.road_division_versions dv
                      on dv.division_id=wa.division_id and dv.valid_until is null
                    where wa.division_id=any(?::uuid[]) and w.retired_at is null
                SQL,
            ],
            'equipment' => [
                <<<'SQL'
                    select eu.id, eu.name, eu.inventory_code code, dv.name division_name,
                           coalesce(eu.attributes->>'model', 'Model kiritilmagan') detail,
                           case eu.state when 'active' then 'Faol' when 'maintenance' then 'Ta’mirda'
                                when 'out_of_service' then 'Ishdan tashqari' else 'Hisobdan chiqarilgan' end state_label
                    from roadops.equipment_units eu
                    join roadops.road_division_versions dv on dv.division_id=eu.division_id and dv.valid_until is null
                    where eu.division_id=any(?::uuid[]) order by dv.name, eu.name, eu.id
                SQL,
                <<<'SQL'
                    select count(*)
                    from roadops.equipment_units eu
                    join roadops.road_division_versions dv
                      on dv.division_id=eu.division_id and dv.valid_until is null
                    where eu.division_id=any(?::uuid[])
                SQL,
            ],
            'warehouse' => [
                <<<'SQL'
                    select concat(sl.id, '-', m.id) id, m.name, m.code, dv.name division_name,
                           concat(csb.on_hand_quantity, ' ', m.unit, ' · ', sl.name) detail,
                           case when csb.on_hand_quantity > 0 then 'Mavjud' else 'Tugagan' end state_label
                    from roadops.current_stock_balances csb
                    join roadops.stock_locations sl on sl.id=csb.stock_location_id
                    join roadops.materials m on m.id=csb.material_id
                    join roadops.road_division_versions dv on dv.division_id=sl.division_id and dv.valid_until is null
                    where sl.division_id=any(?::uuid[]) order by dv.name, m.name, sl.id, m.id
                SQL,
                <<<'SQL'
                    select count(*)
                    from roadops.current_stock_balances csb
                    join roadops.stock_locations sl on sl.id=csb.stock_location_id
                    join roadops.materials m on m.id=csb.material_id
                    join roadops.road_division_versions dv
                      on dv.division_id=sl.division_id and dv.valid_until is null
                    where sl.division_id=any(?::uuid[])
                SQL,
            ],
            'timesheets' => [
                <<<'SQL'
                    select te.id, wv.full_name name, wv.personnel_number code, dv.name division_name,
                           concat(te.work_date, ' · ', te.actual_minutes, ' daqiqa · ', wo.order_number) detail,
                           case when te.approved_at is null then 'Tasdiq kutilmoqda' else 'Tasdiqlangan' end state_label
                    from roadops.time_entries te
                    join roadops.workers w on w.id=te.worker_id
                    join roadops.worker_versions wv on wv.worker_id=w.id and wv.valid_until is null
                    join roadops.worker_division_assignments wa
                      on wa.worker_id=w.id and wa.valid_from <= te.work_date
                     and (wa.valid_until is null or wa.valid_until > te.work_date)
                    join roadops.work_orders wo on wo.id=te.work_order_id
                    join roadops.plan_items pi on pi.id=wo.plan_item_id
                    join roadops.planning_runs pr
                      on pr.id=pi.planning_run_id and pr.division_id=wa.division_id
                    join roadops.road_division_versions dv
                      on dv.division_id=pr.division_id and dv.valid_until is null
                    where pr.division_id=any(?::uuid[])
                    order by te.work_date desc, wv.full_name, te.id
                SQL,
                <<<'SQL'
                    select count(*)
                    from roadops.time_entries te
                    join roadops.worker_versions wv
                      on wv.worker_id=te.worker_id and wv.valid_until is null
                    join roadops.worker_division_assignments wa
                      on wa.worker_id=te.worker_id and wa.valid_from<=te.work_date
                     and (wa.valid_until is null or wa.valid_until>te.work_date)
                    join roadops.work_orders wo on wo.id=te.work_order_id
                    join roadops.plan_items pi on pi.id=wo.plan_item_id
                    join roadops.planning_runs pr
                      on pr.id=pi.planning_run_id and pr.division_id=wa.division_id
                    join roadops.road_division_versions dv
                      on dv.division_id=pr.division_id and dv.valid_until is null
                    where pr.division_id=any(?::uuid[])
                SQL,
            ],
            default => [null, null],
        };
        if ($sql === null || $countSql === null) {
            return response()->json(['error' => ['code' => 'RESOURCE_UNKNOWN', 'message' => "Noma'lum resurs turi."]], 404);
        }
        $rows = DbRows::select(
            $sql.' limit ? offset ?',
            [$ids, $pagination->pageSize, $pagination->offset()],
        );
        $total = (int) DB::scalar($countSql, [$ids]);

        return PagedResponse::make(array_map(static fn (stdClass $row): array => [
            'id' => (string) $row->id,
            'name' => (string) $row->name,
            'code' => $row->code === null ? null : (string) $row->code,
            'divisionName' => $row->division_name === null ? null : (string) $row->division_name,
            'detail' => (string) $row->detail,
            'stateLabel' => (string) $row->state_label,
        ], $rows), $pagination->page, $pagination->pageSize, $total);
    }
}
