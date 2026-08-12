<?php

namespace App\Domain\Norms;

final readonly class NormCalculation
{
    public function __construct(
        public string $normalizedQuantity,
        public string $basisQuantity,
        public string $timeNormPersonHours,
        public string $personHours,
        public int $personMinutes,
    ) {}
}
