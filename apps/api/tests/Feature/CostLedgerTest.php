<?php

namespace Tests\Feature;

use App\Domain\Transparency\MonthlyCostLedgerReader;
use App\Http\Controllers\Api\V1\CostLedgerController;
use App\Security\AuthContext;
use App\Support\ApiScope;
use App\Support\Pagination;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route as RouteFacade;
use Mockery;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class CostLedgerTest extends TestCase
{
    private const DIVISION = '11111111-1111-4111-8111-111111111111';

    protected function setUp(): void
    {
        parent::setUp();
        config(['session.driver' => 'array']);
    }

    public function test_ledger_endpoints_require_financial_permission_and_machine_execution_scope(): void
    {
        foreach (['cost-ledger', 'machine-usage'] as $path) {
            $route = collect(RouteFacade::getRoutes()->getRoutes())->first(
                static fn (Route $route): bool => $route->uri() === 'api/v1/'.$path,
            );
            self::assertInstanceOf(Route::class, $route);
            self::assertContains('GET', $route->methods());
            self::assertContains('roadops.auth', $route->gatherMiddleware());
            self::assertContains('roadops.permission:costs.read', $route->gatherMiddleware());
            if ($path === 'machine-usage') {
                self::assertContains('roadops.permission:execution.read', $route->gatherMiddleware());
            }
        }
    }

    public function test_cost_report_keeps_exact_money_and_scoped_all_page_totals(): void
    {
        $source = [
            'total' => 101,
            'summary' => ['approvedAmountUzs' => '9007199254740993.27', 'draftAmountUzs' => '125.20'],
            'rows' => [['id' => 'line-101', 'amountUzs' => '0.03', 'payrollAllocation' => null]],
        ];
        DB::shouldReceive('selectOne')->once()->with(
            Mockery::on(static fn (string $sql): bool => str_contains($sql, 'a.division_id=any(p.divisions)')
                && str_contains($sql, 'a.act_month=p.month_start')
                && str_contains($sql, "where act_status='approved'")
                && str_contains($sql, 'from filtered')
                && str_contains($sql, 'f.amount_uzs::text')
                && str_contains($sql, 'f.payroll_source_allocation')),
            ['{'.self::DIVISION.'}', '2026-09-01', null, null, null, 100, 100],
            false,
        )->andReturn((object) ['payload' => json_encode($source, JSON_THROW_ON_ERROR)]);

        $result = (new MonthlyCostLedgerReader)->costs(
            [self::DIVISION], '2026-09', null, null, null,
            Pagination::from(Request::create('/', 'GET', ['page' => 2, 'pageSize' => 100])),
        );

        self::assertSame($source['summary'], $result['summary']);
        self::assertSame($source['rows'], $result['rows']);
        self::assertSame(['page' => 2, 'pageSize' => 100, 'total' => 101], $result['pagination']);
        self::assertSame('ACT_SNAPSHOT', $result['basis']);
        self::assertSame('NOT_CONNECTED', $result['paymentTracking']);
        self::assertSame('UZS', $result['currency']);
    }

    public function test_machine_usage_keeps_unrecorded_null_and_separate_verified_minutes(): void
    {
        $source = [
            'total' => 2,
            'summary' => ['reservedMinutes' => 480, 'recordedMinutes' => 45,
                'verifiedMinutes' => 0, 'approvedAmountUzs' => '0.00', 'unpricedVerifiedCount' => 0],
            'assets' => [],
            'rows' => [['usageState' => 'NOT_RECORDED', 'actualMinutes' => null, 'approvedAmountUzs' => null]],
        ];
        DB::shouldReceive('selectOne')->once()->with(
            Mockery::on(static fn (string $sql): bool => str_contains($sql, 'run.division_id=any(p.divisions)')
                && str_contains($sql, 'p.equipment_id is null or er.equipment_unit_id=p.equipment_id')
                && str_contains($sql, "u.status='approved' and wo.status='verified'")
                && str_contains($sql, "when a.status='approved' then l.amount_uzs else null")
                && str_contains($sql, "p.month_start::timestamp at time zone 'Asia/Tashkent'")),
            ['{'.self::DIVISION.'}', '2026-09-01', null, null, 25, 0],
            false,
        )->andReturn((object) ['payload' => json_encode($source, JSON_THROW_ON_ERROR)]);

        $result = (new MonthlyCostLedgerReader)->machines(
            [self::DIVISION], '2026-09', null, null, Pagination::from(Request::create('/')),
        );

        self::assertSame($source['summary'], $result['summary']);
        self::assertNull($result['rows'][0]['actualMinutes']);
        self::assertNull($result['rows'][0]['approvedAmountUzs']);
        self::assertSame('RECORDED_USAGE', $result['basis']);
    }

    public function test_other_division_is_rejected_before_any_ledger_query(): void
    {
        $request = Request::create('/', 'GET', [
            'month' => '2026-09', 'roadUnitId' => '22222222-2222-4222-8222-222222222222',
        ]);
        $request->attributes->set(AuthContext::class, new AuthContext(
            'session', 'actor', 'user@example.uz', 'Operator', '', ['costs.read'], [], [self::DIVISION],
        ));
        DB::shouldReceive('selectOne')->never();

        try {
            (new CostLedgerController(new MonthlyCostLedgerReader))->costs($request, new ApiScope);
            self::fail('Cross-division ledger was accepted.');
        } catch (HttpException $exception) {
            self::assertSame(403, $exception->getStatusCode());
        }
    }
}
