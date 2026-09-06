<?php

namespace Tests\Unit\Execution;

use App\Domain\Execution\PayrollCalculator;
use PHPUnit\Framework\TestCase;

final class PayrollCalculatorTest extends TestCase
{
    /** @return array{monthlySalaryUzs:string,actualMinutes:int,normMinutes:int,bonusRateBps:int,trafficAllowanceRateBps:int,travelAllowanceRateBps:int,socialContributionRateBps:int} */
    private function segment(): array
    {
        return [
            'monthlySalaryUzs' => '1845340', 'actualMinutes' => 10860, 'normMinutes' => 10860,
            'bonusRateBps' => 2000, 'trafficAllowanceRateBps' => 2000,
            'travelAllowanceRateBps' => 2000, 'socialContributionRateBps' => 1200,
        ];
    }

    public function test_source_head_allowances_use_their_explicit_base_and_social_is_employer_cost(): void
    {
        $result = (new PayrollCalculator)->calculate([$this->segment()], [
            // Historical reference row: 980000 × 1.4, supplied explicitly.
            'trafficMonthlyBaseUzs' => '1372000', 'travelMonthlyBaseUzs' => '1372000',
            'incomeTaxAmountUzs' => '250000', 'unionFeeAmountUzs' => '10000',
            'advanceAmountUzs' => '300000', 'otherDeductionAmountUzs' => '0',
            'deductionsConfirmed' => true,
        ]);

        self::assertSame('1845340.00', $result['baseWageAmountUzs']);
        self::assertSame('369068.00', $result['bonusAmountUzs']);
        self::assertSame('274400.00', $result['trafficAllowanceAmountUzs']);
        self::assertSame('274400.00', $result['travelAllowanceAmountUzs']);
        self::assertSame('2763208.00', $result['grossAmountUzs']);
        self::assertSame('331584.96', $result['employerSocialAmountUzs']);
        self::assertSame('3094792.96', $result['employerCostAmountUzs']);
        self::assertSame('2203208.00', $result['payableAmountUzs']);
    }

    public function test_unknown_deductions_do_not_silently_become_zero_tax_or_net_pay(): void
    {
        $result = (new PayrollCalculator)->calculate([$this->segment()]);

        self::assertSame('DEDUCTIONS_REQUIRED', $result['state']);
        self::assertNull($result['payableAmountUzs']);
        self::assertFalse($result['deductionsConfirmed']);
    }

    public function test_monthly_fixed_payments_are_added_once_across_multiple_rate_segments(): void
    {
        $first = $this->segment();
        $first['actualMinutes'] = 5430;
        $second = $first;
        $second['monthlySalaryUzs'] = '2000000';
        $result = (new PayrollCalculator)->calculate([$first, $second], [
            'bonusRateBps' => 0, 'trafficAllowanceRateBps' => 0, 'travelAllowanceRateBps' => 0,
            'holidayAmountUzs' => '150000', 'materialAidAmountUzs' => '100000',
            'socialContributionRateBps' => 0,
            'incomeTaxAmountUzs' => '0', 'unionFeeAmountUzs' => '0',
            'advanceAmountUzs' => '0', 'otherDeductionAmountUzs' => '0',
            'deductionsConfirmed' => true,
        ]);

        self::assertSame('1922670.00', $result['baseWageAmountUzs']);
        self::assertSame('2172670.00', $result['grossAmountUzs']);
        self::assertSame('2172670.00', $result['payableAmountUzs']);
        self::assertSame(10860, $result['actualMinutes']);
    }

    public function test_deductions_confirmation_requires_explicit_zero_or_amount_for_every_field(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        (new PayrollCalculator)->calculate([$this->segment()], ['deductionsConfirmed' => true]);
    }

    public function test_deductions_cannot_exceed_gross_pay(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        (new PayrollCalculator)->calculate([$this->segment()], ['advanceAmountUzs' => '99999999']);
    }

    public function test_unpriced_additional_payments_reject_ambiguous_social_rates(): void
    {
        $second = $this->segment();
        $second['socialContributionRateBps'] = 0;
        $this->expectException(\InvalidArgumentException::class);

        (new PayrollCalculator)->calculate([$this->segment(), $second], ['holidayAmountUzs' => '1']);
    }
}
