<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Execution\PayrollCalculator;
use App\Http\Controllers\Controller;
use App\Security\AuthContext;
use App\Support\ApiScope;
use App\Support\DbRows;
use App\Support\PagedResponse;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

final class PayrollController extends Controller
{
    public function __construct(private readonly PayrollCalculator $calculator) {}

    public function preview(Request $request): JsonResponse
    {
        $rules = [
            'divisionId' => ['required', 'uuid'],
            'period' => ['required', 'date_format:Y-m'],
            'policyReference' => ['required', 'string', 'max:1000', 'regex:/\S/u'],
            'adjustments' => ['present', 'array', 'max:500'],
            'adjustments.*.workerId' => ['required', 'uuid', 'distinct'],
            'adjustments.*.coefficient' => ['sometimes', 'numeric', 'between:0.01,10'],
            'adjustments.*.deductionsConfirmed' => ['sometimes', 'boolean'],
        ];
        foreach (PayrollCalculator::MONEY_FIELDS as $field) {
            $rules['adjustments.*.'.$field] = ['sometimes', 'numeric', 'min:0', 'max:999999999999999999.99'];
        }
        foreach (['trafficMonthlyBaseUzs', 'travelMonthlyBaseUzs'] as $field) {
            $rules['adjustments.*.'.$field] = ['sometimes', 'numeric', 'min:0', 'max:999999999999999999.99'];
        }
        foreach (['bonusRateBps', 'trafficAllowanceRateBps', 'travelAllowanceRateBps', 'seniorityRateBps', 'additionalRateBps'] as $field) {
            $rules['adjustments.*.'.$field] = ['sometimes', 'integer', 'between:0,20000'];
        }
        $rules['adjustments.*.socialContributionRateBps'] = ['sometimes', 'integer', 'between:0,10000'];
        $adjustmentKeys = [
            'workerId', 'coefficient', 'deductionsConfirmed', ...PayrollCalculator::MONEY_FIELDS,
            'trafficMonthlyBaseUzs', 'travelMonthlyBaseUzs', 'bonusRateBps',
            'trafficAllowanceRateBps', 'travelAllowanceRateBps', 'seniorityRateBps',
            'additionalRateBps', 'socialContributionRateBps',
        ];
        $rules['adjustments.*'] = ['array:'.implode(',', $adjustmentKeys)];
        $validated = $request->validate($rules);
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        if (! $context->canAccessRoadUnit((string) $validated['divisionId'])) {
            abort(403);
        }

        $periodStart = $validated['period'].'-01';
        $periodEnd = (new \DateTimeImmutable($periodStart))->modify('+1 month')->format('Y-m-d');
        try {
            $snapshot = DB::transaction(function () use ($validated, $periodStart, $periodEnd, $context): array {
                // Read actual attendance and its approved, dated tariff in one query.
                // A late work completion never moves prior-month payroll into this month.
                $entries = DbRows::select(
                    <<<'SQL'
                    select te.id time_entry_id, te.worker_id, te.work_date, te.actual_minutes,
                           wo.id work_order_id, profile.full_name, profile.personnel_number,
                           rate.id rate_id, rate.rate_amount_uzs, rate.bonus_rate_bps,
                           rate.traffic_allowance_rate_bps, rate.travel_allowance_rate_bps,
                           rate.social_contribution_rate_bps, rate.source_reference rate_reference,
                           norm.id norm_id, norm.norm_minutes, norm.source_reference norm_reference
                    from roadops.time_entries te
                    join roadops.work_orders wo on wo.id=te.work_order_id and wo.status='verified'
                    join roadops.plan_items item on item.id=wo.plan_item_id
                    join roadops.planning_runs run on run.id=item.planning_run_id
                    left join roadops.cost_rate_versions rate
                      on rate.division_id=run.division_id and rate.worker_id=te.worker_id
                     and rate.rate_kind='labor' and rate.status='approved'
                     and rate.effective_period @> te.work_date
                    left join roadops.monthly_work_time_norms norm
                      on norm.division_id=run.division_id and norm.schedule_code=rate.schedule_code
                     and norm.work_month=?::date and norm.status='approved'
                    left join lateral (
                      select version.full_name, version.personnel_number
                      from roadops.worker_versions version
                      where version.worker_id=te.worker_id
                        and version.valid_from <= (te.work_date::timestamp at time zone 'Asia/Tashkent')
                        and (version.valid_until is null
                             or version.valid_until > (te.work_date::timestamp at time zone 'Asia/Tashkent'))
                      order by version.valid_from desc, version.id limit 1
                    ) profile on true
                    where run.division_id=? and te.work_date>=?::date and te.work_date<?::date
                      and te.approved_at is not null and te.approved_by is not null
                    order by te.worker_id, te.work_date, te.id
                SQL,
                    [$periodStart, $validated['divisionId'], $periodStart, $periodEnd],
                    false,
                );
                if ($entries === []) {
                    throw ValidationException::withMessages(['period' => ['Bu oyda tekshirilgan ishlarga tegishli tasdiqlangan tabel yozuvlari mavjud emas.']]);
                }
                $frozenSources = [];
                foreach (DbRows::select(
                    <<<'SQL'
                    select l.time_entry_id, l.payroll_source_allocation
                    from roadops.monthly_completion_act_cost_lines l
                    join roadops.monthly_completion_act_items i on i.id=l.act_item_id
                    join roadops.monthly_completion_acts a on a.id=i.act_id
                    join roadops.time_entries te on te.id=l.time_entry_id
                    where a.division_id=? and a.status in ('submitted','approved')
                      and te.work_date>=?::date and te.work_date<?::date
                      and l.payroll_snapshot_id is not null
                    order by te.work_date, te.id
                SQL,
                    [$validated['divisionId'], $periodStart, $periodEnd], false,
                ) as $source) {
                    $frozenSources[(string) $source->time_entry_id] = json_decode(
                        (string) $source->payroll_source_allocation, true, 512, JSON_THROW_ON_ERROR,
                    );
                }
                $workers = [];
                foreach ($entries as $entry) {
                    if ($entry->rate_id === null || $entry->norm_id === null) {
                        throw ValidationException::withMessages(['period' => ['Haqiqiy ish sanasiga tegishli tasdiqlangan tarif yoki oylik ish vaqti me’yori yetishmaydi.']]);
                    }
                    $workerId = (string) $entry->worker_id;
                    // Match the monthly act: round each immutable attendance source separately.
                    $segmentKey = (string) $entry->time_entry_id;
                    if (! isset($workers[$workerId])) {
                        $workers[$workerId] = [
                            'workerId' => $workerId,
                            'fullName' => (string) ($entry->full_name ?? 'Xodim'),
                            'personnelNumber' => (string) ($entry->personnel_number ?? ''),
                            'segments' => [], 'sources' => [], 'workDates' => [],
                        ];
                    }
                    if (! isset($workers[$workerId]['segments'][$segmentKey])) {
                        $workers[$workerId]['segments'][$segmentKey] = [
                            'monthlySalaryUzs' => (string) $entry->rate_amount_uzs,
                            'actualMinutes' => 0,
                            'normMinutes' => (int) $entry->norm_minutes,
                            'bonusRateBps' => (int) $entry->bonus_rate_bps,
                            'trafficAllowanceRateBps' => (int) $entry->traffic_allowance_rate_bps,
                            'travelAllowanceRateBps' => (int) $entry->travel_allowance_rate_bps,
                            'socialContributionRateBps' => (int) $entry->social_contribution_rate_bps,
                        ];
                    }
                    $workers[$workerId]['segments'][$segmentKey]['actualMinutes'] += (int) $entry->actual_minutes;
                    $workers[$workerId]['workDates'][(string) $entry->work_date] = true;
                    $workers[$workerId]['sources'][] = [
                        'timeEntryId' => (string) $entry->time_entry_id,
                        'workOrderId' => (string) $entry->work_order_id,
                        'workDate' => (string) $entry->work_date,
                        'actualMinutes' => (int) $entry->actual_minutes,
                        'rateId' => (string) $entry->rate_id, 'normId' => (string) $entry->norm_id,
                        'rateReference' => (string) $entry->rate_reference,
                        'normReference' => (string) $entry->norm_reference,
                    ];
                }
                $adjustments = [];
                foreach ($validated['adjustments'] as $index => $adjustment) {
                    $workerId = strtolower((string) $adjustment['workerId']);
                    if (! isset($workers[$workerId])) {
                        throw ValidationException::withMessages(['adjustments.'.$index.'.workerId' => ['Xodimning tanlangan oy va yo‘l bo‘limida tasdiqlangan ish vaqti yo‘q.']]);
                    }
                    if (isset($adjustments[$workerId])) {
                        throw ValidationException::withMessages(['adjustments.'.$index.'.workerId' => ['Xodim bir marta kiritiladi.']]);
                    }
                    // Laravel's boolean validation accepts 1/0 as well as true/false.
                    $adjustment['deductionsConfirmed'] = (bool) ($adjustment['deductionsConfirmed'] ?? false);
                    $adjustments[$workerId] = $adjustment;
                }
                $rows = [];
                $totalGross = BigDecimal::zero();
                $totalEmployerCost = BigDecimal::zero();
                $totalPayable = BigDecimal::zero();
                $deductionsComplete = true;
                foreach ($workers as $workerId => $worker) {
                    $segments = array_values($worker['segments']);
                    try {
                        $frozen = [];
                        foreach ($worker['sources'] as $index => $source) {
                            if (isset($frozenSources[$source['timeEntryId']])) {
                                $frozen[$index] = $frozenSources[$source['timeEntryId']];
                            }
                        }
                        $calculation = $this->calculator->calculate($segments, $adjustments[$workerId] ?? [], $frozen);
                    } catch (\InvalidArgumentException $exception) {
                        throw ValidationException::withMessages(['adjustments' => [$exception->getMessage()]]);
                    }
                    $totalGross = $totalGross->plus((string) $calculation['grossAmountUzs']);
                    $totalEmployerCost = $totalEmployerCost->plus((string) $calculation['employerCostAmountUzs']);
                    if ($calculation['payableAmountUzs'] === null) {
                        $deductionsComplete = false;
                    } else {
                        $totalPayable = $totalPayable->plus((string) $calculation['payableAmountUzs']);
                    }
                    $sourceAllocations = [];
                    foreach ($calculation['sourceAllocations'] as $index => $allocation) {
                        $sourceAllocations[] = [...$worker['sources'][$index], ...$allocation];
                    }
                    $calculation['sourceAllocations'] = $sourceAllocations;
                    $rows[] = [
                        'workerId' => $workerId, 'fullName' => $worker['fullName'],
                        'personnelNumber' => $worker['personnelNumber'],
                        'actualDays' => count($worker['workDates']),
                        'segments' => $segments, 'sources' => $worker['sources'],
                        'adjustments' => $adjustments[$workerId] ?? [],
                        ...$calculation,
                    ];
                }
                $snapshotId = (string) Str::uuid();
                $snapshot = [
                    'id' => $snapshotId, 'divisionId' => (string) $validated['divisionId'],
                    'period' => (string) $validated['period'],
                    'policyReference' => (string) $validated['policyReference'],
                    'currency' => 'UZS', 'state' => 'PREVIEW', 'paymentInitiated' => false,
                    'calculationVersion' => 'payroll-source-allocation-v2',
                    'rounding' => 'HALF_UP_2DP_PER_TIME_ENTRY',
                    'createdAt' => now('Asia/Tashkent')->toIso8601String(),
                    'rows' => $rows,
                    'totals' => [
                        'grossAmountUzs' => (string) $totalGross->toScale(2, RoundingMode::HALF_UP),
                        'employerCostAmountUzs' => (string) $totalEmployerCost->toScale(2, RoundingMode::HALF_UP),
                        'payableAmountUzs' => $deductionsComplete ? (string) $totalPayable->toScale(2, RoundingMode::HALF_UP) : null,
                    ],
                ];
                DB::insert(
                    <<<'SQL'
                    insert into roadops.payroll_snapshots
                      (id, division_id, work_month, policy_reference, snapshot, created_by)
                    values (?, ?, ?::date, ?, ?::jsonb, ?)
                SQL,
                    [$snapshotId, $validated['divisionId'], $periodStart, $validated['policyReference'],
                        json_encode($snapshot, JSON_THROW_ON_ERROR), $context->userId],
                );

                return $snapshot;
            });

        } catch (QueryException $exception) {
            if (str_contains($exception->getMessage(), 'PAYROLL_POSTED_ALLOCATION_CHANGED')) {
                return response()->json(['error' => [
                    'code' => 'PAYROLL_POSTED_ALLOCATION_CHANGED',
                    'message' => 'Dalolatnomaga kiritilgan summalar o‘zgarmaydi. Yangi ishlar uchun qolgan to‘lovlar hisoblanadi.',
                ]], 409);
            }
            if (str_contains($exception->getMessage(), 'PAYROLL_SNAPSHOT_STALE')) {
                return response()->json(['error' => ['code' => 'PAYROLL_SNAPSHOT_STALE',
                    'message' => 'Tabel yangilandi. Oylik hisobini qayta saqlang.']], 409);
            }
            throw $exception;
        }

        return response()->json(['data' => $snapshot], 201);
    }

