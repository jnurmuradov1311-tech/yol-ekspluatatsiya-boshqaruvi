<?php

namespace Tests\Unit\Execution;

use App\Domain\Execution\MonthlyActCalculator;
use PHPUnit\Framework\TestCase;

final class MonthlyActCalculatorTest extends TestCase
{
    public function test_it_calculates_wage_allowances_and_social_contribution_separately(): void
    {
        $labor = (new MonthlyActCalculator)->calculateLabor(
            monthlySalaryUzs: '3000000',
            actualMinutes: 480,
            monthlyNormMinutes: 9600,
            bonusRateBps: 1000,
            trafficAllowanceRateBps: 2000,
            travelAllowanceRateBps: 500,
            socialContributionRateBps: 1200,
        );

        self::assertSame('150000.00', $labor->baseWageAmountUzs);
        self::assertSame('15000.00', $labor->bonusAmountUzs);
        self::assertSame('30000.00', $labor->trafficAllowanceAmountUzs);
        self::assertSame('7500.00', $labor->travelAllowanceAmountUzs);
        self::assertSame('202500.00', $labor->laborAmountUzs);
        self::assertSame('24300.00', $labor->socialAmountUzs);
        self::assertSame('226800.00', $labor->totalAmountUzs);
    }

    public function test_it_calculates_material_and_machine_minute_costs_and_month_total(): void
    {
        $calculator = new MonthlyActCalculator;
        $labor = $calculator->calculateLabor('3000000', 480, 9600, 1000, 2000, 500, 1200);
        $material = $calculator->calculateMaterial('12500', '3.75');
        $equipment = $calculator->calculateEquipment('180000', 90);
        $act = $calculator->summarize([$labor], [$material], [$equipment]);

        self::assertSame('46875.00', $material);
        self::assertSame('270000.00', $equipment);
        self::assertSame('202500.00', $act->laborAmountUzs);
        self::assertSame('24300.00', $act->socialAmountUzs);
        self::assertSame('46875.00', $act->materialAmountUzs);
        self::assertSame('270000.00', $act->equipmentAmountUzs);
        self::assertSame('543675.00', $act->totalAmountUzs);
    }

    public function test_it_rejects_out_of_range_allowance_rates(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        (new MonthlyActCalculator)->calculateLabor('3000000', 480, 9600, bonusRateBps: 20001);
    }

    public function test_it_rejects_zero_machine_minutes(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        (new MonthlyActCalculator)->calculateEquipment('180000', 0);
    }
}
