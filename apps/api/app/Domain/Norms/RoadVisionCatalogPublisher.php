<?php

namespace App\Domain\Norms;

use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;

final class RoadVisionCatalogPublisher
{
    public function __construct(private readonly RoadVisionCatalogReviewValidator $validator) {}

    /** @return array{revision:string,published_count:int} */
    public function publish(string $batchId, string $reviewPath, string $reviewedBy): array
    {
        if (! is_file($reviewPath) || ! is_readable($reviewPath)) {
            throw new \InvalidArgumentException('RoadVision classification manifest is not readable.');
        }
        $contents = file_get_contents($reviewPath);
        if (! is_string($contents)) {
            throw new \RuntimeException('RoadVision classification manifest cannot be read.');
        }
        $manifest = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
        if (! is_array($manifest) || array_is_list($manifest)) {
            throw new \DomainException('RoadVision classification manifest root must be a JSON object.');
        }
        $reviewHash = hash('sha256', $contents);
        $connection = DB::connection('pgsql_sync');

        return $connection->transaction(function () use (
            $connection,
            $batchId,
            $reviewedBy,
            $manifest,
            $reviewHash,
        ): array {
            if ($connection->selectOne(
                "select id from roadops.app_users where id = ?::uuid and status = 'active'",
                [$reviewedBy],
            ) === null) {
                throw new \DomainException('RoadVision publisher requires an active expert reviewer.');
            }
            $batch = $connection->selectOne(
                <<<'SQL'
                    select id, source_system_id, state, parser_version
                    from roadops.import_batches
                    where id = ?::uuid and import_kind = 'roadvision_attribute_catalog'
                    for update
                SQL,
                [$batchId],
            );
            if ($batch === null) {
                throw new \DomainException('RoadVision catalog import batch was not found.');
            }
            if ($batch->state !== 'validated' || $batch->parser_version !== 'roadvision-xlsx-2') {
                throw new \DomainException('Only a validated roadvision-xlsx-2 batch can be published.');
            }
            $openErrors = $connection->selectOne(
                <<<'SQL'
                    select count(*)::integer count from roadops.import_issues
                    where import_batch_id = ?::uuid and issue_level = 'error'
                      and resolution_state = 'open'
                SQL,
                [$batchId],
            );
            if ($openErrors !== null && (int) $openErrors->count > 0) {
                throw new \DomainException('RoadVision import batch has unresolved blocking issues.');
            }

            $stagingObjects = $connection->select(
                <<<'SQL'
                    select id, external_code, external_name, encode(row_hash, 'hex') row_hash,
                           validation_state
                    from roadops.roadvision_attribute_staging
                    where import_batch_id = ?::uuid
                    order by source_row_number
                    for update
                SQL,
                [$batchId],
            );
            $stagedRows = array_values(array_map(fn (object $row): array => [
                'external_code' => $this->requiredStringProperty($row, 'external_code'),
                'external_name' => $this->requiredStringProperty($row, 'external_name'),
                'row_hash' => $this->requiredStringProperty($row, 'row_hash'),
            ], $stagingObjects));
            if ($stagedRows === []) {
                throw new \DomainException('RoadVision import has no staging rows.');
            }
            foreach ($stagingObjects as $row) {
                if ($row->validation_state !== 'pending') {
                    throw new \DomainException('RoadVision staging batch is already partly reviewed.');
                }
            }
            $review = $this->validator->validate($manifest, $stagedRows);
            $this->resolveCatalogOverlap($connection, (string) $batch->source_system_id, $review);
            $defectTypeIds = $this->resolveDefectTypes($connection, $review);

            $stagingByCode = [];
            foreach ($stagingObjects as $row) {
                $stagingByCode[(string) $row->external_code] = $row;
            }
            foreach ($review['rows'] as $code => $classification) {
                $staging = $stagingByCode[$code];
                $connection->update(
                    <<<'SQL'
                        update roadops.roadvision_attribute_staging
                        set proposed_record_kind = ?, proposed_defect_type_code = ?,
                            validation_state = 'accepted', review_note = ?,
                            reviewed_at = clock_timestamp(), reviewed_by = ?::uuid
                        where id = ?::uuid and validation_state = 'pending'
                    SQL,
                    [
                        $classification['record_kind'],
                        $classification['defect_type_code'] ?? null,
                        trim((string) $classification['review_note']),
                        $reviewedBy,
                        $staging->id,
                    ],
                );
                $connection->insert(
                    <<<'SQL'
                        insert into roadops.roadvision_attribute_catalog
                            (import_batch_id, staging_row_id, source_system_id, catalog_revision,
                             external_code, external_name, record_kind, defect_type_id,
                             active_from, active_until, payload_hash)
                        values (?, ?, ?, ?, ?, ?, ?, ?, ?::date, ?::date, decode(?, 'hex'))
                    SQL,
                    [
                        $batchId,
                        $staging->id,
                        $batch->source_system_id,
                        $review['catalog_revision'],
                        $code,
                        $staging->external_name,
                        $classification['record_kind'],
                        $defectTypeIds[$classification['defect_type_code'] ?? ''] ?? null,
                        $review['active_from'],
                        $review['active_until'],
                        $staging->row_hash,
                    ],
                );
            }
            $connection->update(
                <<<'SQL'
                    update roadops.import_batches
                    set state = 'accepted', expected_row_count = ?, accepted_row_count = ?,
                        imported_by = ?::uuid, completed_at = clock_timestamp(),
                        manifest = manifest || ?::jsonb
                    where id = ?::uuid
                SQL,
                [
                    count($stagingObjects),
                    count($stagingObjects),
                    $reviewedBy,
                    $this->json([
                        'catalog_revision' => $review['catalog_revision'],
                        'classification_manifest_sha256' => $reviewHash,
                        'classification_status' => 'expert_reviewed',
                    ]),
                    $batchId,
                ],
            );

            return ['revision' => $review['catalog_revision'], 'published_count' => count($stagingObjects)];
        });
    }

