<?php

namespace App\Domain\Norms;

final class IqnReviewManifestValidator
{
    private const CATALOG_COLLECTIONS = [
        'sections',
        'work_items',
        'variants',
        'resources',
        'norm_sets',
        'norm_lines',
    ];

    /**
     * @param  array<string, mixed>  $manifest
     * @param  list<array{provenance_hash:string,ambiguity_flags:list<string>}>  $stagedBlocks
     * @param  list<array{provenance_hash:string,ambiguity_flags:list<string>}>  $stagedRows
     * @return array{document:array<string,mixed>,block_decisions:array<string,array<string,mixed>>,row_decisions:array<string,array<string,mixed>>,catalog:array<string,list<array<string,mixed>>>,reviewer_attestation:array<string,mixed>}
     */
    public function validate(
        array $manifest,
        array $stagedBlocks,
        array $stagedRows,
        string $expectedDocumentKind,
        string $expectedBatchId,
        string $expectedSourceSha256,
        string $expectedReviewedBy,
    ): array {
        $attestation = $this->attestation(
            $manifest,
            $expectedBatchId,
            $expectedSourceSha256,
            $expectedReviewedBy,
        );
        $document = $this->object($manifest, 'document');
        foreach (['code', 'title', 'revision', 'document_kind', 'effective_from'] as $field) {
            $this->nonEmptyString($document, $field, "document.{$field}");
        }
        if ($document['document_kind'] !== $expectedDocumentKind) {
            throw new \DomainException('Review document_kind does not match the staged source.');
        }
        if (! in_array($expectedDocumentKind, ['iqn_02', 'iqn_03'], true)) {
            throw new \DomainException('Unsupported IQN document_kind.');
        }
        $this->date($document['effective_from'], 'document.effective_from');
        if (isset($document['effective_until'])) {
            $this->date($document['effective_until'], 'document.effective_until');
        }

        $claimedCatalogKeys = [];
        $blockDecisions = $this->decisions(
            $manifest,
            'block_decisions',
            $stagedBlocks,
            'block',
            $claimedCatalogKeys,
        );
        $rowDecisions = $this->decisions(
            $manifest,
            'row_decisions',
            $stagedRows,
            'row',
            $claimedCatalogKeys,
        );
        $catalogInput = $this->object($manifest, 'catalog');
        $catalog = [];
        $publishedCatalogKeys = [];
        foreach (self::CATALOG_COLLECTIONS as $collection) {
            $value = $catalogInput[$collection] ?? null;
            if (! is_array($value) || ! array_is_list($value)) {
                throw new \DomainException("catalog.{$collection} must be a JSON array.");
            }
            foreach ($value as $index => $row) {
                if (! is_array($row) || array_is_list($row)) {
                    throw new \DomainException("catalog.{$collection}[{$index}] must be a JSON object.");
                }
                $this->assertAcceptedSource(
                    $row,
                    $blockDecisions,
                    $rowDecisions,
                    "catalog.{$collection}[{$index}]",
                );
                $catalogKey = $this->nonEmptyString(
                    $row,
                    'key',
                    "catalog.{$collection}[{$index}].key",
                );
                if (isset($publishedCatalogKeys[$catalogKey])) {
                    throw new \DomainException(
                        "Catalog key {$catalogKey} is published more than once across catalog collections.",
                    );
                }
                $publishedCatalogKeys[$catalogKey] = $collection;
            }
            /** @var list<array<string, mixed>> $value */
            $catalog[$collection] = $value;
        }

        foreach (['work_items', 'variants', 'resources', 'norm_sets', 'norm_lines'] as $collection) {
            if ($catalog[$collection] === []) {
                throw new \DomainException(
                    strtoupper(str_replace('_', ' ', $expectedDocumentKind))
                    ." catalog.{$collection} cannot be empty at publication.",
                );
            }
        }
        if ($expectedDocumentKind === 'iqn_02') {
            $this->validateInspectionTopics($catalog['work_items']);
        }
        $this->validateCatalogReferences($catalog);

        $phantomClaims = array_diff_key($claimedCatalogKeys, $publishedCatalogKeys);
        $unclaimedCatalogKeys = array_diff_key($publishedCatalogKeys, $claimedCatalogKeys);
        if ($phantomClaims !== [] || $unclaimedCatalogKeys !== []) {
            throw new \DomainException(sprintf(
                'Accepted source catalog_keys must exactly match the published catalog: %d phantom claims and %d unclaimed records.',
                count($phantomClaims),
                count($unclaimedCatalogKeys),
            ));
        }

        return [
            'document' => $document,
            'block_decisions' => $blockDecisions,
            'row_decisions' => $rowDecisions,
            'catalog' => $catalog,
            'reviewer_attestation' => $attestation,
        ];
    }

