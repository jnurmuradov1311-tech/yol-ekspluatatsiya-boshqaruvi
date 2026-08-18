<?php

namespace Tests\Unit\Execution;

use PHPUnit\Framework\TestCase;

final class ExecutionCostControllerContractTest extends TestCase
{
    public function test_completion_keeps_explicit_actual_dates_and_reservation_audit_links(): void
    {
        $source = $this->source('app/Http/Controllers/Api/V1/WorkOrderExecutionController.php');
        $migration = $this->source('database/migrations/20260818000200_monthly_completion_costing.sql');

        foreach ([
            "'laborEntries.*.workDate'",
            "'materialUsages.*.materialReservationId'",
            "'materialUsages.*.usedAt'",
            "'equipmentUsages.*.equipmentReservationId'",
            "'equipmentUsages.*.usageDate'",
            "(?:jpe?g|png|pdf)",
            'execution_evidence_allowed_origins',
            'assertEvidenceOrigins',
            'httpsOrigin',
            'material_reservation_id',
            'equipment_reservation_id',
            'DB::transaction',
        ] as $contract) {
            self::assertStringContainsString($contract, $source);
        }
        self::assertStringNotContainsString(
            "'laborEntries.*.workerId' => ['required', 'uuid', 'distinct']",
            $source,
        );
        self::assertStringContainsString("strtolower((string) \$entry['workerId']).'|'.\$entry['workDate']", $source);
        self::assertStringContainsString('MATERIAL_USAGE_EXCEEDS_RESERVATION', $source);
        self::assertStringNotContainsString('MATERIAL_USAGE_MUST_CONSUME_RESERVATION', $source);
        self::assertStringContainsString('COMPLETED_QUANTITY_EXCEEDS_PLAN', $source);
        self::assertStringContainsString('MATERIAL_USAGE_COVERAGE_INCOMPLETE', $source);
        self::assertStringContainsString('EQUIPMENT_USAGE_COVERAGE_INCOMPLETE', $source);
        self::assertStringContainsString('EQUIPMENT_USAGE_EXCEEDS_RESERVATION_WINDOW', $source);
        self::assertStringContainsString('Dalil havolasi faqat sozlangan ruxsat etilgan HTTPS omboridan', $source);
        self::assertStringContainsString('new.quantity > reservation_row.quantity', $migration);
    }

    public function test_verification_is_independent_and_uses_guarded_database_workflows(): void
    {
        $source = $this->source('app/Http/Controllers/Api/V1/WorkOrderExecutionController.php');

        foreach ([
            'approve_time_entry',
            'approve_work_order_material_usage',
            'approve_equipment_usage_entry',
            'verify_work_order_completion',
        ] as $function) {
            self::assertStringContainsString('roadops.'.$function, $source);
        }
        self::assertGreaterThanOrEqual(3, substr_count($source, 'return $this->detailResponse('));
        self::assertStringContainsString("'executionResources'", $source);
        self::assertStringContainsString("'completion' => \$completion", $source);
        self::assertStringContainsString("'canVerify' => self::databaseBoolean(\$order->can_verify)", $source);
        self::assertStringContainsString("wo.issued_by <> roadops.current_actor_id()", $source);
        self::assertStringContainsString("cr.recorded_by <> roadops.current_actor_id()", $source);
        self::assertStringContainsString("pending_time.recorded_by = roadops.current_actor_id()", $source);
        self::assertStringContainsString("pending_material.recorded_by = roadops.current_actor_id()", $source);
        self::assertStringContainsString("pending_equipment.recorded_by = roadops.current_actor_id()", $source);
        self::assertStringContainsString('WORK_ORDER_RESCHEDULE_REQUIRED', $source);
        self::assertStringContainsString('roadops.reschedule_work_order', $source);
        self::assertStringContainsString('RESCHEDULE_DATE_IN_PAST', $source);
    }

    public function test_costing_lists_and_payloads_use_the_canonical_paged_contract(): void
    {
        $rates = $this->source('app/Http/Controllers/Api/V1/CostRateController.php');
        $acts = $this->source('app/Http/Controllers/Api/V1/MonthlyCompletionActController.php');

        self::assertGreaterThanOrEqual(2, substr_count($rates, 'PagedResponse::make'));
        self::assertStringContainsString("'rateKind'", $rates);
        self::assertStringContainsString("'effectiveFrom'", $rates);
        self::assertStringContainsString("'effectiveUntil'", $rates);
        self::assertStringContainsString("'target'", $rates);
        self::assertStringContainsString("'state' => strtoupper", $rates);
        self::assertGreaterThanOrEqual(2, substr_count($rates, "'createdByMe'"));
        self::assertGreaterThanOrEqual(2, substr_count($rates, "'canApprove'"));
        self::assertStringContainsString('PagedResponse::make', $acts);
        self::assertStringContainsString("'actMonth'", $acts);
        self::assertStringContainsString("'createdByMe'", $acts);
        self::assertStringContainsString("'submittedByMe'", $acts);
        self::assertStringContainsString("'canSubmit'", $acts);
        self::assertStringContainsString("'canApprove'", $acts);
        self::assertStringContainsString("'costLines'", $acts);
        self::assertStringContainsString("'completedQuantity' => [", $acts);
    }

