<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\V1\AdminNetworkSummaryController;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Mockery;
use RuntimeException;
use Tests\TestCase;

final class AdminNetworkSummaryTest extends TestCase
{
    public function test_route_is_admin_only(): void
    {
        $route = collect(Route::getRoutes()->getRoutes())
            ->first(static fn ($candidate): bool => $candidate->uri() === 'api/v1/admin/network-summary');

        self::assertNotNull($route);
        $middleware = $route->gatherMiddleware();
        self::assertContains('roadops.auth', $middleware);
        self::assertContains('roadops.global-permission:system.all', $middleware);
        self::assertNotContains('roadops.permission:system.all', $middleware);
    }

    public function test_controller_returns_only_the_official_baseline_and_live_aggregates(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->with(
                Mockery::on(static fn (string $sql): bool => str_contains(
                    $sql,
                    'roadops.admin_network_summary()',
                )),
                [],
                true,
            )
            ->andReturn((object) [
                'official_network_length_km' => '42371',
                'synchronized_road_length_km' => '42118.375',
                'synchronized_road_count' => '1324',
                'synchronized_division_count' => '550',
                'as_of' => '2026-08-18 10:30:00+05',
            ]);

        $response = (new AdminNetworkSummaryController)();

        self::assertSame([
            'data' => [
                'asOf' => '2026-08-18T10:30:00+05:00',
                'officialNetworkLengthKm' => 42371,
                'synchronizedRoadLengthKm' => '42118.375',
                'synchronizedRoadCount' => 1324,
                'synchronizedDivisionCount' => 550,
            ],
        ], $response->getData(true));
    }

    public function test_scoped_system_all_database_guard_is_a_forbidden_response(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andThrow(new QueryException(
                'pgsql',
                'select * from roadops.admin_network_summary()',
                [],
                new RuntimeException('Global administrator required', 42501),
            ));

        $response = (new AdminNetworkSummaryController)();

        self::assertSame(403, $response->getStatusCode());
        self::assertSame('PERMISSION_DENIED', $response->getData(true)['error']['code']);
    }
}