    /** @param array<string, mixed> $manifest */
    public function reviewPayloadHash(array $manifest): string
    {
        unset($manifest['reviewer_attestation']);

        return hash('sha256', json_encode(
            $this->canonicalize($manifest),
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR,
        ));
    }

    /**
     * The road-master UI is allowed to call an item an IQN topic only when the
     * expert manifest explicitly publishes the complete 29-heading IQN 02
     * hierarchy. Defect types are a separate catalog and are not a fallback.
     *
     * @param  list<array<string, mixed>>  $workItems
     */
    private function validateInspectionTopics(array $workItems): void
    {
        $topicNumbers = [];
        foreach ($workItems as $index => $item) {
            $sourceLocation = $item['source_location'] ?? null;
            if (! is_array($sourceLocation) || array_is_list($sourceLocation)) {
                throw new \DomainException("work_items[{$index}].source_location must be a JSON object.");
            }
            if (($sourceLocation['catalog_role'] ?? null) !== 'manual_inspection_topic') {
                continue;
            }
            if (($item['item_kind'] ?? null) !== 'group') {
                throw new \DomainException(
                    "work_items[{$index}] manual_inspection_topic must have item_kind=group.",
                );
            }
            if (isset($item['parent_key'])) {
                throw new \DomainException(
                    "work_items[{$index}] manual_inspection_topic must be a top-level work item.",
                );
            }
            $topicNumber = $sourceLocation['topic_number'] ?? null;
            if (! is_int($topicNumber) || $topicNumber < 1 || $topicNumber > 29) {
                throw new \DomainException(
                    "work_items[{$index}].source_location.topic_number must be an integer from 1 through 29.",
                );
            }
            if (isset($topicNumbers[$topicNumber])) {
                throw new \DomainException("Duplicate IQN 02 manual inspection topic_number {$topicNumber}.");
            }
            $topicNumbers[$topicNumber] = true;
        }

        $numbers = array_keys($topicNumbers);
        sort($numbers, SORT_NUMERIC);
        if ($numbers !== range(1, 29)) {
            throw new \DomainException(sprintf(
                'IQN 02 publication requires exactly 29 approved top-level manual inspection topics; %d were provided.',
                count($numbers),
            ));
        }
    }

