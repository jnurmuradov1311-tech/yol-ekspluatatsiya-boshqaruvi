<?php

namespace App\Console\Commands;

use App\Domain\Integrations\SourceSystem;
use App\Jobs\SyncSourceJob;
use Illuminate\Console\Command;

final class SyncSourceCommand extends Command
{
    protected $signature = 'roadops:sync {source : ytp or roadvision} {--now : Run synchronously}';

    protected $description = 'Fetches one external source through its configured idempotent adapter.';

    public function handle(): int
    {
        $source = match (strtolower((string) $this->argument('source'))) {
            'ytp' => SourceSystem::YTP,
            'roadvision' => SourceSystem::ROADVISION,
            default => null,
        };
        if ($source === null) {
            $this->error('Source must be ytp or roadvision.');

            return self::INVALID;
        }

        if ($this->option('now')) {
            SyncSourceJob::dispatchSync($source);
        } else {
            SyncSourceJob::dispatch($source);
        }
        $this->info($source->value.' sync accepted.');

        return self::SUCCESS;
    }
}
