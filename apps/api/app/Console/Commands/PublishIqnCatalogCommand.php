<?php

namespace App\Console\Commands;

use App\Domain\Norms\IqnCatalogPublisher;
use Illuminate\Console\Command;

final class PublishIqnCatalogCommand extends Command
{
    protected $signature = 'roadops:iqn-publish
        {batch : Staged IQN import batch UUID}
        {review-manifest : Path to the complete expert review JSON}
        {--reviewed-by= : Active expert app_user UUID}';

    protected $description = 'Publishes only a completely and explicitly expert-reviewed IQN staging batch.';

    public function handle(IqnCatalogPublisher $publisher): int
    {
        $reviewedBy = trim((string) $this->option('reviewed-by'));
        if (! preg_match('/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i', $reviewedBy)) {
            $this->error('--reviewed-by must be a valid active app_user UUID.');

            return self::INVALID;
        }
        try {
            $documentId = $publisher->publish(
                (string) $this->argument('batch'),
                (string) $this->argument('review-manifest'),
                $reviewedBy,
            );
        } catch (\Throwable $exception) {
            $this->error('IQN catalog was not published: '.$exception->getMessage());

            return self::FAILURE;
        }

        $this->info("IQN catalog published as document {$documentId} from explicit expert decisions.");

        return self::SUCCESS;
    }
}
