<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Reports\MonthlyCompletionActWorkbook;
use App\Http\Controllers\Controller;
use App\Security\AuthContext;
use App\Support\ApiScope;
use App\Support\DbRows;
use App\Support\PagedResponse;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

final class MonthlyCompletionActController extends Controller
{
    public function __construct(private readonly MonthlyCompletionActWorkbook $workbook) {}

    public function index(Request $request, ApiScope $scope): JsonResponse
    {
        $pagination = Pagination::from($request);
        $validated = $request->validate([
            'month' => ['nullable', 'date_format:Y-m'],
            'actMonth' => ['nullable', 'date_format:Y-m-d'],
            'status' => ['nullable', 'in:draft,submitted,approved'],
            'state' => ['nullable', 'in:DRAFT,SUBMITTED,APPROVED'],
        ]);
        $actMonth = $validated['actMonth'] ?? (isset($validated['month']) ? $validated['month'].'-01' : null);
        $status = isset($validated['state']) ? strtolower((string) $validated['state']) : ($validated['status'] ?? null);
        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $baseSql = <<<'SQL'
                select a.*, a.division_name_snapshot division_name,
                       (a.created_by = roadops.current_actor_id()) created_by_me,
                       coalesce(a.submitted_by = roadops.current_actor_id(), false) submitted_by_me,
                       (
                         a.status = 'draft'
                         and roadops.has_permission('costs.manage', a.division_id)
                       ) can_submit,
                       (
                         a.status = 'submitted'
                         and a.created_by <> roadops.current_actor_id()
                         and a.submitted_by <> roadops.current_actor_id()
                         and roadops.has_permission('costs.approve', a.division_id)
                       ) can_approve,
                       (select count(*) from roadops.monthly_completion_act_items i where i.act_id=a.id) item_count,
                       coalesce((
                         select string_agg(
                           distinct concat(i.road_code_snapshot, ' · ', i.road_name_snapshot),
                           ', ' order by concat(i.road_code_snapshot, ' · ', i.road_name_snapshot)
                         )
                         from roadops.monthly_completion_act_items i
                         where i.act_id=a.id
                       ), 'Yo‘l ko‘rsatilmagan') road_label
                from roadops.monthly_completion_acts a
                where a.division_id=any(?::uuid[])
                  and (?::date is null or a.act_month=?::date)
                  and (?::text is null or a.status=?::text)
            SQL;
        $bindings = [$divisionIds, $actMonth, $actMonth, $status, $status];
        $total = (int) DB::scalar('select count(*) from ('.$baseSql.') scoped_acts', $bindings);
        $rows = DbRows::select(
            $baseSql.' order by a.act_month desc, a.act_number, a.id limit ? offset ?',
            [...$bindings, $pagination->pageSize, $pagination->offset()],
        );

        return PagedResponse::make(
            array_map(fn ($row): array => $this->summary($row), $rows),
            $pagination->page,
            $pagination->pageSize,
            $total,
        );
    }