    /** @param array<string, mixed> $review */
    private function resolveCatalogOverlap(Connection $connection, string $sourceSystemId, array $review): void
    {
        $overlaps = $connection->select(
            <<<'SQL'
                select id, catalog_revision, active_from
                from roadops.roadvision_attribute_catalog
                where source_system_id = ?::uuid
                  and daterange(active_from, coalesce(active_until, 'infinity'::date), '[)')
                    && daterange(?::date, coalesce(?::date, 'infinity'::date), '[)')
                for update
            SQL,
            [$sourceSystemId, $review['active_from'], $review['active_until']],
        );
        if ($overlaps === []) {
            return;
        }
        $revisions = array_values(array_unique(array_map(
            fn (object $row): string => $this->requiredStringProperty($row, 'catalog_revision'),
            $overlaps,
        )));
        if ($review['supersedes_revision'] === null
            || $revisions !== [$review['supersedes_revision']]) {
            throw new \DomainException(
                'RoadVision catalog period/code collision requires one explicit supersedes_revision.',
            );
        }
        foreach ($overlaps as $overlap) {
            if ((string) $overlap->active_from >= $review['active_from']) {
                throw new \DomainException(
                    'RoadVision catalog collision cannot be superseded at or before its active_from.',
                );
            }
        }
        $connection->update(
            <<<'SQL'
                update roadops.roadvision_attribute_catalog
                set active_until = ?::date
                where source_system_id = ?::uuid and catalog_revision = ?
                  and active_from < ?::date
                  and (active_until is null or active_until > ?::date)
            SQL,
            [
                $review['active_from'],
                $sourceSystemId,
                $review['supersedes_revision'],
                $review['active_from'],
                $review['active_from'],
            ],
        );
    }

    /**
     * @param  array<string, mixed>  $review
     * @return array<string, string>
     */
    private function resolveDefectTypes(Connection $connection, array $review): array
    {
        $codes = [];
        foreach ($review['rows'] as $row) {
            if (isset($row['defect_type_code'])) {
                $codes[(string) $row['defect_type_code']] = true;
            }
        }
        $ids = [];
        foreach (array_keys($codes) as $code) {
            $row = $connection->selectOne(
                <<<'SQL'
                    select id from roadops.defect_types
                    where code = ? and active_from <= ?::date
                      and (active_until is null or active_until > ?::date)
                SQL,
                [$code, $review['active_from'], $review['active_from']],
            );
            if ($row === null) {
                throw new \DomainException("Approved defect_type_code {$code} is unavailable on active_from.");
            }
            $ids[$code] = (string) $row->id;
        }

        return $ids;
    }

    private function json(mixed $value): string
    {
        return json_encode(
            $value,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
        );
    }

    private function requiredStringProperty(object $row, string $property): string
    {
        $value = get_object_vars($row)[$property] ?? null;
        if (! is_string($value)) {
            throw new \RuntimeException("RoadVision staged row {$property} is not a string.");
        }

        return $value;
    }
}
