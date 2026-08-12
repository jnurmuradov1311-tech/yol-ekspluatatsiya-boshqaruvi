<?php

namespace App\Domain\Planning;

final readonly class RoadZone
{
    public function __construct(
        public string $roadId,
        public string $direction,
        public int $chainageFromM,
        public int $chainageToM,
    ) {
        if ($chainageFromM < 0 || $chainageToM <= $chainageFromM) {
            throw new \InvalidArgumentException('Invalid chainage interval.');
        }
    }

    public function conflictsWith(self $other): bool
    {
        if ($this->roadId !== $other->roadId || $this->direction !== $other->direction) {
            return false;
        }

        return $this->chainageFromM < $other->chainageToM
            && $other->chainageFromM < $this->chainageToM;
    }
}
