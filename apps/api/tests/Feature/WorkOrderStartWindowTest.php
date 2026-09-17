<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\V1\WorkOrderExecutionController;
use App\Security\AuthContext;
use App\Support\ApiScope;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\TestCase;

final class WorkOrderStartWindowTest extends TestCase
{
    private const ORDER = '84000000-0000-4000-8000-000000000001';

    private const DIVISION = '84000000-0000-4000-8000-000000000002';

    private const ACTOR = '84000000-0000-4000-8000-000000000003';

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('session.driver', 'array');
    }

    public function test_database_rejection_outside_the_window_does_not_start_or_emit_events(): void
    {
        DB::shouldReceive('transaction')->once()->andReturnUsing(static fn (callable $callback) => $callback());
        DB::shouldReceive('selectOne')->once()
            ->with(Mockery::type('string'), [self::ORDER, '{'.self::DIVISION.'}'], false)
            ->andReturn((object) ['id' => self::ORDER, 'status' => 'issued']);
        DB::shouldReceive('update')->once()->with(Mockery::type('string'), [self::ORDER])->andReturn(0);
        DB::shouldReceive('select')->never();
        DB::shouldReceive('insert')->never();

        $response = (new WorkOrderExecutionController)->start($this->request(), new ApiScope, self::ORDER);

        self::assertSame(422, $response->getStatusCode());
        self::assertSame('WORK_ORDER_OUTSIDE_SCHEDULE', $response->getData(true)['error']['code']);
    }

    public function test_database_accepted_start_returns_the_started_state_and_one_audit_event(): void
    {
        $order = (object) [
            'id' => self::ORDER,
            'plan_item_id' => '84000000-0000-4000-8000-000000000004',
            'status' => 'issued',
            'order_number' => 'WO-START-TEST',
            'work_name' => 'Qoplamani ta’mirlash',
            'road_code' => 'D001',
            'road_name' => 'Sinov yo‘li',
            'chainage_from' => 1000,
            'chainage_to' => 1001,
            'scheduled_date' => '2026-09-06',
            'scheduled_start_at' => '2026-09-06 09:00:00+00',
            'scheduled_end_at' => '2026-09-06 10:00:00+00',
            'team_name' => 'Sinov brigadasi',
            'work_quantity' => '10.000000',
            'work_unit' => 'm2',
            'norm_reference' => 'IQN 02-24',
            'started_at' => null,
            'started_by_name' => null,
            'completion_id' => null,
        ];
        DB::shouldReceive('transaction')->once()->andReturnUsing(static fn (callable $callback) => $callback());
        DB::shouldReceive('selectOne')->twice()
            ->with(Mockery::type('string'), [self::ORDER, '{'.self::DIVISION.'}'], false)
            ->andReturn(clone $order, $order);
        DB::shouldReceive('update')->once()->with(Mockery::type('string'), [self::ORDER])
            ->andReturnUsing(static function () use ($order): int {
                $order->status = 'in_progress';
                $order->started_at = '2026-09-06 09:00:00+00';
                $order->started_by_name = 'Sinov ustasi';

                return 1;
            });
        DB::shouldReceive('select')->andReturnUsing(static function (string $sql): array {
            return str_contains($sql, 'execution_completion_revisions') ? [(object) [
                'revision' => 1, 'reason' => 'Sarfni tekshiring', 'returned_at' => '2026-09-06 10:00:00+05',
                'returned_by_name' => 'Bo‘lim boshlig‘i', 'snapshot' => '{}',
            ]] : [];
        });
        DB::shouldReceive('insert')->once()
            ->with(Mockery::type('string'), [self::ORDER, 'issued', 'in_progress', 'WORK_STARTED', self::ACTOR, '[]'])
            ->andReturn(true);

        $response = (new WorkOrderExecutionController)->start($this->request(), new ApiScope, self::ORDER);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('IN_PROGRESS', $response->getData(true)['data']['state']);
        self::assertSame('2026-09-06T10:00:00+05:00', $response->getData(true)['data']['correctionHistory'][0]['returnedAt']);
        self::assertSame('2026-09-06 09:00:00+00', $response->getData(true)['data']['startedAt']);
        self::assertSame('2026-09-06T09:00:00+00:00', $response->getData(true)['data']['scheduledStartAt']);
        self::assertSame('2026-09-06T10:00:00+00:00', $response->getData(true)['data']['scheduledEndAt']);
    }

    private function request(): Request
    {
        $request = Request::create('/api/v1/work-orders/'.self::ORDER.'/start', 'POST');
        $request->attributes->set(AuthContext::class, new AuthContext(
            '84000000-0000-4000-8000-000000000005', self::ACTOR,
            'start-test@example.uz', 'Sinov ustasi', '', ['execution.manage'], [], [self::DIVISION],
        ));

        return $request;
    }
}
