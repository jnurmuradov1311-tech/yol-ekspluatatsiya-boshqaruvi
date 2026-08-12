<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\V1\AnnualProgramController;
use App\Http\Controllers\Api\V1\DashboardController;
use App\Http\Controllers\Api\V1\ManualInspectionController;
use App\Http\Controllers\Api\V1\MapController;
use App\Http\Controllers\Api\V1\PlanningController;
use App\Http\Controllers\Api\V1\ReportController;
use App\Http\Controllers\Api\V1\RoadController;
use App\Http\Controllers\Api\V1\RoadVisionFindingController;
use App\Http\Controllers\Api\V1\WorkOrderController;
use App\Http\Middleware\AuthenticateRoadOpsSession;
use App\Http\Middleware\EnsurePrimaryRoadInvariant;
use ReflectionClass;
use Tests\TestCase;

final class D001RoadInvariantTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config()->set('session.driver', 'array');
    }

    public function test_operational_entry_points_fail_closed_to_d001_and_67000_metres(): void
    {
        foreach ([
            PlanningController::class,
            ManualInspectionController::class,
            MapController::class,
            RoadController::class,
        ] as $controller) {
            $source = $this->source($controller);

            self::assertStringContainsString("PRIMARY_ROAD_CODE = 'D001'", $source, $controller);
            self::assertStringContainsString('PRIMARY_ROAD_LENGTH_M = 67_000', $source, $controller);
            self::assertStringContainsString('D001_CONFIGURATION_MISMATCH', $source, $controller);
        }

        $roadVision = $this->source(RoadVisionFindingController::class);
        self::assertStringContainsString("PRIMARY_ROAD_CODE = 'D001'", $roadVision);
        self::assertStringContainsString("preg_match('/^67000(?:\\.0+)?$/D'", $roadVision);
        self::assertStringContainsString('D001_CONFIGURATION_MISMATCH', $roadVision);
    }

    public function test_manual_capture_requires_exact_identity_length_chainage_and_assignment(): void
    {
        $source = $this->source(ManualInspectionController::class);

        self::assertStringContainsString('count($roads) !== 1', $source);
        self::assertStringContainsString('$end > self::PRIMARY_ROAD_LENGTH_M', $source);
        self::assertStringContainsString("(string) \$road->id !== (string) \$validated['roadId']", $source);
        self::assertStringContainsString('ROAD_ASSIGNMENT_MISSING_OR_AMBIGUOUS', $source);
        self::assertStringContainsString('ROAD_ZONE_NOT_ACCESSIBLE', $source);
    }

    public function test_map_returns_the_full_d001_line_and_fixed_length(): void
    {
        $source = $this->source(MapController::class);

        self::assertStringContainsString("'type' => 'LineString'", $source);
        self::assertStringContainsString("'lengthM' => self::PRIMARY_ROAD_LENGTH_M", $source);
        self::assertStringContainsString('$this->chainageMarkers($coordinates, self::PRIMARY_ROAD_LENGTH_M)', $source);
        self::assertStringContainsString('D001_GEOMETRY_UNAVAILABLE', $source);
    }

    public function test_planning_and_all_operational_read_models_are_d001_scoped(): void
    {
        $planning = $this->source(PlanningController::class);
        self::assertStringContainsString("rv.official_code = 'D001' and rv.length_m = 67000", $planning);
        self::assertStringContainsString('d001RunExists', $planning);
        self::assertStringContainsString('CHAINAGE_OUTSIDE_D001', $planning);

        foreach ([
            AnnualProgramController::class,
            DashboardController::class,
            ReportController::class,
            WorkOrderController::class,
        ] as $controller) {
            $source = $this->source($controller);
            self::assertStringContainsString('D001', $source, $controller);
            self::assertStringContainsString('67000', $source, $controller);
        }
    }

    public function test_confirmed_defect_register_and_contract_keep_the_d001_boundary(): void
    {
        $controller = $this->source(RoadVisionFindingController::class);
        $routes = (string) file_get_contents(base_path('routes/api.php'));
        $contract = (string) file_get_contents(base_path('../../packages/contracts/openapi.yaml'));

        self::assertStringContainsString('public function confirmedDefects', $controller);
        self::assertStringContainsString("road.official_code='D001' and road.length_m=67000", $controller);
        self::assertStringContainsString(
            "Route::get('/defects', [RoadVisionFindingController::class, 'confirmedDefects'])",
            $routes,
        );
        self::assertStringContainsString('code: { type: string, const: D001 }', $contract);
        self::assertStringContainsString('lengthM: { type: integer, const: 67000 }', $contract);
    }

    public function test_exact_decimal_length_and_global_source_invariant_are_not_truncated(): void
    {
        $middleware = $this->source(EnsurePrimaryRoadInvariant::class);
        $config = (string) file_get_contents(config_path('roadops.php'));

        self::assertStringContainsString('roadops.primary_road_invariant()', $middleware);
        $migration = (string) file_get_contents(
            database_path('migrations/20260812001400_primary_road_invariant.sql'),
        );
        self::assertStringContainsString('security definer', $migration);
        self::assertStringContainsString('count(distinct road.id) candidate_count', $migration);
        self::assertStringContainsString('version.length_m = 67000::numeric', $migration);
        self::assertStringContainsString('grant execute on function roadops.primary_road_invariant() to roadops_api', $migration);
        self::assertStringNotContainsString("(int) env('PRIMARY_ROAD_LENGTH_M'", $config);

        foreach ([
            PlanningController::class,
            ManualInspectionController::class,
            MapController::class,
            RoadController::class,
        ] as $controller) {
            $source = $this->source($controller);
            self::assertStringContainsString("preg_match('/^67000(?:\\.0+)?$/D'", $source, $controller);
        }
    }

    public function test_plan_road_guard_uses_a_serializable_source_lock_and_rejects_missing_versions(): void
    {
        $source = $this->source(PlanningController::class);
        $auth = $this->source(AuthenticateRoadOpsSession::class);
        $migration = (string) file_get_contents(
            database_path('migrations/20260812001400_primary_road_invariant.sql'),
        );

        self::assertStringContainsString('if (! $this->d001RunExists($id))', $source);
        self::assertStringContainsString('left join roadops.road_versions road', $source);
        self::assertStringContainsString("road.id is null or road.official_code<>'D001'", $source);
        self::assertStringContainsString('set transaction isolation level serializable', $auth);
        self::assertStringContainsString('roadops.lock_primary_road_invariant()', $auth);
        self::assertLessThan(
            strpos($auth, "select set_config('roadops.actor_id'"),
            strpos($auth, 'roadops.lock_primary_road_invariant()'),
        );
        self::assertStringContainsString('lock table roadops.road_versions in share mode', $migration);
    }

    /** @param class-string $class */
    private function source(string $class): string
    {
        $path = (new ReflectionClass($class))->getFileName();
        self::assertIsString($path);

        return (string) file_get_contents($path);
    }
}
