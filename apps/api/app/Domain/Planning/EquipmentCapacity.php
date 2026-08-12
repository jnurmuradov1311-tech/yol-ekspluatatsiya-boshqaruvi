<?php

namespace App\Domain\Planning;

final readonly class EquipmentCapacity
{
    /** @param list<string> $availableDates ISO dates */
    public function __construct(
        public string $equipmentId,
        public string $roadUnitId,
        public string $typeCode,
        public array $availableDates,
    ) {}
}
