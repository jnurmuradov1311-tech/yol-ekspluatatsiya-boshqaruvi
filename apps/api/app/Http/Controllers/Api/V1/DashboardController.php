<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Security\AuthContext;
use App\Support\ApiScope;
use App\Support\DbRows;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use stdClass;

final class DashboardController extends Controller
{
    public function __invoke(Request $request, ApiScope $scope): JsonResponse
    {
        $divisionIds = $scope->roadUnitIds($request);
        $pgIds = $scope->pgUuidArray($divisionIds);
        $counts = DbRows::selectOneOrFail(
            <<<'SQL'
                select
                  (select count(*) from roadops.roadvision_candidates c
                    join roadops.road_versions candidate_road
                      on candidate_road.road_id = c.road_id and candidate_road.valid_until is null
                    where roadops.division_for_road_zone(c.road_id, c.chainage_span, c.observed_at)
                          = any(?::uuid[])
                      and candidate_road.official_code = 'D001' and candidate_road.length_m = 67000
                      and c.status in ('received','unmatched','awaiting_verification')) as review_queue,
                  (select count(*) from roadops.defect_cases dc
                    join roadops.road_versions defect_road
                      on defect_road.road_id = dc.road_id and defect_road.valid_until is null
                    where roadops.division_for_road_zone(dc.road_id, dc.chainage_span, dc.observed_at)
                          = any(?::uuid[])
                      and defect_road.official_code = 'D001' and defect_road.length_m = 67000
                      and dc.status in ('open','planned','in_progress')) as confirmed_defects,
                  (select count(*) from roadops.plan_items pi
                     join roadops.planning_runs pr on pr.id = pi.planning_run_id
                     join roadops.road_versions planned_road
                       on planned_road.road_id = pi.road_id and planned_road.valid_until is null
                    where pr.division_id = any(?::uuid[]) and pi.status in ('approved','scheduled','in_progress')
                      and planned_road.official_code = 'D001' and planned_road.length_m = 67000
                      and lower(pi.scheduled_window) >= date_trunc('day', now())
                      and lower(pi.scheduled_window) < date_trunc('day', now()) + interval '1 day') as planned_today,
                  (select count(*) from roadops.work_orders wo
                     join roadops.plan_items pi on pi.id = wo.plan_item_id
                     join roadops.planning_runs pr on pr.id = pi.planning_run_id
                     join roadops.road_versions open_order_road
                       on open_order_road.road_id = pi.road_id and open_order_road.valid_until is null
                    where pr.division_id = any(?::uuid[]) and wo.status in ('issued','accepted','in_progress','paused')
                      and open_order_road.official_code = 'D001' and open_order_road.length_m = 67000
                    ) as open_work_orders,
                  (select count(*) from roadops.work_orders wo
                     join roadops.plan_items pi on pi.id = wo.plan_item_id
                     join roadops.planning_runs pr on pr.id = pi.planning_run_id
                     join roadops.road_versions overdue_order_road
                       on overdue_order_road.road_id = pi.road_id and overdue_order_road.valid_until is null
                    where pr.division_id = any(?::uuid[]) and wo.status in ('issued','accepted','in_progress','paused')
                      and overdue_order_road.official_code = 'D001' and overdue_order_road.length_m = 67000
                      and upper(pi.scheduled_window) < now()) as overdue_work_orders,
                  (select count(*) from roadops.worker_versions wv
                    where roadops.division_for_worker_assignment(
                            wv.worker_id,
                            (statement_timestamp() at time zone 'Asia/Tashkent')::date
                          )
                          = any(?::uuid[])
                      and wv.valid_until is null and wv.employment_state = 'active') as workers_on_shift,
                  (select count(*) from roadops.equipment_units eu
                    where eu.division_id = any(?::uuid[]) and eu.state = 'active'
                      and not exists (select 1 from roadops.equipment_unavailability un
                        where un.equipment_unit_id = eu.id
                          and un.unavailable_window && tstzrange(now(), now() + interval '1 day', '[)'))
                      and not exists (select 1 from roadops.equipment_reservations er
                        where er.equipment_unit_id = eu.id and er.status in ('reserved','checked_out')
                          and er.reserved_window && tstzrange(now(), now() + interval '1 day', '[)'))) as available_equipment,
                  (select count(*) from roadops.sync_runs sr
                     join roadops.integration_connections ic on ic.id = sr.connection_id
                    where sr.status in ('failed','partially_succeeded') and sr.started_at >= now() - interval '7 days') as failed_syncs
            SQL,
            array_fill(0, 7, $pgIds),
        );

        $division = null;
        if (count($divisionIds) === 1) {
            $row = DbRows::selectOne(
                <<<'SQL'
                    select d.id, dv.name from roadops.road_divisions d
                    join roadops.road_division_versions dv on dv.division_id = d.id and dv.valid_until is null
                    where d.id = ? and d.retired_at is null
                SQL,
                [$divisionIds[0]],
            );
            if ($row !== null) {
                $division = ['id' => (string) $row->id, 'name' => (string) $row->name];
            }
        }

        $alerts = [];
        if ((int) $counts->failed_syncs > 0) {
            $alerts[] = [
                'id' => 'integration-review',
                'kind' => 'danger',
                'title' => 'Integratsiya xatosi tekshirilishi kerak',
                'detail' => 'Oxirgi 7 kunda tugallanmagan yoki xatoli sinxronizatsiya bor.',
                'href' => '/integratsiyalar',
            ];
        }
        if ((int) $counts->review_queue > 0) {
            $alerts[] = [
                'id' => 'roadvision-review',
                'kind' => 'warning',
                'title' => 'RoadVision kuzatuvlari qaror kutmoqda',
                'detail' => 'Inson tasdig‘isiz ular rejalashtirishga kiritilmaydi.',
                'href' => '/nuqsonlar',
            ];
        }

        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        $activityRows = DbRows::select(
            <<<'SQL'
                select ae.event_id, ae.occurred_at, coalesce(u.full_name, 'Tizim') actor,
                       ae.action, coalesce(ae.entity_type || ' ' || ae.entity_id, ae.entity_type) subject
                from roadops.audit_events ae
                left join roadops.app_users u on u.id = ae.actor_user_id
                where ae.actor_user_id = ?
                order by ae.occurred_at desc, ae.id desc
                limit 12
            SQL,
            [$context->userId],
        );

        return response()->json(['data' => [
            'asOf' => now()->toIso8601String(),
            'division' => $division,
            'counts' => [
                'reviewQueue' => (int) $counts->review_queue,
                'confirmedDefects' => (int) $counts->confirmed_defects,
                'plannedToday' => (int) $counts->planned_today,
                'openWorkOrders' => (int) $counts->open_work_orders,
                'overdueWorkOrders' => (int) $counts->overdue_work_orders,
                'workersOnShift' => (int) $counts->workers_on_shift,
                'availableEquipment' => (int) $counts->available_equipment,
                'failedSyncs' => (int) $counts->failed_syncs,
            ],
            'alerts' => $alerts,
            'activity' => array_map(static fn (stdClass $row): array => [
                'id' => (string) $row->event_id,
                'occurredAt' => (string) $row->occurred_at,
                'actor' => (string) $row->actor,
                'action' => (string) $row->action,
                'subject' => (string) $row->subject,
            ], $activityRows),
        ]]);
    }
}
