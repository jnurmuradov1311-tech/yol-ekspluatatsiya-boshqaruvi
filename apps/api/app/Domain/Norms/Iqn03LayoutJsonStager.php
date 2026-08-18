<?php

namespace App\Domain\Norms;

/**
 * Validates the approved IQN 03 layout interchange contract and prepares
 * lossless, hash-bound records for the existing IQN review staging tables.
 *
 * This class deliberately does not interpret a PDF row as an operational
 * norm. Layout acceptance and domain/norm approval are separate decisions.
 */
final class Iqn03LayoutJsonStager
{
    public const APPROVED_SOURCE_SHA256 = 'f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e';

    public const APPROVED_PAGE_COUNT = 51;

    public const SCHEMA_VERSION = 'iqn03-layout-json-v1';

    public const COORDINATE_SYSTEM = 'pdfplumber-top-origin-points';

    /**
     * @return array<string, mixed>
     */
    public function extract(string $pdfPath, string $layoutPath): array
    {
        if (! is_file($pdfPath) || ! is_readable($pdfPath)) {
            throw new \InvalidArgumentException('IQN 03 PDF file is not readable.');
        }
        $prefix = file_get_contents($pdfPath, false, null, 0, 5);
        if ($prefix !== '%PDF-') {
            throw new \InvalidArgumentException('IQN 03 source is not a valid PDF envelope.');
        }
        $sourceChecksum = hash_file('sha256', $pdfPath);
        if (! is_string($sourceChecksum)) {
            throw new \RuntimeException('IQN 03 PDF checksum cannot be calculated.');
        }
        if (! hash_equals(self::APPROVED_SOURCE_SHA256, strtolower($sourceChecksum))) {
            throw new \DomainException('IQN 03 PDF is not the checksum-approved 03-24 source.');
        }

        if (! is_file($layoutPath) || ! is_readable($layoutPath)) {
            throw new \InvalidArgumentException('IQN 03 layout JSON file is not readable.');
        }
        $contents = file_get_contents($layoutPath);
        if (! is_string($contents)) {
            throw new \RuntimeException('IQN 03 layout JSON cannot be read.');
        }
        $payload = json_decode($contents, true, 512, JSON_THROW_ON_ERROR);
        if (! is_array($payload) || array_is_list($payload)) {
            throw new \DomainException('IQN 03 layout JSON root must be an object.');
        }

        return $this->stagePayload($payload, $sourceChecksum, hash('sha256', $contents));
    }

