<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\V1\AdminOrganizationHierarchyController;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Mockery;
use RuntimeException;
use Tests\TestCase;

final class AdminOrganizationHierarchyTest extends TestCase
{
    public function test_route_is_global_admin_only(): void
    {
        $route = collect(Route::getRoutes()->getRoutes())
            ->first(static fn ($candidate): bool => $candidate->uri() === 'api/v1/admin/organization-hierarchy');

        self::assertNotNull($route);
        $middleware = $route->gatherMiddleware();
        self::assertContains('roadops.auth', $middleware);
        self::assertContains('roadops.global-permission:system.all', $middleware);
        self::assertNotContains('roadops.permission:system.all', $middleware);
    }

    public function test_controller_returns_authoritative_tree_and_republic_baseline(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->with(
                Mockery::on(static fn (string $sql): bool => str_contains(
                    $sql,
                    'roadops.admin_organization_hierarchy()',
                )),
                [],
                true,
            )
            ->andReturn((object) [
                'official_network_length_km' => '42371',
                'synchronized_republic_count' => '1',
                'synchronized_region_count' => '1',
                'synchronized_enterprise_count' => '1',
                'synchronized_division_count' => '1',
                'unlinked_node_count' => '0',
                'hierarchy_complete' => 't',
                'hierarchy_tree' => json_encode([[
                    'id' => '10000000-0000-0000-0000-000000000001',
                    'level' => 'REPUBLIC',
                    'name' => "O'zbekiston Respublikasi",
                    'officialNetworkLengthKm' => 42371,
                    'children' => [],
                ]], JSON_THROW_ON_ERROR),
                'unlinked_nodes' => '[]',
                'as_of' => '2026-08-18 10:30:00+05',
            ]);

        $response = (new AdminOrganizationHierarchyController)();
        $data = $response->getData(true)['data'];

        self::assertSame(42371, $data['officialNetworkLengthKm']);
        self::assertTrue($data['summary']['hierarchyComplete']);
        self::assertSame(1, $data['summary']['synchronizedDivisionCount']);
        self::assertSame('REPUBLIC', $data['tree'][0]['level']);
        self::assertSame([], $data['unlinkedNodes']);
    }

    public function test_scoped_system_all_database_guard_is_a_forbidden_response(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andThrow(new QueryException(
                'pgsql',
                'select * from roadops.admin_organization_hierarchy()',
                [],
                new RuntimeException('Global administrator required', 42501),
            ));

        $response = (new AdminOrganizationHierarchyController)();

        self::assertSame(403, $response->getStatusCode());
        self::assertSame('PERMISSION_DENIED', $response->getData(true)['error']['code']);
    }
}