    /**
     * @param  array<string, mixed>  $manifest
     * @param  list<array{provenance_hash:string,ambiguity_flags:list<string>}>  $stagedSources
     * @param  array<string, string>  $claimedCatalogKeys
     * @return array<string, array<string, mixed>>
     */
    private function decisions(
        array $manifest,
        string $manifestKey,
        array $stagedSources,
        string $sourceKind,
        array &$claimedCatalogKeys,
    ): array {
        $input = $manifest[$manifestKey] ?? null;
        if (! is_array($input) || ! array_is_list($input)) {
            throw new \DomainException("{$manifestKey} must be a JSON array.");
        }
        $staged = [];
        foreach ($stagedSources as $source) {
            $hash = strtolower($source['provenance_hash']);
            if (! preg_match('/^[0-9a-f]{64}$/', $hash)) {
                throw new \DomainException("A staged {$sourceKind} has an invalid provenance hash.");
            }
            $staged[$hash] = $source;
        }

        $decisions = [];
        foreach ($input as $index => $decision) {
            if (! is_array($decision) || array_is_list($decision)) {
                throw new \DomainException("{$manifestKey}[{$index}] must be a JSON object.");
            }
            $hash = strtolower($this->nonEmptyString(
                $decision,
                'provenance_hash',
                "{$manifestKey}[{$index}].provenance_hash",
            ));
            if (! preg_match('/^[0-9a-f]{64}$/', $hash) || ! isset($staged[$hash])) {
                throw new \DomainException("{$manifestKey}[{$index}] references an unknown provenance hash.");
            }
            if (isset($decisions[$hash])) {
                throw new \DomainException("Duplicate {$sourceKind} decision for {$hash}.");
            }
            $state = $this->nonEmptyString($decision, 'decision', "{$manifestKey}[{$index}].decision");
            if (! in_array($state, ['accepted', 'rejected'], true)) {
                throw new \DomainException("{$manifestKey}[{$index}].decision must be accepted or rejected.");
            }
            $this->nonEmptyString($decision, 'review_note', "{$manifestKey}[{$index}].review_note");
            if ($state === 'accepted') {
                $payload = $decision['canonical_payload'] ?? null;
                if (! is_array($payload) || array_is_list($payload)) {
                    throw new \DomainException("Accepted {$sourceKind} {$hash} requires canonical_payload object.");
                }
                $catalogKeys = $payload['catalog_keys'] ?? null;
                if (! is_array($catalogKeys) || ! array_is_list($catalogKeys)) {
                    throw new \DomainException(
                        "Accepted {$sourceKind} {$hash} canonical_payload.catalog_keys must be an array.",
                    );
                }
                foreach ($catalogKeys as $catalogKey) {
                    if (! is_string($catalogKey) || trim($catalogKey) === '') {
                        throw new \DomainException(
                            "Accepted {$sourceKind} {$hash} has an invalid canonical catalog key.",
                        );
                    }
                    $catalogKey = trim($catalogKey);
                    if (isset($claimedCatalogKeys[$catalogKey])) {
                        throw new \DomainException(
                            "Canonical catalog key {$catalogKey} is claimed by multiple source records.",
                        );
                    }
                    $claimedCatalogKeys[$catalogKey] = $sourceKind.':'.$hash;
                }
                if ($staged[$hash]['ambiguity_flags'] !== []) {
                    $this->nonEmptyString(
                        $decision,
                        'ambiguity_resolution',
                        "{$manifestKey}[{$index}].ambiguity_resolution",
                    );
                }
            } elseif (array_key_exists('canonical_payload', $decision) && $decision['canonical_payload'] !== null) {
                throw new \DomainException("Rejected {$sourceKind} {$hash} cannot have canonical_payload.");
            }
            $decision['provenance_hash'] = $hash;
            $decisions[$hash] = $decision;
        }

        $missing = array_diff_key($staged, $decisions);
        if ($missing !== [] || count($decisions) !== count($staged)) {
            throw new \DomainException(sprintf(
                'Every staged %s needs an explicit decision; %d of %d are undecided.',
                $sourceKind,
                count($missing),
                count($staged),
            ));
        }

        return $decisions;
    }