    public function generate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'divisionId' => ['required', 'uuid'],
            'actMonth' => ['required', 'date_format:Y-m-d', 'regex:/^\d{4}-\d{2}-01$/'],
            'actNumber' => ['nullable', 'string', 'max:100'],
            'workOrderIds' => ['prohibited'],
        ]);
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        if (! $context->canAccessRoadUnit($validated['divisionId'])) {
            abort(403);
        }
        $month = $validated['actMonth'];
        $actNumber = trim((string) ($validated['actNumber'] ?? ''));
        $actNumberProvided = $actNumber !== '';
        if ($actNumber === '') {
            $actNumber = 'ACT-'.substr($validated['actMonth'], 0, 7).'-'.strtoupper(substr(str_replace('-', '', (string) Str::uuid()), 0, 8));
        }

        try {
            $actId = DB::transaction(function () use (
                $validated,
                $context,
                $month,
                $actNumber,
                $actNumberProvided,
            ): string {
                DbRows::select('select pg_advisory_xact_lock(hashtextextended(?::text, 20260818))', [
                    $validated['divisionId'].':'.substr($month, 0, 4),
                ]);
                if ((bool) DB::scalar(
                    <<<'SQL'
                        select exists (
                          select 1
                          from roadops.monthly_completion_acts later
                          where later.division_id=?
                            and date_part('year', later.act_month)=date_part('year', ?::date)
                            and later.act_month>?::date
                            and later.status in ('submitted', 'approved')
                        )
                    SQL,
                    [$validated['divisionId'], $month, $month],
                )) {
                    throw new \DomainException('MONTHLY_ACT_BACKFILL_LOCKED');
                }
                $existingAct = DbRows::selectOne(
                    <<<'SQL'
                        select id, status, act_number
                        from roadops.monthly_completion_acts
                        where division_id=? and act_month=?::date
                        for update
                    SQL,
                    [$validated['divisionId'], $month],
                    false,
                );
                if ($existingAct !== null && $existingAct->status !== 'draft') {
                    throw new \DomainException('MONTHLY_ACT_ALREADY_CLOSED');
                }
                if ($existingAct !== null && $actNumberProvided
                    && $existingAct->act_number !== $actNumber) {
                    throw new \DomainException('MONTHLY_ACT_NUMBER_MISMATCH');
                }
                $orders = DbRows::select(
                    <<<'SQL'
                        select wo.id, wo.plan_item_id, wo.completed_at,
                               pi.work_variant_id, cr.completed_quantity, cr.work_unit,
                               (wo.completed_at at time zone 'Asia/Tashkent')::date completion_date
                        from roadops.work_orders wo
                        join roadops.plan_items pi on pi.id=wo.plan_item_id
                        join roadops.planning_runs run on run.id=pi.planning_run_id
                        join roadops.work_completion_records cr on cr.work_order_id=wo.id
                        where run.division_id=? and wo.status='verified'
                          and cr.verified_at is not null
                          and (wo.completed_at at time zone 'Asia/Tashkent')::date >= ?::date
                          and (wo.completed_at at time zone 'Asia/Tashkent')::date < (?::date + interval '1 month')::date
                          and not exists (
                            select 1 from roadops.monthly_completion_act_items used where used.work_order_id=wo.id
                          )
                        order by wo.completed_at, wo.order_number, wo.id
                        for update of wo
                    SQL,
                    [
                        $validated['divisionId'], $month, $month,
                    ],
                    false,
                );
                if ($orders === []) {
                    if ($existingAct !== null) {
                        $this->backfillDraftNormSnapshots((string) $existingAct->id);
                        DbRows::select(
                            'select roadops.refresh_monthly_completion_act_totals(?)',
                            [$existingAct->id],
                            false,
                        );

                        return (string) $existingAct->id;
                    }
                    throw new \DomainException('NO_VERIFIED_WORK_FOR_MONTH');
                }
                if ($existingAct === null) {
                    $act = DbRows::selectOneOrFail(
                        <<<'SQL'
                            insert into roadops.monthly_completion_acts
                              (division_id, act_number, act_month, created_by)
                            values (?, ?, ?::date, ?) returning id
                        SQL,
                        [$validated['divisionId'], $actNumber, $month, $context->userId],
                        false,
                    );
                    $actId = (string) $act->id;
                } else {
                    $actId = (string) $existingAct->id;
                    $this->backfillDraftNormSnapshots($actId);
                }

                foreach ($orders as $order) {
                    $iqnLaborNorm = $this->approvedIqnLaborNorm(
                        (string) $order->work_variant_id,
                        (string) $order->completion_date,
                        (string) $order->completed_quantity,
                        (string) $order->work_unit,
                    );
                    if ($iqnLaborNorm === null) {
                        throw new \DomainException('IQN_APPROVED_LABOR_NORM_MISSING');
                    }
                    $item = DbRows::selectOneOrFail(
                        <<<'SQL'
                            insert into roadops.monthly_completion_act_items (
                              act_id, work_order_id, iqn_norm_set_id_snapshot,
                              iqn_labor_norm_line_ids_snapshot, iqn_basis_quantity_snapshot,
                              iqn_basis_unit_snapshot, iqn_labor_minutes_per_basis_snapshot,
                              iqn_labor_minutes_per_unit_snapshot, iqn_total_labor_minutes_snapshot
                            ) values (?, ?, ?, ?::uuid[], ?, ?, ?, ?, ?) returning id
                        SQL,
                        [
                            $actId, $order->id, $iqnLaborNorm->norm_set_id,
                            $iqnLaborNorm->labor_norm_line_ids, $iqnLaborNorm->basis_quantity,
                            $iqnLaborNorm->basis_unit, $iqnLaborNorm->labor_minutes_per_basis,
                            $iqnLaborNorm->labor_minutes_per_unit, $iqnLaborNorm->total_labor_minutes,
                        ],
                        false,
                    );
                    $sourceCount = 0;
                    foreach (DbRows::select(
                        <<<'SQL'
                            select te.id, te.worker_id, te.work_date
                            from roadops.time_entries te
                            where te.work_order_id=? and te.approved_at is not null and te.approved_by is not null
                            order by te.work_date, te.id
                        SQL,
                        [$order->id],
                        false,
                    ) as $source) {
                        $pricing = $this->laborPricing(
                            $validated['divisionId'],
                            (string) $source->worker_id,
                            (string) $source->work_date,
                        );
                        if ($pricing === null) {
                            throw new \DomainException('LABOR_RATE_OR_MONTHLY_NORM_MISSING');
                        }
                        DB::insert(
                            <<<'SQL'
                                insert into roadops.monthly_completion_act_cost_lines
                                  (act_item_id, line_kind, time_entry_id, cost_rate_version_id,
                                   monthly_work_time_norm_id)
                                values (?, 'labor', ?, ?, ?)
                            SQL,
                            [$item->id, $source->id, $pricing->rate_id, $pricing->norm_id],
                        );
                        $sourceCount++;
                    }
                    foreach (DbRows::select(
                        <<<'SQL'
                            select id, material_id, (used_at at time zone 'Asia/Tashkent')::date usage_date
                            from roadops.work_order_material_usages
                            where work_order_id=? and status='approved' order by used_at, id
                        SQL,
                        [$order->id],
                        false,
                    ) as $source) {
                        $rate = $this->rate(
                            $validated['divisionId'], 'material', (string) $source->material_id, (string) $source->usage_date,
                        );
                        if ($rate === null) {
                            throw new \DomainException('MATERIAL_RATE_MISSING');
                        }
                        DB::insert(
                            <<<'SQL'
                                insert into roadops.monthly_completion_act_cost_lines
                                  (act_item_id, line_kind, material_usage_id, cost_rate_version_id)
                                values (?, 'material', ?, ?)
                            SQL,
                            [$item->id, $source->id, $rate->id],
                        );
                        $sourceCount++;
                    }
                    foreach (DbRows::select(
                        <<<'SQL'
                            select id, equipment_unit_id, usage_date
                            from roadops.equipment_usage_entries
                            where work_order_id=? and status='approved' order by usage_date, id
                        SQL,
                        [$order->id],
                        false,
                    ) as $source) {
                        $rate = $this->rate(
                            $validated['divisionId'], 'equipment', (string) $source->equipment_unit_id, (string) $source->usage_date,
                        );
                        if ($rate === null) {
                            throw new \DomainException('EQUIPMENT_RATE_MISSING');
                        }
                        DB::insert(
                            <<<'SQL'
                                insert into roadops.monthly_completion_act_cost_lines
                                  (act_item_id, line_kind, equipment_usage_entry_id, cost_rate_version_id)
                                values (?, 'equipment', ?, ?)
                            SQL,
                            [$item->id, $source->id, $rate->id],
                        );
                        $sourceCount++;
                    }
                    if ($sourceCount === 0) {
                        throw new \DomainException('ACTUAL_COST_SOURCE_MISSING');
                    }
                }
                DbRows::select(
                    'select roadops.refresh_monthly_completion_act_totals(?)',
                    [$actId],
                    false,
                );

                return $actId;
            });
        } catch (\Throwable $exception) {
            return $this->generationError($exception);
        }

        return response()->json(['data' => $this->detail($actId)], 201);
    }

    public function show(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        $act = $this->act($request, $scope, $id);
        if ($act === null) {
            abort(404);
        }

        return response()->json(['data' => $this->detail($id, $act)]);
    }

    public function submit(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        $act = $this->act($request, $scope, $id, true);
        if ($act === null) {
            abort(404);
        }
        try {
            DB::transaction(function () use ($act, $id): void {
                DbRows::select(
                    'select pg_advisory_xact_lock(hashtextextended(?::text, 20260818))',
                    [$act->division_id.':'.substr((string) $act->act_month, 0, 4)],
                    false,
                );
                DbRows::select('select roadops.submit_monthly_completion_act(?)', [$id], false);
            });
        } catch (\Throwable $exception) {
            return $this->workflowError($exception, 'MONTHLY_ACT_SUBMIT_REJECTED');
        }

        return response()->json(['data' => $this->detail($id)]);
    }

    public function approve(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        $act = $this->act($request, $scope, $id, true);
        if ($act === null) {
            abort(404);
        }
        try {
            DB::transaction(function () use ($act, $id): void {
                DbRows::select(
                    'select pg_advisory_xact_lock(hashtextextended(?::text, 20260818))',
                    [$act->division_id.':'.substr((string) $act->act_month, 0, 4)],
                    false,
                );
                DbRows::select('select roadops.approve_monthly_completion_act(?)', [$id], false);
            });
        } catch (\Throwable $exception) {
            return $this->workflowError($exception, 'MONTHLY_ACT_APPROVAL_REJECTED');
        }

        return response()->json(['data' => $this->detail($id)]);
    }

    public function export(Request $request, ApiScope $scope, string $id): StreamedResponse
    {
        $act = $this->act($request, $scope, $id);
        if ($act === null) {
            abort(404);
        }
        $spreadsheet = $this->workbook->build($this->workbookData($id, $act));

        return response()->streamDownload(
            static function () use ($spreadsheet): void {
                (new Xlsx($spreadsheet))->save('php://output');
                $spreadsheet->disconnectWorksheets();
            },
            'bajarilgan-ishlar-dalolatnomasi-'.substr((string) $act->act_month, 0, 7).'-'.$act->act_number.'.xlsx',
            ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        );
    }

    private function act(
        Request $request,
        ApiScope $scope,
        string $id,
        bool $primary = false,
    ): ?object
    {
        if (! Str::isUuid($id)) {
            return null;
        }

        return DbRows::selectOne(
            <<<'SQL'
                select a.*, a.division_name_snapshot division_name,
                       a.created_by_name_snapshot prepared_by,
                       a.approved_by_name_snapshot approved_by_name,
                       (a.created_by = roadops.current_actor_id()) created_by_me,
                       coalesce(a.submitted_by = roadops.current_actor_id(), false) submitted_by_me,
                       (
                         a.status = 'draft'
                         and roadops.has_permission('costs.manage', a.division_id)
                       ) can_submit,
                       (
                         a.status = 'submitted'
                         and a.created_by <> roadops.current_actor_id()
                         and a.submitted_by <> roadops.current_actor_id()
                         and roadops.has_permission('costs.approve', a.division_id)
                       ) can_approve,
                       (select count(*) from roadops.monthly_completion_act_items i where i.act_id=a.id) item_count,
                       coalesce((
                         select string_agg(
                           distinct concat(i.road_code_snapshot, ' · ', i.road_name_snapshot),
                           ', ' order by concat(i.road_code_snapshot, ' · ', i.road_name_snapshot)
                         )
                         from roadops.monthly_completion_act_items i
                         where i.act_id=a.id
                       ), 'Yo‘l ko‘rsatilmagan') road_label
                from roadops.monthly_completion_acts a
                where a.id=? and a.division_id=any(?::uuid[])
            SQL,
            [$id, $scope->pgUuidArray($scope->roadUnitIds($request))],
            ! $primary,
        );
    }

    /** @return array<string, mixed> */
    private function detail(string $id, ?object $act = null): array
    {
        $act ??= DbRows::selectOneOrFail(
            <<<'SQL'
                select a.*, a.division_name_snapshot division_name,
                       a.created_by_name_snapshot prepared_by,
                       a.approved_by_name_snapshot approved_by_name,
                       (a.created_by = roadops.current_actor_id()) created_by_me,
                       coalesce(a.submitted_by = roadops.current_actor_id(), false) submitted_by_me,
                       (
                         a.status = 'draft'
                         and roadops.has_permission('costs.manage', a.division_id)
                       ) can_submit,
                       (
                         a.status = 'submitted'
                         and a.created_by <> roadops.current_actor_id()
                         and a.submitted_by <> roadops.current_actor_id()
                         and roadops.has_permission('costs.approve', a.division_id)
                       ) can_approve,
                       (select count(*) from roadops.monthly_completion_act_items i where i.act_id=a.id) item_count,
                       coalesce((
                         select string_agg(
                           distinct concat(i.road_code_snapshot, ' · ', i.road_name_snapshot),
                           ', ' order by concat(i.road_code_snapshot, ' · ', i.road_name_snapshot)
                         )
                         from roadops.monthly_completion_act_items i
                         where i.act_id=a.id
                       ), 'Yo‘l ko‘rsatilmagan') road_label
                from roadops.monthly_completion_acts a
                where a.id=?
            SQL,
            [$id],
            false,
        );
        $items = DbRows::select(
            <<<'SQL'
                select i.*,
                       (select count(*) from roadops.monthly_completion_act_cost_lines l where l.act_item_id=i.id) cost_line_count
                from roadops.monthly_completion_act_items i
                where i.act_id=? order by i.completed_at_snapshot, i.order_number_snapshot, i.id
            SQL,
            [$id],
            false,
        );
        $lines = DbRows::select(
            <<<'SQL'
                select l.*
                from roadops.monthly_completion_act_cost_lines l
                join roadops.monthly_completion_act_items i on i.id=l.act_item_id
                where i.act_id=?
                order by i.completed_at_snapshot, i.order_number_snapshot, l.line_kind,
                         l.resource_name_snapshot, l.id
            SQL,
            [$id],
            false,
        );
        $linesByItem = [];
        foreach ($lines as $line) {
            $linesByItem[(string) $line->act_item_id][] = $this->costLine($line);
        }

        $itemPayloads = [];
        foreach ($items as $item) {
            $itemPayloads[] = [
                'id' => (string) $item->id,
                'workOrderId' => (string) $item->work_order_id,
                'orderNumber' => (string) $item->order_number_snapshot,
                'roadCode' => (string) $item->road_code_snapshot,
                'roadName' => (string) $item->road_name_snapshot,
                'workCode' => (string) $item->work_code_snapshot,
                'workName' => (string) $item->work_name_snapshot,
                'normReference' => (string) $item->norm_reference_snapshot,
                'completedAt' => (string) $item->completed_at_snapshot,
                'completedQuantity' => [
                    'value' => (string) $item->completed_quantity,
                    'unit' => (string) $item->work_unit,
                ],
                'iqnLaborNorm' => $item->iqn_norm_set_id_snapshot === null ? null : [
                    'normSetId' => (string) $item->iqn_norm_set_id_snapshot,
                    'normLineIds' => $this->pgUuidArray((string) $item->iqn_labor_norm_line_ids_snapshot),
                    'basisQuantity' => [
                        'value' => (string) $item->iqn_basis_quantity_snapshot,
                        'unit' => (string) $item->iqn_basis_unit_snapshot,
                    ],
                    'minutesPerBasis' => (string) $item->iqn_labor_minutes_per_basis_snapshot,
                    'minutesPerUnit' => (string) $item->iqn_labor_minutes_per_unit_snapshot,
                    'totalMinutes' => (string) $item->iqn_total_labor_minutes_snapshot,
                ],
                'laborAmountUzs' => (string) $item->labor_amount_uzs,
                'socialAmountUzs' => (string) $item->social_amount_uzs,
                'materialAmountUzs' => (string) $item->material_amount_uzs,
                'equipmentAmountUzs' => (string) $item->equipment_amount_uzs,
                'totalAmountUzs' => (string) $item->total_amount_uzs,
                'costLineCount' => (int) $item->cost_line_count,
                'costLines' => $linesByItem[(string) $item->id] ?? [],
            ];
        }

        return [
            ...$this->summary($act),
            'currency' => 'UZS',
            'transportAmountUzs' => '0.00',
            'otherAmountUzs' => '0.00',
            'vatAmountUzs' => '0.00',
            'items' => $itemPayloads,
        ];
    }

    /** @return array<string, mixed> */
    private function summary(object $act): array
    {
        return [
            'id' => (string) $act->id, 'divisionId' => (string) $act->division_id,
            'divisionName' => (string) $act->division_name,
            'actNumber' => (string) $act->act_number,
            'actMonth' => substr((string) $act->act_month, 0, 10),
            'roadLabel' => isset($act->road_label) ? (string) $act->road_label : 'Yo‘l ko‘rsatilmagan',
            'state' => strtoupper((string) $act->status),
            'createdByMe' => self::databaseBoolean($act->created_by_me),
            'submittedByMe' => self::databaseBoolean($act->submitted_by_me),
            'canSubmit' => self::databaseBoolean($act->can_submit),
            'canApprove' => self::databaseBoolean($act->can_approve),
            'itemCount' => isset($act->item_count) ? (int) $act->item_count : null,
            'laborAmountUzs' => (string) $act->labor_amount_uzs,
            'socialAmountUzs' => (string) $act->social_amount_uzs,
            'materialAmountUzs' => (string) $act->material_amount_uzs,
            'equipmentAmountUzs' => (string) $act->equipment_amount_uzs,
            'totalAmountUzs' => (string) $act->total_amount_uzs,
            'createdAt' => (string) $act->created_at,
            'submittedAt' => $act->submitted_at === null ? null : (string) $act->submitted_at,
            'approvedAt' => $act->approved_at === null ? null : (string) $act->approved_at,
        ];
    }

    /** @return array<string, mixed> */
    private function costLine(object $line): array
    {
        return [
            'id' => (string) $line->id,
            'lineKind' => (string) $line->line_kind,
            'source' => [
                'timeEntryId' => $line->time_entry_id === null ? null : (string) $line->time_entry_id,
                'materialUsageId' => $line->material_usage_id === null ? null : (string) $line->material_usage_id,
                'equipmentUsageEntryId' => $line->equipment_usage_entry_id === null
                    ? null : (string) $line->equipment_usage_entry_id,
            ],
            'costRateVersionId' => (string) $line->cost_rate_version_id,
            'monthlyWorkTimeNormId' => $line->monthly_work_time_norm_id === null
                ? null : (string) $line->monthly_work_time_norm_id,
            'resource' => [
                'code' => (string) $line->resource_code_snapshot,
                'name' => (string) $line->resource_name_snapshot,
                'detail' => (string) $line->resource_detail_snapshot,
            ],
            'sourceQuantity' => [
                'value' => (string) $line->source_quantity,
                'unit' => (string) $line->source_unit,
            ],
            'rateBasis' => (string) $line->rate_basis_snapshot,
            'rateAmountUzs' => (string) $line->rate_amount_uzs,
            'bonusRateBps' => (int) $line->bonus_rate_bps,
            'trafficAllowanceRateBps' => (int) $line->traffic_allowance_rate_bps,
            'travelAllowanceRateBps' => (int) $line->travel_allowance_rate_bps,
            'socialContributionRateBps' => (int) $line->social_contribution_rate_bps,
            'rateDenominatorQuantity' => (string) $line->rate_denominator_quantity,
            'unitRateUzs' => (string) $line->unit_rate_uzs,
            'baseWageAmountUzs' => (string) $line->base_wage_amount_uzs,
            'bonusAmountUzs' => (string) $line->bonus_amount_uzs,
            'trafficAllowanceAmountUzs' => (string) $line->traffic_allowance_amount_uzs,
            'travelAllowanceAmountUzs' => (string) $line->travel_allowance_amount_uzs,
            'socialAmountUzs' => (string) $line->social_amount_uzs,
            'amountUzs' => (string) $line->amount_uzs,
            'currency' => (string) $line->currency,
            'createdAt' => (string) $line->created_at,
        ];
    }

    private static function databaseBoolean(mixed $value): bool
    {
        return in_array($value, [true, 1, '1', 't', 'true'], true);
    }

    private function laborPricing(string $divisionId, string $workerId, string $date): ?object
    {
        return DbRows::selectOne(
            <<<'SQL'
                select r.id rate_id, n.id norm_id
                from roadops.cost_rate_versions r
                join roadops.monthly_work_time_norms n
                  on n.division_id=r.division_id and n.schedule_code=r.schedule_code
                 and n.work_month=date_trunc('month', ?::date)::date and n.status='approved'
                where r.division_id=? and r.rate_kind='labor' and r.worker_id=?
                  and r.status='approved' and r.effective_period @> ?::date
                limit 1
            SQL,
            [$date, $divisionId, $workerId, $date],
            false,
        );
    }

    private function rate(string $divisionId, string $kind, string $targetId, string $date): ?object
    {
        $column = $kind === 'material' ? 'material_id' : 'equipment_unit_id';

        return DbRows::selectOne(
            "select id from roadops.cost_rate_versions where division_id=? and rate_kind=? and {$column}=? and status='approved' and effective_period @> ?::date limit 1",
            [$divisionId, $kind, $targetId, $date],
            false,
        );
    }

    private function approvedIqnLaborNorm(
        string $workVariantId,
        string $completionDate,
        string $completedQuantity,
        string $workUnit,
    ): ?object {
        return DbRows::selectOne(
            <<<'SQL'
                select ns.id norm_set_id,
                       array_agg(line.id order by line.source_line_number, line.id)::text
                         labor_norm_line_ids,
                       variant.basis_quantity, variant.basis_unit,
                       sum(line.minutes_per_basis)::numeric(20,3) labor_minutes_per_basis,
                       round(sum(line.minutes_per_basis) / variant.basis_quantity, 6)
                         labor_minutes_per_unit,
                       round((?::numeric / variant.basis_quantity)
                         * sum(line.minutes_per_basis), 6) total_labor_minutes
                from roadops.iqn_work_variants variant
                join roadops.iqn_norm_sets ns on ns.work_variant_id = variant.id
                join roadops.iqn_norm_lines line on line.norm_set_id = ns.id
                join roadops.iqn_resources resource on resource.id = line.resource_id
                where variant.id = ?
                  and variant.basis_quantity is not null
                  and coalesce(btrim(variant.basis_unit), '') <> ''
                  and btrim(variant.basis_unit) = btrim(?::text)
                  and variant.formula_type = 'linear'
                  and ns.status = 'approved'
                  and ns.effective_from <= ?::date
                  and (ns.effective_until is null or ns.effective_until > ?::date)
                  and resource.resource_kind = 'labor'
                  and line.minutes_per_basis is not null
                  and not exists (
                    select 1
                    from roadops.iqn_norm_lines incomplete_line
                    join roadops.iqn_resources incomplete_resource
                      on incomplete_resource.id = incomplete_line.resource_id
                    where incomplete_line.norm_set_id = ns.id
                      and incomplete_resource.resource_kind = 'labor'
                      and incomplete_line.minutes_per_basis is null
                  )
                group by ns.id, variant.basis_quantity, variant.basis_unit
                having sum(line.minutes_per_basis) > 0
                limit 1
            SQL,
            [$completedQuantity, $workVariantId, $workUnit, $completionDate, $completionDate],
            false,
        );
    }

    private function backfillDraftNormSnapshots(string $actId): void
    {
        $items = DbRows::select(
            <<<'SQL'
                select item.id, item.work_variant_id_snapshot,
                       (item.completed_at_snapshot at time zone 'Asia/Tashkent')::date completion_date,
                       item.completed_quantity, item.work_unit
                from roadops.monthly_completion_act_items item
                join roadops.monthly_completion_acts act on act.id = item.act_id
                where item.act_id = ? and act.status = 'draft'
                  and item.iqn_norm_set_id_snapshot is null
                order by item.completed_at_snapshot, item.id
                for update of item
            SQL,
            [$actId],
            false,
        );
        foreach ($items as $item) {
            $norm = $this->approvedIqnLaborNorm(
                (string) $item->work_variant_id_snapshot,
                (string) $item->completion_date,
                (string) $item->completed_quantity,
                (string) $item->work_unit,
            );
            if ($norm === null) {
                throw new \DomainException('IQN_APPROVED_LABOR_NORM_MISSING');
            }
            DB::update(
                <<<'SQL'
                    update roadops.monthly_completion_act_items
                    set iqn_norm_set_id_snapshot = ?,
                        iqn_labor_norm_line_ids_snapshot = ?::uuid[],
                        iqn_basis_quantity_snapshot = ?, iqn_basis_unit_snapshot = ?,
                        iqn_labor_minutes_per_basis_snapshot = ?,
                        iqn_labor_minutes_per_unit_snapshot = ?,
                        iqn_total_labor_minutes_snapshot = ?
                    where id = ? and iqn_norm_set_id_snapshot is null
                SQL,
                [
                    $norm->norm_set_id, $norm->labor_norm_line_ids, $norm->basis_quantity,
                    $norm->basis_unit, $norm->labor_minutes_per_basis,
                    $norm->labor_minutes_per_unit, $norm->total_labor_minutes, $item->id,
                ],
            );
        }
    }

    /** @return list<string> */
    private function pgUuidArray(string $value): array
    {
        $contents = trim($value, '{}');

        return $contents === '' ? [] : array_map(
            static fn (string $id): string => trim($id, '"'),
            explode(',', $contents),
        );
    }

    /** @return array<string, mixed> */
    private function workbookData(string $id, object $act): array
    {
        $items = DbRows::select(
            <<<'SQL'
                select i.order_number_snapshot, i.work_code_snapshot, i.work_name_snapshot, i.work_unit,
                       i.completed_quantity, i.total_amount_uzs, i.road_id_snapshot,
                       i.work_variant_id_snapshot, i.iqn_labor_minutes_per_unit_snapshot,
                       i.iqn_total_labor_minutes_snapshot,
                       case
                         when i.annual_program_item_id_snapshot is not null
                           then 'annual:' || i.annual_program_item_id_snapshot::text
                         else 'work:' || i.road_id_snapshot::text || ':' || i.work_variant_id_snapshot::text
                       end ytd_group_key,
                       i.norm_reference_snapshot norm_reference,
                       i.annual_planned_quantity_snapshot annual_planned_quantity,
                       i.year_to_date_quantity_snapshot ytd_quantity,
                       i.year_to_date_amount_uzs_snapshot ytd_amount
                from roadops.monthly_completion_act_items i
                where i.act_id=? order by i.completed_at_snapshot, i.order_number_snapshot
            SQL,
            [$id],
        );
        $labor = DbRows::select(
            <<<'SQL'
                select i.order_number_snapshot, l.resource_name_snapshot,
                       l.resource_detail_snapshot position_name,
                       l.resource_code_snapshot personnel_number,
                       te.work_date, te.actual_minutes,
                       l.rate_basis_snapshot, l.rate_amount_uzs, l.rate_denominator_quantity norm_minutes,
                       n.working_days norm_working_days,
                       l.bonus_rate_bps, l.traffic_allowance_rate_bps,
                       l.travel_allowance_rate_bps, l.social_contribution_rate_bps,
                       l.base_wage_amount_uzs, l.bonus_amount_uzs,
                       l.traffic_allowance_amount_uzs, l.travel_allowance_amount_uzs,
                       (l.bonus_amount_uzs+l.traffic_allowance_amount_uzs+l.travel_allowance_amount_uzs) allowance_amount,
                       l.social_amount_uzs, l.amount_uzs
                from roadops.monthly_completion_act_cost_lines l
                join roadops.monthly_completion_act_items i on i.id=l.act_item_id
                join roadops.time_entries te on te.id=l.time_entry_id
                join roadops.monthly_work_time_norms n on n.id=l.monthly_work_time_norm_id
                where i.act_id=? and l.line_kind='labor' order by i.order_number_snapshot,l.resource_name_snapshot,l.id
            SQL,
            [$id],
        );
        $materials = DbRows::select(
            <<<'SQL'
                select i.order_number_snapshot,l.resource_code_snapshot,l.resource_name_snapshot,
                       l.source_unit,l.source_quantity,l.rate_amount_uzs,l.amount_uzs
                from roadops.monthly_completion_act_cost_lines l
                join roadops.monthly_completion_act_items i on i.id=l.act_item_id
                where i.act_id=? and l.line_kind='material' order by i.order_number_snapshot,l.resource_name_snapshot,l.id
            SQL,
            [$id],
        );
        $equipment = DbRows::select(
            <<<'SQL'
                select i.order_number_snapshot,l.resource_code_snapshot,l.resource_name_snapshot,
                       l.source_quantity,l.rate_amount_uzs,l.amount_uzs
                from roadops.monthly_completion_act_cost_lines l
                join roadops.monthly_completion_act_items i on i.id=l.act_item_id
                where i.act_id=? and l.line_kind='equipment' order by i.order_number_snapshot,l.resource_name_snapshot,l.id
            SQL,
            [$id],
        );
        $total = (float) $act->total_amount_uzs;

        return [
            'actNumber' => (string) $act->act_number,
            'period' => substr((string) $act->act_month, 0, 7),
            'divisionName' => (string) $act->division_name,
            'roadLabel' => isset($act->road_label) ? (string) $act->road_label : 'Yo‘l ko‘rsatilmagan',
            'state' => strtoupper((string) $act->status),
            'preparedBy' => (string) $act->prepared_by,
            'approvedBy' => $act->approved_by_name === null ? null : (string) $act->approved_by_name,
            'items' => array_map(static fn ($row): array => [
                'orderNumber' => (string) $row->order_number_snapshot,
                'aggregationKey' => implode(':', [
                    (string) $row->road_id_snapshot,
                    (string) $row->work_variant_id_snapshot,
                    mb_strtolower(trim((string) $row->work_unit)),
                ]),
                'workCode' => (string) $row->work_code_snapshot,
                'workName' => (string) $row->work_name_snapshot,
                'normReference' => (string) $row->norm_reference, 'unit' => (string) $row->work_unit,
                'annualPlannedQuantity' => (float) $row->annual_planned_quantity,
                'monthQuantity' => (float) $row->completed_quantity,
                'monthAmount' => (float) $row->total_amount_uzs,
                'iqnUnitLaborMinutes' => $row->iqn_labor_minutes_per_unit_snapshot === null
                    ? null
                    : (float) $row->iqn_labor_minutes_per_unit_snapshot,
                'iqnTotalLaborMinutes' => $row->iqn_total_labor_minutes_snapshot === null
                    ? null
                    : (float) $row->iqn_total_labor_minutes_snapshot,
                'yearToDateQuantity' => (float) $row->ytd_quantity,
                'yearToDateAmount' => (float) $row->ytd_amount,
                'ytdGroupKey' => (string) $row->ytd_group_key,
            ], $items),
            'labor' => array_map(static fn ($row): array => [
                'orderNumber' => (string) $row->order_number_snapshot,
                'fullName' => (string) $row->resource_name_snapshot,
                'positionName' => (string) $row->position_name,
                'personnelNumber' => (string) $row->personnel_number,
                'workDate' => (string) $row->work_date,
                'actualMinutes' => (int) $row->actual_minutes,
                'rateBasis' => (string) $row->rate_basis_snapshot,
                'unitRate' => (float) $row->rate_amount_uzs,
                'normWorkingDays' => (int) $row->norm_working_days,
                'normMinutes' => (int) $row->norm_minutes,
                'bonusRateBps' => (int) $row->bonus_rate_bps,
                'trafficAllowanceRateBps' => (int) $row->traffic_allowance_rate_bps,
                'travelAllowanceRateBps' => (int) $row->travel_allowance_rate_bps,
                'socialContributionRateBps' => (int) $row->social_contribution_rate_bps,
                'wageAmount' => (float) $row->base_wage_amount_uzs,
                'bonusAmount' => (float) $row->bonus_amount_uzs,
                'trafficAllowanceAmount' => (float) $row->traffic_allowance_amount_uzs,
                'travelAllowanceAmount' => (float) $row->travel_allowance_amount_uzs,
                'allowanceAmount' => (float) $row->allowance_amount,
                'socialAmount' => (float) $row->social_amount_uzs,
                'totalAmount' => (float) $row->amount_uzs,
            ], $labor),
            'materials' => array_map(static fn ($row): array => [
                'orderNumber' => (string) $row->order_number_snapshot,
                'code' => (string) $row->resource_code_snapshot, 'name' => (string) $row->resource_name_snapshot,
                'unit' => (string) $row->source_unit, 'quantity' => (float) $row->source_quantity,
                'unitPrice' => (float) $row->rate_amount_uzs, 'amount' => (float) $row->amount_uzs,
            ], $materials),
            'equipment' => array_map(static fn ($row): array => [
                'orderNumber' => (string) $row->order_number_snapshot,
                'inventoryCode' => (string) $row->resource_code_snapshot,
                'name' => (string) $row->resource_name_snapshot,
                'machineMinutes' => (int) $row->source_quantity,
                'machineHourRate' => (float) $row->rate_amount_uzs,
                'amount' => (float) $row->amount_uzs,
            ], $equipment),
            'totals' => [
                'labor' => (float) $act->labor_amount_uzs, 'social' => (float) $act->social_amount_uzs,
                'materials' => (float) $act->material_amount_uzs,
                'equipment' => (float) $act->equipment_amount_uzs,
                'transport' => 0.0, 'other' => 0.0, 'subtotal' => $total,
                'vat' => 0.0, 'grandTotal' => $total,
            ],
        ];
    }

    private function generationError(\Throwable $exception): JsonResponse
    {
        if ($exception instanceof HttpExceptionInterface) {
            throw $exception;
        }
        $code = $exception instanceof \DomainException ? $exception->getMessage() : 'MONTHLY_ACT_GENERATION_REJECTED';
        if (str_contains($exception->getMessage(), 'MONTHLY_ACT_IQN_LABOR_NORM_INVALID')) {
            $code = 'MONTHLY_ACT_IQN_LABOR_NORM_INVALID';
        } elseif (str_contains($exception->getMessage(), 'MONTHLY_ACT_IQN_LABOR_NORM_SNAPSHOT_MISSING')) {
            $code = 'MONTHLY_ACT_IQN_LABOR_NORM_SNAPSHOT_MISSING';
        }
        $message = match ($code) {
            'NO_VERIFIED_WORK_FOR_MONTH' => 'Tanlangan oyda dalolatnomaga olinmagan tasdiqlangan ish topilmadi.',
            'MONTHLY_ACT_ALREADY_CLOSED' => 'Bu oy dalolatnomasi allaqachon topshirilgan yoki tasdiqlangan; unga yangi ish qo‘shib bo‘lmaydi.',
            'MONTHLY_ACT_NUMBER_MISMATCH' => 'Mavjud qoralama dalolatnoma raqami yuborilgan raqamga mos emas.',
            'MONTHLY_ACT_BACKFILL_LOCKED' => 'Keyingi oy dalolatnomasi yuborilgan yoki tasdiqlangan; oldingi oy uchun orqaga qarab dalolatnoma yaratib bo‘lmaydi.',
            'IQN_APPROVED_LABOR_NORM_MISSING' => 'Bajarilgan ish turi, sana va birlik uchun aniq hisoblanadigan tasdiqlangan chiziqli IQN mehnat normasi topilmadi. Chiziqli bo‘lmagan formula alohida tasdiqlangan hisoblash qoidasini talab qiladi.',
            'MONTHLY_ACT_IQN_LABOR_NORM_INVALID' => 'IQN mehnat normasi nusxasi tasdiqlangan norma satrlari bilan aynan mos emas.',
            'MONTHLY_ACT_IQN_LABOR_NORM_SNAPSHOT_MISSING' => 'Dalolatnoma bandida tasdiqlangan IQN mehnat normasi muzlatilmadi.',
            'LABOR_RATE_OR_MONTHLY_NORM_MISSING' => 'Ishchi uchun tasdiqlangan oylik tarif yoki ish vaqti normasi topilmadi.',
            'MATERIAL_RATE_MISSING' => 'Sarflangan material uchun amal qiluvchi tasdiqlangan narx topilmadi.',
            'EQUIPMENT_RATE_MISSING' => 'Texnika uchun amal qiluvchi tasdiqlangan mashina-soat narxi topilmadi.',
            'ACTUAL_COST_SOURCE_MISSING' => 'Bajarilgan topshiriqda tasdiqlangan mehnat yoki resurs sarfi yo‘q.',
            default => 'Dalolatnoma yaratilmadi: oy, tariflar va haqiqiy sarflar mosligini tekshiring.',
        };

        return response()->json(['error' => ['code' => $code, 'message' => $message]], 422);
    }

    private function workflowError(\Throwable $exception, string $fallback): JsonResponse
    {
        if ($exception instanceof HttpExceptionInterface) {
            throw $exception;
        }
        $independent = str_contains($exception->getMessage(), 'cannot approve')
            || str_contains($exception->getMessage(), 'creator or submitter');
        $missingVerifiedWork = str_contains($exception->getMessage(), 'MONTHLY_ACT_VERIFIED_WORK_MISSING');
        $missingIqnSnapshot = str_contains($exception->getMessage(), 'MONTHLY_ACT_IQN_LABOR_NORM_SNAPSHOT_MISSING');

        return response()->json(['error' => [
            'code' => match (true) {
                $independent => 'INDEPENDENT_APPROVER_REQUIRED',
                $missingVerifiedWork => 'MONTHLY_ACT_VERIFIED_WORK_MISSING',
                $missingIqnSnapshot => 'MONTHLY_ACT_IQN_LABOR_NORM_SNAPSHOT_MISSING',
                default => $fallback,
            },
            'message' => match (true) {
                $independent => 'Dalolatnomani tuzgan yoki yuborgan shaxs uni tasdiqlay olmaydi.',
                $missingVerifiedWork => 'Oy yakunida tasdiqlangan barcha ishlar dalolatnomaga kiritilmagan. Qoralamani qayta shakllantiring; yopilgan oyda kech tasdiqlangan ish uchun nazoratli tuzatish talab etiladi.',
                $missingIqnSnapshot => 'Dalolatnoma bandida tasdiqlangan IQN mehnat normasi muzlatilmagan. Qoralamani qayta shakllantiring.',
                default => 'Dalolatnoma holati, xarajat manbalari yoki muzlatilgan nusxa tekshiruvdan o‘tmadi.',
            },
        ]], 409);
    }
}