    public function test_monthly_generation_requires_exact_approved_rates_and_norms(): void
    {
        $source = $this->source('app/Http/Controllers/Api/V1/MonthlyCompletionActController.php');

        self::assertStringContainsString("wo.status='verified'", $source);
        self::assertStringContainsString("n.status='approved'", $source);
        self::assertStringContainsString("r.status='approved'", $source);
        self::assertStringContainsString('effective_period @> ?::date', $source);
        self::assertStringContainsString('LABOR_RATE_OR_MONTHLY_NORM_MISSING', $source);
        self::assertStringContainsString('IQN_APPROVED_LABOR_NORM_MISSING', $source);
        self::assertStringContainsString("variant.formula_type = 'linear'", $source);
        self::assertStringContainsString('iqn_labor_minutes_per_unit_snapshot', $source);
        self::assertStringContainsString("'iqnLaborNorm' =>", $source);
        self::assertStringContainsString("'workOrderIds' => ['prohibited']", $source);
        self::assertStringNotContainsString('SELECTED_WORK_ORDER_UNAVAILABLE', $source);
        self::assertStringContainsString('MATERIAL_RATE_MISSING', $source);
        self::assertStringContainsString('EQUIPMENT_RATE_MISSING', $source);
        self::assertStringContainsString('refresh_monthly_completion_act_totals', $source);
        self::assertStringContainsString('year_to_date_quantity_snapshot', $source);
        self::assertStringContainsString('ytd_group_key', $source);
        self::assertStringContainsString('MONTHLY_ACT_BACKFILL_LOCKED', $source);
        self::assertStringNotContainsString('left join roadops.annual_program_items api', $source);
        self::assertStringContainsString("'transportAmountUzs' => '0.00'", $source);
        self::assertStringContainsString("'vatAmountUzs' => '0.00'", $source);
    }

    public function test_closed_month_rejects_late_verification_with_an_explicit_error(): void
    {
        $execution = $this->source('app/Http/Controllers/Api/V1/WorkOrderExecutionController.php');
        $acts = $this->source('app/Http/Controllers/Api/V1/MonthlyCompletionActController.php');
        $migration = $this->source('database/migrations/20260818000700_monthly_act_iqn_labor_norms.sql');

        self::assertStringContainsString('MONTHLY_ACT_MONTH_CLOSED_FOR_LATE_VERIFICATION', $execution);
        self::assertStringContainsString('reject_late_verification_for_closed_act_month', $migration);
        self::assertStringContainsString('work_orders_closed_month_verification_guard', $migration);
        self::assertStringContainsString('MONTHLY_ACT_VERIFIED_WORK_MISSING', $migration);
        self::assertStringContainsString('MONTHLY_ACT_IQN_LABOR_NORM_SNAPSHOT_MISSING', $migration);
        self::assertStringContainsString('validate_monthly_act_iqn_labor_snapshot', $migration);
        self::assertStringContainsString("norm_set.status = 'approved'", $migration);
        self::assertStringContainsString("variant.formula_type = 'linear'", $migration);
        self::assertStringContainsString('iqn_labor_norm_line_ids', $migration);
        self::assertStringContainsString('iqn_total_labor_minutes', $migration);
        self::assertStringContainsString('pg_advisory_xact_lock', $migration);
        self::assertStringContainsString(
            '$this->order($request, $scope, $id, false, true)',
            $execution,
        );
        self::assertStringContainsString("\$order->division_id.':'.substr", $execution);
        self::assertStringContainsString("\$act->division_id.':'.substr", $acts);
        self::assertSame(2, substr_count(
            $acts,
            '$this->act($request, $scope, $id, true)',
        ));
        self::assertSame(2, substr_count(
            $acts,
            'DB::transaction(function () use ($act, $id): void {',
        ));
    }

    public function test_reports_only_count_independently_verified_actuals(): void
    {
        $annual = $this->source('app/Http/Controllers/Api/V1/AnnualProgramController.php');
        $report = $this->source('app/Http/Controllers/Api/V1/ReportController.php');

        self::assertStringContainsString("wo.status='verified'", $annual);
        self::assertStringContainsString('te.approved_at is not null', $annual);
        self::assertStringContainsString("case when wo.status='verified'", $report);
        self::assertStringContainsString('verified_labor_minutes', $report);
        self::assertStringNotContainsString("official_code='D001'", $report);
    }

    private function source(string $relative): string
    {
        $source = file_get_contents(dirname(__DIR__, 3).'/'.$relative);
        self::assertIsString($source);

        return $source;
    }
}
