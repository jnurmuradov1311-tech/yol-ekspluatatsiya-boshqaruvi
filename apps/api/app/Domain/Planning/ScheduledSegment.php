<?php

namespace App\Domain\Planning;

final readonly class ScheduledSegment
{
    /**
     * @param  list<string>  $workerIds
     * @param  list<string>  $equipmentIds
     */
    public function __construct(
        public string $date,
        public int $minutes,
        public array $workerIds,
        public array $equipmentIds,
    ) {}
}
