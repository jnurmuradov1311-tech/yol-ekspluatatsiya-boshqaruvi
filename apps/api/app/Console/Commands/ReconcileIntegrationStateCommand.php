<?php

namespace App\Console\Commands;

use App\Domain\Integrations\IntegrationInboxProcessor;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class ReconcileIntegrationStateCommand extends Command
{
    protected $signature = 'roadops:reconcile {--limit=1000}';

    protected $description = 'Recovers stale integration locks and replays pending inbox events.';

    public function handle(IntegrationInboxProcessor $processor): int
    {
        $limit = max(1, min(25000, (int) $this->option('limit')));
        $connection = DB::connection('pgsql_sync');
        $recoveredInbox = $connection->update(
            <<<'SQL'
                update roadops.integration_inbox
                set state = 'failed', available_at = clock_timestamp(),
                    locked_at = null, locked_by = null,
                    last_error_code = 'STALE_PROCESSING_LOCK',
                    last_error_detail = jsonb_build_object(
                      'message', 'A stale processing lock was recovered by reconciliation.'
                    )
                where state = 'processing'
                  and locked_at < clock_timestamp() - interval '15 minutes'
            SQL,
        );
        $recoveredOutbox = $connection->update(
            <<<'SQL'
                update roadops.integration_outbox
                set state = 'failed', available_at = clock_timestamp(),
                    locked_at = null, locked_by = null,
                    last_error_code = 'STALE_PUBLISHING_LOCK',
                    last_error_detail = jsonb_build_object(
                      'message', 'A stale publishing lock was recovered by reconciliation.'
                    )
                where state = 'publishing'
                  and locked_at < clock_timestamp() - interval '15 minutes'
            SQL,
        );
        $staleRuns = $connection->update(
            <<<'SQL'
                update roadops.sync_runs
                set status = 'failed', finished_at = clock_timestamp(),
                    error_summary = jsonb_build_object(
                      'code', 'STALE_SYNC_RUN',
                      'message', 'The sync run exceeded its maximum processing window.'
                    )
                where status = 'running'
                  and started_at < clock_timestamp() - interval '2 hours'
            SQL,
        );

        $counts = $processor->processPending(null, $limit, true);
        $connection->update(
            <<<'SQL'
                update roadops.sync_runs r
                set received_count = greatest(r.received_count, q.received),
                    applied_count = q.processed,
                    rejected_count = q.rejected,
                    status = case
                      when q.retryable > 0 then
                        case when q.processed + q.rejected > 0
                          then 'partially_succeeded' else 'failed' end
                      when q.rejected > 0 then 'partially_succeeded'
                      else 'succeeded'
                    end,
                    error_summary = coalesce(r.error_summary, '{}'::jsonb) || jsonb_build_object(
                      'reconciled_at', clock_timestamp(),
                      'conflicts', q.conflicts,
                      'dead_letters', q.dead_letters,
                      'retryable', q.retryable
                    )
                from (
                  select i.sync_run_id,
                         count(*) received,
                         count(*) filter (where i.state = 'processed') processed,
                         count(*) filter (where i.state in ('conflict', 'dead_letter')) rejected,
                         count(*) filter (where i.state = 'conflict') conflicts,
                         count(*) filter (where i.state = 'dead_letter') dead_letters,
                         count(*) filter (where i.state in ('pending', 'processing', 'failed')) retryable
                  from roadops.integration_inbox i
                  where i.sync_run_id is not null
                  group by i.sync_run_id
                ) q
                where r.id = q.sync_run_id and r.status <> 'running'
            SQL,
        );
        $this->info(sprintf(
            'Recovered inbox=%d outbox=%d sync_runs=%d; processed=%d conflicts=%d dead_letters=%d retryable=%d.',
            $recoveredInbox,
            $recoveredOutbox,
            $staleRuns,
            $counts['processed'],
            $counts['conflict'],
            $counts['dead_letter'],
            $counts['failed'] + $counts['pending'],
        ));

        return ($counts['failed'] + $counts['pending'] + $counts['conflict'] + $counts['dead_letter']) > 0
            ? self::FAILURE
            : self::SUCCESS;
    }
}
