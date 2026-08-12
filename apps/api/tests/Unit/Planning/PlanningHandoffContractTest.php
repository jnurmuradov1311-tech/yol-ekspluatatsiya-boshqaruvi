<?php

namespace Tests\Unit\Planning;

use PHPUnit\Framework\TestCase;

final class PlanningHandoffContractTest extends TestCase
{
    public function test_forward_migration_selects_norms_at_each_scheduled_work_date(): void
    {
        $migration = $this->read('database/migrations/20260812001300_planning_handoff_and_work_date_norms.sql');

        self::assertStringContainsString("lower(item.scheduled_window) at time zone 'Asia/Tashkent'", $migration);
        self::assertStringContainsString('m.effective_from <= coalesce(', $migration);
        self::assertStringContainsString('ns.effective_from <= coalesce(', $migration);
        self::assertStringContainsString("roadops.has_permission('planning.approve', run_row.division_id)", $migration);
    }

    public function test_plan_detail_and_snapshot_validation_preserve_maker_checker_handoff(): void
    {
        $routes = $this->read('routes/api.php');
        $controller = $this->read('app/Http/Controllers/Api/V1/PlanningController.php');

        self::assertStringContainsString("Route::get('/planning/plans/{id}', [PlanningController::class, 'show'])", $routes);
        self::assertStringContainsString('public function show(Request $request, ApiScope $scope, string $id)', $controller);
        self::assertStringContainsString('(string) $run->created_by !== $context->userId', $controller);
        self::assertStringContainsString("lower(pi.scheduled_window) at time zone 'Asia/Tashkent'", $controller);
        self::assertStringContainsString('line.norm_set_id is distinct from', $controller);
    }

    private function read(string $relativePath): string
    {
        $contents = file_get_contents(dirname(__DIR__, 3).'/'.$relativePath);
        self::assertIsString($contents);

        return $contents;
    }
}
