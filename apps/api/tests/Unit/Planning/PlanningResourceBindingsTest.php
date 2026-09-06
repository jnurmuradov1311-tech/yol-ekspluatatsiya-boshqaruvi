<?php

namespace Tests\Unit\Planning;

use App\Http\Controllers\Api\V1\PlanningController;
use Illuminate\Support\Facades\DB;
use ReflectionMethod;
use Tests\TestCase;

final class PlanningResourceBindingsTest extends TestCase
{
    public function test_material_reservation_binds_only_its_seven_resource_parameters(): void
    {
        DB::shouldReceive('select')->once()->andReturn([(object) [
            'plan_item_id' => '10000000-0000-0000-0000-000000000001',
            'requirement_id' => '10000000-0000-0000-0000-000000000002',
            'resource_id' => '10000000-0000-0000-0000-000000000003',
            'unit' => 'kg', 'required_quantity' => '12.000000',
        ]]);
        DB::shouldReceive('insert')->once()->withArgs(function (string $query, array $bindings): bool {
            self::assertSame(substr_count($query, '?'), count($bindings));
            self::assertCount(7, $bindings);
            self::assertSame('12.000000', $bindings[5]);

            return true;
        })->andReturn(true);
        $method = new ReflectionMethod(PlanningController::class, 'allocateMaterials');
        $method->invoke($this->app->make(PlanningController::class), 'run', 'division', 'actor');
    }

    public function test_equipment_availability_binds_real_shift_twice_without_losing_scope(): void
    {
        $window = '["2026-09-06 09:00+05","2026-09-06 11:00+05")';
        DB::shouldReceive('select')->andReturnUsing(function (string $query, array $bindings) use ($window): array {
            self::assertSame(substr_count($query, '?'), count($bindings));
            if (str_contains($query, 'select pi.id plan_item_id')) {
                return [(object) [
                    'plan_item_id' => 'item', 'requirement_id' => 'requirement', 'resource_id' => 'resource',
                    'unit' => 'machine_hour', 'required_quantity' => '3.000000',
                    'scheduled_window' => $window, 'work_date' => '2026-09-06',
                ]];
            }
            if (str_contains($query, 'from roadops.equipment_units e')) {
                self::assertSame([$window, $window, 'division', 'resource'], array_slice($bindings, 0, 4));

                return [(object) ['id' => 'equipment', 'available_minutes' => 120]];
            }
            if (str_contains($query, 'put_allocator_blocker')) {
                self::assertSame('EQUIPMENT_CAPACITY_INSUFFICIENT', $bindings[2]);
                self::assertStringContainsString('2.000000', $bindings[5]);
            }

            return [];
        });
        DB::shouldReceive('insert')->once()->withArgs(function (string $query, array $bindings) use ($window): bool {
            self::assertSame(substr_count($query, '?'), count($bindings));
            self::assertSame($window, $bindings[3]);
            self::assertSame('2.000000', $bindings[4]);

            return true;
        })->andReturn(true);
        $method = new ReflectionMethod(PlanningController::class, 'allocateEquipment');
        $method->invoke($this->app->make(PlanningController::class), 'run', 'division', 'actor');
    }
}
