<?php

namespace App\Console\Commands;

use App\Domain\Norms\IqnCatalogPublisher;
use Illuminate\Console\Command;

final class PublishIqnCatalogCommand extends Command
{
    protected $signature = 'roadops:iqn-publish
        {batch : IQN batch with a persisted authenticated expert approval}';

    protected $description = 'Consumes a persisted authenticated expert approval and publishes its exact IQN batch.';

    public function handle(IqnCatalogPublisher $publisher): int
    {
        try {
            $documentId = $publisher->publish((string) $this->argument('batch'));
        } catch (\Throwable $exception) {
            $this->error('IQN catalog was not published: '.$exception->getMessage());

            return self::FAILURE;
        }

        $this->info("IQN catalog published as document {$documentId} from explicit expert decisions.");

        return self::SUCCESS;
    }
}
