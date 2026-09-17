<?php

namespace Tests\Feature;

use App\Domain\Resources\MonthlyTimesheetReader;
use App\Http\Controllers\Api\V1\WorkOrderController;
use App\Http\Controllers\Api\V1\WorkOrderExecutionController;
use App\Security\AuthContext;
use App\Support\ApiScope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Mockery;
use Tests\TestCase;

final class ExecutionActualIntegrityTest extends TestCase
{
    private const DIVISION = '84000000-0000-4000-8000-000000000002';

    private const WORKER = '84000000-0000-4000-8000-000000000006';

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('session.driver', 'array');
    }

    public function test_zero_attendance_requires_a_reason_before_any_database_write(): void
    {
        DB::shouldReceive('transaction')->never();
        $request = $this->request('/api/v1/work-orders/order/complete', 'POST', $this->completion([
            ['workerId' => self::WORKER, 'workDate' => '2026-09-16', 'actualMinutes' => 0],
            ['workerId' => '84000000-0000-4000-8000-000000000007', 'workDate' => '2026-09-16', 'actualMinutes' => 30],
        ]));
        try {
            (new WorkOrderExecutionController)->complete($request, new ApiScope, 'order');
            self::fail('Missing non-attendance reason was accepted');
        } catch (ValidationException $exception) {
            self::assertArrayHasKey('unusedResources.reason', $exception->errors());
        }
    }

    public function test_positive_completion_cannot_have_only_zero_labor(): void
    {
        DB::shouldReceive('transaction')->never();
        $payload = $this->completion([
            ['workerId' => self::WORKER, 'workDate' => '2026-09-16', 'actualMinutes' => 0],
        ]);
        $payload['unusedResources'] = ['reason' => 'Ishga chiqmadi'];
        try {
            (new WorkOrderExecutionController)->complete(
                $this->request('/api/v1/work-orders/order/complete', 'POST', $payload), new ApiScope, 'order',
            );
            self::fail('Work completion with no working staff was accepted');
        } catch (ValidationException $exception) {
            self::assertArrayHasKey('laborEntries', $exception->errors());
        }
    }

    public function test_verified_filter_queries_verified_orders_only(): void
    {
        $bindings = ['{'.self::DIVISION.'}', 0, '{verified}'];
        DB::shouldReceive('scalar')->once()->with(Mockery::type('string'), $bindings)->andReturn(0);
        DB::shouldReceive('select')->once()->with(Mockery::type('string'), [...$bindings, 25, 0], true, [])->andReturn([]);
        $response = (new WorkOrderController)->index(
            $this->request('/api/v1/work-orders?state=VERIFIED', 'GET'), new ApiScope,
        );
        self::assertSame(200, $response->getStatusCode());
    }

    public function test_timesheet_uses_verified_approved_sources_and_does_not_hide_source_minutes(): void
    {
        DB::shouldReceive('select')->once()->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, 'road_division_versions')), Mockery::any(), true, [])->andReturn([(object) ['name' => 'Test']]);
        DB::shouldReceive('select')->once()->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, 'select distinct on (w.id)')), Mockery::any(), true, [])->andReturn([(object) [
            'id' => self::WORKER, 'full_name' => 'Test Worker', 'personnel_number' => 'T1', 'position_name' => 'Ishchi',
        ]]);
        DB::shouldReceive('select')->once()->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, 'generate_series')), Mockery::any(), true, [])->andReturn([]);
        DB::shouldReceive('select')->once()->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, "wo.status = 'verified'") && str_contains($sql, 'te.approved_at is not null')
            && ! str_contains($sql, 'least(')), Mockery::any(), true, [])->andReturn([(object) [
                'worker_id' => self::WORKER, 'work_date' => '2026-09-16', 'actual_minutes' => 421,
            ]]);
        DB::shouldReceive('select')->once()->with(Mockery::on(static fn (string $sql): bool => str_contains($sql, 'from roadops.worker_availability')), Mockery::any(), true, [])->andReturn([]);

        $result = (new MonthlyTimesheetReader)->read([self::DIVISION], 2026, 9);

        // Legacy inconsistencies must remain visible rather than silently altered;
        // new entries cannot exceed 420 due to the database's serialized guard.
        self::assertSame(421, $result['rows'][0]['totalMinutes']);
        self::assertSame('WORK', $result['rows'][0]['entries'][15]['state']);
    }

    /** @param list<array{workerId:string,workDate:string,actualMinutes:int}> $labor */
    private function completion(array $labor): array
    {
        return [
            'laborEntries' => $labor, 'materialUsages' => [], 'equipmentUsages' => [],
            'completedQuantity' => '1', 'unit' => 'm2', 'evidence' => [],
        ];
    }

    /** @param array<string, mixed> $payload */
    private function request(string $uri, string $method, array $payload = []): Request
    {
        $request = Request::create($uri, $method, $payload);
        $request->attributes->set(AuthContext::class, new AuthContext(
            '84000000-0000-4000-8000-000000000005', '84000000-0000-4000-8000-000000000003',
            'test@example.uz', 'Test', '', ['execution.manage'], [], [self::DIVISION],
        ));

        return $request;
    }
}
