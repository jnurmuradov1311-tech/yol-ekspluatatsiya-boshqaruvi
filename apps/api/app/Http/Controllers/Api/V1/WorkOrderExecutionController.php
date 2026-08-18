<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Security\AuthContext;
use App\Support\ApiScope;
use App\Support\DbRows;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use stdClass;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

final class WorkOrderExecutionController extends Controller
{
    public function show(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        $order = $this->order($request, $scope, $id, false, true);
        if ($order === null) {
            abort(404);
        }

        return response()->json(['data' => $this->payload($order)]);
    }

    public function start(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        try {
            DB::transaction(function () use ($request, $scope, $id, $context): void {
                $order = $this->order($request, $scope, $id, true);
                if ($order === null) {
                    abort(404);
                }
                if ($order->status === 'in_progress') {
                    return;
                }
                if (! in_array($order->status, ['issued', 'accepted', 'paused'], true)) {
                    throw new \DomainException('WORK_ORDER_NOT_STARTABLE');
                }
                if ($order->scheduled_date === null
                    || (string) $order->scheduled_date !== now('Asia/Tashkent')->format('Y-m-d')) {
                    throw new \DomainException('WORK_ORDER_RESCHEDULE_REQUIRED');
                }
                DB::update(
                    <<<'SQL'
                        update roadops.work_orders
                        set status='in_progress', accepted_at=coalesce(accepted_at, clock_timestamp()),
                            started_at=coalesce(started_at, clock_timestamp()), row_version=row_version+1
                        where id=?
                    SQL,
                    [$id],
                );
                DbRows::select(
                    "select roadops.sync_plan_item_execution_status(?, 'in_progress')",
                    [$id],
                    false,
                );
                $this->event($id, (string) $order->status, 'in_progress', 'WORK_STARTED', $context->userId);
            });
        } catch (\Throwable $exception) {
            return $this->domainError($exception, 'WORK_ORDER_START_REJECTED');
        }

        return $this->detailResponse($request, $scope, $id);
    }

    public function reschedule(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        $validated = $request->validate([
            'scheduledDate' => ['required', 'date_format:Y-m-d'],
        ]);
        try {
            DB::transaction(function () use ($request, $scope, $id, $validated): void {
                $order = $this->order($request, $scope, $id, true);
                if ($order === null) {
                    abort(404);
                }
                if ($validated['scheduledDate'] < now('Asia/Tashkent')->format('Y-m-d')) {
                    throw new \DomainException('RESCHEDULE_DATE_IN_PAST');
                }
                if (! in_array($order->status, ['issued', 'accepted', 'paused'], true)
                    || $order->started_at !== null) {
                    throw new \DomainException('WORK_ORDER_NOT_RESCHEDULABLE');
                }
                DbRows::select(
                    'select roadops.reschedule_work_order(?, ?::date)',
                    [$id, $validated['scheduledDate']],
                    false,
                );
            });
        } catch (\Throwable $exception) {
            return $this->domainError($exception, 'WORK_ORDER_RESCHEDULE_REJECTED');
        }

        return $this->detailResponse($request, $scope, $id);
    }

    public function complete(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        $validated = $request->validate([
            'laborEntries' => ['required', 'array', 'min:1', 'max:100'],
            'laborEntries.*.workerId' => ['required', 'uuid'],
            'laborEntries.*.workDate' => ['required', 'date_format:Y-m-d'],
            'laborEntries.*.actualMinutes' => ['required', 'integer', 'between:1,420'],
            'materialUsages' => ['present', 'array', 'max:100'],
            'materialUsages.*.materialReservationId' => ['required', 'uuid', 'distinct'],
            'materialUsages.*.quantity' => ['required', 'numeric', 'gt:0'],
            'materialUsages.*.usedAt' => [
                'required',
                'date',
                'regex:/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})\z/',
            ],
            'equipmentUsages' => ['present', 'array', 'max:100'],
            'equipmentUsages.*.equipmentReservationId' => ['required', 'uuid', 'distinct'],
            'equipmentUsages.*.usageDate' => ['required', 'date_format:Y-m-d'],
            'equipmentUsages.*.actualMachineMinutes' => ['required', 'integer', 'between:1,1440'],
            'completedQuantity' => ['required', 'numeric', 'gt:0'],
            'unit' => ['required', 'string', 'max:50'],
            'note' => ['nullable', 'string', 'max:5000'],
            'evidence' => ['present', 'array', 'max:20'],
            'evidence.*' => [
                'string',
                'max:2048',
                'regex:/\Ahttps:\/\/[^\s?#]+\.(?:jpe?g|png|pdf)(?:\?[^\s#]*)?\z/i',
            ],
        ]);
        $laborEntryKeys = [];
        foreach ($validated['laborEntries'] as $index => $entry) {
            $key = strtolower((string) $entry['workerId']).'|'.$entry['workDate'];
            if (isset($laborEntryKeys[$key])) {
                throw ValidationException::withMessages([
                    "laborEntries.$index.workerId" => [
                        'Bir ishchi va ish sanasi kombinatsiyasi faqat bir marta yuborilishi mumkin.',
                    ],
                ]);
            }
            $laborEntryKeys[$key] = true;
        }
        $this->assertEvidenceOrigins($validated['evidence']);
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);

