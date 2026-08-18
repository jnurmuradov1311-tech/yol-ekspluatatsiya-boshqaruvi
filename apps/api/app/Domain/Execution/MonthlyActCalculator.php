<?php

namespace App\Domain\Execution;

use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;

final class MonthlyActCalculator
{
    public function calculateLabor(
        string $monthlySalaryUzs,
        int $actualMinutes,
        int $monthlyNormMinutes,
        int $bonusRateBps = 0,
        int $trafficAllowanceRateBps = 0,
        int $travelAllowanceRateBps = 0,
        int $socialContributionRateBps = 0,
    ): LaborCostCalculation {
        $salary = $this->positiveDecimal($monthlySalaryUzs, 'Monthly salary');
        if ($actualMinutes <= 0 || $monthlyNormMinutes <= 0) {
            throw new \InvalidArgumentException('Actual and monthly norm minutes must be positive.');
        }
        $this->assertBasisPoints($bonusRateBps, 20000, 'Bonus rate');
        $this->assertBasisPoints($trafficAllowanceRateBps, 20000, 'Traffic allowance rate');
        $this->assertBasisPoints($travelAllowanceRateBps, 20000, 'Travel allowance rate');
        $this->assertBasisPoints($socialContributionRateBps, 10000, 'Social contribution rate');

        $base = $salary
            ->multipliedBy($actualMinutes)
            ->dividedBy($monthlyNormMinutes, 12, RoundingMode::HALF_UP)
            ->toScale(2, RoundingMode::HALF_UP);
        $bonus = $this->percentageAmount($base, $bonusRateBps);
        $traffic = $this->percentageAmount($base, $trafficAllowanceRateBps);
        $travel = $this->percentageAmount($base, $travelAllowanceRateBps);
        $labor = $base->plus($bonus)->plus($traffic)->plus($travel);
        $social = $this->percentageAmount($labor, $socialContributionRateBps);
        $total = $labor->plus($social);

        return new LaborCostCalculation(
            $this->money($base),
            $this->money($bonus),
            $this->money($traffic),
            $this->money($travel),
            $this->money($labor),
            $this->money($social),
            $this->money($total),
        );
    }

    public function calculateMaterial(string $unitPriceUzs, string $quantity): string
    {
        $price = $this->positiveDecimal($unitPriceUzs, 'Material unit price');
        $actualQuantity = $this->positiveDecimal($quantity, 'Material quantity');

        return $this->money($price->multipliedBy($actualQuantity));
    }

    public function calculateEquipment(string $machineHourRateUzs, int $actualMachineMinutes): string
    {
        $rate = $this->positiveDecimal($machineHourRateUzs, 'Machine-hour rate');
        if ($actualMachineMinutes <= 0) {
            throw new \InvalidArgumentException('Actual machine minutes must be positive.');
        }

        return $this->money(
            $rate
                ->multipliedBy($actualMachineMinutes)
                ->dividedBy(60, 12, RoundingMode::HALF_UP),
        );
    }

    /**
     * @param  list<LaborCostCalculation>  $laborLines
     * @param  list<string>  $materialAmountsUzs
     * @param  list<string>  $equipmentAmountsUzs
     */
    public function summarize(
        array $laborLines,
        array $materialAmountsUzs,
        array $equipmentAmountsUzs,
    ): MonthlyActCalculation {
        $labor = BigDecimal::zero();
        $social = BigDecimal::zero();
        foreach ($laborLines as $line) {
            if (! $line instanceof LaborCostCalculation) {
                throw new \InvalidArgumentException('Every labor line must be a LaborCostCalculation.');
            }
            $labor = $labor->plus($line->laborAmountUzs);
            $social = $social->plus($line->socialAmountUzs);
        }
        $materials = $this->sumMoney($materialAmountsUzs, 'Material amount');
        $equipment = $this->sumMoney($equipmentAmountsUzs, 'Equipment amount');
        $total = $labor->plus($social)->plus($materials)->plus($equipment);

        return new MonthlyActCalculation(
            $this->money($labor),
            $this->money($social),
            $this->money($materials),
            $this->money($equipment),
            $this->money($total),
        );
    }

    private function positiveDecimal(string $value, string $label): BigDecimal
    {
        try {
            $decimal = BigDecimal::of($value);
        } catch (\Throwable $exception) {
            throw new \InvalidArgumentException("{$label} must be numeric.", 0, $exception);
        }
        if ($decimal->isLessThanOrEqualTo(0)) {
            throw new \InvalidArgumentException("{$label} must be positive.");
        }

        return $decimal;
    }

    private function assertBasisPoints(int $basisPoints, int $maximum, string $label): void
    {
        if ($basisPoints < 0 || $basisPoints > $maximum) {
            throw new \InvalidArgumentException("{$label} is outside the approved range.");
        }
    }

    private function percentageAmount(BigDecimal $base, int $basisPoints): BigDecimal
    {
        return $base
            ->multipliedBy($basisPoints)
            ->dividedBy(10000, 12, RoundingMode::HALF_UP)
            ->toScale(2, RoundingMode::HALF_UP);
    }

    /** @param list<string> $amounts */
    private function sumMoney(array $amounts, string $label): BigDecimal
    {
        $total = BigDecimal::zero();
        foreach ($amounts as $amount) {
            $total = $total->plus($this->positiveDecimal($amount, $label));
        }

        return $total;
    }

    private function money(BigDecimal $amount): string
    {
        return (string) $amount->toScale(2, RoundingMode::HALF_UP);
    }
}
