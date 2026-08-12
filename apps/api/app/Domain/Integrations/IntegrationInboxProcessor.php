<?php

namespace App\Domain\Integrations;

use Illuminate\Database\Connection;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use stdClass;

final class IntegrationInboxProcessor
{
    public function __construct(
        private readonly ExternalEventContractValidator $validator,
        private readonly YtpMasterDataProjector $ytp,
        private readonly RoadVisionFindingProjector $roadVision,
    ) {}

    /**
     * @return array{state:string,applied:bool,retryable:bool,error:?string}
     */
    public function process(string $inboxId): array
    {
        $connection = DB::connection('pgsql_sync');
        $claimed = $connection->transaction(function () use ($connection, $inboxId): ?stdClass {
            $row = $connection->selectOne(
                <<<'SQL'
                    select i.id, i.state, i.attempt_count, i.available_at,
                           case when i.available_at <= clock_timestamp() then 1 else 0 end available_now
                    from roadops.integration_inbox i
                    where i.id = ?
                    for update skip locked
                SQL,
                [$inboxId],
            );
            if ($row === null || in_array((string) $row->state, ['processed', 'dead_letter'], true)) {
                return $row;
            }
            if ($row->state === 'processing') {
                return null;
            }
            if ($row->state === 'failed' && (int) $row->available_now !== 1) {
                return $row;
            }

            $connection->update(
                <<<'SQL'
                    update roadops.integration_inbox
                    set state = 'processing', attempt_count = attempt_count + 1,
                        locked_at = clock_timestamp(), locked_by = ?,
                        last_error_code = null, last_error_detail = null
                    where id = ?
                SQL,
                [gethostname() ?: 'roadops-integration-worker', $inboxId],
            );

            return $row;
        });

        if ($claimed === null) {
            return ['state' => 'processing', 'applied' => false, 'retryable' => false, 'error' => null];
        }
        if (in_array((string) $claimed->state, ['processed', 'dead_letter'], true)) {
            return [
                'state' => (string) $claimed->state,
                'applied' => $claimed->state === 'processed',
                'retryable' => false,
                'error' => null,
            ];
        }
        if ($claimed->state === 'failed' && isset($claimed->available_now) && (int) $claimed->available_now !== 1) {
            return [
                'state' => 'failed',
                'applied' => false,
                'retryable' => true,
                'error' => 'Integration inbox retry is not available yet.',
            ];
        }

        try {
            $connection->transaction(function () use ($connection, $inboxId): void {
                $inbox = $connection->selectOne(
                    <<<'SQL'
                        select i.id, i.source_system_id, i.external_event_id, i.event_kind,
                               i.payload, i.transport_context,
                               encode(i.payload_hash, 'hex') payload_hash,
                               s.system_kind
                        from roadops.integration_inbox i
                        join roadops.source_systems s on s.id = i.source_system_id
                        where i.id = ? and i.state = 'processing'
                        for update
                    SQL,
                    [$inboxId],
                );
                if ($inbox === null) {
                    throw new \RuntimeException('Claimed inbox event is no longer processable.');
                }

                /** @var array<string, mixed> $envelope */
                $envelope = is_string($inbox->payload)
                    ? json_decode($inbox->payload, true, 128, JSON_THROW_ON_ERROR)
                    : (array) $inbox->payload;
                $this->validator->validate((string) $inbox->system_kind, $envelope);

                match ((string) $inbox->system_kind) {
                    SourceSystem::YTP->value => $this->ytp->apply($connection, $inbox, $envelope),
                    SourceSystem::ROADVISION->value => $this->roadVision->apply($connection, $inbox, $envelope),
                    default => throw new ContractViolation(
                        'SOURCE_KIND_UNSUPPORTED',
                        'Unsupported integration source kind.',
                    ),
                };

                $connection->update(
                    <<<'SQL'
                        update roadops.integration_inbox
                        set state = 'processed', processed_at = clock_timestamp(),
                            locked_at = null, locked_by = null,
                            last_error_code = null, last_error_detail = null
                        where id = ?
                    SQL,
                    [$inboxId],
                );
                $connection->statement(
                    <<<'SQL'
                        update roadops.sync_conflicts
                        set status = 'resolved_from_source', resolved_at = clock_timestamp(),
                            resolved_by = null,
                            resolution_note = 'Dependency became available and the immutable inbox event was replayed.'
                        where inbox_id = ? and status = 'open'
                    SQL,
                    [$inboxId],
                );
            });

            return ['state' => 'processed', 'applied' => true, 'retryable' => false, 'error' => null];
        } catch (IntegrationApplyConflict $exception) {
            $this->recordConflict($connection, $inboxId, $exception);

            return [
                'state' => 'conflict',
                'applied' => false,
                'retryable' => false,
                'error' => $exception->getMessage(),
            ];
        } catch (ContractViolation|\JsonException|\InvalidArgumentException $exception) {
            $code = $exception instanceof ContractViolation
                ? $exception->contractCode
                : class_basename($exception);
            $this->recordFailure($connection, $inboxId, $code, $exception, false);

            return [
                'state' => 'dead_letter',
                'applied' => false,
                'retryable' => false,
                'error' => $exception->getMessage(),
            ];
        } catch (QueryException $exception) {
            $sqlState = (string) $exception->getCode();
            if (in_array($sqlState, ['23503', '23505', '23P01'], true)) {
                $conflict = new IntegrationApplyConflict(
                    'SOURCE_INTEGRITY_CONSTRAINT',
                    'INTEGRATION_EVENT',
                    $inboxId,
                    'The source event violates an effective-date, uniqueness, or ownership invariant.',
                    [],
                    ['sqlstate' => $sqlState],
                );
                $this->recordConflict($connection, $inboxId, $conflict);

                return [
                    'state' => 'conflict',
                    'applied' => false,
                    'retryable' => false,
                    'error' => $conflict->getMessage(),
                ];
            }
            if (str_starts_with($sqlState, '23')) {
                $this->recordFailure(
                    $connection,
                    $inboxId,
                    'SOURCE_INTEGRITY_CONSTRAINT',
                    $exception,
                    false,
                );

                return [
                    'state' => 'dead_letter',
                    'applied' => false,
                    'retryable' => false,
                    'error' => $exception->getMessage(),
                ];
            }

            return $this->recordUnexpectedFailure($connection, $inboxId, $exception);
        } catch (\Throwable $exception) {
            return $this->recordUnexpectedFailure($connection, $inboxId, $exception);
        }
    }

