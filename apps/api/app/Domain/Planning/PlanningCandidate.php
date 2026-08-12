<?php

namespace App\Domain\Planning;

use DateTimeImmutable;

final readonly class PlanningCandidate
{
    /**
     * @param  array<string, int>  $crewBySkill  skill code => simultaneous worker count
     * @param  array<string, int>  $equipmentByType  equipment type => simultaneous unit count
     * @param  array<string, float>  $materialsByCode  material code => total quantity
     * @param  list<BlockerCode>  $validationBlockers
     */
    public function __construct(
        public string $id,
        public string $roadUnitId,
        public DateTimeImmutable $verifiedAt,
        public ?int $explicitOrder,
        public int $personMinutes,
        public array $crewBySkill,
        public array $equipmentByType,
        public array $materialsByCode,
        public ?string $trafficControlPlanId,
        public RoadZone $zone,
        public bool $divisible,
        public array $validationBlockers = [],
    ) {
        if ($personMinutes <= 0) {
            throw new \InvalidArgumentException('Person-minutes must be positive.');
        }
        if ($crewBySkill === [] || array_sum($crewBySkill) <= 0) {
            throw new \InvalidArgumentException('At least one crew role is required.');
        }
        foreach ($crewBySkill as $count) {
            if ($count <= 0) {
                throw new \InvalidArgumentException('Crew counts must be positive.');
            }
        }
    }

    public function durationMinutes(): int
    {
        return (int) ceil($this->personMinutes / array_sum($this->crewBySkill));
    }
}