    /**
     * Public for deterministic contract tests and offline validation tools.
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function stagePayload(
        array $payload,
        string $actualSourceChecksum,
        ?string $layoutChecksum = null,
    ): array {
        $actualSourceChecksum = strtolower(trim($actualSourceChecksum));
        if (! preg_match('/^[0-9a-f]{64}$/', $actualSourceChecksum)) {
            throw new \DomainException('Actual IQN 03 source checksum must be lowercase SHA-256.');
        }
        if (! hash_equals(self::APPROVED_SOURCE_SHA256, $actualSourceChecksum)) {
            throw new \DomainException('IQN 03 source checksum is not approved.');
        }
        $layoutChecksum ??= hash('sha256', $this->json($this->canonicalize($payload)));
        $layoutChecksum = strtolower(trim($layoutChecksum));
        if (! preg_match('/^[0-9a-f]{64}$/', $layoutChecksum)) {
            throw new \DomainException('IQN 03 layout checksum must be lowercase SHA-256.');
        }

        $this->keys(
            $payload,
            ['schema_version', 'document_kind', 'coordinate_system', 'source', 'extractor', 'approval', 'counts', 'pages'],
            [],
            '$',
        );
        $this->exact($payload, 'schema_version', self::SCHEMA_VERSION, '$.schema_version');
        $this->exact($payload, 'document_kind', 'iqn_03', '$.document_kind');
        $this->exact($payload, 'coordinate_system', self::COORDINATE_SYSTEM, '$.coordinate_system');

        $source = $this->object($payload, 'source', '$.source');
        $this->keys($source, ['filename', 'media_type', 'sha256', 'page_count', 'pdf_version'], [], '$.source');
        $this->nonEmptyString($source, 'filename', '$.source.filename');
        $this->exact($source, 'media_type', 'application/pdf', '$.source.media_type');
        $declaredChecksum = strtolower($this->nonEmptyString($source, 'sha256', '$.source.sha256'));
        if (! hash_equals($actualSourceChecksum, $declaredChecksum)) {
            throw new \DomainException('Layout source SHA-256 does not match the approved PDF bytes.');
        }
        $this->integer($source['page_count'] ?? null, '$.source.page_count', 1);
        if ($source['page_count'] !== self::APPROVED_PAGE_COUNT) {
            throw new \DomainException('Approved IQN 03 source must contain exactly 51 pages.');
        }
        $this->nonEmptyString($source, 'pdf_version', '$.source.pdf_version');

        $extractor = $this->object($payload, 'extractor', '$.extractor');
        $this->keys($extractor, ['name', 'version'], [], '$.extractor');
        $this->nonEmptyString($extractor, 'name', '$.extractor.name');
        $this->nonEmptyString($extractor, 'version', '$.extractor.version');

        $approval = $this->object($payload, 'approval', '$.approval');
        $this->keys($approval, ['layout_contract', 'norm_interpretation'], [], '$.approval');
        $this->exact($approval, 'layout_contract', 'approved', '$.approval.layout_contract');
        $this->exact(
            $approval,
            'norm_interpretation',
            'expert_review_required',
            '$.approval.norm_interpretation',
        );

        $counts = $this->object($payload, 'counts', '$.counts');
        $countKeys = [
            'page_count',
            'block_count',
            'text_block_count',
            'table_count',
            'table_row_count',
            'table_cell_slot_count',
            'non_placeholder_cell_count',
            'word_count',
        ];
        $this->keys($counts, $countKeys, [], '$.counts');
        foreach ($countKeys as $key) {
            $this->integer($counts[$key] ?? null, "$.counts.{$key}", 0);
        }

        $pages = $this->list($payload, 'pages', '$.pages');
        if (count($pages) !== self::APPROVED_PAGE_COUNT) {
            throw new \DomainException('Layout pages must cover every one of the 51 approved source pages.');
        }

        $blocks = [];
        $tables = [];
        $blockSequences = [];
        $tableIndexes = [];
        $wordSequences = [];
        $textIndex = 0;
        $derived = array_fill_keys($countKeys, 0);
        $derived['page_count'] = count($pages);

        foreach ($pages as $pageOffset => $page) {
            $location = '$.pages['.$pageOffset.']';
            if (! is_array($page) || array_is_list($page)) {
                throw new \DomainException("{$location} must be an object.");
            }
            $this->keys($page, ['page_number', 'width', 'height', 'rotation', 'blocks'], [], $location);
            $pageNumber = $this->integer($page['page_number'] ?? null, "{$location}.page_number", 1);
            if ($pageNumber !== $pageOffset + 1) {
                throw new \DomainException('IQN 03 page numbers must be complete, ordered, and gap-free.');
            }
            $pageWidth = $this->number($page['width'] ?? null, "{$location}.width", true);
            $pageHeight = $this->number($page['height'] ?? null, "{$location}.height", true);
            $rotation = $this->integer($page['rotation'] ?? null, "{$location}.rotation", 0);
            if (! in_array($rotation, [0, 90, 180, 270], true)) {
                throw new \DomainException("{$location}.rotation must be 0, 90, 180, or 270.");
            }
            $pageBlocks = $this->list($page, 'blocks', "{$location}.blocks");

            foreach ($pageBlocks as $blockOffset => $layoutBlock) {
                $blockLocation = "{$location}.blocks[{$blockOffset}]";
                if (! is_array($layoutBlock) || array_is_list($layoutBlock)) {
                    throw new \DomainException("{$blockLocation} must be an object.");
                }
                $kind = $layoutBlock['block_kind'] ?? null;
                if ($kind === 'text') {
                    $this->keys(
                        $layoutBlock,
                        ['block_sequence', 'block_kind', 'bbox', 'raw_text', 'words', 'ambiguity_flags'],
                        [],
                        $blockLocation,
                    );
                } elseif ($kind === 'table') {
                    $this->keys(
                        $layoutBlock,
                        [
                            'block_sequence', 'block_kind', 'table_index', 'bbox', 'raw_text',
                            'orphan_words', 'rows', 'ambiguity_flags',
                        ],
                        [],
                        $blockLocation,
                    );
                } else {
                    throw new \DomainException("{$blockLocation}.block_kind must be text or table.");
                }

                $blockSequence = $this->integer(
                    $layoutBlock['block_sequence'] ?? null,
                    "{$blockLocation}.block_sequence",
                    1,
                );
                if (isset($blockSequences[$blockSequence])) {
                    throw new \DomainException("Duplicate block_sequence {$blockSequence}.");
                }
                $blockSequences[$blockSequence] = true;
                $bbox = $this->bbox($layoutBlock['bbox'] ?? null, "{$blockLocation}.bbox", $pageWidth, $pageHeight);
                $rawText = $this->string($layoutBlock['raw_text'] ?? null, "{$blockLocation}.raw_text");
                $flags = $this->flags($layoutBlock['ambiguity_flags'] ?? null, "{$blockLocation}.ambiguity_flags");
                $derived['block_count']++;

                if ($kind === 'text') {
                    $textIndex++;
                    $derived['text_block_count']++;
                    $words = $this->words(
                        $layoutBlock['words'] ?? null,
                        "{$blockLocation}.words",
                        $pageWidth,
                        $pageHeight,
                        $wordSequences,
                    );
                    $derived['word_count'] += count($words);
                    $structure = [
                        'schema_version' => self::SCHEMA_VERSION,
                        'coordinate_system' => self::COORDINATE_SYSTEM,
                        'page_number' => $pageNumber,
                        'page_width' => $pageWidth,
                        'page_height' => $pageHeight,
                        'rotation' => $rotation,
                        'bbox' => $bbox,
                        'words' => $words,
                        'extractor' => $extractor,
                    ];
                    $block = [
                        'block_sequence' => $blockSequence,
                        'block_kind' => 'paragraph',
                        'source_index' => $textIndex,
                        'raw_text' => $rawText,
                        'normalized_text' => $this->normalizeText($rawText),
                        'structure' => $structure,
                        'ambiguity_flags' => $flags,
                    ];
                    $block['provenance_hash'] = $this->provenanceHash($actualSourceChecksum, $block);
                    $blocks[] = $block;

                    continue;
                }

                $tableIndex = $this->integer(
                    $layoutBlock['table_index'] ?? null,
                    "{$blockLocation}.table_index",
                    1,
                );
                if (isset($tableIndexes[$tableIndex])) {
                    throw new \DomainException("Duplicate table_index {$tableIndex}.");
                }
                $tableIndexes[$tableIndex] = true;
                $derived['table_count']++;
                $orphanWords = $this->words(
                    $layoutBlock['orphan_words'] ?? null,
                    "{$blockLocation}.orphan_words",
                    $pageWidth,
                    $pageHeight,
                    $wordSequences,
                );
                $derived['word_count'] += count($orphanWords);
                $layoutRows = $this->list($layoutBlock, 'rows', "{$blockLocation}.rows");
                if ($layoutRows === []) {
                    throw new \DomainException("{$blockLocation}.rows cannot be empty.");
                }
                $rows = [];
                foreach ($layoutRows as $rowOffset => $layoutRow) {
                    $rowLocation = "{$blockLocation}.rows[{$rowOffset}]";
                    if (! is_array($layoutRow) || array_is_list($layoutRow)) {
                        throw new \DomainException("{$rowLocation} must be an object.");
                    }
                    $this->keys($layoutRow, ['row_index', 'bbox', 'cells', 'ambiguity_flags'], [], $rowLocation);
                    $rowIndex = $this->integer($layoutRow['row_index'] ?? null, "{$rowLocation}.row_index", 1);
                    if ($rowIndex !== $rowOffset + 1) {
                        throw new \DomainException("Table {$tableIndex} row indexes must be ordered and gap-free.");
                    }
                    $rowBbox = $layoutRow['bbox'] === null
                        ? null
                        : $this->bbox($layoutRow['bbox'], "{$rowLocation}.bbox", $pageWidth, $pageHeight);
                    $rowFlags = $this->flags($layoutRow['ambiguity_flags'] ?? null, "{$rowLocation}.ambiguity_flags");
                    $layoutCells = $this->list($layoutRow, 'cells', "{$rowLocation}.cells");
                    if ($layoutCells === []) {
                        throw new \DomainException("{$rowLocation}.cells cannot be empty.");
                    }
                    $cells = [];
                    $physicalCellCount = 0;
                    foreach ($layoutCells as $cellOffset => $layoutCell) {
                        $cellLocation = "{$rowLocation}.cells[{$cellOffset}]";
                        if (! is_array($layoutCell) || array_is_list($layoutCell)) {
                            throw new \DomainException("{$cellLocation} must be an object.");
                        }
                        $this->keys(
                            $layoutCell,
                            ['column_index', 'is_placeholder', 'bbox', 'raw_text', 'words', 'ambiguity_flags'],
                            [],
                            $cellLocation,
                        );
                        $columnIndex = $this->integer(
                            $layoutCell['column_index'] ?? null,
                            "{$cellLocation}.column_index",
                            1,
                        );
                        if ($columnIndex !== $cellOffset + 1) {
                            throw new \DomainException(
                                "Table {$tableIndex} row {$rowIndex} column indexes must be ordered and gap-free.",
                            );
                        }
                        if (! is_bool($layoutCell['is_placeholder'] ?? null)) {
                            throw new \DomainException("{$cellLocation}.is_placeholder must be boolean.");
                        }
                        $placeholder = $layoutCell['is_placeholder'];
                        if ($placeholder) {
                            if ($layoutCell['bbox'] !== null || $layoutCell['raw_text'] !== null) {
                                throw new \DomainException("{$cellLocation} placeholder geometry and text must be null.");
                            }
                        } else {
                            $physicalCellCount++;
                            $this->bbox($layoutCell['bbox'], "{$cellLocation}.bbox", $pageWidth, $pageHeight);
                            $this->string($layoutCell['raw_text'], "{$cellLocation}.raw_text");
                        }
                        $cellWords = $this->words(
                            $layoutCell['words'] ?? null,
                            "{$cellLocation}.words",
                            $pageWidth,
                            $pageHeight,
                            $wordSequences,
                        );
                        if ($placeholder && $cellWords !== []) {
                            throw new \DomainException("{$cellLocation} placeholder cannot contain words.");
                        }
                        $derived['word_count'] += count($cellWords);
                        $cell = [
                            'physical_column_index' => $columnIndex,
                            'logical_column_index' => $columnIndex,
                            'is_placeholder' => $placeholder,
                            'bbox' => $layoutCell['bbox'],
                            'raw_text' => $layoutCell['raw_text'],
                            'normalized_text' => $layoutCell['raw_text'] === null
                                ? null
                                : $this->normalizeText($layoutCell['raw_text']),
                            'words' => $cellWords,
                            'ambiguity_flags' => $this->flags(
                                $layoutCell['ambiguity_flags'] ?? null,
                                "{$cellLocation}.ambiguity_flags",
                            ),
                        ];
                        $cell['provenance_hash'] = $this->provenanceHash($actualSourceChecksum, [
                            'page_number' => $pageNumber,
                            'block_sequence' => $blockSequence,
                            'table_index' => $tableIndex,
                            'row_index' => $rowIndex,
                            'cell' => $cell,
                        ]);
                        $cells[] = $cell;
                    }
                    $derived['table_row_count']++;
                    $derived['table_cell_slot_count'] += count($cells);
                    $derived['non_placeholder_cell_count'] += $physicalCellCount;
                    $row = [
                        'page_number' => $pageNumber,
                        'block_sequence' => $blockSequence,
                        'table_index' => $tableIndex,
                        'row_index' => $rowIndex,
                        'bbox' => $rowBbox,
                        'physical_cell_count' => $physicalCellCount,
                        'logical_column_count' => count($cells),
                        'cells' => $cells,
                        'ambiguity_flags' => $rowFlags,
                    ];
                    $row['provenance_hash'] = $this->provenanceHash($actualSourceChecksum, $row);
                    $rows[] = $row;
                }

                $structure = [
                    'schema_version' => self::SCHEMA_VERSION,
                    'coordinate_system' => self::COORDINATE_SYSTEM,
                    'page_number' => $pageNumber,
                    'page_width' => $pageWidth,
                    'page_height' => $pageHeight,
                    'rotation' => $rotation,
                    'bbox' => $bbox,
                    'table_index' => $tableIndex,
                    'raw_text' => $rawText,
                    'orphan_words' => $orphanWords,
                    'row_count' => count($rows),
                    'extractor' => $extractor,
                ];
                $block = [
                    'block_sequence' => $blockSequence,
                    'block_kind' => 'table',
                    'source_index' => $tableIndex,
                    'raw_text' => null,
                    'normalized_text' => null,
                    'structure' => $structure,
                    'ambiguity_flags' => $flags,
                ];
                $block['provenance_hash'] = $this->provenanceHash($actualSourceChecksum, $block);
                $blocks[] = $block;
                $tables[] = [
                    'page_number' => $pageNumber,
                    'block_sequence' => $blockSequence,
                    'table_index' => $tableIndex,
                    'rows' => $rows,
                ];
            }
        }

        $this->contiguous(array_keys($blockSequences), $derived['block_count'], 'block_sequence');
        $this->contiguous(array_keys($tableIndexes), $derived['table_count'], 'table_index');
        $this->contiguous(array_keys($wordSequences), $derived['word_count'], 'word_sequence');
        foreach ($countKeys as $key) {
            if ($counts[$key] !== $derived[$key]) {
                throw new \DomainException(
                    "Layout count {$key} declares {$counts[$key]}, but {$derived[$key]} records were validated.",
                );
            }
        }
        usort($blocks, static fn (array $left, array $right): int => $left['block_sequence'] <=> $right['block_sequence']);
        usort($tables, static fn (array $left, array $right): int => $left['table_index'] <=> $right['table_index']);

        return [
            'checksum' => $actualSourceChecksum,
            'layout_checksum' => $layoutChecksum,
            'parser_version' => 'iqn03-layout-json-1-'.substr($layoutChecksum, 0, 12),
            'source' => $source,
            'extractor' => $extractor,
            'counts' => $derived,
            'blocks' => $blocks,
            'tables' => $tables,
            'interpretation_status' => 'expert_review_required',
        ];
    }

    /**
     * @param  array<int, true>  $seenSequences
     * @return list<array<string, mixed>>
     */
    private function words(
        mixed $input,
        string $location,
        float $pageWidth,
        float $pageHeight,
        array &$seenSequences,
    ): array {
        if (! is_array($input) || ! array_is_list($input)) {
            throw new \DomainException("{$location} must be an array.");
        }
        $words = [];
        foreach ($input as $offset => $word) {
            $wordLocation = "{$location}[{$offset}]";
            if (! is_array($word) || array_is_list($word)) {
                throw new \DomainException("{$wordLocation} must be an object.");
            }
            $this->keys(
                $word,
                ['word_sequence', 'text', 'bbox', 'doctop', 'upright', 'direction'],
                [],
                $wordLocation,
            );
            $sequence = $this->integer($word['word_sequence'] ?? null, "{$wordLocation}.word_sequence", 1);
            if (isset($seenSequences[$sequence])) {
                throw new \DomainException("Duplicate word_sequence {$sequence}; every PDF word must be staged once.");
            }
            $seenSequences[$sequence] = true;
            $this->string($word['text'] ?? null, "{$wordLocation}.text");
            $this->bbox($word['bbox'] ?? null, "{$wordLocation}.bbox", $pageWidth, $pageHeight);
            $this->number($word['doctop'] ?? null, "{$wordLocation}.doctop");
            if (! is_bool($word['upright'] ?? null)) {
                throw new \DomainException("{$wordLocation}.upright must be boolean.");
            }
            if ($word['direction'] !== null && ! is_string($word['direction'])) {
                throw new \DomainException("{$wordLocation}.direction must be a string or null.");
            }
            $words[] = $word;
        }

        return $words;
    }

