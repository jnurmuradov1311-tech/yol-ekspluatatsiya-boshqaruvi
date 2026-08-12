<?php

namespace App\Domain\Norms;

use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;

final class NormCalculator
{
    public function calculate(
        string $workQuantity,
        string $conversionMultiplier,
        string $basisQuantity,
        string $timeNormPersonHours,
    ): NormCalculation {
        $quantity = BigDecimal::of($workQuantity);
        $multiplier = BigDecimal::of($conversionMultiplier);
        $basis = BigDecimal::of($basisQuantity);
        $timeNorm = BigDecimal::of($timeNormPersonHours);

        if ($quantity->isLessThanOrEqualTo(0) || $multiplier->isLessThanOrEqualTo(0)
            || $basis->isLessThanOrEqualTo(0) || $timeNorm->isLessThanOrEqualTo(0)) {
            throw new \InvalidArgumentException('Norm calculation values must be positive.');
        }

        $normalized = $quantity->multipliedBy($multiplier);
        $hours = $normalized
            ->dividedBy($basis, 12, RoundingMode::HALF_UP)
            ->multipliedBy($timeNorm)
            ->toScale(6, RoundingMode::HALF_UP);
        $minutes = $hours
            ->multipliedBy(60)
            ->toScale(0, RoundingMode::CEILING)
            ->toInt();

        return new NormCalculation(
            (string) $normalized->strippedOfTrailingZeros(),
            (string) $basis->strippedOfTrailingZeros(),
            (string) $timeNorm->strippedOfTrailingZeros(),
            (string) $hours->strippedOfTrailingZeros(),
            $minutes,
        );
    }
}
