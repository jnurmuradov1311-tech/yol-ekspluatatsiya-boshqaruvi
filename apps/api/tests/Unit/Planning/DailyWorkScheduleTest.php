<?php

namespace Tests\Unit\Planning;

use App\Domain\Planning\DailyWorkSchedule;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

final class DailyWorkScheduleTest extends TestCase
{
    public function test_multi_day_quantity_is_conserved_and_short_shift_caps_capacity(): void
    {
        $days = DailyWorkSchedule::split('2026-09-06', '2026-09-08', '09:00', '11:00', '1');
        self::assertSame(['2026-09-06', '2026-09-07', '2026-09-08'], array_column($days, 'date'));
        self::assertSame(['0.333333', '0.333333', '0.333334'], array_column($days, 'quantity'));
        self::assertSame([120, 120, 120], array_column($days, 'availableMinutes'));
    }

    public function test_long_window_does_not_increase_the_daily_worker_limit(): void
    {
        self::assertSame(420, DailyWorkSchedule::split('2026-09-06', '2026-09-06', '08:00', '20:00', '4')[0]['availableMinutes']);
    }

    public function test_reversed_times_cannot_create_a_zero_or_negative_capacity_plan(): void
    {
        $this->expectException(InvalidArgumentException::class);
        DailyWorkSchedule::split('2026-09-06', '2026-09-06', '15:00', '08:00', '4');
    }

    public function test_long_horizon_is_rejected_before_any_reservations_are_made(): void
    {
        $this->expectException(InvalidArgumentException::class);
        DailyWorkSchedule::split('2026-09-06', '2026-09-20', '08:00', '15:00', '40', 14);
    }
}