    /** @return array{0:float|int,1:float|int,2:float|int,3:float|int} */
    private function bbox(mixed $value, string $location, float $pageWidth, float $pageHeight): array
    {
        if (! is_array($value) || ! array_is_list($value) || count($value) !== 4) {
            throw new \DomainException("{$location} must be [x0, top, x1, bottom].");
        }
        $bbox = [];
        foreach ($value as $index => $coordinate) {
            $bbox[] = $this->number($coordinate, "{$location}[{$index}]");
        }
        if ($bbox[0] < 0 || $bbox[1] < 0 || $bbox[2] < $bbox[0] || $bbox[3] < $bbox[1]
            || $bbox[2] > $pageWidth + 0.01 || $bbox[3] > $pageHeight + 0.01) {
            throw new \DomainException("{$location} is outside page geometry or has reversed coordinates.");
        }

        /** @var array{0:float|int,1:float|int,2:float|int,3:float|int} $bbox */
        return $bbox;
    }

    /**
     * @param  list<int>  $sequences
     */
    private function contiguous(array $sequences, int $count, string $name): void
    {
        sort($sequences, SORT_NUMERIC);
        if ($sequences !== ($count === 0 ? [] : range(1, $count))) {
            throw new \DomainException("{$name} values must start at one and be globally gap-free.");
        }
    }

