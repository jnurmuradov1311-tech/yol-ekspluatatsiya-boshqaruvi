<?php

namespace App\Domain\Norms;

use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class IqnCatalogPublisher
{
    public function __construct(private readonly IqnReviewManifestValidator $validator) {}

    public function publish(string $batchId, string $manifestPath, string $reviewedBy): string
    {
        if (! is_file($manifestPath) || ! is_readable($manifestPath)) {
            throw new \InvalidArgumentException('IQN expert review manifest is not readable.');
        }
        $contents = file_get_contents($manifestPath);
        if (! is_string($contents)) {
            throw new \RuntimeException('IQN expert review manifest cannot be read.');
        }
        $manifest = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
        if (! is_array($manifest) || array_is_list($manifest)) {
            throw new \DomainException('IQN expert review manifest root must be a JSON object.');
        }
        $manifestHash = hash('sha256', $contents);

        $connection = DB::connection('pgsql_sync');

        return $connection->transaction(function () use (
            $connection,
            $batchId,
            $reviewedBy,
            $manifest,
            $manifestHash,
        ): string {
            $reviewer = $connection->selectOne(
                "select id from roadops.app_users where id = ?::uuid and status = 'active'",
                [$reviewedBy],
            );
            if ($reviewer === null) {
                throw new \DomainException('IQN publisher requires an active expert reviewer.');
            }
            $batch = $connection->selectOne(
                <<<'SQL'
                    select id, state, parser_version, encode(source_sha256, 'hex') source_sha256
                    from roadops.import_batches
                    where id = ?::uuid and import_kind = 'iqn_document'
                    for update
                SQL,
                [$batchId],
            );
            if ($batch === null) {
                throw new \DomainException('IQN import batch was not found.');
            }
            if (! in_array($batch->state, ['parsed', 'validated'], true)) {
                throw new \DomainException("IQN import batch state {$batch->state} cannot be published.");
            }
            $expectedKind = match (true) {
                str_starts_with((string) $batch->parser_version, 'iqn02-ooxml-') => 'iqn_02',
                str_starts_with((string) $batch->parser_version, 'iqn03-layout-json-') => 'iqn_03',
                default => throw new \DomainException('IQN parser output is not eligible for publication.'),
            };
            $openErrors = $connection->selectOne(
                <<<'SQL'
                    select count(*)::integer count
                    from roadops.import_issues
                    where import_batch_id = ?::uuid and issue_level = 'error'
                      and resolution_state = 'open'
                SQL,
                [$batchId],
            );
            if ($openErrors !== null && (int) $openErrors->count > 0) {
                throw new \DomainException('IQN import batch has unresolved blocking issues.');
            }
            if ($connection->selectOne(
                'select 1 from roadops.iqn_import_reviews where import_batch_id = ?::uuid',
                [$batchId],
            ) !== null) {
                throw new \DomainException('IQN import batch already has a review publication.');
            }

            $stagedRows = array_values(array_map(fn (object $row): array => [
                'provenance_hash' => $this->requiredStringProperty($row, 'provenance_hash'),
                'ambiguity_flags' => $this->stringListProperty($row, 'ambiguity_flags'),
            ], $connection->select(
                <<<'SQL'
                    select encode(provenance_hash, 'hex') provenance_hash,
                           ambiguity_flags::text ambiguity_flags
                    from roadops.iqn_staged_rows
                    where import_batch_id = ?::uuid
                    order by table_index, row_index
                    for update
                SQL,
                [$batchId],
            )));
            if ($stagedRows === []) {
                throw new \DomainException('IQN import has no staged source rows.');
            }

            $review = $this->validator->validate($manifest, $stagedRows, $expectedKind);
            $acceptedCount = $this->applyRowDecisions(
                $connection,
                $batchId,
                $reviewedBy,
                $review['decisions'],
            );
            $documentId = $this->insertDocument(
                $connection,
                $batchId,
                $reviewedBy,
                (string) $batch->source_sha256,
                $manifestHash,
                $review['document'],
            );
            $this->insertCatalog($connection, $documentId, $reviewedBy, $review['catalog']);

            $connection->insert(
                <<<'SQL'
                    insert into roadops.iqn_import_reviews
                        (import_batch_id, document_kind, review_manifest,
                         review_manifest_hash, review_state, reviewed_by,
                         published_document_id, published_at)
                    values (?, ?, ?::jsonb, decode(?, 'hex'), 'published', ?, ?, clock_timestamp())
                SQL,
                [
                    $batchId,
                    $expectedKind,
                    $this->json($manifest),
                    $manifestHash,
                    $reviewedBy,
                    $documentId,
                ],
            );
            $connection->update(
                <<<'SQL'
                    update roadops.import_batches
                    set state = 'accepted', expected_row_count = ?, accepted_row_count = ?,
                        imported_by = ?, completed_at = clock_timestamp(),
                        manifest = manifest || ?::jsonb
                    where id = ?::uuid
                SQL,
                [
                    count($stagedRows),
                    $acceptedCount,
                    $reviewedBy,
                    $this->json([
                        'review_manifest_sha256' => $manifestHash,
                        'publication_status' => 'expert_reviewed',
                    ]),
                    $batchId,
                ],
            );

            return $documentId;
        });
    }

    /**
     * @param  array<string, array<string, mixed>>  $decisions
     */
    private function applyRowDecisions(
        Connection $connection,
        string $batchId,
        string $reviewedBy,
        array $decisions,
    ): int {
        $accepted = 0;
        foreach ($decisions as $hash => $decision) {
            $state = (string) $decision['decision'];
            $canonical = $state === 'accepted' ? $this->json($decision['canonical_payload']) : null;
            $note = trim((string) $decision['review_note']);
            if (isset($decision['ambiguity_resolution'])) {
                $note .= ' | Ambiguity: '.trim((string) $decision['ambiguity_resolution']);
            }
            $affected = $connection->update(
                <<<'SQL'
                    update roadops.iqn_staged_rows
                    set review_state = ?, canonical_payload = ?::jsonb, review_note = ?,
                        reviewed_at = clock_timestamp(), reviewed_by = ?::uuid
                    where import_batch_id = ?::uuid and provenance_hash = decode(?, 'hex')
                      and review_state = 'pending'
                SQL,
                [$state, $canonical, $note, $reviewedBy, $batchId, $hash],
            );
            if ($affected !== 1) {
                throw new \DomainException("Staged IQN row {$hash} is missing or already reviewed.");
            }
            if ($state === 'accepted') {
                $accepted++;
            }
        }

        return $accepted;
    }

    /** @param array<string, mixed> $document */
    private function insertDocument(
        Connection $connection,
        string $batchId,
        string $reviewedBy,
        string $sourceChecksum,
        string $manifestHash,
        array $document,
    ): string {
        $id = (string) Str::uuid();
        $connection->insert(
            <<<'SQL'
                insert into roadops.iqn_documents
                    (id, import_batch_id, code, title, revision, document_kind,
                     source_sha256, effective_from, effective_until, imported_by, import_manifest)
                values (?, ?, ?, ?, ?, ?, decode(?, 'hex'), ?::date, ?::date, ?, ?::jsonb)
            SQL,
            [
                $id,
                $batchId,
                trim((string) $document['code']),
                trim((string) $document['title']),
                trim((string) $document['revision']),
                $document['document_kind'],
                $sourceChecksum,
                $document['effective_from'],
                $document['effective_until'] ?? null,
                $reviewedBy,
                $this->json([
                    'review_manifest_sha256' => $manifestHash,
                    'approval_mode' => 'explicit_expert_manifest',
                ]),
            ],
        );

        return $id;
    }

    /** @param array<string, list<array<string, mixed>>> $catalog */
    private function insertCatalog(
        Connection $connection,
        string $documentId,
        string $reviewedBy,
        array $catalog,
    ): void {
        $sectionIds = [];
        foreach ($catalog['sections'] as $section) {
            $id = (string) Str::uuid();
            $sectionIds[(string) $section['key']] = $id;
            $connection->insert(
                <<<'SQL'
                    insert into roadops.iqn_sections
                        (id, document_id, parent_section_id, sequence_number,
                         raw_heading, normalized_heading, source_location)
                    values (?, ?, ?, ?, ?, ?, ?::jsonb)
                SQL,
                [
                    $id,
                    $documentId,
                    isset($section['parent_key']) ? $sectionIds[(string) $section['parent_key']] : null,
                    $section['sequence_number'],
                    $section['raw_heading'],
                    $section['normalized_heading'],
                    $this->json($section['source_location']),
                ],
            );
        }

        $workItemIds = [];
        foreach ($catalog['work_items'] as $item) {
            $id = (string) Str::uuid();
            $workItemIds[(string) $item['key']] = $id;
            $connection->insert(
                <<<'SQL'
                    insert into roadops.iqn_work_items
                        (id, document_id, section_id, parent_item_id, source_sequence,
                         raw_code, normalized_code, raw_name, normalized_name, item_kind,
                         source_location, raw_expression)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?)
                SQL,
                [
                    $id,
                    $documentId,
                    isset($item['section_key']) ? $sectionIds[(string) $item['section_key']] : null,
                    isset($item['parent_key']) ? $workItemIds[(string) $item['parent_key']] : null,
                    $item['source_sequence'],
                    $item['raw_code'] ?? null,
                    $item['normalized_code'] ?? null,
                    $item['raw_name'],
                    $item['normalized_name'],
                    $item['item_kind'],
                    $this->json($item['source_location']),
                    $item['raw_expression'] ?? null,
                ],
            );
        }

        $resourceIds = [];
        foreach ($catalog['resources'] as $resource) {
            $id = (string) Str::uuid();
            $resourceIds[(string) $resource['key']] = $id;
            $connection->insert(
                <<<'SQL'
                    insert into roadops.iqn_resources
                        (id, document_id, resource_kind, raw_code, normalized_code,
                         raw_name, normalized_name, unit, source_location, attributes)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb)
                SQL,
                [
                    $id,
                    $documentId,
                    $resource['resource_kind'],
                    $resource['raw_code'] ?? null,
                    $resource['normalized_code'] ?? null,
                    $resource['raw_name'],
                    $resource['normalized_name'],
                    $resource['unit'],
                    $this->json($resource['source_location']),
                    $this->json($resource['attributes'] ?? []),
                ],
            );
        }

        $variantIds = [];
        foreach ($catalog['variants'] as $variant) {
            $id = (string) Str::uuid();
            $variantIds[(string) $variant['key']] = $id;
            $reviewed = in_array($variant['interpretation_status'], ['approved', 'rejected'], true);
            $connection->insert(
                <<<'SQL'
                    insert into roadops.iqn_work_variants
                        (id, work_item_id, variant_key, variant_label, basis_quantity,
                         basis_unit, raw_expression, formula_type, formula_parameters,
                         interpretation_status, planning_status, interpretation_note,
                         reviewed_at, reviewed_by, source_location)
                    values (?, ?, ?, ?, ?::numeric, ?, ?, ?, ?::jsonb, ?, ?, ?,
                            case when ?::boolean then clock_timestamp() else null end, ?, ?::jsonb)
                SQL,
                [
                    $id,
                    $workItemIds[(string) $variant['work_item_key']],
                    $variant['variant_key'],
                    $variant['variant_label'] ?? null,
                    $variant['basis_quantity'] ?? null,
                    $variant['basis_unit'] ?? null,
                    $variant['raw_expression'] ?? null,
                    $variant['formula_type'],
                    $this->json($variant['formula_parameters'] ?? []),
                    $variant['interpretation_status'],
                    $variant['planning_status'],
                    $variant['interpretation_note'] ?? null,
                    $reviewed,
                    $reviewed ? $reviewedBy : null,
                    $this->json($variant['source_location']),
                ],
            );
        }

        $normSetIds = [];
        $approvedNormSets = [];
        foreach ($catalog['norm_sets'] as $normSet) {
            $id = (string) Str::uuid();
            $normSetIds[(string) $normSet['key']] = $id;
            if ($normSet['status'] === 'approved') {
                $approvedNormSets[] = $id;
            }
            $connection->insert(
                <<<'SQL'
                    insert into roadops.iqn_norm_sets
                        (id, work_variant_id, norm_set_key, status, effective_from,
                         effective_until, raw_expression, interpretation, source_location)
                    values (?, ?, ?, 'draft', ?::date, ?::date, ?, ?::jsonb, ?::jsonb)
                SQL,
                [
                    $id,
                    $variantIds[(string) $normSet['variant_key']],
                    $normSet['norm_set_key'],
                    $normSet['effective_from'],
                    $normSet['effective_until'] ?? null,
                    $normSet['raw_expression'] ?? null,
                    $this->json($normSet['interpretation'] ?? []),
                    $this->json($normSet['source_location']),
                ],
            );
        }

        foreach ($catalog['norm_lines'] as $line) {
            $connection->insert(
                <<<'SQL'
                    insert into roadops.iqn_norm_lines
                        (id, norm_set_id, source_line_number, resource_id,
                         quantity_per_basis, increment_quantity, minutes_per_basis,
                         increment_minutes, unit, raw_expression, formula_parameters,
                         source_location)
                    values (?, ?, ?, ?, ?::numeric, ?::numeric, ?::numeric,
                            ?::numeric, ?, ?, ?::jsonb, ?::jsonb)
                SQL,
                [
                    (string) Str::uuid(),
                    $normSetIds[(string) $line['norm_set_key']],
                    $line['source_line_number'],
                    $resourceIds[(string) $line['resource_key']],
                    $line['quantity_per_basis'] ?? null,
                    $line['increment_quantity'] ?? null,
                    $line['minutes_per_basis'] ?? null,
                    $line['increment_minutes'] ?? null,
                    $line['unit'],
                    $line['raw_expression'] ?? null,
                    $this->json($line['formula_parameters'] ?? []),
                    $this->json($line['source_location']),
                ],
            );
        }
        foreach ($approvedNormSets as $normSetId) {
            $connection->update(
                <<<'SQL'
                    update roadops.iqn_norm_sets
                    set status = 'approved', approved_at = clock_timestamp(), approved_by = ?::uuid
                    where id = ?::uuid
                SQL,
                [$reviewedBy, $normSetId],
            );
        }
    }

    private function json(mixed $value): string
    {
        return json_encode(
            $value,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR,
        );
    }

    private function requiredStringProperty(object $row, string $property): string
    {
        $value = get_object_vars($row)[$property] ?? null;
        if (! is_string($value)) {
            throw new \RuntimeException("IQN staged row {$property} is not a string.");
        }

        return $value;
    }

    /** @return list<string> */
    private function stringListProperty(object $row, string $property): array
    {
        $decoded = json_decode(
            $this->requiredStringProperty($row, $property),
            true,
            32,
            JSON_THROW_ON_ERROR,
        );
        if (! is_array($decoded) || ! array_is_list($decoded)) {
            throw new \RuntimeException("IQN staged row {$property} is not a JSON string list.");
        }

        $values = [];
        foreach ($decoded as $value) {
            if (! is_string($value)) {
                throw new \RuntimeException("IQN staged row {$property} contains a non-string value.");
            }
            $values[] = $value;
        }

        return $values;
    }
}
