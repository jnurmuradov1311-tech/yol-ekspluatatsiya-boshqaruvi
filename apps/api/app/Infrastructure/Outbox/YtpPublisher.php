<?php

namespace App\Infrastructure\Outbox;

use App\Domain\Outbox\OutboxPublisher;
use App\Support\HttpsEndpoint;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\Facades\DB;

final class YtpPublisher implements OutboxPublisher
{
    public function __construct(private readonly HttpFactory $http) {}

    public function supports(string $destination): bool
    {
        return strtolower($destination) === 'road_repair';
    }

    public function publish(string $eventId, string $eventKind, array $payload): void
    {
        $config = (array) config('roadops.integrations.ytp');
        foreach (['base_url', 'client_id', 'client_secret'] as $key) {
            if (trim((string) ($config[$key] ?? '')) === '') {
                throw new \RuntimeException('YTP outbound publisher is CONFIGURATION_REQUIRED.');
            }
        }
        try {
            $base = HttpsEndpoint::baseApi($config['base_url'] ?? null, 'YTP base URL');
        } catch (\InvalidArgumentException $exception) {
            throw new \RuntimeException('YTP outbound publisher is CONFIGURATION_REQUIRED: base_url_invalid.', previous: $exception);
        }

        $approvedConnections = (int) DB::connection('pgsql_sync')->scalar(
            <<<'SQL'
                select count(*)
                from roadops.integration_connections c
                join roadops.source_systems s on s.id=c.source_system_id
                where s.system_kind='road_repair' and s.enabled and c.enabled
                  and c.configuration->>'contract_approved'='true'
                  and c.configuration->>'contract_sha256' ~ '^[a-f0-9]{64}$'
            SQL,
        );
        if ($approvedConnections !== 1) {
            throw new \RuntimeException('YTP outbound publisher is CONTRACT_APPROVAL_REQUIRED.');
        }
        $token = (string) $this->http->asForm()->timeout(15)->post($base.'/oauth/token', [
            'grant_type' => 'client_credentials',
            'client_id' => $config['client_id'],
            'client_secret' => $config['client_secret'],
        ])->throw()->json('access_token');
        if ($token === '') {
            throw new \RuntimeException('YTP OAuth response has no access_token.');
        }

        $this->http->withToken($token)->withHeaders([
            'Idempotency-Key' => $eventId,
        ])->asJson()->timeout(20)->retry(3, 500, throw: false)->post(
            $base.'/v1/roadops-events',
            ['eventId' => $eventId, 'eventType' => $eventKind, 'payload' => $payload],
        )->throw();
    }
}
