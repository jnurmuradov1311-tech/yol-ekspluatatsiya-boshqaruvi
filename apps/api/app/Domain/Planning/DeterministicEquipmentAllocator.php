<?php

namespace App\Domain\Planning;

/**
 * Converts only approved machine-time units and splits them over physical
 * assets in their caller-supplied stable order. Unknown units fail closed.
 */
final class DeterministicEquipmentAllocator
{
    /**
     * @param  list<array{id: string, availableMinutes: int}>  $assets
     * @return list<array{equipmentUnitId: string, allocatedQuantity: string}>
     */
    public function allocate(string $unit, string $requiredQuantity, array $assets): array
    {
        $normalizedUnit = mb_strtolower(trim($unit), 'UTF-8');
        $minutesPerUnit = match ($normalizedUnit) {
            'machine_minute' => 1,
            'machine_hour' => 60,
            default => null,
        };
        if ($minutesPerUnit === null) {
            return [];
        }

        $remainingMicros = $this->decimalMicros($requiredQuantity);
        if ($remainingMicros === null || $remainingMicros <= 0) {
            return [];
        }
        $allocations = [];

        foreach ($assets as $asset) {
            $availableMinutes = min(420, max(0, $asset['availableMinutes']));
            if ($remainingMicros <= 0) {
                break;
            }
            if ($asset['id'] === '' || $availableMinutes === 0) {
                continue;
            }
            $capacityMicros = intdiv($availableMinutes * 1_000_000, $minutesPerUnit);
            $allocatedMicros = min($capacityMicros, $remainingMicros);
            if ($allocatedMicros <= 0) {
                continue;
            }
            $allocations[] = [
                'equipmentUnitId' => $asset['id'],
                'allocatedQuantity' => $this->formatMicros($allocatedMicros),
            ];
            $remainingMicros -= $allocatedMicros;
        }

        return $allocations;
    }

    private function decimalMicros(string $value): ?int
    {
        $value = trim($value);
        if (! preg_match('/^\+?(\d+)(?:\.(\d{1,6}))?$/', $value, $matches)) {
            return null;
        }
        $whole = ltrim($matches[1], '0');
        $whole = $whole === '' ? '0' : $whole;
        // Keeps the exact numeric(20,6) calculation inside a signed PHP int.
        if (strlen($whole) > 12) {
            return null;
        }
        $fraction = str_pad($matches[2] ?? '', 6, '0');

        return ((int) $whole * 1_000_000) + (int) $fraction;
    }

    private function formatMicros(int $value): string
    {
        return intdiv($value, 1_000_000).'.'.str_pad(
            (string) ($value % 1_000_000),
            6,
            '0',
            STR_PAD_LEFT,
        );
    }
}
