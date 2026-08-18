<?php

namespace App\Domain\Execution;

final readonly class LaborCostCalculation
{
    public function __construct(
        public string $baseWageAmountUzs,
        public string $bonusAmountUzs,
        public string $trafficAllowanceAmountUzs,
        public string $travelAllowanceAmountUzs,
        public string $laborAmountUzs,
        public string $socialAmountUzs,
        public string $totalAmountUzs,
    ) {}
}
