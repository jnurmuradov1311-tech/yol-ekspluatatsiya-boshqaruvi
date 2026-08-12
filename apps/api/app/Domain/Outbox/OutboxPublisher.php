<?php

namespace App\Domain\Outbox;

interface OutboxPublisher
{
    public function supports(string $destination): bool;

    /** @param array<string, mixed> $payload */
    public function publish(string $eventId, string $eventKind, array $payload): void;
}
