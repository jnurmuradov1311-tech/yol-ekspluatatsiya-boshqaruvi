<?php

namespace Tests\Unit\Planning;

use App\Domain\Planning\DeterministicEquipmentAllocator;
use PHPUnit\Framework\TestCase;

final class DeterministicEquipmentAllocatorTest extends TestCase
{
    public function test_machine_hours_are_split_without_exceeding_420_minutes_per_asset(): void
    {
        $allocations = (new DeterministicEquipmentAllocator)->allocate(
            'machine_hour',
            '10',
            [
                ['id' => 'EQ-001', 'availableMinutes' => 420],
                ['id' => 'EQ-002', 'availableMinutes' => 420],
            ],
        );

        self::assertSame([
            ['equipmentUnitId' => 'EQ-001', 'allocatedQuantity' => '7.000000'],
            ['equipmentUnitId' => 'EQ-002', 'allocatedQuantity' => '3.000000'],
        ], $allocations);
    }

    public function test_insufficient_capacity_is_a_truthful_partial_allocation(): void
    {
        $allocations = (new DeterministicEquipmentAllocator)->allocate(
            'machine_hour',
            '8',
            [['id' => 'EQ-001', 'availableMinutes' => 300]],
        );

        self::assertSame([
            ['equipmentUnitId' => 'EQ-001', 'allocatedQuantity' => '5.000000'],
        ], $allocations);
    }

    public function test_unknown_equipment_unit_is_not_inferred(): void
    {
        self::assertSame([], (new DeterministicEquipmentAllocator)->allocate(
            'trip',
            '3',
            [['id' => 'EQ-001', 'availableMinutes' => 420]],
        ));
    }

    public function test_fractional_machine_time_is_not_rounded_up(): void
    {
        self::assertSame([
            ['equipmentUnitId' => 'EQ-001', 'allocatedQuantity' => '0.001000'],
        ], (new DeterministicEquipmentAllocator)->allocate(
            'machine_hour',
            '0.001000',
            [['id' => 'EQ-001', 'availableMinutes' => 420]],
        ));
    }
}
