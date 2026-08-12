<?php

namespace App\Domain\Planning;

final class LiveResourceGuard
{
    public function assertCurrent(int $invalidItemCount): void
    {
        if ($invalidItemCount !== 0) {
            throw new \DomainException('PLAN_INPUT_SNAPSHOT_STALE');
        }
    }
}
