<?php

namespace Tests\Unit\Planning;

use PHPUnit\Framework\TestCase;

final class PlanningControllerContractTest extends TestCase
{
    public function test_every_allocator_preserves_the_explicit_candidate_selection_order(): void
    {
        $source = file_get_contents(__DIR__.'/../../../app/Http/Controllers/Api/V1/PlanningController.php');

        self::assertIsString($source);
        self::assertGreaterThanOrEqual(
            3,
            substr_count($source, "pi.formula_inputs ->> 'selectionOrder'"),
            'Labor, equipment, and material allocation must use the explicit input order.',
        );
        self::assertStringContainsString(
            "order by (formula_inputs ->> 'selectionOrder')::integer, id",
            $source,
            'Safety allocation must use the explicit input order rather than UUID order.',
        );
    }

    public function test_blockers_are_rebuilt_in_the_authoritative_chain(): void
    {
        $source = file_get_contents(__DIR__.'/../../../app/Http/Controllers/Api/V1/PlanningController.php');

        self::assertIsString($source);
        $base = strpos($source, 'rebuild_plan_blockers(?)');
        $safety = strpos($source, 'rebuild_plan_safety_blockers(?)');
        $operator = strpos($source, 'add_equipment_operator_blockers(?)');

        self::assertIsInt($base);
        self::assertIsInt($safety);
        self::assertIsInt($operator);
        self::assertStringNotContainsString('rebuild_plan_assignment_blockers(?)', $source);
        self::assertLessThan($safety, $base);
        self::assertLessThan($operator, $safety);
    }
}
