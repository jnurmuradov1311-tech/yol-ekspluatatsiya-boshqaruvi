<?php

namespace App\Http\Controllers\Api\V1;

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
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

final class CostRateController extends Controller
{
    public function index(Request $request, ApiScope $scope): JsonResponse
    {
        $pagination = Pagination::from($request);
        $validated = $request->validate([
            'kind' => ['nullable', 'in:labor,material,equipment'],
            'rateKind' => ['nullable', 'in:labor,material,equipment'],
            'effectiveDate' => ['nullable', 'date_format:Y-m-d'],
            'status' => ['nullable', 'in:draft,approved'],
            'state' => ['nullable', 'in:DRAFT,APPROVED'],
        ]);
        $kind = $validated['rateKind'] ?? $validated['kind'] ?? null;
        $status = isset($validated['state']) ? strtolower((string) $validated['state']) : ($validated['status'] ?? null);
        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $baseSql = <<<'SQL'
                select r.*, lower(r.effective_period) effective_from,
                       upper(r.effective_period) effective_until,
                       coalesce(wv.full_name, m.name, e.name) resource_name,
                       coalesce(w.external_id, m.code, e.inventory_code) resource_code,
                       (r.created_by = roadops.current_actor_id()) created_by_me,
                       (
                         r.status = 'draft'
                         and r.created_by <> roadops.current_actor_id()
                         and roadops.has_permission('costs.approve', r.division_id)
                       ) can_approve
                from roadops.cost_rate_versions r
                left join roadops.workers w on w.id=r.worker_id
                left join roadops.worker_versions wv on wv.worker_id=w.id and wv.valid_until is null
                left join roadops.materials m on m.id=r.material_id
                left join roadops.equipment_units e on e.id=r.equipment_unit_id
                where r.division_id=any(?::uuid[])
                  and (?::text is null or r.rate_kind=?::text)
                  and (?::date is null or r.effective_period @> ?::date)
                  and (?::text is null or r.status=?::text)
            SQL;
        $bindings = [
            $divisionIds,
            $kind, $kind,
            $validated['effectiveDate'] ?? null, $validated['effectiveDate'] ?? null,
            $status, $status,
        ];
        $total = (int) DB::scalar('select count(*) from ('.$baseSql.') scoped_rates', $bindings);
        $rows = DbRows::select(
            $baseSql.' order by r.rate_kind, resource_name, lower(r.effective_period) desc, r.version_no desc limit ? offset ?',
            [...$bindings, $pagination->pageSize, $pagination->offset()],
        );

        return PagedResponse::make(
            array_map($this->ratePayload(...), $rows),
            $pagination->page,
            $pagination->pageSize,
            $total,
        );
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'divisionId' => ['required', 'uuid'],
            'rateKind' => ['required', 'in:labor,material,equipment'],
            'targetId' => ['required', 'uuid'],
            'rateBasis' => ['required', 'in:monthly_salary,material_unit,machine_hour'],
            'scheduleCode' => ['nullable', 'string', 'max:80', 'required_if:rateKind,labor'],
            'pricingUnit' => ['required', 'string', 'max:50'],
            'rateAmountUzs' => ['required', 'numeric', 'gt:0'],
            'bonusRateBps' => ['sometimes', 'integer', 'between:0,20000'],
            'trafficAllowanceRateBps' => ['sometimes', 'integer', 'between:0,20000'],
            'travelAllowanceRateBps' => ['sometimes', 'integer', 'between:0,20000'],
            'socialContributionRateBps' => ['sometimes', 'integer', 'between:0,10000'],
            'effectiveFrom' => ['required', 'date_format:Y-m-d'],
            'effectiveUntil' => ['required', 'date_format:Y-m-d', 'after:effectiveFrom'],
            'versionNo' => ['required', 'integer', 'min:1'],
            'sourceReference' => ['required', 'string', 'max:500'],
        ]);
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        if (! $context->canAccessRoadUnit($validated['divisionId'])) {
            abort(403);
        }
        $target = match ($validated['rateKind']) {
            'labor' => ['worker_id' => $validated['targetId'], 'material_id' => null, 'equipment_unit_id' => null, 'basis' => 'monthly_salary'],
            'material' => ['worker_id' => null, 'material_id' => $validated['targetId'], 'equipment_unit_id' => null, 'basis' => 'material_unit'],
            default => ['worker_id' => null, 'material_id' => null, 'equipment_unit_id' => $validated['targetId'], 'basis' => 'machine_hour'],
        };
        if ($validated['rateBasis'] !== $target['basis']) {
            return $this->writeError(new \DomainException('COST_RATE_BASIS_MISMATCH'), 'COST_RATE_BASIS_MISMATCH');
        }
        try {
            $row = DbRows::selectOneOrFail(
                <<<'SQL'
                    insert into roadops.cost_rate_versions
                      (division_id, rate_kind, worker_id, material_id, equipment_unit_id,
                       schedule_code, rate_basis, pricing_unit, rate_amount_uzs,
                       bonus_rate_bps, traffic_allowance_rate_bps, travel_allowance_rate_bps,
                       social_contribution_rate_bps, effective_period, version_no,
                       source_reference, created_by)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?::numeric, ?, ?, ?, ?,
                            daterange(?::date, ?::date, '[)'), ?, ?, ?)
                    returning id
                SQL,
                [
                    $validated['divisionId'], $validated['rateKind'], $target['worker_id'],
                    $target['material_id'], $target['equipment_unit_id'],
                    $validated['rateKind'] === 'labor' ? $validated['scheduleCode'] : null,
                    $target['basis'], $validated['pricingUnit'], $validated['rateAmountUzs'],
                    $validated['bonusRateBps'] ?? 0, $validated['trafficAllowanceRateBps'] ?? 0,
                    $validated['travelAllowanceRateBps'] ?? 0,
                    $validated['socialContributionRateBps'] ?? 0,
                    $validated['effectiveFrom'], $validated['effectiveUntil'],
                    $validated['versionNo'], $validated['sourceReference'], $context->userId,
                ],
                false,
            );
        } catch (\Throwable $exception) {
            return $this->writeError($exception, 'COST_RATE_INVALID');
        }

        return response()->json(['data' => $this->ratePayload($this->rate((string) $row->id))], 201);
    }

    public function approve(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        if (! Str::isUuid($id)) {
            abort(404);
        }
        if (! DB::scalar(
            'select exists(select 1 from roadops.cost_rate_versions where id=? and division_id=any(?::uuid[]))',
            [$id, $scope->pgUuidArray($scope->roadUnitIds($request))],
        )) {
            abort(404);
        }
        try {
            DbRows::select('select roadops.approve_cost_rate_version(?)', [$id], false);
        } catch (\Throwable $exception) {
            return $this->writeError($exception, 'COST_RATE_APPROVAL_REJECTED');
        }

        return response()->json(['data' => $this->ratePayload($this->rate($id))]);
    }

    public function normIndex(Request $request, ApiScope $scope): JsonResponse
    {
        $pagination = Pagination::from($request);
        $validated = $request->validate([
            'month' => ['nullable', 'date_format:Y-m'],
            'workMonth' => ['nullable', 'date_format:Y-m-d'],
            'scheduleCode' => ['nullable', 'string', 'max:80'],
            'status' => ['nullable', 'in:draft,approved'],
            'state' => ['nullable', 'in:DRAFT,APPROVED'],
        ]);
        $workMonth = $validated['workMonth'] ?? (isset($validated['month']) ? $validated['month'].'-01' : null);
        $status = isset($validated['state']) ? strtolower((string) $validated['state']) : ($validated['status'] ?? null);
        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $baseSql = <<<'SQL'
                select n.*,
                       (n.created_by = roadops.current_actor_id()) created_by_me,
                       (
                         n.status = 'draft'
                         and n.created_by <> roadops.current_actor_id()
                         and roadops.has_permission('costs.approve', n.division_id)
                       ) can_approve
                from roadops.monthly_work_time_norms n
                where n.division_id=any(?::uuid[])
                  and (?::date is null or n.work_month=?::date)
                  and (?::text is null or n.schedule_code=?::text)
                  and (?::text is null or n.status=?::text)
            SQL;
        $bindings = [
            $divisionIds,
            $workMonth, $workMonth,
            $validated['scheduleCode'] ?? null, $validated['scheduleCode'] ?? null,
            $status, $status,
        ];
        $total = (int) DB::scalar('select count(*) from ('.$baseSql.') scoped_norms', $bindings);
        $rows = DbRows::select(
            $baseSql.' order by n.work_month desc, n.schedule_code, n.version_no desc limit ? offset ?',
            [...$bindings, $pagination->pageSize, $pagination->offset()],
        );

        return PagedResponse::make(
            array_map($this->normPayload(...), $rows),
            $pagination->page,
            $pagination->pageSize,
            $total,
        );
    }

    public function normStore(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'divisionId' => ['required', 'uuid'],
            'workMonth' => ['required', 'date_format:Y-m-d', 'regex:/^\d{4}-\d{2}-01$/'],
            'scheduleCode' => ['required', 'string', 'max:80'],
            'workingDays' => ['required', 'integer', 'between:1,31'],
            'normMinutes' => ['required', 'integer', 'between:1,44640'],
            'versionNo' => ['required', 'integer', 'min:1'],
            'sourceReference' => ['required', 'string', 'max:500'],
        ]);
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        if (! $context->canAccessRoadUnit($validated['divisionId'])) {
            abort(403);
        }
        try {
            $row = DbRows::selectOneOrFail(
                <<<'SQL'
                    insert into roadops.monthly_work_time_norms
                      (division_id, work_month, schedule_code, working_days, norm_minutes,
                       version_no, source_reference, created_by)
                    values (?, ?::date, ?, ?, ?, ?, ?, ?) returning *
                SQL,
                [
                    $validated['divisionId'], $validated['workMonth'], $validated['scheduleCode'],
                    $validated['workingDays'], $validated['normMinutes'], $validated['versionNo'],
                    $validated['sourceReference'], $context->userId,
                ],
                false,
            );
        } catch (\Throwable $exception) {
            return $this->writeError($exception, 'MONTHLY_NORM_INVALID');
        }

        return response()->json(['data' => $this->normPayload($this->norm((string) $row->id))], 201);
    }

    public function normApprove(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        if (! Str::isUuid($id)) {
            abort(404);
        }
        if (! DB::scalar(
            'select exists(select 1 from roadops.monthly_work_time_norms where id=? and division_id=any(?::uuid[]))',
            [$id, $scope->pgUuidArray($scope->roadUnitIds($request))],
        )) {
            abort(404);
        }
        try {
            DbRows::select('select roadops.approve_monthly_work_time_norm(?)', [$id], false);
        } catch (\Throwable $exception) {
            return $this->writeError($exception, 'MONTHLY_NORM_APPROVAL_REJECTED');
        }

        return response()->json(['data' => $this->normPayload($this->norm($id))]);
    }

    /** @return array<string, mixed> */
    private function ratePayload(object $row): array
    {
        return [
            'id' => (string) $row->id, 'divisionId' => (string) $row->division_id,
            'rateKind' => (string) $row->rate_kind,
            'target' => [
                'id' => (string) ($row->worker_id ?? $row->material_id ?? $row->equipment_unit_id),
                'code' => isset($row->resource_code) ? (string) $row->resource_code : null,
                'name' => isset($row->resource_name) ? (string) $row->resource_name : '',
            ],
            'scheduleCode' => $row->schedule_code,
            'rateBasis' => (string) $row->rate_basis,
            'pricingUnit' => (string) $row->pricing_unit,
            'rateAmountUzs' => (string) $row->rate_amount_uzs,
            'bonusRateBps' => (int) $row->bonus_rate_bps,
            'trafficAllowanceRateBps' => (int) $row->traffic_allowance_rate_bps,
            'travelAllowanceRateBps' => (int) $row->travel_allowance_rate_bps,
            'socialContributionRateBps' => (int) $row->social_contribution_rate_bps,
            'effectiveFrom' => (string) $row->effective_from,
            'effectiveUntil' => (string) $row->effective_until,
            'sourceReference' => (string) $row->source_reference,
            'versionNo' => (int) $row->version_no,
            'state' => strtoupper((string) $row->status),
            'createdByMe' => self::databaseBoolean($row->created_by_me),
            'canApprove' => self::databaseBoolean($row->can_approve),
            'createdAt' => (string) $row->created_at,
            'approvedAt' => $row->approved_at === null ? null : (string) $row->approved_at,
        ];
    }

    /** @return array<string, mixed> */
    private function normPayload(object $row): array
    {
        return [
            'id' => (string) $row->id, 'divisionId' => (string) $row->division_id,
            'workMonth' => substr((string) $row->work_month, 0, 10),
            'scheduleCode' => (string) $row->schedule_code,
            'workingDays' => (int) $row->working_days, 'normMinutes' => (int) $row->norm_minutes,
            'sourceReference' => (string) $row->source_reference,
            'versionNo' => (int) $row->version_no,
            'state' => strtoupper((string) $row->status),
            'createdByMe' => self::databaseBoolean($row->created_by_me),
            'canApprove' => self::databaseBoolean($row->can_approve),
            'createdAt' => (string) $row->created_at,
            'approvedAt' => $row->approved_at === null ? null : (string) $row->approved_at,
        ];
    }

    private function rate(string $id): object
    {
        return DbRows::selectOneOrFail(
            <<<'SQL'
                select r.*, lower(r.effective_period) effective_from,
                       upper(r.effective_period) effective_until,
                       coalesce(wv.full_name, m.name, e.name) resource_name,
                       coalesce(w.external_id, m.code, e.inventory_code) resource_code,
                       (r.created_by = roadops.current_actor_id()) created_by_me,
                       (
                         r.status = 'draft'
                         and r.created_by <> roadops.current_actor_id()
                         and roadops.has_permission('costs.approve', r.division_id)
                       ) can_approve
                from roadops.cost_rate_versions r
                left join roadops.workers w on w.id=r.worker_id
                left join roadops.worker_versions wv on wv.worker_id=w.id and wv.valid_until is null
                left join roadops.materials m on m.id=r.material_id
                left join roadops.equipment_units e on e.id=r.equipment_unit_id
                where r.id=?
            SQL,
            [$id],
            false,
        );
    }

    private function norm(string $id): object
    {
        return DbRows::selectOneOrFail(
            <<<'SQL'
                select n.*,
                       (n.created_by = roadops.current_actor_id()) created_by_me,
                       (
                         n.status = 'draft'
                         and n.created_by <> roadops.current_actor_id()
                         and roadops.has_permission('costs.approve', n.division_id)
                       ) can_approve
                from roadops.monthly_work_time_norms n
                where n.id=?
            SQL,
            [$id],
            false,
        );
    }

    private static function databaseBoolean(mixed $value): bool
    {
        return in_array($value, [true, 1, '1', 't', 'true'], true);
    }

    private function writeError(\Throwable $exception, string $fallback): JsonResponse
    {
        if ($exception instanceof HttpExceptionInterface) {
            throw $exception;
        }
        $message = $exception->getMessage();
        $overlap = str_contains($message, 'exclusion') || str_contains($message, 'overlap')
            || str_contains($message, 'one_approved');
        $independent = str_contains($message, 'cannot approve') || str_contains($message, 'creator');
        $code = $overlap ? 'COST_RATE_PERIOD_OVERLAP' : ($independent ? 'INDEPENDENT_APPROVER_REQUIRED' : $fallback);

        return response()->json(['error' => [
            'code' => $code,
            'message' => $overlap
                ? 'Ushbu resurs va davr uchun boshqa tasdiqlangan tarif yoki norma mavjud.'
                : ($independent
                    ? 'Yozuvni uni tuzgan shaxsdan boshqa vakolatli shaxs tasdiqlashi shart.'
                    : 'Tarif yoki ish vaqti normasi ma’lumotlari to‘liq va mos bo‘lishi shart.'),
        ]], $overlap ? 409 : 422);
    }
}
