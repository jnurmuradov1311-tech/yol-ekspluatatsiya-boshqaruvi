<?php

namespace Tests\Unit\Norms;

use App\Domain\Norms\NormCalculator;
use PHPUnit\Framework\TestCase;

final class NormCalculatorTest extends TestCase
{
    public function test_it_calculates_350_square_metres_against_100_square_metre_basis(): void
    {
        $result = (new NormCalculator)->calculate('350', '1', '100', '1.05');

        self::assertSame('350', $result->normalizedQuantity);
        self::assertSame('3.675', $result->personHours);
        self::assertSame(221, $result->personMinutes);
    }

    public function test_it_applies_only_an_approved_external_conversion_multiplier(): void
    {
        $result = (new NormCalculator)->calculate('3.5', '1000', '100', '1.05');

        self::assertSame('3500', $result->normalizedQuantity);
        self::assertSame('36.75', $result->personHours);
    }

    public function test_it_rejects_non_positive_values(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        (new NormCalculator)->calculate('0', '1', '100', '1.05');
    }
}
