<?php

namespace Tests\Feature;

use App\Domain\Execution\PayrollCalculator;
use App\Http\Controllers\Api\V1\PayrollController;
use App\Security\AuthContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Mockery;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class PayrollPreviewTest extends TestCase
{
    private const DIVISION = '91000000-0000-4000-8000-000000000001';

    private const WORKER = '91000000-0000-4000-8000-000000000002';

    protected function setUp(): void
    {
        parent::setUp();
        config(['session.driver' => 'array']);
    }

    public function test_preview_uses_approved_calendar_month_attendance_and_saves_reproducible_inputs(): void
    {
        DB::shouldReceive('transaction')->once()->andReturnUsing(static fn (callable $callback) => $callback());
        $this->expectAttendance();
        $saved = [];
        DB::shouldReceive('insert')->once()->andReturnUsing(static function (string $sql, array $bindings) use (&$saved): bool {
            self::assertStringContainsString('insert into roadops.payroll_snapshots', $sql);
            self::assertSame(self::DIVISION, $bindings[1]);
            self::assertSame('2026-09-01', $bindings[2]);
            $saved = json_decode($bindings[4], true, 512, JSON_THROW_ON_ERROR);

            return true;
        });
        $response = (new PayrollController(new PayrollCalculator))->preview($this->request([
            'workerId' => self::WORKER, 'deductionsConfirmed' => true,
            'incomeTaxAmountUzs' => '1000', 'unionFeeAmountUzs' => '0',
            'advanceAmountUzs' => '0', 'otherDeductionAmountUzs' => '0',
        ]));
        $data = $response->getData(true)['data'];

        self::assertSame(201, $response->getStatusCode());
        self::assertFalse($data['paymentInitiated']);
        self::assertSame('PREVIEW', $data['state']);
        self::assertSame(120, $data['rows'][0]['actualMinutes']);
        self::assertSame(1, $data['rows'][0]['actualDays']);
        self::assertSame('37500.00', $data['rows'][0]['baseWageAmountUzs']);
        self::assertSame('41250.00', $data['totals']['grossAmountUzs']);
        self::assertSame('40250.00', $data['totals']['payableAmountUzs']);
        self::assertSame('46200.00', $data['totals']['employerCostAmountUzs']);
        self::assertSame($data, $saved);
        self::assertSame('2026-09-06', $saved['rows'][0]['sources'][0]['workDate']);
        self::assertSame('TEST-RATE-2026', $saved['rows'][0]['sources'][0]['rateReference']);
        self::assertSame('payroll-source-allocation-v2', $saved['calculationVersion']);
        self::assertSame('46200.00', $saved['rows'][0]['sourceAllocations'][0]['employerCostAmountUzs']);
        self::assertSame('37500.00', $saved['rows'][0]['sourceAllocations'][0]['components']['baseWageAmountUzs']);
        self::assertSame($saved['rows'][0]['sources'][0]['timeEntryId'], $saved['rows'][0]['sourceAllocations'][0]['timeEntryId']);
    }

    public function test_preview_rejects_unapproved_or_missing_tariff_before_saving(): void
    {
        DB::shouldReceive('transaction')->once()->andReturnUsing(static fn (callable $callback) => $callback());
        $this->expectAttendance(false);
        DB::shouldReceive('insert')->never();
        $this->expectException(ValidationException::class);

        (new PayrollController(new PayrollCalculator))->preview($this->request());
    }

    public function test_actual_minutes_cannot_be_supplied_as_a_payroll_adjustment(): void
    {
        DB::shouldReceive('transaction')->never();
        $this->expectException(ValidationException::class);

        (new PayrollController(new PayrollCalculator))->preview($this->request([
            'workerId' => self::WORKER, 'actualMinutes' => 9999,
        ]));
    }

    public function test_other_division_is_rejected_before_reading_attendance(): void
    {
        $request = $this->request();
        $request->merge(['divisionId' => '91000000-0000-4000-8000-000000000099']);
        DB::shouldReceive('transaction')->never();
        $this->expectException(HttpException::class);

        (new PayrollController(new PayrollCalculator))->preview($request);
    }

    private function expectAttendance(bool $hasRate = true): void
    {
        DB::shouldReceive('select')->once()
            ->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, 'l.payroll_source_allocation')),
                [self::DIVISION, '2026-09-01', '2026-10-01'], false, [])->andReturn([]);
        DB::shouldReceive('select')->once()
            ->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, "wo.status='verified'")
                && str_contains($sql, "rate.status='approved'")
                && str_contains($sql, 'rate.effective_period @> te.work_date')
                && str_contains($sql, 'te.approved_at is not null')
                && str_contains($sql, 'te.work_date>=?::date and te.work_date<?::date')),
                ['2026-09-01', self::DIVISION, '2026-09-01', '2026-10-01'], false, [])
            ->andReturn([(object) [
                'time_entry_id' => '91000000-0000-4000-8000-000000000003',
                'worker_id' => self::WORKER, 'work_date' => '2026-09-06', 'actual_minutes' => 120,
                'work_order_id' => '91000000-0000-4000-8000-000000000004',
                'full_name' => 'Test xodim', 'personnel_number' => 'TEST-1',
                'rate_id' => $hasRate ? '91000000-0000-4000-8000-000000000005' : null,
                'rate_amount_uzs' => '3000000', 'bonus_rate_bps' => 1000,
                'traffic_allowance_rate_bps' => 0, 'travel_allowance_rate_bps' => 0,
                'social_contribution_rate_bps' => 1200, 'rate_reference' => 'TEST-RATE-2026',
                'norm_id' => '91000000-0000-4000-8000-000000000006', 'norm_minutes' => 9600,
                'norm_reference' => 'TEST-NORM-2026',
            ]]);
    }

    /** @param array<string, mixed>|null $adjustment */
    private function request(?array $adjustment = null): Request
    {
        $request = Request::create('/api/v1/payroll/preview', 'POST', [
            'divisionId' => self::DIVISION, 'period' => '2026-09',
            'policyReference' => 'Test hisob siyosati; amaldagi soliq stavkasi emas',
            'adjustments' => $adjustment === null ? [] : [$adjustment],
        ]);
        $request->attributes->set(AuthContext::class, new AuthContext(
            '91000000-0000-4000-8000-000000000010',
            '91000000-0000-4000-8000-000000000011',
            'test@example.test', 'Test user', '', ['costs.read', 'costs.manage'], [], [self::DIVISION],
        ));

        return $request;
    }
}
