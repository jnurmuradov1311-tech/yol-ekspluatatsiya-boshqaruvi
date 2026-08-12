<?php

namespace App\Infrastructure\Integrations;

use App\Domain\Integrations\ExternalEventContractValidator;
use App\Domain\Integrations\IntegrationInbox;
use App\Domain\Integrations\SourceSystem;
use App\Domain\Integrations\SyncAdapter;
use Aws\S3\S3Client;
use Illuminate\Support\Facades\DB;

final class RoadVisionS3ManifestAdapter implements SyncAdapter
{
    private const MAX_MANIFEST_BYTES = 134_217_728;

    public function __construct(
        private readonly IntegrationInbox $inbox,
        private readonly ExternalEventContractValidator $validator,
    ) {}

    public function source(): SourceSystem
    {
        return SourceSystem::ROADVISION;
    }

    public function missingConfiguration(): array
    {
        $config = (array) config('roadops.integrations.roadvision');
        $missing = [];
        foreach (['s3_bucket', 's3_region', 'manifest_canonicalization'] as $key) {
            if (trim((string) ($config[$key] ?? '')) === '') {
                $missing[] = $key;
            }
        }

        return $missing;
    }

    public function fetch(?string $cursor, ?string $syncRunId = null): array
    {
        if ($this->missingConfiguration() !== []) {
            throw new \RuntimeException('RoadVision S3 manifest integration is CONFIGURATION_REQUIRED.');
        }
        $config = (array) config('roadops.integrations.roadvision');
        $client = new S3Client([
            'version' => 'latest',
            'region' => $config['s3_region'],
        ]);
        $list = $client->listObjectsV2(array_filter([
            'Bucket' => $config['s3_bucket'],
            'Prefix' => $config['s3_prefix'] ?? 'results/',
            'StartAfter' => $cursor,
            // One manifest/object per job keeps S3 sync work bounded. The
            // committed object key is the cursor for the next scheduled run.
            'MaxKeys' => 1,
        ], static fn (mixed $value): bool => $value !== null && $value !== ''));

        $received = 0;
        $duplicates = 0;
        $lastKey = $cursor;
        foreach ($list['Contents'] ?? [] as $object) {
            $key = (string) ($object['Key'] ?? '');
            if ($key === '') {
                continue;
            }
            // The cursor must move past every listed object, including non-JSON
            // artifacts, otherwise a page containing only media repeats forever.
            $lastKey = $key;
            if (! str_ends_with(strtolower($key), '.json')) {
                continue;
            }
            if ((int) ($object['Size'] ?? 0) > self::MAX_MANIFEST_BYTES) {
                throw new \UnexpectedValueException('RoadVision manifest exceeds the 128 MiB ingestion limit.');
            }
            $item = $client->getObject(['Bucket' => $config['s3_bucket'], 'Key' => $key]);
            $body = (string) $item['Body'];
            if (strlen($body) > self::MAX_MANIFEST_BYTES) {
                throw new \UnexpectedValueException('RoadVision manifest exceeds the 128 MiB ingestion limit.');
            }
            $manifest = json_decode($body, true, 128, JSON_THROW_ON_ERROR);
            if (! is_array($manifest) || ($manifest !== [] && array_is_list($manifest))) {
                throw new \UnexpectedValueException('RoadVision manifest must be a JSON object.');
            }
            /** @var array<string, mixed> $manifest */
            $this->validateManifest($manifest);
            // The proposal explicitly leaves manifest canonicalization undefined.
            // Enabling the feed without an approved algorithm would make the
            // advertised manifest_sha256 unverifiable, so production stays closed.
            $canonicalization = trim((string) ($config['manifest_canonicalization'] ?? ''));
            if ($canonicalization !== 'json_preserve_order_without_manifest_sha256_v1') {
                throw new \RuntimeException(
                    'RoadVision manifest checksum canonicalization is CONTRACT_APPROVAL_REQUIRED.',
                );
            }
            $canonical = $manifest;
            unset($canonical['manifest_sha256']);
            $canonicalBytes = json_encode(
                $canonical,
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
                  | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR,
            );
            if (! hash_equals((string) $manifest['manifest_sha256'], hash('sha256', $canonicalBytes))) {
                throw new \UnexpectedValueException('RoadVision manifest_sha256 verification failed.');
            }
            /** @var list<array<string, mixed>> $events */
            $events = $manifest['events'];
            // Validate the complete wrapper before persisting its first event.
            // A bad event near the end must not leave a partially accepted
            // manifest that can never advance its source cursor.
            foreach ($events as $event) {
                $this->validator->validate(SourceSystem::ROADVISION->value, $event);
            }
            [$manifestReceived, $manifestDuplicates] = DB::connection('pgsql_sync')->transaction(
                function () use ($events, $syncRunId, $config, $key, $object, $manifest): array {
                    $accepted = 0;
                    $duplicates = 0;
                    foreach ($events as $event) {
                        $encoded = json_encode($event, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
                        $result = $this->inbox->receive(
                            SourceSystem::ROADVISION->value,
                            $event,
                            hash('sha256', $encoded),
                            $syncRunId,
                            [
                                'transport' => 's3_manifest',
                                'bucket' => (string) $config['s3_bucket'],
                                'key' => $key,
                                'etag' => trim((string) ($object['ETag'] ?? ''), '"'),
                                'manifest_id' => (string) $manifest['manifest_id'],
                                'manifest_sha256' => (string) $manifest['manifest_sha256'],
                                'generated_at' => (string) $manifest['generated_at'],
                            ],
                        );
                        $result['duplicate'] ? $duplicates++ : $accepted++;
                    }

                    return [$accepted, $duplicates];
                },
            );
            $received += $manifestReceived;
            $duplicates += $manifestDuplicates;
        }

        return ['received' => $received, 'duplicate' => $duplicates, 'next_cursor' => $lastKey];
    }

    /** @param array<string, mixed> $manifest */
    private function validateManifest(array $manifest): void
    {
        $required = ['manifest_id', 'schema_version', 'generated_at', 'events', 'manifest_sha256'];
        $allowed = array_flip([...$required, 'previous_manifest_id']);
        foreach ($required as $key) {
            if (! array_key_exists($key, $manifest)) {
                throw new \UnexpectedValueException("RoadVision manifest {$key} is required.");
            }
        }
        foreach (array_keys($manifest) as $key) {
            if (! is_string($key) || ! isset($allowed[$key])) {
                throw new \UnexpectedValueException('RoadVision manifest contains an unapproved property.');
            }
        }
        if (! is_string($manifest['manifest_id'])
            || trim($manifest['manifest_id']) === ''
            || mb_strlen($manifest['manifest_id']) > 200) {
            throw new \UnexpectedValueException('RoadVision manifest_id is invalid.');
        }
        if ($manifest['schema_version'] !== '1.0.0') {
            throw new \UnexpectedValueException('RoadVision manifest schema_version is unsupported.');
        }
        if (! is_string($manifest['generated_at'])
            || ! preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/', $manifest['generated_at'])) {
            throw new \UnexpectedValueException('RoadVision manifest generated_at is invalid.');
        }
        try {
            new \DateTimeImmutable($manifest['generated_at']);
        } catch (\Throwable) {
            throw new \UnexpectedValueException('RoadVision manifest generated_at is invalid.');
        }
        if (! is_array($manifest['events']) || ! array_is_list($manifest['events'])
            || count($manifest['events']) < 1 || count($manifest['events']) > 10000) {
            throw new \UnexpectedValueException('RoadVision manifest events[] is invalid.');
        }
        foreach ($manifest['events'] as $event) {
            if (! is_array($event) || ($event !== [] && array_is_list($event))) {
                throw new \UnexpectedValueException('Every RoadVision manifest event must be an object.');
            }
        }
        if (! is_string($manifest['manifest_sha256'])
            || ! preg_match('/^[a-f0-9]{64}$/', $manifest['manifest_sha256'])) {
            throw new \UnexpectedValueException('RoadVision manifest_sha256 is invalid.');
        }
        if (array_key_exists('previous_manifest_id', $manifest)
            && $manifest['previous_manifest_id'] !== null
            && (! is_string($manifest['previous_manifest_id'])
                || mb_strlen($manifest['previous_manifest_id']) > 200)) {
            throw new \UnexpectedValueException('RoadVision previous_manifest_id is invalid.');
        }
    }
}
