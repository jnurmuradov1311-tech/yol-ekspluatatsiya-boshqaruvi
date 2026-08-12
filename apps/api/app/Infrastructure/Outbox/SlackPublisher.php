<?php

namespace App\Infrastructure\Outbox;

use App\Domain\Outbox\OutboxPublisher;
use App\Support\HttpsEndpoint;
use Illuminate\Http\Client\Factory as HttpFactory;

final class SlackPublisher implements OutboxPublisher
{
    public function __construct(private readonly HttpFactory $http) {}

    public function supports(string $destination): bool
    {
        return strtolower($destination) === 'slack';
    }

    public function publish(string $eventId, string $eventKind, array $payload): void
    {
        try {
            $url = HttpsEndpoint::slackWebhook(config('services.slack.webhook_url'));
        } catch (\InvalidArgumentException $exception) {
            throw new \RuntimeException('Slack publisher is CONFIGURATION_REQUIRED: webhook_url_invalid.', previous: $exception);
        }
        $text = trim((string) ($payload['message'] ?? ''));
        if ($text === '') {
            throw new \InvalidArgumentException('Slack outbox payload has no message.');
        }

        $this->http->asJson()->timeout(10)->retry(3, 500, throw: false)->post($url, [
            'text' => $text,
            'unfurl_links' => false,
            'unfurl_media' => false,
        ])->throw();
    }
}
