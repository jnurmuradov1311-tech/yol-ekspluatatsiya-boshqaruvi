<?php

namespace App\Domain\Integrations;

use Illuminate\Database\Connection;
use stdClass;

final class RoadVisionFindingProjector
{
    /** @param array<string, mixed> $envelope */
    public function apply(Connection $db, stdClass $inbox, array $envelope): void
    {
        /** @var array<string, mixed> $payload */
        $payload = $envelope['payload'];
        if ($envelope['event_type'] === 'roadvision.finding.withdrawn') {
            $this->withdraw($db, $inbox, $payload);

            return;
        }
        $this->observe($db, $inbox, $payload);
    }

    /** @param array<string, mixed> $payload */
    private function observe(Connection $db, stdClass $inbox, array $payload): void
    {
        $sourceId = (string) $inbox->source_system_id;
        $externalId = (string) $payload['vendor_finding_id'];
        $revision = (string) $payload['source_revision'];
        $hash = (string) $inbox->payload_hash;
        $observedAt = (string) $payload['observed_at'];

        $existing = $db->selectOne(
            <<<'SQL'
                select id, encode(payload_hash, 'hex') payload_hash
                from roadops.roadvision_candidates
                where source_system_id = ? and external_candidate_id = ? and source_revision = ?
            SQL,
            [$sourceId, $externalId, $revision],
        );
        if ($existing !== null) {
            if (! hash_equals((string) $existing->payload_hash, $hash)) {
                throw new IntegrationApplyConflict(
                    'ROADVISION_REVISION_REUSED_WITH_DIFFERENT_PAYLOAD',
                    'ROADVISION_FINDING', $externalId,
                    'RoadVision reused a finding revision with different bytes.',
                    ['payload_hash' => $hash],
                    ['payload_hash' => (string) $existing->payload_hash],
                );
            }

            return;
        }

        $catalog = $db->selectOne(
            <<<'SQL'
                select ac.id, ac.record_kind, ac.defect_type_id
                from roadops.roadvision_attribute_catalog ac
                where ac.source_system_id = ? and ac.catalog_revision = ?
                  and ac.external_code = ? and ac.active_from <= ?::timestamptz::date
                  and (ac.active_until is null or ac.active_until > ?::timestamptz::date)
            SQL,
            [$sourceId, $payload['attribute_revision'], $payload['attribute_code'], $observedAt, $observedAt],
        );
        if ($catalog === null) {
            throw new IntegrationApplyConflict(
                'ROADVISION_ATTRIBUTE_CATALOG_MISSING',
                'ROADVISION_ATTRIBUTE',
                (string) $payload['attribute_code'],
                'RoadVision attribute code/revision is not in the approved effective catalog.',
                [
                    'attribute_code' => $payload['attribute_code'],
                    'attribute_revision' => $payload['attribute_revision'],
                    'observed_at' => $observedAt,
                ],
            );
        }
        if ((string) $catalog->record_kind !== 'defect_candidate') {
            throw new IntegrationApplyConflict(
                'ROADVISION_ATTRIBUTE_NOT_A_DEFECT',
                'ROADVISION_ATTRIBUTE',
                (string) $payload['attribute_code'],
                'The approved RoadVision attribute is not mapped to a defect-candidate workflow.',
                [
                    'attribute_code' => $payload['attribute_code'],
                    'attribute_revision' => $payload['attribute_revision'],
                ],
                ['record_kind' => (string) $catalog->record_kind],
            );
        }
        [$evidenceUri, $evidenceType] = $this->approvedEvidence($payload);
        $road = $this->road($db, $payload['ytp_road_external_id'] ?? null, $observedAt);
        [$chainageFrom, $chainageTo] = $this->chainage($payload);
        $chainageUsable = $road !== null
            && $road->length_m !== null
            && $chainageFrom !== null
            && $chainageTo !== null
            && $chainageTo <= (float) $road->length_m;
        $chainageSpan = $chainageUsable ? [$chainageFrom, $chainageTo] : null;
        $status = 'unmatched';
        if ($chainageUsable) {
            $owner = $db->scalar(
                <<<'SQL'
                    select roadops.division_for_road_zone(
                      ?, numrange(?::numeric, ?::numeric, '[)'), ?::timestamptz
                    )
                SQL,
                [$road->id, $chainageFrom, $chainageTo, $observedAt],
            );
            if ($owner !== null) {
                $status = 'awaiting_verification';
            }
        }

        $context = is_string($inbox->transport_context)
            ? json_decode($inbox->transport_context, true, 64, JSON_THROW_ON_ERROR)
            : (array) $inbox->transport_context;
        // An S3 manifest is the batch boundary.  HTTP/webhook events have no
        // vendor-approved batch contract, so use the immutable event id rather
        // than capture_id: one capture may legitimately contain many findings
        // with different payload hashes.
        $batchExternalId = trim((string) ($context['manifest_id'] ?? $inbox->external_event_id));
        $manifestHash = strtolower((string) ($context['manifest_sha256'] ?? $hash));
        if (! preg_match('/^[a-f0-9]{64}$/', $manifestHash)) {
            throw new ContractViolation('MANIFEST_HASH_INVALID', 'RoadVision transport manifest hash is invalid.');
        }
        $batch = $db->selectOne(
            <<<'SQL'
                insert into roadops.roadvision_batches
                  (source_system_id, external_batch_id, inbox_id, captured_from, captured_until,
                   manifest_hash, state, validation_result)
                values (?, ?, ?, ?::timestamptz, ?::timestamptz, decode(?, 'hex'),
                        'validated', ?::jsonb)
                on conflict (source_system_id, external_batch_id) do update
                set captured_from = least(roadops.roadvision_batches.captured_from, excluded.captured_from),
                    captured_until = greatest(roadops.roadvision_batches.captured_until, excluded.captured_until),
                    state = 'validated'
                where roadops.roadvision_batches.manifest_hash = excluded.manifest_hash
                returning id
            SQL,
            [
                $sourceId, $batchExternalId, $inbox->id, $observedAt, $observedAt,
                $manifestHash,
                json_encode([
                    'contract_schema_version' => '1.0.0',
                    'manifest_id' => $context['manifest_id'] ?? null,
                    'transport' => $context['transport'] ?? 'webhook_or_http',
                ], JSON_THROW_ON_ERROR),
            ],
        );
        if ($batch === null) {
            throw new IntegrationApplyConflict(
                'ROADVISION_BATCH_HASH_CONFLICT', 'ROADVISION_BATCH', $batchExternalId,
                'RoadVision batch/manifest identifier was reused with a different manifest hash.',
            );
        }

        $superseded = $db->selectOne(
            <<<'SQL'
                select id, status, source_revision, observed_at
                from roadops.roadvision_candidates
                where source_system_id = ? and external_candidate_id = ?
                  and status <> 'superseded'
                for update
            SQL,
            [$sourceId, $externalId],
        );
        if ($superseded !== null) {
            if (strtotime($observedAt) < strtotime((string) $superseded->observed_at)) {
                throw new IntegrationApplyConflict(
                    'ROADVISION_REVISION_OUT_OF_ORDER',
                    'ROADVISION_FINDING',
                    $externalId,
                    'RoadVision revision observation time is older than the active revision.',
                    ['source_revision' => $revision, 'observed_at' => $observedAt],
                    [
                        'source_revision' => (string) $superseded->source_revision,
                        'observed_at' => (string) $superseded->observed_at,
                    ],
                );
            }
            $db->update(
                "update roadops.roadvision_candidates set status = 'superseded' where id = ?",
                [$superseded->id],
            );
            $db->statement(
                <<<'SQL'
                    insert into roadops.roadvision_candidate_events
                      (candidate_id, from_status, to_status, event_code, details)
                    values (?, ?, 'superseded', 'source_revision_superseded', ?::jsonb)
                SQL,
                [
                    $superseded->id,
                    $superseded->status,
                    json_encode([
                        'previous_source_revision' => (string) $superseded->source_revision,
                        'replacement_source_revision' => $revision,
                    ], JSON_THROW_ON_ERROR),
                ],
            );
        }

        /** @var list<array<string, mixed>> $media */
        $media = $payload['media'];
        $coordinates = $payload['location']['coordinates'];
        $candidate = $db->selectOne(
            <<<'SQL'
                insert into roadops.roadvision_candidates
                  (source_system_id, batch_id, external_candidate_id, source_revision,
                   attribute_catalog_id, observed_at, latitude, longitude,
                   evidence_reference, evidence_media_type, evidence, payload_hash,
                   road_id, defect_type_id, chainage_span, direction, lane_label, status)
                values (?, ?, ?, ?, ?, ?::timestamptz, ?::numeric, ?::numeric,
                        ?, ?, ?::jsonb, decode(?, 'hex'), ?::uuid, ?,
                        case when ? then numrange(?::numeric, ?::numeric, '[)') else null end,
                        ?, ?, ?)
                returning id
            SQL,
            [
                $sourceId, $batch->id, $externalId, $revision, $catalog->id,
                $observedAt, $coordinates[1], $coordinates[0], $evidenceUri, $evidenceType,
                json_encode($media, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), $hash,
                $road?->id, $catalog->defect_type_id, $chainageSpan !== null,
                $chainageFrom, $chainageTo,
                $payload['direction'] ?? null, $payload['lane_label'] ?? null, $status,
            ],
        );
        $db->statement(
            <<<'SQL'
                insert into roadops.roadvision_candidate_events
                  (candidate_id, from_status, to_status, event_code, details)
                values (?, null, ?, 'source_observed', ?::jsonb)
            SQL,
            [
                $candidate->id,
                $status,
                json_encode([
                    'source_revision' => $revision,
                    'road_match' => $road === null ? 'missing' : 'found',
                    'chainage_match' => $chainageSpan === null ? 'missing_or_invalid' : 'source_supplied',
                    'catalog_match' => (string) $catalog->record_kind,
                ], JSON_THROW_ON_ERROR),
            ],
        );
        $db->update(
            "update roadops.roadvision_batches set state = 'imported' where id = ?",
            [$batch->id],
        );
    }

