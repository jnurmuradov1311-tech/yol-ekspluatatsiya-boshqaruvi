<?php

namespace App\Infrastructure\Integrations;

use App\Domain\Integrations\IntegrationInbox;
use App\Domain\Integrations\SourceSystem;
use App\Domain\Integrations\SyncAdapter;
use App\Support\HttpsEndpoint;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\Facades\DB;

final class RoadVisionHttpAdapter implements SyncAdapter
{
    private const MAX_PAGE_BYTES = 67_108_864;

    public function __construct(
        private readonly HttpFactory $http,
        private readonly IntegrationInbox $inbox,
    ) {}

    public function source(): SourceSystem
    {
        return SourceSystem::ROADVISION;
    }

    public function missingConfiguration(): array
    {
        $config = (array) config('roadops.integrations.roadvision');
        $missing = [];
        foreach (['api_url', 'client_id', 'client_secret'] as $key) {
            if (trim((string) ($config[$key] ?? '')) === '') {
                $missing[] = $key;
            }
        }
        if (! in_array('api_url', $missing, true)) {
            try {
                HttpsEndpoint::baseApi($config['api_url'] ?? null, 'RoadVision API URL');
            } catch (\InvalidArgumentException) {
                $missing[] = 'api_url_invalid';
            }
        }

        return array_values($missing);
    }

    public function fetch(?string $cursor, ?string $syncRunId = null): array
    {
        if ($this->missingConfiguration() !== []) {
            throw new \RuntimeException('RoadVision vendor API is CONFIGURATION_REQUIRED.');
        }

        $config = (array) config('roadops.integrations.roadvision');
        $apiUrl = HttpsEndpoint::baseApi($config['api_url'] ?? null, 'RoadVision API URL');
        $tokenResponse = $this->http->asForm()->timeout(15)->retry(3, 500, throw: false)->post(
            $apiUrl.'/oauth/token',
            [
                'grant_type' => 'client_credentials',
                'client_id' => $config['client_id'],
                'client_secret' => $config['client_secret'],
            ],
        )->throw();
        $token = (string) $tokenResponse->json('access_token');
        if ($token === '') {
            throw new \RuntimeException('RoadVision OAuth response has no access_token.');
        }

        $response = $this->http->withToken($token)->acceptJson()->timeout(30)->retry(3, 750, throw: false)->get(
            $apiUrl.'/v1/detections',
            array_filter(['cursor' => $cursor, 'limit' => 250], static fn (mixed $value): bool => $value !== null),
        )->throw();
        if (strlen($response->body()) > self::MAX_PAGE_BYTES) {
            throw new \UnexpectedValueException('RoadVision page exceeds the 64 MiB ingestion limit.');
        }
        $events = $response->json('events');
        if (! is_array($events) || ! array_is_list($events)) {
            throw new \UnexpectedValueException('RoadVision response must contain events[].');
        }
        $nextCursor = $response->json('next_cursor');
        if ($events !== [] && (! is_string($nextCursor) || trim($nextCursor) === '')) {
            throw new \UnexpectedValueException('RoadVision non-empty detection page must contain next_cursor.');
        }
        if ($events !== [] && $cursor !== null && hash_equals($cursor, (string) $nextCursor)) {
            throw new \UnexpectedValueException('RoadVision non-empty detection page did not advance next_cursor.');
        }

        $received = 0;
        $duplicates = 0;
        [$received, $duplicates] = DB::connection('pgsql_sync')->transaction(
            function () use ($events, $syncRunId): array {
                $received = 0;
                $duplicates = 0;
                foreach ($events as $event) {
                    if (! is_array($event) || ($event !== [] && array_is_list($event))) {
                        throw new \UnexpectedValueException('RoadVision event must be an object.');
                    }
                    $encoded = json_encode($event, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                    $result = $this->inbox->receive(
                        SourceSystem::ROADVISION->value,
                        $event,
                        hash('sha256', $encoded),
                        $syncRunId,
                        ['transport' => 'https', 'endpoint' => '/v1/detections'],
                    );
                    $result['duplicate'] ? $duplicates++ : $received++;
                }

                return [$received, $duplicates];
            },
        );

        return [
            'received' => $received,
            'duplicate' => $duplicates,
            'next_cursor' => is_string($nextCursor) && trim($nextCursor) !== '' ? $nextCursor : $cursor,
        ];
    }
}
