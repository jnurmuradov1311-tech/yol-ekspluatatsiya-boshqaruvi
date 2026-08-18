<?php

namespace App\Domain\Execution;

final readonly class MonthlyActCalculation
{
    public function __construct(
        public string $laborAmountUzs,
        public string $socialAmountUzs,
        public string $materialAmountUzs,
        public string $equipmentAmountUzs,
        public string $totalAmountUzs,
    ) {}
}
