<?php

namespace App\Domain\Planning;

final readonly class PlanningPool
{
    /**
     * @param  list<string>  $dates  ordered ISO dates
     * @param  list<WorkerCapacity>  $workers
     * @param  list<EquipmentCapacity>  $equipment
     * @param  array<string, float>  $materialBalances
     * @param  array<string, list<RoadZone>>  $occupiedZonesByDate
     */
    public function __construct(
        public array $dates,
        public array $workers,
        public array $equipment,
        public array $materialBalances,
        public array $occupiedZonesByDate = [],
    ) {}
}
