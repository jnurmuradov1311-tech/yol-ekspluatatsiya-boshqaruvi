<?php

namespace App\Domain\Norms;

final class RoadVisionCatalogReviewValidator
{
    /**
     * @param  array<string, mixed>  $manifest
     * @param  list<array{external_code:string,external_name:string,row_hash:string}>  $stagedRows
     * @return array{catalog_revision:string,active_from:string,active_until:?string,supersedes_revision:?string,review_note:string,rows:array<string,array<string,mixed>>}
     */
    public function validate(array $manifest, array $stagedRows): array
    {
        $revision = $this->text($manifest, 'catalog_revision', 'catalog_revision');
        $activeFrom = $this->date($manifest['active_from'] ?? null, 'active_from');
        $activeUntil = isset($manifest['active_until'])
            ? $this->date($manifest['active_until'], 'active_until')
            : null;
        if ($activeUntil !== null && $activeUntil <= $activeFrom) {
            throw new \DomainException('active_until must be later than active_from.');
        }
        $supersedes = isset($manifest['supersedes_revision'])
            ? $this->text($manifest, 'supersedes_revision', 'supersedes_revision')
            : null;
        if ($supersedes === $revision) {
            throw new \DomainException('catalog_revision cannot supersede itself.');
        }
        $reviewNote = $this->text($manifest, 'review_note', 'review_note');
        $input = $manifest['rows'] ?? null;
        if (! is_array($input) || ! array_is_list($input)) {
            throw new \DomainException('rows must be a JSON array.');
        }

        $source = [];
        $names = [];
        foreach ($stagedRows as $row) {
            $code = trim($row['external_code']);
            if ($code === '' || isset($source[$code])) {
                throw new \DomainException("Staged RoadVision external_code collision: {$code}.");
            }
            $normalizedName = $this->normalize($row['external_name']);
            if (isset($names[$normalizedName])) {
                throw new \DomainException(
                    "Staged RoadVision normalized-name collision: {$row['external_name']}.",
                );
            }
            $names[$normalizedName] = true;
            $source[$code] = $row;
        }

        $rows = [];
        foreach ($input as $index => $row) {
            if (! is_array($row) || array_is_list($row)) {
                throw new \DomainException("rows[{$index}] must be a JSON object.");
            }
            $code = $this->text($row, 'external_code', "rows[{$index}].external_code");
            if (! isset($source[$code])) {
                throw new \DomainException("rows[{$index}] references unknown external_code {$code}.");
            }
            if (isset($rows[$code])) {
                throw new \DomainException("Duplicate RoadVision classification for external_code {$code}.");
            }
            $expectedHash = strtolower($this->text($row, 'expected_row_hash', "rows[{$index}].expected_row_hash"));
            if (! preg_match('/^[0-9a-f]{64}$/', $expectedHash)
                || ! hash_equals(strtolower($source[$code]['row_hash']), $expectedHash)) {
                throw new \DomainException("RoadVision row hash mismatch for external_code {$code}.");
            }
            $recordKind = $this->text($row, 'record_kind', "rows[{$index}].record_kind");
            if (! in_array($recordKind, ['defect_candidate', 'asset_observation', 'safety_observation', 'ignore'], true)) {
                throw new \DomainException("rows[{$index}].record_kind is invalid.");
            }
            $defectTypeCode = isset($row['defect_type_code'])
                ? $this->text($row, 'defect_type_code', "rows[{$index}].defect_type_code")
                : null;
            if (($recordKind === 'defect_candidate') !== ($defectTypeCode !== null)) {
                throw new \DomainException(
                    "RoadVision defect_candidate {$code} requires exactly one defect_type_code.",
                );
            }
            $this->text($row, 'review_note', "rows[{$index}].review_note");
            $rows[$code] = $row;
        }
        $missing = array_diff_key($source, $rows);
        if ($missing !== [] || count($source) !== count($rows)) {
            throw new \DomainException(sprintf(
                'Every staged RoadVision row needs an explicit classification; %d of %d rows are missing.',
                count($missing),
                count($source),
            ));
        }

        return [
            'catalog_revision' => $revision,
            'active_from' => $activeFrom,
            'active_until' => $activeUntil,
            'supersedes_revision' => $supersedes,
            'review_note' => $reviewNote,
            'rows' => $rows,
        ];
    }

    /** @param array<string, mixed> $input */
    private function text(array $input, string $key, string $location): string
    {
        $value = $input[$key] ?? null;
        if (! is_string($value) || trim($value) === '') {
            throw new \DomainException("{$location} must be a non-empty string.");
        }

        return trim($value);
    }

    private function date(mixed $value, string $location): string
    {
        if (! is_string($value)) {
            throw new \DomainException("{$location} must use YYYY-MM-DD.");
        }
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        if ($date === false || $date->format('Y-m-d') !== $value) {
            throw new \DomainException("{$location} must use YYYY-MM-DD.");
        }

        return $value;
    }

    private function normalize(string $value): string
    {
        return mb_strtolower(trim(preg_replace('/\s+/u', ' ', $value) ?? ''), 'UTF-8');
    }
}
