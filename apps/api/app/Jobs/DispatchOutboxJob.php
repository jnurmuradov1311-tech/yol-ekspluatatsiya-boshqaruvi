<?php

namespace App\Jobs;

use App\Domain\Outbox\OutboxPublisher;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use stdClass;

final class DispatchOutboxJob implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 1;

    public int $uniqueFor = 3600;

    public function __construct(public readonly string $outboxId)
    {
        $this->onQueue('outbox');
    }

    public function uniqueId(): string
    {
        return $this->outboxId;
    }

    public function handle(): void
    {
        $connection = DB::connection('pgsql_sync');
        $event = $connection->transaction(function () use ($connection): ?stdClass {
            $row = $connection->selectOne(
                <<<'SQL'
                    select id, event_id, destination_code, event_kind, payload, attempt_count
                    from roadops.integration_outbox
                    where id = ? and state in ('pending', 'failed') and available_at <= now()
                    for update skip locked
                SQL,
                [$this->outboxId],
            );
            if ($row === null) {
                return null;
            }
            $connection->update(
                "update roadops.integration_outbox set state = 'publishing', attempt_count = attempt_count + 1, locked_at = now(), locked_by = ? where id = ?",
                [gethostname() ?: 'roadops-worker', $this->outboxId],
            );

            return $row;
        });
        if ($event === null) {
            return;
        }

        try {
            $payload = is_string($event->payload)
                ? json_decode($event->payload, true, 128, JSON_THROW_ON_ERROR)
                : (array) $event->payload;
            $publisher = $this->publisher((string) $event->destination_code);
            $publisher->publish((string) $event->event_id, (string) $event->event_kind, $payload);
            $connection->update(
                "update roadops.integration_outbox set state = 'published', published_at = now(), locked_at = null, locked_by = null where id = ?",
                [$this->outboxId],
            );
        } catch (\Throwable $exception) {
            $attempt = (int) $event->attempt_count + 1;
            $state = $attempt >= 8 ? 'dead_letter' : 'failed';
            $connection->transaction(function () use ($connection, $exception, $attempt, $state): void {
                $connection->update(
                    <<<'SQL'
                        update roadops.integration_outbox
                        set state = ?, available_at = now() + make_interval(secs => least(3600, power(2, ?)::integer * 15)),
                            locked_at = null, locked_by = null, last_error_code = ?, last_error_detail = ?::jsonb
                        where id = ?
                    SQL,
                    [
                        $state,
                        min($attempt, 8),
                        class_basename($exception),
                        json_encode(['message' => mb_substr($exception->getMessage(), 0, 1500)], JSON_THROW_ON_ERROR),
                        $this->outboxId,
                    ],
                );
                if ($state === 'dead_letter') {
                    $connection->statement(
                        <<<'SQL'
                            insert into roadops.dead_letter_events
                                (direction, original_id, source_or_destination, event_kind,
                                 payload_hash, failure_code, failure_detail)
                            select 'outbox', id, destination_code, event_kind, payload_hash, ?, ?::jsonb
                            from roadops.integration_outbox where id = ?
                            on conflict (direction, original_id) do nothing
                        SQL,
                        [
                            class_basename($exception),
                            json_encode(['message' => mb_substr($exception->getMessage(), 0, 1500)], JSON_THROW_ON_ERROR),
                            $this->outboxId,
                        ],
                    );
                }
            });
        }
    }

    private function publisher(string $destination): OutboxPublisher
    {
        /** @var iterable<OutboxPublisher> $publishers */
        $publishers = app()->tagged('roadops.outbox-publishers');
        foreach ($publishers as $publisher) {
            if ($publisher->supports($destination)) {
                return $publisher;
            }
        }

        throw new \RuntimeException("No outbox publisher for {$destination}.");
    }
}
