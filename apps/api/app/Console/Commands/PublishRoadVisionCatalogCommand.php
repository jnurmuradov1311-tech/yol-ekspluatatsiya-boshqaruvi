<?php

namespace App\Console\Commands;

use App\Domain\Norms\RoadVisionCatalogPublisher;
use Illuminate\Console\Command;

final class PublishRoadVisionCatalogCommand extends Command
{
    protected $signature = 'roadops:roadvision-catalog:publish
        {batch : Validated RoadVision catalog batch UUID}
        {classification-manifest : Path to the complete expert classification JSON}
        {--reviewed-by= : Active expert app_user UUID}';

    protected $description = 'Publishes a RoadVision catalog only after complete explicit classification and collision checks.';

    public function handle(RoadVisionCatalogPublisher $publisher): int
    {
        $reviewedBy = trim((string) $this->option('reviewed-by'));
        if (! preg_match('/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i', $reviewedBy)) {
            $this->error('--reviewed-by must be a valid active app_user UUID.');

            return self::INVALID;
        }
        try {
            $result = $publisher->publish(
                (string) $this->argument('batch'),
                (string) $this->argument('classification-manifest'),
                $reviewedBy,
            );
        } catch (\Throwable $exception) {
            $this->error('RoadVision catalog was not published: '.$exception->getMessage());

            return self::FAILURE;
        }
        $this->info(sprintf(
            'RoadVision catalog revision %s published with %d explicit classifications.',
            $result['revision'],
            $result['published_count'],
        ));

        return self::SUCCESS;
    }
}
