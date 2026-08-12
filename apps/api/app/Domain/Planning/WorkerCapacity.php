<?php

namespace App\Domain\Planning;

final readonly class WorkerCapacity
{
    /**
     * @param  list<string>  $skills
     * @param  array<string, int>  $availableMinutesByDate  ISO date => unallocated minutes
     */
    public function __construct(
        public string $workerId,
        public string $roadUnitId,
        public array $skills,
        public array $availableMinutesByDate,
    ) {
        foreach ($availableMinutesByDate as $minutes) {
            if ($minutes < 0 || $minutes > 420) {
                throw new \InvalidArgumentException('Worker availability must be between 0 and 420 minutes.');
            }
        }
    }
}