    /**
     * Processes an ordered batch and retries dependency conflicts once after
     * later source rows have had an opportunity to arrive.
     *
     * @return array{processed:int,conflict:int,dead_letter:int,failed:int,pending:int}
     */
    public function processPending(
        ?string $syncRunId = null,
        int $limit = 1000,
        bool $includeConflicts = false,
    ): array {
        $connection = DB::connection('pgsql_sync');
        $limit = max(1, min(25000, $limit));
        $parameters = [];
        $runFilter = '';
        if ($syncRunId !== null) {
            $runFilter = 'and sync_run_id = ?';
            $parameters[] = $syncRunId;
        }
        $parameters[] = $limit;
        $eligibleStates = $includeConflicts
            ? "('pending', 'failed', 'conflict')"
            : "('pending', 'failed')";
        $rows = $connection->select(
            <<<SQL
                select id
                from roadops.integration_inbox
                where state in {$eligibleStates}
                  and available_at <= clock_timestamp()
                  {$runFilter}
                order by occurred_at nulls last, received_at, id
                limit ?
            SQL,
            $parameters,
        );
        foreach ($rows as $row) {
            $this->process((string) $row->id);
        }

        // Do not hot-loop conflicts in the same run. Reconciliation explicitly
        // replays them after dependent master events have had time to arrive.

        $countParameters = [];
        $countFilter = '';
        if ($syncRunId !== null) {
            $countFilter = 'where sync_run_id = ?';
            $countParameters[] = $syncRunId;
        }
        $counts = $connection->selectOne(
            <<<SQL
                select count(*) filter (where state = 'processed')::integer processed,
                       count(*) filter (where state = 'conflict')::integer conflict,
                       count(*) filter (where state = 'dead_letter')::integer dead_letter,
                       count(*) filter (where state in ('failed', 'processing'))::integer failed,
                       count(*) filter (where state = 'pending')::integer pending
                from roadops.integration_inbox
                {$countFilter}
            SQL,
            $countParameters,
        );

        return [
            'processed' => (int) $counts->processed,
            'conflict' => (int) $counts->conflict,
            'dead_letter' => (int) $counts->dead_letter,
            'failed' => (int) $counts->failed,
            'pending' => (int) $counts->pending,
        ];
    }

