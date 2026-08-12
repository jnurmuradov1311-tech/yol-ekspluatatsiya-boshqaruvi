<?php

namespace App\Console\Commands;

use App\Jobs\DispatchOutboxJob;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class DispatchOutboxCommand extends Command
{
    protected $signature = 'roadops:dispatch-outbox {--limit=100}';

    protected $description = 'Queues pending transactional outbox records.';

    public function handle(): int
    {
        $limit = max(1, min(500, (int) $this->option('limit')));
        $rows = DB::connection('pgsql_sync')->select(
            <<<'SQL'
                select id from roadops.integration_outbox
                where state in ('pending', 'failed') and available_at <= now()
                order by available_at, created_at
                limit ?
            SQL,
            [$limit],
        );
        foreach ($rows as $row) {
            DispatchOutboxJob::dispatch((string) $row->id);
        }
        $this->info(count($rows).' outbox record(s) queued.');

        return self::SUCCESS;
    }
}