    public function history(Request $request, ApiScope $scope): JsonResponse
    {
        $validated = $request->validate([
            'period' => ['sometimes', 'date_format:Y-m'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'pageSize' => ['sometimes', 'integer', 'between:1,100'],
        ]);
        $divisionIds = $scope->roadUnitIds($request);
        $page = (int) ($validated['page'] ?? 1);
        $pageSize = (int) ($validated['pageSize'] ?? 25);
        $period = isset($validated['period']) ? $validated['period'].'-01' : null;
        $rows = DbRows::select(
            <<<'SQL'
                select id, division_id, work_month, policy_reference, created_at,
                       snapshot->'totals' totals, encode(snapshot_hash,'hex') snapshot_hash,
                       count(*) over() total_count
                from roadops.payroll_snapshots
                where division_id=any(?::uuid[]) and (?::date is null or work_month=?::date)
                order by created_at desc, id desc limit ? offset ?
            SQL,
            [$scope->pgUuidArray($divisionIds), $period, $period, $pageSize, ($page - 1) * $pageSize],
            false,
        );

        return PagedResponse::make(array_map(static fn ($row): array => [
            'id' => (string) $row->id, 'divisionId' => (string) $row->division_id,
            'period' => substr((string) $row->work_month, 0, 7),
            'policyReference' => (string) $row->policy_reference,
            'createdAt' => (string) $row->created_at, 'state' => 'PREVIEW',
            'totals' => json_decode((string) $row->totals, true, 512, JSON_THROW_ON_ERROR),
            'snapshotHash' => (string) $row->snapshot_hash,
        ], $rows), $page, $pageSize, (int) ($rows[0]->total_count ?? 0));
    }

    public function show(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        $row = DbRows::selectOne(
            'select snapshot from roadops.payroll_snapshots where id=? and division_id=any(?::uuid[])',
            [$id, $scope->pgUuidArray($scope->roadUnitIds($request))],
            false,
        );
        if ($row === null) {
            abort(404);
        }

        return response()->json(['data' => json_decode((string) $row->snapshot, true, 512, JSON_THROW_ON_ERROR)]);
    }
}
