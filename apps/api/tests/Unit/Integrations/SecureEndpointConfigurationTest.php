<?php

namespace Tests\Unit\Integrations;

use App\Console\Commands\ConfigureIntegrationCommand;
use App\Infrastructure\Integrations\RoadVisionHttpAdapter;
use App\Infrastructure\Integrations\YtpHttpAdapter;
use App\Infrastructure\Outbox\SlackPublisher;
use App\Infrastructure\Outbox\YtpPublisher;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;

final class SecureEndpointConfigurationTest extends TestCase
{
    public function test_sync_adapters_report_invalid_urls_and_never_make_a_request(): void
    {
        config()->set('roadops.integrations.ytp', [
            'base_url' => 'http://ytp.example.test',
            'client_id' => 'client',
            'client_secret' => 'secret',
        ]);
        config()->set('roadops.integrations.roadvision', [
            'api_url' => 'https://roadvision.example.test/api?tenant=one',
            'client_id' => 'client',
            'client_secret' => 'secret',
        ]);
        Http::fake();

        $ytp = $this->app->make(YtpHttpAdapter::class);
        self::assertSame(['base_url_invalid'], $ytp->missingConfiguration());
        try {
            $ytp->fetch(null);
            self::fail('YTP attempted to use an invalid endpoint.');
        } catch (\RuntimeException $exception) {
            self::assertStringContainsString('CONFIGURATION_REQUIRED', $exception->getMessage());
        }

        $roadVision = $this->app->make(RoadVisionHttpAdapter::class);
        self::assertSame(['api_url_invalid'], $roadVision->missingConfiguration());
        try {
            $roadVision->fetch(null);
            self::fail('RoadVision attempted to use an invalid endpoint.');
        } catch (\RuntimeException $exception) {
            self::assertStringContainsString('CONFIGURATION_REQUIRED', $exception->getMessage());
        }

        Http::assertNothingSent();
    }

    public function test_publishers_reject_invalid_endpoints_before_database_or_http_io(): void
    {
        config()->set('roadops.integrations.ytp', [
            'base_url' => 'https://client:secret@ytp.example.test',
            'client_id' => 'client',
            'client_secret' => 'secret',
        ]);
        config()->set('services.slack.webhook_url', 'https://attacker.example.test/services/T/B/secret');
        DB::shouldReceive('connection')->never();
        Http::fake();

        try {
            $this->app->make(YtpPublisher::class)->publish('event-1', 'work_order.created', []);
            self::fail('YTP publisher accepted an invalid endpoint.');
        } catch (\RuntimeException $exception) {
            self::assertStringContainsString('base_url_invalid', $exception->getMessage());
        }

        try {
            $this->app->make(SlackPublisher::class)->publish(
                'event-2',
                'plan.blocked',
                ['message' => 'Plan blocked'],
            );
            self::fail('Slack publisher accepted an invalid endpoint.');
        } catch (\RuntimeException $exception) {
            self::assertStringContainsString('webhook_url_invalid', $exception->getMessage());
        }

        Http::assertNothingSent();
    }

    public function test_slack_publisher_can_send_to_an_official_webhook_url(): void
    {
        config()->set('services.slack.webhook_url', 'https://hooks.slack.com/services/T000/B000/secret');
        Http::fake(['https://hooks.slack.com/services/*' => Http::response('ok')]);

        $this->app->make(SlackPublisher::class)->publish(
            'event-1',
            'plan.blocked',
            ['message' => 'Plan blocked'],
        );

        Http::assertSentCount(1);
        Http::assertSent(static fn ($request): bool => $request->url() === 'https://hooks.slack.com/services/T000/B000/secret');
    }

    public function test_configure_command_refuses_invalid_https_endpoint_without_database_io(): void
    {
        config()->set('roadops.integrations.ytp.base_url', 'http://ytp.example.test');
        DB::shouldReceive('connection')->never();

        $command = $this->app->make(ConfigureIntegrationCommand::class);
        $command->setLaravel($this->app);
        $tester = new CommandTester($command);
        $status = $tester->execute(['source' => 'ytp']);

        self::assertSame(Command::INVALID, $status);
        self::assertStringContainsString('absolute HTTPS URL', $tester->getDisplay());
    }
}