    /**
     * @param  array<string, list<array<string, mixed>>>  $catalog
     */
    private function validateCatalogReferences(array $catalog): void
    {
        $sectionKeys = $this->keys($catalog['sections'], 'sections');
        $workItemKeys = $this->keys($catalog['work_items'], 'work_items');
        $variantKeys = $this->keys($catalog['variants'], 'variants');
        $resourceKeys = $this->keys($catalog['resources'], 'resources');
        $normSetKeys = $this->keys($catalog['norm_sets'], 'norm_sets');
        $this->keys($catalog['norm_lines'], 'norm_lines');

        $seen = [];
        foreach ($catalog['sections'] as $index => $section) {
            if (isset($section['parent_key'])) {
                $parent = (string) $section['parent_key'];
                if (! isset($sectionKeys[$parent]) || ! isset($seen[$parent])) {
                    throw new \DomainException("sections[{$index}].parent_key must reference an earlier section.");
                }
            }
            $seen[(string) $section['key']] = true;
        }

        $seen = [];
        foreach ($catalog['work_items'] as $index => $item) {
            if (isset($item['section_key']) && ! isset($sectionKeys[(string) $item['section_key']])) {
                throw new \DomainException("work_items[{$index}].section_key is unknown.");
            }
            if (isset($item['parent_key'])) {
                $parent = (string) $item['parent_key'];
                if (! isset($workItemKeys[$parent]) || ! isset($seen[$parent])) {
                    throw new \DomainException("work_items[{$index}].parent_key must reference an earlier work item.");
                }
            }
            $seen[(string) $item['key']] = true;
        }

        foreach ($catalog['variants'] as $index => $variant) {
            if (! isset($workItemKeys[(string) ($variant['work_item_key'] ?? '')])) {
                throw new \DomainException("variants[{$index}].work_item_key is unknown.");
            }
            $status = (string) ($variant['interpretation_status'] ?? '');
            if (! in_array($status, ['interpreted', 'approved', 'needs_resolution', 'rejected'], true)) {
                throw new \DomainException("variants[{$index}].interpretation_status is invalid.");
            }
            if (($variant['planning_status'] ?? null) === 'automatic' && $status !== 'approved') {
                throw new \DomainException("variants[{$index}] cannot be automatic before explicit approval.");
            }
            if (! in_array($variant['formula_type'] ?? null, [
                'linear', 'incremental', 'range', 'dual_value', 'fixed_period',
                'summary', 'manual_resolution_required',
            ], true)) {
                throw new \DomainException("variants[{$index}].formula_type is invalid.");
            }
            $planningStatus = $variant['planning_status'] ?? null;
            if (! in_array($planningStatus, ['not_usable', 'automatic', 'manual', 'retired'], true)) {
                throw new \DomainException("variants[{$index}].planning_status is invalid.");
            }
            if ($planningStatus === 'automatic'
                && (! isset($variant['basis_quantity']) || ! is_numeric($variant['basis_quantity'])
                    || (float) $variant['basis_quantity'] <= 0
                    || ! isset($variant['basis_unit']) || ! is_string($variant['basis_unit'])
                    || trim($variant['basis_unit']) === '')) {
                throw new \DomainException("variants[{$index}] automatic planning requires a positive basis and unit.");
            }
        }
        foreach ($catalog['norm_sets'] as $index => $normSet) {
            if (! isset($variantKeys[(string) ($normSet['variant_key'] ?? '')])) {
                throw new \DomainException("norm_sets[{$index}].variant_key is unknown.");
            }
            if (! in_array($normSet['status'] ?? null, ['draft', 'approved'], true)) {
                throw new \DomainException("norm_sets[{$index}].status must be draft or approved.");
            }
            $this->date($normSet['effective_from'] ?? null, "norm_sets[{$index}].effective_from");
            if (isset($normSet['effective_until'])) {
                $this->date($normSet['effective_until'], "norm_sets[{$index}].effective_until");
            }
        }
        foreach ($catalog['norm_lines'] as $index => $line) {
            if (! isset($normSetKeys[(string) ($line['norm_set_key'] ?? '')])) {
                throw new \DomainException("norm_lines[{$index}].norm_set_key is unknown.");
            }
            if (! isset($resourceKeys[(string) ($line['resource_key'] ?? '')])) {
                throw new \DomainException("norm_lines[{$index}].resource_key is unknown.");
            }
        }
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return array<string, true>
     */
    private function keys(array $rows, string $collection): array
    {
        $keys = [];
        foreach ($rows as $index => $row) {
            $key = $this->nonEmptyString($row, 'key', "{$collection}[{$index}].key");
            if (isset($keys[$key])) {
                throw new \DomainException("Duplicate {$collection} key {$key}.");
            }
            $keys[$key] = true;
        }

        return $keys;
    }

    /**
     * @param  array<string, mixed>  $row
     * @param  array<string, array<string, mixed>>  $blockDecisions
     * @param  array<string, array<string, mixed>>  $rowDecisions
     */
    private function assertAcceptedSource(
        array $row,
        array $blockDecisions,
        array $rowDecisions,
        string $location,
    ): void {
        $sourceLocation = $row['source_location'] ?? null;
        if (! is_array($sourceLocation) || array_is_list($sourceLocation)) {
            throw new \DomainException("{$location}.source_location must be a JSON object.");
        }
        $hasBlockHash = array_key_exists('block_provenance_hash', $sourceLocation);
        $hasRowHash = array_key_exists('row_provenance_hash', $sourceLocation);
        if ($hasBlockHash === $hasRowHash) {
            throw new \DomainException(
                "{$location}.source_location must identify exactly one staged block or row.",
            );
        }
        $hashKey = $hasBlockHash ? 'block_provenance_hash' : 'row_provenance_hash';
        $sourceKind = $hasBlockHash ? 'block' : 'row';
        $decisions = $hasBlockHash ? $blockDecisions : $rowDecisions;
        $hash = strtolower($this->nonEmptyString(
            $sourceLocation,
            $hashKey,
            "{$location}.source_location.{$hashKey}",
        ));
        if (($decisions[$hash]['decision'] ?? null) !== 'accepted') {
            throw new \DomainException(
                "{$location} is not backed by an explicitly accepted source {$sourceKind}.",
            );
        }
        $catalogKey = $this->nonEmptyString($row, 'key', "{$location}.key");
        $catalogKeys = $decisions[$hash]['canonical_payload']['catalog_keys'] ?? null;
        if (! is_array($catalogKeys) || ! in_array($catalogKey, $catalogKeys, true)) {
            throw new \DomainException(
                "{$location} key is not claimed by its accepted source canonical_payload.",
            );
        }
    }

    /**
     * @param  array<string, mixed>  $manifest
     * @return array<string, mixed>
     */
    private function attestation(
        array $manifest,
        string $expectedBatchId,
        string $expectedSourceSha256,
        string $expectedReviewedBy,
    ): array {
        $attestation = $this->object($manifest, 'reviewer_attestation');
        $expectedKeys = [
            'attestation_id',
            'canonical_manifest_sha256',
            'confirmation',
            'confirmed_at',
            'expires_at',
            'import_batch_id',
            'reviewed_by',
            'source_sha256',
        ];
        sort($expectedKeys, SORT_STRING);
        $actualKeys = array_keys($attestation);
        sort($actualKeys, SORT_STRING);
        if ($actualKeys !== $expectedKeys) {
            throw new \DomainException(
                'reviewer_attestation must contain exactly the approved identity and payload-binding fields.',
            );
        }

        $attestationId = strtolower($this->nonEmptyString(
            $attestation,
            'attestation_id',
            'reviewer_attestation.attestation_id',
        ));
        $reviewedBy = strtolower($this->nonEmptyString(
            $attestation,
            'reviewed_by',
            'reviewer_attestation.reviewed_by',
        ));
        $batchId = strtolower($this->nonEmptyString(
            $attestation,
            'import_batch_id',
            'reviewer_attestation.import_batch_id',
        ));
        foreach ([
            'reviewer_attestation.attestation_id' => $attestationId,
            'reviewer_attestation.reviewed_by' => $reviewedBy,
            'reviewer_attestation.import_batch_id' => $batchId,
        ] as $location => $uuid) {
            $this->uuid($uuid, $location);
        }
        if (! hash_equals(strtolower($expectedReviewedBy), $reviewedBy)) {
            throw new \DomainException('Reviewer attestation does not match the authenticated reviewer.');
        }
        if (! hash_equals(strtolower($expectedBatchId), $batchId)) {
            throw new \DomainException('Reviewer attestation does not match the staged import batch.');
        }

        $sourceSha256 = strtolower($this->nonEmptyString(
            $attestation,
            'source_sha256',
            'reviewer_attestation.source_sha256',
        ));
        if (! preg_match('/^[0-9a-f]{64}$/', $sourceSha256)
            || ! hash_equals(strtolower($expectedSourceSha256), $sourceSha256)) {
            throw new \DomainException('Reviewer attestation does not match the staged source SHA-256.');
        }
        $payloadSha256 = strtolower($this->nonEmptyString(
            $attestation,
            'canonical_manifest_sha256',
            'reviewer_attestation.canonical_manifest_sha256',
        ));
        if (! preg_match('/^[0-9a-f]{64}$/', $payloadSha256)
            || ! hash_equals($this->reviewPayloadHash($manifest), $payloadSha256)) {
            throw new \DomainException('Reviewer attestation does not match the canonical review payload.');
        }
        if ($this->nonEmptyString(
            $attestation,
            'confirmation',
            'reviewer_attestation.confirmation',
        ) !== 'IQN_CATALOG_REVIEW_APPROVED') {
            throw new \DomainException('Reviewer attestation confirmation is invalid.');
        }
        $confirmedAt = $this->nonEmptyString(
            $attestation,
            'confirmed_at',
            'reviewer_attestation.confirmed_at',
        );
        if (! preg_match(
            '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/',
            $confirmedAt,
        )) {
            throw new \DomainException('reviewer_attestation.confirmed_at must be RFC 3339 with an explicit offset.');
        }
        try {
            $confirmedAtValue = new \DateTimeImmutable($confirmedAt);
        } catch (\Exception) {
            throw new \DomainException('reviewer_attestation.confirmed_at is not a valid timestamp.');
        }
        $expiresAt = $this->nonEmptyString(
            $attestation,
            'expires_at',
            'reviewer_attestation.expires_at',
        );
        if (! preg_match(
            '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/',
            $expiresAt,
        )) {
            throw new \DomainException('reviewer_attestation.expires_at must be RFC 3339 with an explicit offset.');
        }
        try {
            $expiresAtValue = new \DateTimeImmutable($expiresAt);
        } catch (\Exception) {
            throw new \DomainException('reviewer_attestation.expires_at is not a valid timestamp.');
        }
        if ($expiresAtValue <= $confirmedAtValue
            || $expiresAtValue != $confirmedAtValue->modify('+24 hours')) {
            throw new \DomainException('Reviewer attestation must use the fixed 24-hour approval window.');
        }

        return [
            ...$attestation,
            'attestation_id' => $attestationId,
            'reviewed_by' => $reviewedBy,
            'import_batch_id' => $batchId,
            'source_sha256' => $sourceSha256,
            'canonical_manifest_sha256' => $payloadSha256,
        ];
    }

    private function uuid(string $value, string $location): void
    {
        if (! preg_match('/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/', $value)) {
            throw new \DomainException("{$location} must be a UUID.");
        }
    }

    private function canonicalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (array_is_list($value)) {
            return array_map(fn (mixed $item): mixed => $this->canonicalize($item), $value);
        }

        ksort($value, SORT_STRING);
        foreach ($value as $key => $item) {
            $value[$key] = $this->canonicalize($item);
        }

        return $value;
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function object(array $input, string $key): array
    {
        $value = $input[$key] ?? null;
        if (! is_array($value) || array_is_list($value)) {
            throw new \DomainException("{$key} must be a JSON object.");
        }

        return $value;
    }

    /** @param array<string, mixed> $input */
    private function nonEmptyString(array $input, string $key, string $location): string
    {
        $value = $input[$key] ?? null;
        if (! is_string($value) || trim($value) === '') {
            throw new \DomainException("{$location} must be a non-empty string.");
        }

        return trim($value);
    }

    private function date(mixed $value, string $location): void
    {
        if (! is_string($value)) {
            throw new \DomainException("{$location} must use YYYY-MM-DD.");
        }
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        if ($date === false || $date->format('Y-m-d') !== $value) {
            throw new \DomainException("{$location} must use YYYY-MM-DD.");
        }
    }
}
