<?php

namespace App\Domain\Resources;

use DateTimeImmutable;
use InvalidArgumentException;

final class WorkerEquipmentLifecycle
{
    /**
     * The source supplies months. Starting the clock on the issue date is the
     * operational policy; the 30-day reminder is not an additional IQN norm.
     *
     * @return array{expiresOn:string,daysRemaining:int,daysElapsed:int,totalDays:int,status:string}
     */
    public function snapshot(string $issuedOn, int $serviceMonths, string $asOf): array
    {
        $issued = $this->date($issuedOn);
        $today = $this->date($asOf);
        if ($serviceMonths < 1 || $serviceMonths > 1200) {
            throw new InvalidArgumentException('Invalid equipment service life.');
        }
        // Anchor to the original day and clamp at month-end. PHP's bare
        // "+1 month" would incorrectly turn 31 January into a date in March.
        $month = $issued->modify('first day of this month')->modify('+'.$serviceMonths.' months');
        $expires = $month->setDate(
            (int) $month->format('Y'),
            (int) $month->format('m'),
            min((int) $issued->format('d'), (int) $month->format('t')),
        );
        $remaining = (int) $today->diff($expires)->format('%r%a');

        return [
            'expiresOn' => $expires->format('Y-m-d'),
            'daysRemaining' => $remaining,
            'daysElapsed' => max(0, (int) $issued->diff($today)->format('%r%a')),
            'totalDays' => (int) $issued->diff($expires)->format('%a'),
            'status' => $remaining <= 0 ? 'EXPIRED' : ($remaining <= 30 ? 'DUE' : 'ACTIVE'),
        ];
    }

    private function date(string $value): DateTimeImmutable
    {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        if ($date === false || $date->format('Y-m-d') !== $value) {
            throw new InvalidArgumentException('Invalid equipment lifecycle date.');
        }

        return $date;
    }
}