    /**
     * @param  array<string, mixed>  $object
     * @param  list<string>  $required
     * @param  list<string>  $optional
     */
    private function keys(array $object, array $required, array $optional, string $location): void
    {
        foreach ($required as $key) {
            if (! array_key_exists($key, $object)) {
                throw new \DomainException("{$location}.{$key} is required.");
            }
        }
        $allowed = array_fill_keys([...$required, ...$optional], true);
        foreach (array_keys($object) as $key) {
            if (! isset($allowed[$key])) {
                throw new \DomainException("{$location}.{$key} is not allowed by ".self::SCHEMA_VERSION.'.');
            }
        }
    }

    /** @param array<string, mixed> $object */
    private function object(array $object, string $key, string $location): array
    {
        $value = $object[$key] ?? null;
        if (! is_array($value) || array_is_list($value)) {
            throw new \DomainException("{$location} must be an object.");
        }

        return $value;
    }

    /** @param array<string, mixed> $object */
    private function list(array $object, string $key, string $location): array
    {
        $value = $object[$key] ?? null;
        if (! is_array($value) || ! array_is_list($value)) {
            throw new \DomainException("{$location} must be an array.");
        }

        return $value;
    }

    /** @param array<string, mixed> $object */
    private function exact(array $object, string $key, string $expected, string $location): void
    {
        if (($object[$key] ?? null) !== $expected) {
            throw new \DomainException("{$location} must equal {$expected}.");
        }
    }