    /** @param array<string, mixed> $payload */
    private function withdraw(Connection $db, stdClass $inbox, array $payload): void
    {
        $candidate = $db->selectOne(
            <<<'SQL'
                select id, status, source_revision, observed_at
                from roadops.roadvision_candidates
                where source_system_id = ? and external_candidate_id = ?
                  and status <> 'superseded'
                for update
            SQL,
            [$inbox->source_system_id, $payload['vendor_finding_id']],
        );
        if ($candidate === null) {
            throw new IntegrationApplyConflict(
                'ROADVISION_WITHDRAWAL_TARGET_MISSING', 'ROADVISION_FINDING',
                (string) $payload['vendor_finding_id'],
                'RoadVision withdrawal references a finding that has not been ingested.',
                $payload,
            );
        }
        if (strtotime((string) $payload['withdrawn_at']) <= strtotime((string) $candidate->observed_at)) {
            throw new IntegrationApplyConflict(
                'ROADVISION_WITHDRAWAL_OUT_OF_ORDER',
                'ROADVISION_FINDING',
                (string) $payload['vendor_finding_id'],
                'RoadVision withdrawal time must be later than the active observation.',
                [
                    'source_revision' => $payload['source_revision'],
                    'withdrawn_at' => $payload['withdrawn_at'],
                ],
                [
                    'source_revision' => (string) $candidate->source_revision,
                    'observed_at' => (string) $candidate->observed_at,
                ],
            );
        }
        $db->update(
            "update roadops.roadvision_candidates set status = 'superseded' where id = ?",
            [$candidate->id],
        );
        $db->statement(
            <<<'SQL'
                insert into roadops.roadvision_candidate_events
                  (candidate_id, from_status, to_status, event_code, details)
                values (?, ?, 'superseded', 'source_withdrawn', ?::jsonb)
            SQL,
            [
                $candidate->id, $candidate->status,
                json_encode([
                    'source_revision' => $payload['source_revision'],
                    'withdrawn_at' => $payload['withdrawn_at'],
                    'reason' => $payload['reason'],
                ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            ],
        );
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{string, string}
     */
    private function approvedEvidence(array $payload): array
    {
        $configuredBucket = trim((string) config('roadops.integrations.roadvision.s3_bucket'));
        $configuredPrefix = trim((string) config('roadops.integrations.roadvision.s3_prefix'), '/');
        if ($configuredBucket === '' || $configuredPrefix === '') {
            throw new IntegrationApplyConflict(
                'ROADVISION_EVIDENCE_BUCKET_NOT_CONFIGURED', 'ROADVISION_FINDING',
                (string) $payload['vendor_finding_id'],
                'The approved RoadVision evidence bucket is not configured.',
            );
        }
        $firstMedia = null;
        foreach ($payload['media'] as $media) {
            if (! in_array($media['content_type'], ['image/jpeg', 'image/png', 'video/mp4'], true)) {
                throw new ContractViolation(
                    'EVIDENCE_MEDIA_TYPE_INVALID',
                    'RoadVision evidence media type is outside the approved contract.',
                );
            }
            $parts = parse_url((string) $media['object_uri']);
            $scheme = is_array($parts) ? (string) ($parts['scheme'] ?? '') : '';
            $bucket = is_array($parts) ? (string) ($parts['host'] ?? '') : '';
            $key = is_array($parts) ? ltrim((string) ($parts['path'] ?? ''), '/') : '';
            $insidePrefix = str_starts_with($key, $configuredPrefix.'/')
                && $key !== $configuredPrefix;
            if ($scheme === 's3' && $key !== '' && $insidePrefix
                && hash_equals($configuredBucket, $bucket)) {
                if ($firstMedia === null) {
                    $firstMedia = [(string) $media['object_uri'], (string) $media['content_type']];
                }

                continue;
            }
            throw new IntegrationApplyConflict(
                'ROADVISION_EVIDENCE_BUCKET_MISMATCH',
                'ROADVISION_FINDING',
                (string) $payload['vendor_finding_id'],
                'RoadVision evidence is outside the configured approved S3 bucket.',
                ['media_id' => $media['media_id'] ?? null, 'object_uri' => $media['object_uri'] ?? null],
            );
        }

        if ($firstMedia !== null) {
            return $firstMedia;
        }

        throw new IntegrationApplyConflict(
            'ROADVISION_MEDIA_EVIDENCE_REQUIRED',
            'ROADVISION_FINDING', (string) $payload['vendor_finding_id'],
            'RoadVision finding has no approved evidence media.',
            ['media_count' => count($payload['media'])],
        );
    }

    private function road(Connection $db, mixed $externalId, string $observedAt): ?stdClass
    {
        if (! is_string($externalId) || trim($externalId) === '') {
            return null;
        }
        $rows = $db->select(
            <<<'SQL'
                select r.id, effective.length_m
                from roadops.roads r
                join roadops.source_systems s on s.id = r.source_system_id
                left join lateral (
                  select rv.length_m
                  from roadops.road_versions rv
                  where rv.road_id = r.id
                    and rv.valid_from <= ?::timestamptz
                    and (rv.valid_until is null or rv.valid_until > ?::timestamptz)
                  order by rv.valid_from desc
                  limit 1
                ) effective on true
                where s.system_kind = 'road_repair' and s.enabled
                  and exists (
                    select 1 from roadops.integration_connections c
                    where c.source_system_id = s.id and c.enabled
                      and c.configuration ->> 'contract_approved' = 'true'
                      and c.configuration ->> 'contract_sha256' ~ '^[a-f0-9]{64}$'
                  )
                  and r.external_id = ? and r.retired_at is null
            SQL,
            [$observedAt, $observedAt, $externalId],
        );
        if (count($rows) > 1) {
            throw new IntegrationApplyConflict(
                'YTP_ROAD_EXTERNAL_ID_AMBIGUOUS', 'ROAD', $externalId,
                'RoadVision YTP road identifier resolves to multiple enabled source masters.',
                [], ['match_count' => count($rows)],
            );
        }

        return $rows[0] ?? null;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array{?int, ?int}
     */
    private function chainage(array $payload): array
    {
        $from = $payload['chainage_from_m'] ?? null;
        $to = $payload['chainage_to_m'] ?? null;
        if (! is_int($from) || ! is_int($to) || $to <= $from) {
            return [null, null];
        }

        return [$from, $to];
    }
}
