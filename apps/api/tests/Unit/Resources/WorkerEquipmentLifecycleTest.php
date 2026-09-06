<?php

namespace Tests\Unit\Resources;

use App\Domain\Resources\WorkerEquipmentLifecycle;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

final class WorkerEquipmentLifecycleTest extends TestCase
{
    public function test_calendar_months_are_anchored_to_issue_date_and_clamp_at_month_end(): void
    {
        $service = new WorkerEquipmentLifecycle;
        self::assertSame('2027-02-28', $service->snapshot('2027-01-31', 1, '2027-01-31')['expiresOn']);
        self::assertSame('2028-02-29', $service->snapshot('2028-01-31', 1, '2028-01-31')['expiresOn']);
        self::assertSame('2029-02-28', $service->snapshot('2028-02-29', 12, '2028-02-29')['expiresOn']);
        self::assertSame('2027-03-31', $service->snapshot('2027-01-31', 2, '2027-01-31')['expiresOn']);
    }

    public function test_timer_changes_state_on_due_and_expiry_boundaries(): void
    {
        $service = new WorkerEquipmentLifecycle;
        self::assertSame('ACTIVE', $service->snapshot('2026-01-01', 6, '2026-05-31')['status']);
        self::assertSame('DUE', $service->snapshot('2026-01-01', 6, '2026-06-01')['status']);
        self::assertSame('EXPIRED', $service->snapshot('2026-01-01', 6, '2026-07-01')['status']);
        self::assertSame(-1, $service->snapshot('2026-01-01', 6, '2026-07-02')['daysRemaining']);
    }

    public function test_invalid_dates_are_not_silently_normalized(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new WorkerEquipmentLifecycle)->snapshot('2026-02-30', 6, '2026-03-01');
    }

    public function test_missing_service_life_is_not_invented(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new WorkerEquipmentLifecycle)->snapshot('2026-01-01', 0, '2026-01-01');
    }
}