    /** @param array<string, mixed> $object */
    private function nonEmptyString(array $object, string $key, string $location): string
    {
        $value = $object[$key] ?? null;
        if (! is_string($value) || trim($value) === '') {
            throw new \DomainException("{$location} must be a non-empty string.");
        }

        return trim($value);
    }

    private function string(mixed $value, string $location): string
    {
        if (! is_string($value)) {
            throw new \DomainException("{$location} must be a string.");
        }

        return $value;
    }

    private function integer(mixed $value, string $location, int $minimum): int
    {
        if (! is_int($value) || $value < $minimum) {
            throw new \DomainException("{$location} must be an integer >= {$minimum}.");
        }

        return $value;
    }

    private function number(mixed $value, string $location, bool $positive = false): float|int
    {
        if (! is_int($value) && ! is_float($value)) {
            throw new \DomainException("{$location} must be a finite number.");
        }
        if (! is_finite((float) $value) || ($positive && $value <= 0)) {
            throw new \DomainException("{$location} must be a finite".($positive ? ' positive' : '').' number.');
        }

        return $value;
    }

    /** @return list<string> */
    private function flags(mixed $value, string $location): array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            throw new \DomainException("{$location} must be an array.");
        }
        $flags = [];
        foreach ($value as $offset => $flag) {
            if (! is_string($flag) || ! preg_match('/^[A-Z][A-Z0-9_]{2,95}$/', $flag)) {
                throw new \DomainException("{$location}[{$offset}] is not a valid ambiguity code.");
            }
            if (isset($flags[$flag])) {
                throw new \DomainException("{$location} contains duplicate ambiguity code {$flag}.");
            }
            $flags[$flag] = true;
        }
        $result = array_keys($flags);
        $sorted = $result;
        sort($sorted, SORT_STRING);
        if ($result !== $sorted) {
            throw new \DomainException("{$location} must be sorted for deterministic staging.");
        }

        return $result;
    }

    private function normalizeText(string $value): string
    {
        return trim(preg_replace('/\s+/u', ' ', $value) ?? '');
    }

    /** @param array<string, mixed> $payload */
    private function provenanceHash(string $checksum, array $payload): string
    {
        return hash('sha256', $this->json($this->canonicalize([
            'source_sha256' => $checksum,
            'payload' => $payload,
        ])));
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

    private function json(mixed $payload): string
    {
        return json_encode(
            $payload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR,
        );
    }
}