        try {
            DB::transaction(function () use ($request, $scope, $id, $validated, $context): void {
                $order = $this->order($request, $scope, $id, true);
                if ($order === null) {
                    abort(404);
                }
                if ($order->status === 'completed') {
                    return;
                }
                if ($order->status !== 'in_progress' || $order->started_at === null) {
                    throw new \DomainException('WORK_ORDER_NOT_IN_PROGRESS');
                }
                if ((string) $order->work_unit !== (string) $validated['unit']) {
                    throw new \DomainException('COMPLETION_UNIT_MISMATCH');
                }
                if (! (bool) DB::scalar(
                    'select ?::numeric <= ?::numeric',
                    [$validated['completedQuantity'], $order->work_quantity],
                )) {
                    throw new \DomainException('COMPLETED_QUANTITY_EXCEEDS_PLAN');
                }
                $completedAt = now('Asia/Tashkent');
                $startedDate = $this->localDate((string) $order->started_at);
                $completedDate = $completedAt->format('Y-m-d');

                foreach ($validated['laborEntries'] as $entry) {
                    if ($entry['workDate'] < $startedDate || $entry['workDate'] > $completedDate) {
                        throw new \DomainException('LABOR_DATE_OUTSIDE_ORDER');
                    }
                    $assigned = DB::scalar(
                        <<<'SQL'
                            select exists(
                              select 1 from roadops.work_assignments wa
                              where wa.plan_item_id=? and wa.worker_id=? and wa.work_date=?::date
                                and wa.status <> 'cancelled'
                            )
                        SQL,
                        [$order->plan_item_id, $entry['workerId'], $entry['workDate']],
                    );
                    if (! $assigned) {
                        throw new \DomainException('LABOR_WORKER_NOT_ASSIGNED');
                    }
                    DB::insert(
                        <<<'SQL'
                            insert into roadops.time_entries
                              (work_order_id, worker_id, work_date, actual_minutes, recorded_by, request_id)
                            values (?, ?, ?::date, ?, ?, roadops.current_request_id())
                        SQL,
                        [$id, $entry['workerId'], $entry['workDate'], $entry['actualMinutes'], $context->userId],
                    );
                }

                foreach ($validated['materialUsages'] as $usage) {
                    $reservation = DbRows::selectOne(
                        <<<'SQL'
                            select mr.id, mr.stock_location_id, mr.material_id, mr.quantity reserved_quantity,
                                   mr.status, m.unit
                            from roadops.material_reservations mr
                            join roadops.materials m on m.id=mr.material_id
                            where mr.id=? and mr.plan_item_id=? for update
                        SQL,
                        [$usage['materialReservationId'], $order->plan_item_id],
                        false,
                    );
                    if ($reservation === null || ! in_array($reservation->status, ['reserved', 'issued'], true)) {
                        throw new \DomainException('MATERIAL_RESERVATION_UNAVAILABLE');
                    }
                    if ((float) $usage['quantity'] > (float) $reservation->reserved_quantity) {
                        throw new \DomainException('MATERIAL_USAGE_EXCEEDS_RESERVATION');
                    }
                    $usedAt = new \DateTimeImmutable((string) $usage['usedAt']);
                    if ($usedAt < new \DateTimeImmutable((string) $order->started_at)
                        || $usedAt > $completedAt->toDateTimeImmutable()) {
                        throw new \DomainException('MATERIAL_DATE_OUTSIDE_ORDER');
                    }
                    DbRows::select('select pg_advisory_xact_lock(hashtextextended(?::text, 20260818))', [
                        $reservation->stock_location_id.':'.$reservation->material_id,
                    ]);
                    $balance = (float) DB::scalar(
                        <<<'SQL'
                            select coalesce(sum(quantity_delta),0)
                            from roadops.inventory_transactions
                            where stock_location_id=? and material_id=?
                        SQL,
                        [$reservation->stock_location_id, $reservation->material_id],
                    );
                    if ($balance < (float) $usage['quantity']) {
                        throw new \DomainException('INSUFFICIENT_MATERIAL_STOCK');
                    }
                    $usageId = (string) Str::uuid();
                    $transactionId = (string) Str::uuid();
                    DB::insert(
                        <<<'SQL'
                            insert into roadops.inventory_transactions
                              (id, stock_location_id, material_id, transaction_kind, quantity_delta,
                               occurred_at, reference_type, reference_id, recorded_by, request_id)
                            values (?, ?, ?, 'issue', -(?::numeric), ?,
                                    'work_order_material_usage', ?, ?, roadops.current_request_id())
                        SQL,
                        [
                            $transactionId, $reservation->stock_location_id, $reservation->material_id,
                            $usage['quantity'], $usedAt->format(DATE_ATOM), $usageId, $context->userId,
                        ],
                    );
                    DB::insert(
                        <<<'SQL'
                            insert into roadops.work_order_material_usages
                              (id, work_order_id, material_reservation_id, inventory_transaction_id,
                               stock_location_id, material_id, quantity, unit, used_at, recorded_by, request_id)
                            values (?, ?, ?, ?, ?, ?, ?::numeric, ?, ?, ?, roadops.current_request_id())
                        SQL,
                        [
                            $usageId, $id, $reservation->id, $transactionId,
                            $reservation->stock_location_id, $reservation->material_id,
                            $usage['quantity'], $reservation->unit,
                            $usedAt->format(DATE_ATOM), $context->userId,
                        ],
                    );
                    DbRows::select(
                        'select roadops.finalize_material_reservation_for_usage(?)',
                        [$usageId],
                        false,
                    );
                }

                foreach ($validated['equipmentUsages'] as $usage) {
                    if ($usage['usageDate'] < $startedDate || $usage['usageDate'] > $completedDate) {
                        throw new \DomainException('EQUIPMENT_DATE_OUTSIDE_ORDER');
                    }
                    $reservation = DbRows::selectOne(
                        <<<'SQL'
                            select er.id, er.equipment_unit_id, er.status, er.reserved_window,
                                   floor(extract(epoch from (upper(er.reserved_window)-lower(er.reserved_window)))/60)::integer
                                     reserved_minutes
                            from roadops.equipment_reservations er
                            where er.id=? and er.plan_item_id=? for update
                        SQL,
                        [$usage['equipmentReservationId'], $order->plan_item_id],
                        false,
                    );
                    if ($reservation === null || ! in_array($reservation->status, ['reserved', 'checked_out'], true)) {
                        throw new \DomainException('EQUIPMENT_RESERVATION_UNAVAILABLE');
                    }
                    if (! DB::scalar(
                        "select ?::date <@ daterange((lower(?::tstzrange) at time zone 'Asia/Tashkent')::date, ((upper(?::tstzrange) at time zone 'Asia/Tashkent')::date + 1), '[)')",
                        [$usage['usageDate'], $reservation->reserved_window, $reservation->reserved_window],
                    )) {
                        throw new \DomainException('EQUIPMENT_DATE_OUTSIDE_RESERVATION');
                    }
                    if ((int) $usage['actualMachineMinutes'] > (int) $reservation->reserved_minutes) {
                        throw new \DomainException('EQUIPMENT_USAGE_EXCEEDS_RESERVATION_WINDOW');
                    }
                    $usageId = (string) Str::uuid();
                    DB::insert(
                        <<<'SQL'
                            insert into roadops.equipment_usage_entries
                              (id, work_order_id, equipment_reservation_id, equipment_unit_id, usage_date,
                               actual_machine_minutes, recorded_by, request_id)
                            values (?, ?, ?, ?, ?::date, ?, ?, roadops.current_request_id())
                        SQL,
                        [
                            $usageId, $id, $reservation->id, $reservation->equipment_unit_id,
                            $usage['usageDate'], $usage['actualMachineMinutes'], $context->userId,
                        ],
                    );
                    DbRows::select(
                        'select roadops.finalize_equipment_reservation_for_usage(?)',
                        [$usageId],
                        false,
                    );
                }

                if ((bool) DB::scalar(
                    <<<'SQL'
                        select exists (
                          select 1
                          from roadops.material_reservations reservation
                          where reservation.plan_item_id=?
                            and reservation.status in ('reserved', 'issued')
                            and (
                              select count(*)
                              from roadops.work_order_material_usages usage
                              where usage.material_reservation_id=reservation.id
                                and usage.work_order_id=?
                            ) <> 1
                        )
                    SQL,
                    [$order->plan_item_id, $id],
                )) {
                    throw new \DomainException('MATERIAL_USAGE_COVERAGE_INCOMPLETE');
                }
                if ((bool) DB::scalar(
                    <<<'SQL'
                        select exists (
                          select 1
                          from roadops.equipment_reservations reservation
                          where reservation.plan_item_id=?
                            and reservation.status in ('reserved', 'checked_out', 'returned')
                            and (
                              select count(*)
                              from roadops.equipment_usage_entries usage
                              where usage.equipment_reservation_id=reservation.id
                                and usage.work_order_id=?
                            ) <> 1
                        )
                    SQL,
                    [$order->plan_item_id, $id],
                )) {
                    throw new \DomainException('EQUIPMENT_USAGE_COVERAGE_INCOMPLETE');
                }

                DB::insert(
                    <<<'SQL'
                        insert into roadops.work_completion_records
                          (work_order_id, completed_quantity, work_unit, evidence, completion_note, recorded_by)
                        values (?, ?::numeric, ?, ?::jsonb, ?, ?)
                    SQL,
                    [
                        $id, $validated['completedQuantity'], $validated['unit'],
                        json_encode(array_values($validated['evidence']), JSON_THROW_ON_ERROR),
                        $validated['note'] ?? null, $context->userId,
                    ],
                );
                DB::update(
                    <<<'SQL'
                        update roadops.work_orders
                        set status='completed', completed_at=?, row_version=row_version+1
                        where id=?
                    SQL,
                    [$completedAt->toIso8601String(), $id],
                );
                DbRows::select(
                    "select roadops.sync_plan_item_execution_status(?, 'completed')",
                    [$id],
                    false,
                );
                $this->event($id, 'in_progress', 'completed', 'WORK_COMPLETED', $context->userId, [
                    'completedQuantity' => (string) $validated['completedQuantity'],
                    'unit' => (string) $validated['unit'],
                ]);
            });
        } catch (\Throwable $exception) {
            return $this->domainError($exception, 'WORK_ORDER_COMPLETION_REJECTED');
        }

