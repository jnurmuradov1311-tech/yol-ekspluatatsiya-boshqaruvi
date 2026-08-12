<?php

namespace App\Providers;

use App\Domain\Integrations\SyncAdapter;
use App\Infrastructure\Integrations\RoadVisionHttpAdapter;
use App\Infrastructure\Integrations\RoadVisionS3ManifestAdapter;
use App\Infrastructure\Integrations\YtpHttpAdapter;
use App\Infrastructure\Outbox\EmailPublisher;
use App\Infrastructure\Outbox\SlackPublisher;
use App\Infrastructure\Outbox\YtpPublisher;
use Illuminate\Support\ServiceProvider;

final class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->tag([YtpHttpAdapter::class, RoadVisionHttpAdapter::class, RoadVisionS3ManifestAdapter::class], 'roadops.sync-adapters');
        $this->app->bind('roadops.ytp-adapter', YtpHttpAdapter::class);
        $this->app->bind('roadops.roadvision-adapter', function ($app): SyncAdapter {
            return config('roadops.integrations.roadvision.mode') === 'vendor_api'
                ? $app->make(RoadVisionHttpAdapter::class)
                : $app->make(RoadVisionS3ManifestAdapter::class);
        });
        $this->app->tag(
            [SlackPublisher::class, EmailPublisher::class, YtpPublisher::class],
            'roadops.outbox-publishers',
        );
    }

    public function boot(): void
    {
        // Domain bootstrapping is intentionally explicit in jobs and controllers.
    }
}
