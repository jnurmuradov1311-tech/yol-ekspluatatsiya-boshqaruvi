<?php

namespace App\Domain\Planning;

final readonly class PlanningResult
{
    /** @param list<PlanningDecision> $decisions */
    public function __construct(
        public array $decisions,
        public PlanningPool $remainingPool,
    ) {}

    public function isFeasible(): bool
    {
        foreach ($this->decisions as $decision) {
            if ($decision->status === 'BLOCKED') {
                return false;
            }
        }

        return true;
    }
}
