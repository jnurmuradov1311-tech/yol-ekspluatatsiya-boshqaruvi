<?php

namespace Tests\Unit\Planning;

use App\Domain\Planning\RoadAccessDetails;
use PHPUnit\Framework\TestCase;

final class RoadAccessDetailsTest extends TestCase
{
    public function test_open_road_needs_no_closure_details(): void
    {
        self::assertSame([], RoadAccessDetails::errors('OPEN', '', '', ''));
    }

    public function test_partial_closure_requires_direction_and_exact_lane(): void
    {
        self::assertArrayHasKey('direction', RoadAccessDetails::errors('PARTIAL', ' ', '1-tasma', ''));
        self::assertArrayHasKey('laneLabel', RoadAccessDetails::errors('PARTIAL', 'FORWARD', ' ', ''));
        self::assertSame([], RoadAccessDetails::errors('PARTIAL', 'REVERSE', '2-tasma', ''));
    }

    public function test_full_closure_requires_direction_and_permit(): void
    {
        self::assertArrayHasKey('permitNumber', RoadAccessDetails::errors('CLOSED', 'BOTH', '', ''));
        self::assertSame([], RoadAccessDetails::errors('CLOSED', 'BOTH', '', 'YHXX-2026-1'));
    }
}
