<?php

namespace App\Domain\Planning;

final readonly class PlanningDecision
{
    /**
     * @param  list<ScheduledSegment>  $segments
     * @param  list<BlockerCode>  $blockers
     */
    private function __construct(
        public string $candidateId,
        public string $status,
        public array $segments,
        public array $blockers,
    ) {}

    /** @param list<ScheduledSegment> $segments */
    public static function scheduled(string $candidateId, array $segments): self
    {
        return new self($candidateId, 'SCHEDULED', $segments, []);
    }

    /** @param list<BlockerCode> $blockers */
    public static function blocked(string $candidateId, array $blockers): self
    {
        return new self($candidateId, 'BLOCKED', [], array_values(array_unique($blockers, SORT_REGULAR)));
    }
}
