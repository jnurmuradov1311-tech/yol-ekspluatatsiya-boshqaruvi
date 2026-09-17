<?php

namespace App\Domain\Execution;

use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;

/** Calculates a reviewable payroll statement; it never initiates a payment. */
final class PayrollCalculator
{
    public const MONEY_FIELDS = [
        'mealAmountUzs', 'holidayAmountUzs', 'oneTimeAmountUzs', 'terminationAmountUzs',
        'sickLeaveAmountUzs', 'leaveAmountUzs', 'materialAidAmountUzs',
        'incomeTaxAmountUzs', 'unionFeeAmountUzs', 'advanceAmountUzs', 'otherDeductionAmountUzs',
    ];

    /**
     * @param  list<array{monthlySalaryUzs:string,actualMinutes:int,normMinutes:int,bonusRateBps:int,trafficAllowanceRateBps:int,travelAllowanceRateBps:int,socialContributionRateBps:int}>  $segments
     * @param  array<string, mixed>  $adjustments
     * @param  array<int, array<string, mixed>>  $frozenAllocations
     * @return array<string, mixed>
     */
    public function calculate(array $segments, array $adjustments = [], array $frozenAllocations = []): array
    {
        if ($segments === []) {
            throw new \InvalidArgumentException('Tasdiqlangan ish vaqti mavjud emas.');
        }
        $amounts = array_fill_keys([
            'baseWageAmountUzs', 'bonusAmountUzs', 'trafficAllowanceAmountUzs',
            'travelAllowanceAmountUzs', 'seniorityAmountUzs', 'additionalAmountUzs',
            'employerSocialAmountUzs',
        ], BigDecimal::zero());
        $actualMinutes = 0;
        $sourceCalculations = [];
        $coefficient = $this->decimalInput((string) ($adjustments['coefficient'] ?? '1'));
        if ($coefficient->isLessThan('0.01') || $coefficient->isGreaterThan('10')) {
            throw new \InvalidArgumentException('Koeffitsiyent 0,01 dan 10 gacha bo‘lishi kerak.');
        }
        $socialRates = [];
        foreach ($segments as $segment) {
            if ($segment['actualMinutes'] <= 0 || $segment['normMinutes'] <= 0) {
                throw new \InvalidArgumentException('Haqiqiy ish vaqti va oylik vaqt me’yori musbat bo‘lishi kerak.');
            }
            $actualMinutes += $segment['actualMinutes'];
            $base = $this->prorate((string) $this->decimalInput($segment['monthlySalaryUzs'])->multipliedBy($coefficient), $segment['actualMinutes'], $segment['normMinutes']);
            $parts = ['baseWageAmountUzs' => $base];
            $parts['bonusAmountUzs'] = $this->percent($base,
                (int) ($adjustments['bonusRateBps'] ?? $segment['bonusRateBps']));
            foreach (['traffic', 'travel'] as $kind) {
                $allowanceBase = isset($adjustments[$kind.'MonthlyBaseUzs'])
                    ? $this->prorate((string) $adjustments[$kind.'MonthlyBaseUzs'], $segment['actualMinutes'], $segment['normMinutes'])
                    : $base;
                $parts[$kind.'AllowanceAmountUzs'] = $this->percent($allowanceBase,
                    (int) ($adjustments[$kind.'AllowanceRateBps'] ?? $segment[$kind.'AllowanceRateBps']));
            }
            $parts['seniorityAmountUzs'] = $this->percent($base, (int) ($adjustments['seniorityRateBps'] ?? 0));
            $parts['additionalAmountUzs'] = $this->percent($base, (int) ($adjustments['additionalRateBps'] ?? 0));
            $segmentGross = BigDecimal::zero();
            foreach ($parts as $key => $amount) {
                $amounts[$key] = $amounts[$key]->plus($amount);
                $segmentGross = $segmentGross->plus($amount);
            }
            $socialRate = (int) ($adjustments['socialContributionRateBps'] ?? $segment['socialContributionRateBps']);
            $socialRates[$socialRate] = true;
            $sourceSocial = $this->percent($segmentGross, $socialRate, 10000);
            $amounts['employerSocialAmountUzs'] = $amounts['employerSocialAmountUzs']->plus($sourceSocial);
            $sourceCalculations[] = [
                'actualMinutes' => $segment['actualMinutes'],
                'socialRateBps' => $socialRate,
                'components' => $parts,
                'grossAmountUzs' => $segmentGross,
                'employerSocialAmountUzs' => $sourceSocial,
            ];
        }

        $gross = BigDecimal::zero();
        foreach ($amounts as $key => $amount) {
            if ($key !== 'employerSocialAmountUzs') {
                $gross = $gross->plus($amount);
            }
        }
        $extraGross = BigDecimal::zero();
        $deductions = BigDecimal::zero();
        foreach (self::MONEY_FIELDS as $key) {
            $amounts[$key] = $this->moneyInput((string) ($adjustments[$key] ?? '0'));
            if (in_array($key, ['incomeTaxAmountUzs', 'unionFeeAmountUzs', 'advanceAmountUzs', 'otherDeductionAmountUzs'], true)) {
                $deductions = $deductions->plus($amounts[$key]);
            } else {
                $extraGross = $extraGross->plus($amounts[$key]);
            }
        }
        $extraSocial = BigDecimal::zero();
        if ($extraGross->isGreaterThan(0)) {
            if (count($socialRates) !== 1) {
                throw new \InvalidArgumentException('Qo‘shimcha to‘lovlar uchun yagona ijtimoiy ajratma stavkasini aniq kiriting.');
            }
            $extraSocial = $this->percent($extraGross, (int) array_key_first($socialRates), 10000);
            $amounts['employerSocialAmountUzs'] = $amounts['employerSocialAmountUzs']->plus($extraSocial);
        }
        $gross = $gross->plus($extraGross);
        if ($deductions->isGreaterThan($gross)) {
            throw new \InvalidArgumentException('Ushlanmalar hisoblangan ish haqidan ko‘p bo‘lishi mumkin emas.');
        }
        $deductionsConfirmed = ($adjustments['deductionsConfirmed'] ?? false) === true;
        if ($deductionsConfirmed) {
            foreach (['incomeTaxAmountUzs', 'unionFeeAmountUzs', 'advanceAmountUzs', 'otherDeductionAmountUzs'] as $field) {
                if (! array_key_exists($field, $adjustments)) {
                    throw new \InvalidArgumentException('Ushlanmalar tasdiqlanganda barcha ushlanma summalari, jumladan nol qiymatlar ham kiritiladi.');
                }
            }
        }

        // Posted source allocations never move when later attendance is added.
        // Only the remainder of each once-monthly component is assigned to new
        // sources; cumulative rounding keeps that remainder exact to one tiyin.
        $fixedFields = array_values(array_diff(self::MONEY_FIELDS, [
            'incomeTaxAmountUzs', 'unionFeeAmountUzs', 'advanceAmountUzs', 'otherDeductionAmountUzs',
        ]));
        $remaining = [];
        foreach ($fixedFields as $key) {
            $remaining[$key] = $amounts[$key];
        }
        $remainingSocial = $extraSocial;
        $unpostedMinutes = $actualMinutes;
        foreach ($frozenAllocations as $index => $frozen) {
            if (! isset($sourceCalculations[$index])) {
                throw new \InvalidArgumentException('Dalolatnomaga kiritilgan tabel yozuvi yangi hisobda yo‘q.');
            }
            $source = $sourceCalculations[$index];
            foreach ($source['components'] as $key => $value) {
                if (! $value->isEqualTo((string) ($frozen['components'][$key] ?? '-1'))) {
                    throw new \InvalidArgumentException('Dalolatnomaga kiritilgan ish haqi yoki ustamani o‘zgartirib bo‘lmaydi.');
                }
            }
            if (isset($frozen['socialRateBps']) && $frozen['socialRateBps'] !== $source['socialRateBps']) {
                throw new \InvalidArgumentException('Dalolatnomaga kiritilgan ijtimoiy ajratma stavkasi o‘zgarmaydi.');
            }
            foreach ($remaining as $key => $value) {
                $remaining[$key] = $value->minus((string) ($frozen['components'][$key] ?? '0'));
            }
            $remainingSocial = $remainingSocial->minus(
                BigDecimal::of((string) $frozen['employerSocialAmountUzs'])->minus($source['employerSocialAmountUzs']),
            );
            $unpostedMinutes -= $source['actualMinutes'];
        }
        foreach ([...array_values($remaining), $remainingSocial] as $value) {
            if ($value->isLessThan(0) || ($unpostedMinutes === 0 && ! $value->isZero())) {
                throw new \InvalidArgumentException('Bir martalik to‘lovning dalolatnomaga kiritilgan qismi o‘zgarmaydi. Qolgan summa uchun yangi tasdiqlangan ish vaqti kerak.');
            }
        }
        $allocatedMinutes = 0;
        $allocations = [];
        foreach ($sourceCalculations as $index => $source) {
            if (isset($frozenAllocations[$index])) {
                $frozen = $frozenAllocations[$index];
                $allocations[] = [
                    'components' => $frozen['components'],
                    'grossAmountUzs' => $frozen['grossAmountUzs'],
                    'employerSocialAmountUzs' => $frozen['employerSocialAmountUzs'],
                    'employerCostAmountUzs' => $frozen['employerCostAmountUzs'],
                    'socialRateBps' => $source['socialRateBps'],
                ];

                continue;
            }
            $nextMinutes = $allocatedMinutes + $source['actualMinutes'];
            foreach ($remaining as $key => $value) {
                $share = $this->share($value, $allocatedMinutes, $nextMinutes, $unpostedMinutes);
                $source['components'][$key] = $share;
                $source['grossAmountUzs'] = $source['grossAmountUzs']->plus($share);
            }
            $source['employerSocialAmountUzs'] = $source['employerSocialAmountUzs']->plus(
                $this->share($remainingSocial, $allocatedMinutes, $nextMinutes, $unpostedMinutes),
            );
            $allocations[] = [
                'components' => array_map(static fn (BigDecimal $value): string => (string) $value->toScale(2), $source['components']),
                'grossAmountUzs' => (string) $source['grossAmountUzs']->toScale(2),
                'employerSocialAmountUzs' => (string) $source['employerSocialAmountUzs']->toScale(2),
                'employerCostAmountUzs' => (string) $source['grossAmountUzs']->plus($source['employerSocialAmountUzs'])->toScale(2),
                'socialRateBps' => $source['socialRateBps'],
            ];
            $allocatedMinutes = $nextMinutes;
        }

        return [
            'coefficient' => (string) $coefficient,
            'sourceAllocations' => $allocations,
            'allocationBasis' => 'ACTUAL_MINUTES_CUMULATIVE_HALF_UP_2DP',
            'actualMinutes' => $actualMinutes,
            ...array_map(static fn (BigDecimal $amount): string => (string) $amount->toScale(2, RoundingMode::HALF_UP), $amounts),
            'grossAmountUzs' => (string) $gross->toScale(2, RoundingMode::HALF_UP),
            'deductionsAmountUzs' => (string) $deductions->toScale(2, RoundingMode::HALF_UP),
            'payableAmountUzs' => $deductionsConfirmed ? (string) $gross->minus($deductions)->toScale(2, RoundingMode::HALF_UP) : null,
            'employerCostAmountUzs' => (string) $gross->plus($amounts['employerSocialAmountUzs'])->toScale(2, RoundingMode::HALF_UP),
            'deductionsConfirmed' => $deductionsConfirmed,
            'state' => $deductionsConfirmed ? 'PREVIEW' : 'DEDUCTIONS_REQUIRED',
        ];
    }

