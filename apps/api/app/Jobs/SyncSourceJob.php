<?php

namespace App\Jobs;

use App\Domain\Integrations\IntegrationInboxProcessor;
use App\Domain\Integrations\SourceSystem;
use App\Domain\Integrations\SyncAdapter;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class SyncSourceJob implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 5;

    public int $timeout = 840;

    public int $uniqueFor = 7200;

    public bool $failOnTimeout = true;

    /** @var list<int> */
    public array $backoff = [30, 120, 600, 1800];

    public function __construct(public readonly SourceSystem $source)
    {
        $this->onConnection('redis_integrations');
        $this->onQueue('integrations');
    }

    /** @return list<object> */
    public function middleware(): array
    {
        return [(new WithoutOverlapping('sync-'.$this->source->value))->expireAfter(1200)];
    }

    public function uniqueId(): string
    {
        return $this->source->value;
    }

    public function handle(IntegrationInboxProcessor $processor): void
    {
        /** @var SyncAdapter $adapter */
        $adapter = match ($this->source) {
            SourceSystem::YTP => app('roadops.ytp-adapter'),
            SourceSystem::ROADVISION => app('roadops.roadvision-adapter'),
        };
        $missing = $adapter->missingConfiguration();
        if ($missing !== []) {
            throw new \RuntimeException(
                $this->source->value.' is CONFIGURATION_REQUIRED: '.implode(', ', $missing),
            );
        }

        $connection = DB::connection('pgsql_sync');
        $connectionRows = $connection->select(
            <<<'SQL'
                select ic.id, ic.source_system_id from roadops.integration_connections ic
                join roadops.source_systems ss on ss.id = ic.source_system_id
                where ss.system_kind = ? and ss.enabled = true and ic.enabled = true
                  and ic.configuration ->> 'contract_approved' = 'true'
                  and ic.configuration ->> 'contract_sha256' ~ '^[a-f0-9]{64}$'
                order by ic.created_at, ic.id
            SQL,
            [$this->source->value],
        );
        if (count($connectionRows) !== 1) {
            throw new \RuntimeException($this->source->value.' connection is CONFIGURATION_REQUIRED.');
        }
        $connectionRow = $connectionRows[0];

        $runId = (string) Str::uuid();
        try {
            $cursorRow = $connection->selectOne(
                'select cursor_value from roadops.sync_cursors where connection_id = ? and stream_name = ?',
                [$connectionRow->id, 'default'],
            );
            $cursor = $cursorRow === null ? null : (string) $cursorRow->cursor_value;
            $connection->insert(
                <<<'SQL'
                    insert into roadops.sync_runs
                        (id, connection_id, stream_name, run_kind, status,
                         cursor_before, started_at)
                    values (?, ?, 'default', 'incremental', 'running', ?, now())
                SQL,
                [$runId, $connectionRow->id, $cursor],
            );

            // Revisit dependency conflicts and transient failures from earlier
            // runs before reading a newer cursor page.
            $processor->processPending(null, 1000);
            $received = 0;
            $duplicates = 0;
            // One external page per queue job keeps runtime bounded below the
            // worker timeout. A subsequent scheduled run resumes from the
            // committed cursor rather than holding a 100-page job lease.
            $page = $adapter->fetch($cursor, $runId);
            $received = $page['received'];
            $duplicates = $page['duplicate'];
            $nextCursor = $page['next_cursor'];
            $cursor = $nextCursor === null || $nextCursor === $cursor ? $cursor : $nextCursor;

            $counts = $processor->processPending($runId, 1000);
            $runBacklog = (int) $connection->scalar(
                "select count(*) from roadops.integration_inbox where sync_run_id = ? and state in ('pending', 'processing', 'failed')",
                [$runId],
            );
            $sourceBacklog = (int) $connection->scalar(
                <<<'SQL'
                    select count(*)
                    from roadops.integration_inbox i
                    where i.source_system_id = ?
                      and i.state in ('pending', 'processing', 'failed')
                SQL,
                [$connectionRow->source_system_id],
            );
            $rejected = $counts['conflict'] + $counts['dead_letter'];
            // Duplicate refetches keep their original sync_run_id. Include the
            // source-wide backlog so a later all-duplicate run cannot advance
            // past older unprocessed events.
            $retryable = max($counts['failed'] + $counts['pending'], $runBacklog, $sourceBacklog);
            $status = $retryable > 0
                ? (($counts['processed'] + $rejected) > 0 ? 'partially_succeeded' : 'failed')
                : ($rejected > 0 ? 'partially_succeeded' : 'succeeded');
            $connection->transaction(function () use (
                $connection,
                $connectionRow,
                $runId,
                $received,
                $duplicates,
                $cursor,
                $counts,
                $rejected,
                $retryable,
                $status,
            ): void {
                $connection->update(
                    <<<'SQL'
                        update roadops.sync_runs
                        set status = ?, finished_at = now(), received_count = ?,
                            applied_count = ?, rejected_count = ?,
                            error_summary = ?::jsonb, cursor_after = ?
                        where id = ?
                    SQL,
                    [
                        $status,
                        $received,
                        $counts['processed'],
                        $rejected,
                        json_encode([
                            'new_events' => $received,
                            'duplicates' => $duplicates,
                            'conflicts' => $counts['conflict'],
                            'dead_letters' => $counts['dead_letter'],
                            'retryable' => $retryable,
                        ], JSON_THROW_ON_ERROR),
                        $retryable === 0 ? $cursor : null,
                        $runId,
                    ],
                );
                if ($retryable === 0 && $cursor !== null) {
                    $connection->statement(
                        <<<'SQL'
                            insert into roadops.sync_cursors (connection_id, stream_name, cursor_value, updated_at)
                            values (?, 'default', ?, now())
                            on conflict (connection_id, stream_name)
                            do update set cursor_value = excluded.cursor_value, updated_at = excluded.updated_at
                        SQL,
                        [$connectionRow->id, $cursor],
                    );
                }
            });
        } catch (\Throwable $exception) {
            $connection->statement(
                <<<'SQL'
                    update roadops.sync_runs
                    set status = 'failed', finished_at = now(),
                        received_count = greatest(
                          received_count,
                          (select count(*) from roadops.integration_inbox i where i.sync_run_id = sync_runs.id)
                        ),
                        error_summary = ?::jsonb
                    where id = ? and status = 'running'
                SQL,
                [json_encode([
                    'code' => class_basename($exception),
                    'message' => mb_substr($exception->getMessage(), 0, 2000),
                ], JSON_THROW_ON_ERROR), $runId],
            );
            throw $exception;
        }
    }
}
