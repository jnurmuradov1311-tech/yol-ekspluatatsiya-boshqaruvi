<?php

namespace App\Domain\Integrations;

interface SyncAdapter
{
    public function source(): SourceSystem;

    /** @return list<string> */
    public function missingConfiguration(): array;

    /**
     * Fetches at most one cursor page and stores immutable events in the inbox.
     *
     * @return array{received:int,duplicate:int,next_cursor:?string}
     */
    public function fetch(?string $cursor, ?string $syncRunId = null): array;
}
