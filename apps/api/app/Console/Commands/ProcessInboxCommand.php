<?php

namespace App\Console\Commands;

use App\Domain\Integrations\IntegrationInboxProcessor;
use Illuminate\Console\Command;

final class ProcessInboxCommand extends Command
{
    protected $signature = 'roadops:process-inbox {--limit=1000} {--run-id=}';

    protected $description = 'Validates and applies queued external integration events.';

    public function handle(IntegrationInboxProcessor $processor): int
    {
        $limit = max(1, min(25000, (int) $this->option('limit')));
        $runId = trim((string) $this->option('run-id')) ?: null;
        $counts = $processor->processPending($runId, $limit);
        $this->line(json_encode($counts, JSON_THROW_ON_ERROR));

        return ($counts['failed'] + $counts['dead_letter']) > 0
            ? self::FAILURE
            : self::SUCCESS;
    }
}
