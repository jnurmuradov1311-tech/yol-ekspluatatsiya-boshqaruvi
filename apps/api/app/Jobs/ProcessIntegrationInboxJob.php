<?php

namespace App\Jobs;

use App\Domain\Integrations\IntegrationInboxProcessor;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

final class ProcessIntegrationInboxJob implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 8;

    public int $uniqueFor = 7200;

    /** @var list<int> */
    public array $backoff = [15, 30, 120, 300, 900, 1800, 3600];

    public function __construct(public readonly string $inboxId)
    {
        $this->onConnection('redis_integrations');
        $this->onQueue('integrations');
    }

    public function handle(IntegrationInboxProcessor $processor): void
    {
        $result = $processor->process($this->inboxId);
        if ($result['retryable']) {
            throw new \RuntimeException(
                'Integration inbox apply failed and will be retried: '.($result['error'] ?? 'unknown error'),
            );
        }
    }

    public function uniqueId(): string
    {
        return $this->inboxId;
    }
}