    private function recordConflict(
        Connection $connection,
        string $inboxId,
        IntegrationApplyConflict $exception,
    ): void {
        $connection->transaction(function () use ($connection, $inboxId, $exception): void {
            $detail = ['message' => mb_substr($exception->getMessage(), 0, 2000)];
            $connection->update(
                <<<'SQL'
                    update roadops.integration_inbox
                    set state = 'conflict', processed_at = null,
                        available_at = clock_timestamp() + make_interval(
                          secs => least(3600, power(2, least(attempt_count, 8))::integer * 15)
                        ),
                        locked_at = null, locked_by = null,
                        last_error_code = ?, last_error_detail = ?::jsonb
                    where id = ?
                SQL,
                [
                    $exception->conflictCode,
                    json_encode($detail, JSON_THROW_ON_ERROR),
                    $inboxId,
                ],
            );
            $connection->statement(
                <<<'SQL'
                    insert into roadops.sync_conflicts
                        (inbox_id, entity_type, external_id, conflict_code,
                         source_value, current_value)
                    values (?, ?, ?, ?, ?::jsonb, ?::jsonb)
                    on conflict (inbox_id, conflict_code) where status = 'open'
                    do update set source_value = excluded.source_value,
                                  current_value = excluded.current_value,
                                  detected_at = clock_timestamp()
                SQL,
                [
                    $inboxId,
                    $exception->entityType,
                    $exception->externalId,
                    $exception->conflictCode,
                    json_encode($exception->sourceValue, JSON_THROW_ON_ERROR),
                    json_encode($exception->currentValue, JSON_THROW_ON_ERROR),
                ],
            );
        });
    }

    private function recordFailure(
        Connection $connection,
        string $inboxId,
        string $code,
        \Throwable $exception,
        bool $retryable,
    ): void {
        $connection->transaction(function () use (
            $connection,
            $inboxId,
            $code,
            $exception,
            $retryable,
        ): void {
            $state = $retryable ? 'failed' : 'dead_letter';
            $detail = ['message' => mb_substr($exception->getMessage(), 0, 2000)];
            $connection->update(
                <<<'SQL'
                    update roadops.integration_inbox
                    set state = ?, processed_at = null,
                        available_at = case when ? then
                          clock_timestamp() + make_interval(
                            secs => least(3600, power(2, least(attempt_count, 8))::integer * 15)
                          )
                          else available_at end,
                        locked_at = null, locked_by = null,
                        last_error_code = ?, last_error_detail = ?::jsonb
                    where id = ?
                SQL,
                [
                    $state,
                    $retryable,
                    $code,
                    json_encode($detail, JSON_THROW_ON_ERROR),
                    $inboxId,
                ],
            );
            if (! $retryable) {
                $connection->statement(
                    <<<'SQL'
                        insert into roadops.dead_letter_events
                            (direction, original_id, source_or_destination, event_kind,
                             payload_hash, failure_code, failure_detail)
                        select 'inbox', i.id, s.code, i.event_kind, i.payload_hash, ?, ?::jsonb
                        from roadops.integration_inbox i
                        join roadops.source_systems s on s.id = i.source_system_id
                        where i.id = ?
                        on conflict (direction, original_id) do nothing
                    SQL,
                    [$code, json_encode($detail, JSON_THROW_ON_ERROR), $inboxId],
                );
            }
        });
    }

    /** @return array{state:string, applied:false, retryable:bool, error:string} */
    private function recordUnexpectedFailure(
        Connection $connection,
        string $inboxId,
        \Throwable $exception,
    ): array {
        $attempt = (int) $connection->scalar(
            'select attempt_count from roadops.integration_inbox where id = ?',
            [$inboxId],
        );
        $retryable = $attempt < 8;
        $this->recordFailure(
            $connection,
            $inboxId,
            class_basename($exception),
            $exception,
            $retryable,
        );

        return [
            'state' => $retryable ? 'failed' : 'dead_letter',
            'applied' => false,
            'retryable' => $retryable,
            'error' => $exception->getMessage(),
        ];
    }
}
