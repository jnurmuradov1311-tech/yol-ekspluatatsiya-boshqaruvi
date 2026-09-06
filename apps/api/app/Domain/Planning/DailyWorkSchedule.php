<?php

namespace App\Domain\Planning;

use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use InvalidArgumentException;

final class DailyWorkSchedule
{
    /** @return list<array{date: string, quantity: string, availableMinutes: int}> */
    public static function split(string $from, string $to, string $start, string $end, string $quantity, int $maximumDays = 14): array
    {
        $first = DateTimeImmutable::createFromFormat('!Y-m-d', $from);
        $last = DateTimeImmutable::createFromFormat('!Y-m-d', $to);
        if ($first === false || $last === false || $first->format('Y-m-d') !== $from || $last->format('Y-m-d') !== $to || $last < $first) {
            throw new InvalidArgumentException('Boshlanish va tugash sanasini to‘g‘ri kiriting.');
        }
        if (! preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/', $start) || ! preg_match('/^([01][0-9]|2[0-3]):[0-5][0-9]$/', $end)) {
            throw new InvalidArgumentException('Vaqt HH:mm ko‘rinishida bo‘lishi kerak.');
        }
        $minutes = ((int) substr($end, 0, 2) * 60 + (int) substr($end, 3)) - ((int) substr($start, 0, 2) * 60 + (int) substr($start, 3));
        if ($minutes <= 0) {
            throw new InvalidArgumentException('Har kungi tugash vaqti boshlanish vaqtidan keyin bo‘lishi kerak.');
        }
        $count = (int) $first->diff($last)->days + 1;
        if ($count > $maximumDays) {
            throw new InvalidArgumentException("Ish davri {$maximumDays} kundan oshmasligi kerak.");
        }
        if (! preg_match('/^[0-9]+(?:\.[0-9]{1,6})?$/', $quantity) || ! BigDecimal::of($quantity)->isPositive()) {
            throw new InvalidArgumentException('Ish hajmi musbat va ko‘pi bilan 6 kasr xonali bo‘lishi kerak.');
        }
        $total = BigDecimal::of($quantity)->toScale(6);
        $share = $total->dividedBy($count, 6, RoundingMode::Down);
        if (! $share->isPositive()) {
            throw new InvalidArgumentException('Ish hajmi tanlangan kunlar soniga bo‘lish uchun juda kichik.');
        }
        $days = [];
        for ($i = 0; $i < $count; $i++) {
            $days[] = [
                'date' => $first->modify("+{$i} days")->format('Y-m-d'),
                // Put only the rounding remainder into the last shift. Total is exact.
                'quantity' => (string) ($i === $count - 1 ? $total->minus($share->multipliedBy($count - 1)) : $share),
                'availableMinutes' => min(420, $minutes),
            ];
        }

        return $days;
    }

    public static function roadAccess(string $scheme): string
    {
        return match ($scheme) {
            'shoulder_work' => 'OPEN',
            'full_closure_permit' => 'CLOSED',
            default => 'PARTIAL',
        };
    }
}