        return $this->detailResponse($request, $scope, $id);
    }

    public function verify(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        $validated = $request->validate([
            'note' => ['nullable', 'string', 'max:5000'],
        ]);
        try {
            DB::transaction(function () use ($request, $scope, $id, $validated): void {
                $order = $this->order($request, $scope, $id, false, true);
                if ($order === null) {
                    abort(404);
                }
                if ($order->status === 'verified') {
                    return;
                }
                if ($order->status !== 'completed') {
                    throw new \DomainException('WORK_ORDER_NOT_COMPLETED');
                }
                DbRows::select(
                    'select pg_advisory_xact_lock(hashtextextended(?::text, 20260818))',
                    [
                        $order->division_id.':'.substr(
                            $this->localDate((string) $order->completed_at),
                            0,
                            4,
                        ),
                    ],
                    false,
                );
                $order = $this->order($request, $scope, $id, true);
                if ($order === null) {
                    abort(404);
                }
                if ($order->status === 'verified') {
                    return;
                }
                if ($order->status !== 'completed') {
                    throw new \DomainException('WORK_ORDER_NOT_COMPLETED');
                }
                foreach (DbRows::select(
                    'select id from roadops.time_entries where work_order_id=? and approved_at is null order by id for update',
                    [$id],
                    false,
                ) as $entry) {
                    DbRows::select('select roadops.approve_time_entry(?)', [$entry->id], false);
                }
                foreach (DbRows::select(
                    "select id from roadops.work_order_material_usages where work_order_id=? and status='recorded' order by id for update",
                    [$id],
                    false,
                ) as $usage) {
                    DbRows::select('select roadops.approve_work_order_material_usage(?)', [$usage->id], false);
                }
                foreach (DbRows::select(
                    "select id from roadops.equipment_usage_entries where work_order_id=? and status='recorded' order by id for update",
                    [$id],
                    false,
                ) as $usage) {
                    DbRows::select('select roadops.approve_equipment_usage_entry(?)', [$usage->id], false);
                }
                DbRows::select(
                    "select set_config('roadops.verification_note', ?, true)",
                    [(string) ($validated['note'] ?? '')],
                    false,
                );
                DbRows::select('select roadops.verify_work_order_completion(?)', [$id], false);
            });
        } catch (\Throwable $exception) {
            return $this->domainError($exception, 'WORK_ORDER_VERIFICATION_REJECTED', 409);
        }

        return $this->detailResponse($request, $scope, $id);
    }

    private function order(
        Request $request,
        ApiScope $scope,
        string $id,
        bool $lock = false,
        bool $primary = false,
    ): ?stdClass {
        if (! Str::isUuid($id)) {
            return null;
        }
        $suffix = $lock ? ' for update of wo' : '';
        $sql = <<<'SQL'
            select wo.*, pi.id plan_item_id, pi.work_quantity, pi.work_unit,
                   lower(pi.chainage_span) chainage_from, upper(pi.chainage_span) chainage_to,
                   (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date scheduled_date,
                   run.division_id,
                   rv.official_code road_code, rv.name road_name,
                   coalesce(wi.normalized_name, dt.name, 'Ish turi ko‘rsatilmagan') work_name,
                   coalesce(
                     concat_ws(' · ', doc.code, nullif(wi.raw_code,''), nullif(wi.normalized_name,'')),
                     'IQN normasi biriktirilmagan'
                   ) norm_reference,
                   coalesce((
                     select string_agg(distinct assigned.full_name, ', ' order by assigned.full_name)
                     from roadops.work_assignments wa
                     join roadops.worker_versions assigned
                       on assigned.worker_id=wa.worker_id and assigned.valid_until is null
                     where wa.plan_item_id=pi.id and wa.status <> 'cancelled'
                   ), 'Brigada biriktirilmagan') team_name,
                   starter.id started_by_id, starter.full_name started_by_name,
                   cr.id completion_id, cr.recorded_at completion_recorded_at,
                   recorder.full_name completion_recorded_by_name,
                   cr.completed_quantity, cr.work_unit completed_unit, cr.evidence,
                   cr.completion_note, cr.verified_at completion_verified_at,
                   verifier.full_name completion_verified_by_name,
                   verification_event.note verification_note,
                   coalesce(
                     wo.status = 'completed'
                     and wo.completed_at is not null
                     and wo.verified_at is null
                     and cr.id is not null
                     and cr.verified_at is null
                     and roadops.current_actor_id() is not null
                     and wo.issued_by <> roadops.current_actor_id()
                     and cr.recorded_by <> roadops.current_actor_id()
                     and roadops.has_permission('execution.verify', run.division_id)
                     and not exists (
                       select 1 from roadops.time_entries pending_time
                       where pending_time.work_order_id = wo.id
                         and pending_time.approved_at is null
                         and pending_time.recorded_by = roadops.current_actor_id()
                     )
                     and not exists (
                       select 1 from roadops.work_order_material_usages pending_material
                       where pending_material.work_order_id = wo.id
                         and pending_material.status = 'recorded'
                         and pending_material.recorded_by = roadops.current_actor_id()
                     )
                     and not exists (
                       select 1 from roadops.equipment_usage_entries pending_equipment
                       where pending_equipment.work_order_id = wo.id
                         and pending_equipment.status = 'recorded'
                         and pending_equipment.recorded_by = roadops.current_actor_id()
                     ),
                     false
                   ) can_verify
            from roadops.work_orders wo
            join roadops.plan_items pi on pi.id=wo.plan_item_id
            join roadops.planning_runs run on run.id=pi.planning_run_id
            join roadops.road_versions rv on rv.road_id=pi.road_id and rv.valid_until is null
            left join roadops.iqn_work_variants variant on variant.id=pi.work_variant_id
            left join roadops.iqn_work_items wi on wi.id=variant.work_item_id
            left join roadops.iqn_documents doc on doc.id=wi.document_id
            left join roadops.defect_cases dc on dc.id=pi.defect_case_id
            left join roadops.defect_types dt on dt.id=dc.defect_type_id
            left join roadops.work_completion_records cr on cr.work_order_id=wo.id
            left join roadops.app_users recorder on recorder.id=cr.recorded_by
            left join roadops.app_users verifier on verifier.id=cr.verified_by
            left join lateral (
              select ev.actor_user_id
              from roadops.work_order_events ev
              where ev.work_order_id=wo.id and ev.event_code='WORK_STARTED'
              order by ev.occurred_at, ev.id limit 1
            ) started_event on true
            left join roadops.app_users starter on starter.id=started_event.actor_user_id
            left join lateral (
              select ev.note
              from roadops.work_order_events ev
              where ev.work_order_id=wo.id and ev.event_code='WORK_COMPLETION_VERIFIED'
              order by ev.occurred_at desc, ev.id desc limit 1
            ) verification_event on true
            where wo.id=? and run.division_id=any(?::uuid[])
        SQL;

        return DbRows::selectOne(
            $sql.$suffix,
            [$id, $scope->pgUuidArray($scope->roadUnitIds($request))],
            ! $lock && ! $primary,
        );
    }

    /** @return array<string, mixed> */
    private function payload(stdClass $order): array
    {
        $plannedWorkers = DbRows::select(
            <<<'SQL'
                select wa.worker_id, wv.full_name, coalesce(wv.position_name,'') position_name,
                       wa.work_date, wa.planned_minutes
                from roadops.work_assignments wa
                join roadops.worker_versions wv
                  on wv.worker_id=wa.worker_id and wv.valid_until is null
                where wa.plan_item_id=? and wa.status <> 'cancelled'
                order by wa.work_date, wv.full_name, wa.id
            SQL,
            [$order->plan_item_id],
            false,
        );
        $plannedMaterials = DbRows::select(
            <<<'SQL'
                select m.id material_id, mr.id reservation_id, m.code, m.name, m.unit,
                       mr.quantity planned_quantity,
                       coalesce(lower(pi.scheduled_window), mr.reserved_at) used_at
                from roadops.material_reservations mr
                join roadops.materials m on m.id=mr.material_id
                join roadops.plan_items pi on pi.id=mr.plan_item_id
                where mr.plan_item_id=? and mr.status <> 'cancelled'
                order by m.name, mr.id
            SQL,
            [$order->plan_item_id],
            false,
        );
        $plannedEquipment = DbRows::select(
            <<<'SQL'
                select e.id equipment_unit_id, er.id reservation_id, e.inventory_code, e.name,
                       (lower(er.reserved_window) at time zone 'Asia/Tashkent')::date usage_date,
                       coalesce(req.required_minutes,
                         round(extract(epoch from (upper(er.reserved_window)-lower(er.reserved_window)))/60)::integer
                       ) planned_machine_minutes
                from roadops.equipment_reservations er
                join roadops.equipment_units e on e.id=er.equipment_unit_id
                join roadops.plan_resource_requirements req on req.id=er.equipment_requirement_id
                where er.plan_item_id=? and er.status <> 'cancelled'
                order by usage_date, e.name, er.id
            SQL,
            [$order->plan_item_id],
            false,
        );
        $time = DbRows::select(
            <<<'SQL'
                select te.worker_id, sum(te.actual_minutes)::integer actual_minutes
                from roadops.time_entries te
                where te.work_order_id=? group by te.worker_id order by te.worker_id
            SQL,
            [$order->id],
            false,
        );
        $materials = DbRows::select(
            <<<'SQL'
                select u.material_id, sum(u.quantity) quantity, u.unit
                from roadops.work_order_material_usages u
                where u.work_order_id=? group by u.material_id,u.unit order by u.material_id
            SQL,
            [$order->id],
            false,
        );
        $equipment = DbRows::select(
            <<<'SQL'
                select u.equipment_unit_id, sum(u.actual_machine_minutes)::integer actual_machine_minutes
                from roadops.equipment_usage_entries u
                where u.work_order_id=? group by u.equipment_unit_id order by u.equipment_unit_id
            SQL,
            [$order->id],
            false,
        );

        $completion = null;
        if ($order->completion_id !== null) {
            $evidence = $this->evidence((string) $order->evidence);
            $completion = [
                'id' => (string) $order->completion_id,
                'state' => $order->completion_verified_at === null ? 'PENDING_VERIFICATION' : 'VERIFIED',
                'actualQuantity' => [
                    'value' => (string) $order->completed_quantity,
                    'unit' => (string) $order->completed_unit,
                ],
                'workerMinutes' => array_map(static fn ($row): array => [
                    'workerId' => (string) $row->worker_id,
                    'minutes' => (int) $row->actual_minutes,
                ], $time),
                'materials' => array_map(static fn ($row): array => [
                    'materialId' => (string) $row->material_id,
                    'quantity' => (string) $row->quantity,
                    'unit' => (string) $row->unit,
                ], $materials),
                'equipment' => array_map(static fn ($row): array => [
                    'equipmentUnitId' => (string) $row->equipment_unit_id,
                    'machineMinutes' => (int) $row->actual_machine_minutes,
                ], $equipment),
                'evidence' => array_map(fn (string $url): array => [
                    'url' => $url,
                    'mediaType' => $this->evidenceMediaType($url),
                ], $evidence),
                'note' => $order->completion_note === null ? null : (string) $order->completion_note,
                'recordedAt' => (string) $order->completion_recorded_at,
                'recordedByName' => (string) $order->completion_recorded_by_name,
                'verifiedAt' => $order->completion_verified_at === null ? null : (string) $order->completion_verified_at,
                'verifiedByName' => $order->completion_verified_by_name === null
                    ? null : (string) $order->completion_verified_by_name,
                'verificationNote' => $order->verification_note === null ? null : (string) $order->verification_note,
                'canVerify' => self::databaseBoolean($order->can_verify),
            ];
        }

        return [
            'id' => (string) $order->id,
            'number' => (string) $order->order_number,
            'workName' => (string) $order->work_name,
            'road' => ['code' => (string) $order->road_code, 'name' => (string) $order->road_name],
            'locationLabel' => sprintf(
                'km %.3f–%.3f',
                (float) $order->chainage_from / 1000,
                (float) $order->chainage_to / 1000,
            ),
            'scheduledDate' => $order->scheduled_date === null ? '' : (string) $order->scheduled_date,
            'teamName' => (string) $order->team_name,
            'state' => $this->state((string) $order->status),
            'exactQuantity' => [
                'value' => $order->work_quantity === null ? '0' : (string) $order->work_quantity,
                'unit' => $order->work_unit === null ? '—' : (string) $order->work_unit,
            ],
            'normReference' => (string) $order->norm_reference,
            'startedAt' => $order->started_at === null ? null : (string) $order->started_at,
            'startedByName' => $order->started_by_name === null ? null : (string) $order->started_by_name,
            'executionResources' => [
                'workers' => array_map(static fn ($row): array => [
                    'id' => (string) $row->worker_id,
                    'fullName' => (string) $row->full_name,
                    'positionName' => (string) $row->position_name,
                    'workDate' => (string) $row->work_date,
                    'plannedMinutes' => (int) $row->planned_minutes,
                ], $plannedWorkers),
                'materials' => array_map(static fn ($row): array => [
                    'id' => (string) $row->material_id,
                    'reservationId' => (string) $row->reservation_id,
                    'code' => (string) $row->code,
                    'name' => (string) $row->name,
                    'unit' => (string) $row->unit,
                    'usedAt' => (string) $row->used_at,
                    'plannedQuantity' => (string) $row->planned_quantity,
                ], $plannedMaterials),
                'equipment' => array_map(static fn ($row): array => [
                    'id' => (string) $row->equipment_unit_id,
                    'reservationId' => (string) $row->reservation_id,
                    'inventoryCode' => (string) $row->inventory_code,
                    'name' => (string) $row->name,
                    'usageDate' => (string) $row->usage_date,
                    'plannedMachineMinutes' => (int) $row->planned_machine_minutes,
                ], $plannedEquipment),
            ],
            'completion' => $completion,
        ];
    }

    private function detailResponse(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        $order = $this->order($request, $scope, $id, false, true);
        if ($order === null) {
            abort(404);
        }

        return response()->json(['data' => $this->payload($order)]);
    }

    /** @return list<string> */
    private function evidence(string $json): array
    {
        try {
            $values = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [];
        }

        return is_array($values)
            ? array_values(array_filter($values, static fn ($value): bool => is_string($value)))
            : [];
    }

    private static function databaseBoolean(mixed $value): bool
    {
        return in_array($value, [true, 1, '1', 't', 'true'], true);
    }

    private function evidenceMediaType(string $url): string
    {
        $path = strtolower((string) parse_url($url, PHP_URL_PATH));

        return match (true) {
            str_ends_with($path, '.pdf') => 'application/pdf',
            str_ends_with($path, '.jpg'), str_ends_with($path, '.jpeg') => 'image/jpeg',
            default => 'image/png',
        };
    }

    /** @param list<string> $urls */
    private function assertEvidenceOrigins(array $urls): void
    {
        if ($urls === []) {
            return;
        }
        $allowed = array_values(array_filter(array_map(
            fn (mixed $origin): ?string => is_string($origin) ? $this->httpsOrigin($origin) : null,
            (array) config('roadops.execution_evidence_allowed_origins', []),
        )));
        if ($allowed === []) {
            throw ValidationException::withMessages([
                'evidence' => ['Bajarilish dalillari uchun ruxsat etilgan HTTPS ombori sozlanmagan.'],
            ]);
        }
        foreach ($urls as $index => $url) {
            $origin = $this->httpsOrigin($url);
            if ($origin === null || ! in_array($origin, $allowed, true)) {
                throw ValidationException::withMessages([
                    "evidence.$index" => ['Dalil havolasi faqat sozlangan ruxsat etilgan HTTPS omboridan bo‘lishi mumkin.'],
                ]);
            }
        }
    }

    private function httpsOrigin(string $url): ?string
    {
        $parts = parse_url(trim($url));
        if (! is_array($parts) || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || ! isset($parts['host']) || trim((string) $parts['host']) === '') {
            return null;
        }
        $port = isset($parts['port']) ? ':'.(int) $parts['port'] : '';

        return 'https://'.strtolower((string) $parts['host']).$port;
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

    /** @param array<string, mixed> $details */
    private function event(
        string $orderId,
        string $from,
        string $to,
        string $code,
        string $actor,
        array $details = [],
    ): void {
        DB::insert(
            <<<'SQL'
                insert into roadops.work_order_events
                  (work_order_id, from_status, to_status, event_code, actor_user_id, details, request_id)
                values (?, ?, ?, ?, ?, ?::jsonb, roadops.current_request_id())
            SQL,
            [$orderId, $from, $to, $code, $actor, json_encode($details, JSON_THROW_ON_ERROR)],
        );
    }

    private function localDate(string $timestamp): string
    {
        return (new \DateTimeImmutable($timestamp))
            ->setTimezone(new \DateTimeZone('Asia/Tashkent'))
            ->format('Y-m-d');
    }

    private function domainError(\Throwable $exception, string $fallback, int $status = 422): JsonResponse
    {
        if ($exception instanceof HttpExceptionInterface) {
            throw $exception;
        }
        $code = match (true) {
            $exception instanceof \DomainException => $exception->getMessage(),
            str_contains($exception->getMessage(), 'MONTHLY_ACT_MONTH_CLOSED_FOR_LATE_VERIFICATION') => 'MONTHLY_ACT_MONTH_CLOSED_FOR_LATE_VERIFICATION',
            default => $fallback,
        };

        return response()->json(['error' => [
            'code' => $code,
            'message' => match ($code) {
                'WORK_ORDER_NOT_STARTABLE' => 'Topshiriqni hozir boshlash mumkin emas.',
                'WORK_ORDER_RESCHEDULE_REQUIRED' => 'Reja sanasi o‘tgan: ishni boshlashdan oldin rejani qayta sanalang va resurslarni qayta band qiling.',
                'RESCHEDULE_DATE_IN_PAST' => 'Yangi reja sanasi bugundan oldin bo‘lishi mumkin emas.',
                'WORK_ORDER_NOT_RESCHEDULABLE' => 'Faqat hali boshlanmagan topshiriq sanasini ko‘chirish mumkin.',
                'WORK_ORDER_RESCHEDULE_REJECTED' => 'Yangi sanada ishchi yoki texnika band: boshqa sanani tanlang va qayta urinib ko‘ring.',
                'WORK_ORDER_NOT_IN_PROGRESS' => 'Avval topshiriqni boshlang.',
                'COMPLETION_UNIT_MISMATCH' => 'Bajarilgan ish birligi topshiriq birligiga mos emas.',
                'COMPLETED_QUANTITY_EXCEEDS_PLAN' => 'Haqiqiy bajarilgan hajm topshiriqdagi reja hajmidan oshmasligi kerak.',
                'LABOR_WORKER_NOT_ASSIGNED' => 'Ishchi ushbu topshiriqqa va sanaga biriktirilmagan.',
                'INSUFFICIENT_MATERIAL_STOCK' => 'Omborda sarfni rasmiylashtirish uchun material yetarli emas.',
                'MATERIAL_USAGE_EXCEEDS_RESERVATION' => 'Haqiqiy material sarfi rezerv qilingan miqdordan oshmasligi kerak.',
                'EQUIPMENT_USAGE_EXCEEDS_RESERVATION_WINDOW' => 'Mashina-soat sarfi rezerv qilingan vaqt oralig‘idan oshmasligi kerak.',
                'MATERIAL_RESERVATION_UNAVAILABLE', 'EQUIPMENT_RESERVATION_UNAVAILABLE' => 'Resurs rezervi topilmadi yoki ishlatib bo‘lingan.',
                'MATERIAL_USAGE_COVERAGE_INCOMPLETE' => 'Rejalashtirilgan har bir material rezervi uchun musbat haqiqiy sarf kiriting.',
                'EQUIPMENT_USAGE_COVERAGE_INCOMPLETE' => 'Rejalashtirilgan har bir texnika rezervi uchun haqiqiy mashina-daqiqani kiriting.',
                'WORK_ORDER_NOT_COMPLETED' => 'Faqat bajarilgan topshiriq tasdiqlanadi.',
                'MONTHLY_ACT_MONTH_CLOSED_FOR_LATE_VERIFICATION' => 'Bu ish tegishli bo‘lgan oy dalolatnomasi allaqachon yuborilgan yoki tasdiqlangan. Yopilgan oyga kech tasdiqlash kiritilmaydi.',
                default => 'Amal xavfsizlik yoki ma’lumot yaxlitligi tekshiruvidan o‘tmadi.',
            },
        ]], $status);
    }
}
