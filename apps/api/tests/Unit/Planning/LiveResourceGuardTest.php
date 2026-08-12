<?php

namespace Tests\Unit\Planning;

use App\Domain\Planning\LiveResourceGuard;
use PHPUnit\Framework\TestCase;

final class LiveResourceGuardTest extends TestCase
{
    public function test_it_accepts_a_live_query_with_no_invalid_items(): void
    {
        (new LiveResourceGuard)->assertCurrent(0);

        self::addToAssertionCount(1);
    }

    public function test_it_fails_closed_when_the_live_query_finds_an_invalid_item(): void
    {
        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('PLAN_INPUT_SNAPSHOT_STALE');

        (new LiveResourceGuard)->assertCurrent(1);
    }

    public function test_publish_guard_query_covers_every_live_resource_and_uses_the_service(): void
    {
        $source = file_get_contents(__DIR__.'/../../../app/Http/Controllers/Api/V1/PlanningController.php');

        self::assertIsString($source);
        foreach ([
            '$this->liveResourceGuard->assertCurrent($invalidCount);',
            "pi.status = 'approved'",
            'daily.assigned_minutes > least(420, coalesce(availability.available_minutes, 0))',
            'overlap.scheduled_window && selected_assignment.scheduled_window',
            "lower(requirement.unit) not in ('machine_minute', 'machine_hour')",
            'reservation.allocated_quantity > case lower(requirement.unit)',
            'unavailable.unavailable_window && reservation.reserved_window',
            'overlap.reserved_window && reservation.reserved_window',
            "skill.requirement_kind = 'equipment_operator'",
            "active_reservation.status = 'reserved'",
            'qualification.qualification_code = requirement.qualification_code',
            'active_reservation.reserved_window && selected_reservation.reserved_window',
            "scheme.scheme_kind = 'full_closure_permit'",
        ] as $contractFragment) {
            self::assertStringContainsString($contractFragment, $source);
        }
    }
}