    private function share(BigDecimal $amount, int $previous, int $next, int $total): BigDecimal
    {
        return $amount->multipliedBy($next)->dividedBy($total, 2, RoundingMode::HALF_UP)
            ->minus($amount->multipliedBy($previous)->dividedBy($total, 2, RoundingMode::HALF_UP));
    }

    private function prorate(string $monthlyAmount, int $actualMinutes, int $normMinutes): BigDecimal
    {
        return $this->decimalInput($monthlyAmount)->multipliedBy($actualMinutes)
            ->dividedBy($normMinutes, 2, RoundingMode::HALF_UP);
    }

    private function moneyInput(string $amount): BigDecimal
    {
        return $this->decimalInput($amount)->toScale(2, RoundingMode::HALF_UP);
    }

    private function decimalInput(string $amount): BigDecimal
    {
        try {
            $decimal = BigDecimal::of($amount);
        } catch (\Throwable $exception) {
            throw new \InvalidArgumentException('Summa raqam bilan kiritiladi.', 0, $exception);
        }
        if ($decimal->isLessThan(0)) {
            throw new \InvalidArgumentException('Summa manfiy bo‘lishi mumkin emas.');
        }

        return $decimal;
    }

    private function percent(BigDecimal $base, int $rateBps, int $maximum = 20000): BigDecimal
    {
        if ($rateBps < 0 || $rateBps > $maximum) {
            throw new \InvalidArgumentException('Foiz stavkasi ruxsat etilgan oraliqda bo‘lishi kerak.');
        }

        return $base->multipliedBy($rateBps)->dividedBy(10000, 2, RoundingMode::HALF_UP);
    }
}
