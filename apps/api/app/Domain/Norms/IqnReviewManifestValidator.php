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
     * @param  list<array{provenance_hash:string,ambiguity_flags:list<string>}>  $stagedRows
     * @return array{document:array<string,mixed>,decisions:array<string,array<string,mixed>>,catalog:array<string,list<array<string,mixed>>>}
     */
    public function validate(array $manifest, array $stagedRows, string $expectedDocumentKind): array
    {
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

        $decisions = $this->decisions($manifest, $stagedRows);
        $catalogInput = $this->object($manifest, 'catalog');
        $catalog = [];
        foreach (self::CATALOG_COLLECTIONS as $collection) {
            $value = $catalogInput[$collection] ?? null;
            if (! is_array($value) || ! array_is_list($value)) {
                throw new \DomainException("catalog.{$collection} must be a JSON array.");
            }
            foreach ($value as $index => $row) {
                if (! is_array($row) || array_is_list($row)) {
                    throw new \DomainException("catalog.{$collection}[{$index}] must be a JSON object.");
                }
                $this->assertAcceptedSource($row, $decisions, "catalog.{$collection}[{$index}]");
            }
            /** @var list<array<string, mixed>> $value */
            $catalog[$collection] = $value;
        }

        if ($expectedDocumentKind === 'iqn_02') {
            foreach (['work_items', 'variants', 'resources', 'norm_sets', 'norm_lines'] as $collection) {
                if ($catalog[$collection] === []) {
                    throw new \DomainException("IQN 02 catalog.{$collection} cannot be empty at publication.");
                }
            }
        }
        $this->validateCatalogReferences($catalog);

        return ['document' => $document, 'decisions' => $decisions, 'catalog' => $catalog];
    }

    /**
     * @param  array<string, mixed>  $manifest
     * @param  list<array{provenance_hash:string,ambiguity_flags:list<string>}>  $stagedRows
     * @return array<string, array<string, mixed>>
     */
    private function decisions(array $manifest, array $stagedRows): array
    {
        $input = $manifest['row_decisions'] ?? null;
        if (! is_array($input) || ! array_is_list($input)) {
            throw new \DomainException('row_decisions must be a JSON array.');
        }
        $staged = [];
        foreach ($stagedRows as $row) {
            $hash = strtolower($row['provenance_hash']);
            if (! preg_match('/^[0-9a-f]{64}$/', $hash)) {
                throw new \DomainException('A staged row has an invalid provenance hash.');
            }
            $staged[$hash] = $row;
        }

        $decisions = [];
        $claimedCatalogKeys = [];
        foreach ($input as $index => $decision) {
            if (! is_array($decision) || array_is_list($decision)) {
                throw new \DomainException("row_decisions[{$index}] must be a JSON object.");
            }
            $hash = strtolower($this->nonEmptyString($decision, 'provenance_hash', "row_decisions[{$index}].provenance_hash"));
            if (! preg_match('/^[0-9a-f]{64}$/', $hash) || ! isset($staged[$hash])) {
                throw new \DomainException("row_decisions[{$index}] references an unknown provenance hash.");
            }
            if (isset($decisions[$hash])) {
                throw new \DomainException("Duplicate row decision for {$hash}.");
            }
            $state = $this->nonEmptyString($decision, 'decision', "row_decisions[{$index}].decision");
            if (! in_array($state, ['accepted', 'rejected'], true)) {
                throw new \DomainException("row_decisions[{$index}].decision must be accepted or rejected.");
            }
            $this->nonEmptyString($decision, 'review_note', "row_decisions[{$index}].review_note");
            if ($state === 'accepted') {
                $payload = $decision['canonical_payload'] ?? null;
                if (! is_array($payload) || array_is_list($payload)) {
                    throw new \DomainException("Accepted row {$hash} requires canonical_payload object.");
                }
                $catalogKeys = $payload['catalog_keys'] ?? null;
                if (! is_array($catalogKeys) || ! array_is_list($catalogKeys)) {
                    throw new \DomainException("Accepted row {$hash} canonical_payload.catalog_keys must be an array.");
                }
                foreach ($catalogKeys as $catalogKey) {
                    if (! is_string($catalogKey) || trim($catalogKey) === '') {
                        throw new \DomainException("Accepted row {$hash} has an invalid canonical catalog key.");
                    }
                    $catalogKey = trim($catalogKey);
                    if (isset($claimedCatalogKeys[$catalogKey])) {
                        throw new \DomainException("Canonical catalog key {$catalogKey} is claimed by multiple rows.");
                    }
                    $claimedCatalogKeys[$catalogKey] = $hash;
                }
                if ($staged[$hash]['ambiguity_flags'] !== []) {
                    $this->nonEmptyString($decision, 'ambiguity_resolution', "row_decisions[{$index}].ambiguity_resolution");
                }
            } elseif (array_key_exists('canonical_payload', $decision) && $decision['canonical_payload'] !== null) {
                throw new \DomainException("Rejected row {$hash} cannot have canonical_payload.");
            }
            $decision['provenance_hash'] = $hash;
            $decisions[$hash] = $decision;
        }

        $missing = array_diff_key($staged, $decisions);
        if ($missing !== [] || count($decisions) !== count($staged)) {
            throw new \DomainException(sprintf(
                'Every staged row needs an explicit decision; %d of %d rows are undecided.',
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
     * @param  array<string, array<string, mixed>>  $decisions
     */
    private function assertAcceptedSource(array $row, array $decisions, string $location): void
    {
        $sourceLocation = $row['source_location'] ?? null;
        if (! is_array($sourceLocation) || array_is_list($sourceLocation)) {
            throw new \DomainException("{$location}.source_location must be a JSON object.");
        }
        $hash = strtolower($this->nonEmptyString(
            $sourceLocation,
            'row_provenance_hash',
            "{$location}.source_location.row_provenance_hash",
        ));
        if (($decisions[$hash]['decision'] ?? null) !== 'accepted') {
            throw new \DomainException("{$location} is not backed by an explicitly accepted source row.");
        }
        $catalogKey = $this->nonEmptyString($row, 'key', "{$location}.key");
        $catalogKeys = $decisions[$hash]['canonical_payload']['catalog_keys'] ?? null;
        if (! is_array($catalogKeys) || ! in_array($catalogKey, $catalogKeys, true)) {
            throw new \DomainException(
                "{$location} key is not claimed by its accepted row canonical_payload.",
            );
        }
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
