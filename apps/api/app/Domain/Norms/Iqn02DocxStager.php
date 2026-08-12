<?php

namespace App\Domain\Norms;

use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;
use ZipArchive;

/**
 * @phpstan-type IqnToken array{type:string,value:string}
 * @phpstan-type IqnCell array{physical_column_index:int,logical_column_index:int,grid_span:int,vertical_merge:string,raw_text:string,normalized_text:string,tokens:list<IqnToken>,tab_count:int,break_count:int,ambiguity_flags:list<string>,provenance_hash:string}
 * @phpstan-type IqnRow array{block_sequence:int,table_index:int,row_index:int,physical_cell_count:int,logical_column_count:int,cells:list<IqnCell>,ambiguity_flags:list<string>,provenance_hash:string}
 * @phpstan-type IqnTable array{block_sequence:int,table_index:int,grid_column_count:int,context_block_sequences:list<int>,rows:list<IqnRow>,ambiguity_flags:list<string>}
 * @phpstan-type IqnBlock array{block_sequence:int,block_kind:string,source_index:int,raw_text:?string,normalized_text:?string,structure:array<string,mixed>,ambiguity_flags:list<string>,provenance_hash:string}
 */
final class Iqn02DocxStager
{
    private const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

    /**
     * Extracts lossless-enough OOXML staging data without interpreting any row as an approved norm.
     *
     * Paragraph/table order, tab and break tokens, and Word merge controls are deliberately retained.
     * Every staged block, row, and cell receives a deterministic hash tied to the source checksum.
     *
     * @return array{checksum:string,paragraph_count:int,table_count:int,row_count:int,cell_count:int,paragraph_tab_count:int,paragraph_break_count:int,cell_tab_count:int,cell_break_count:int,tab_count:int,break_count:int,blocks:list<IqnBlock>,tables:list<IqnTable>}
     */
    public function extract(string $path): array
    {
        if (! is_file($path) || ! is_readable($path)) {
            throw new \InvalidArgumentException('IQN DOCX file is not readable.');
        }

        $checksum = hash_file('sha256', $path);
        if (! is_string($checksum)) {
            throw new \RuntimeException('IQN DOCX checksum cannot be calculated.');
        }

        $zip = new ZipArchive;
        if ($zip->open($path) !== true) {
            throw new \RuntimeException('IQN DOCX archive cannot be opened.');
        }
        try {
            $xml = $zip->getFromName('word/document.xml');
        } finally {
            $zip->close();
        }
        if (! is_string($xml)) {
            throw new \RuntimeException('word/document.xml is missing.');
        }

        $document = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        try {
            if (! $document->loadXML($xml, LIBXML_NONET | LIBXML_COMPACT)) {
                throw new \RuntimeException('IQN OOXML is malformed.');
            }
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }

        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('w', self::WORD_NAMESPACE);
        $bodyNodes = $xpath->query('/w:document/w:body');
        $body = $bodyNodes === false ? null : $bodyNodes->item(0);
        if (! $body instanceof DOMElement) {
            throw new \RuntimeException('IQN OOXML body is missing.');
        }

        $blocks = [];
        $tables = [];
        $blockSequence = 0;
        $paragraphIndex = 0;
        $tableIndex = 0;
        $rowCount = 0;
        $cellCount = 0;
        $tabCount = 0;
        $breakCount = 0;
        $paragraphTabCount = 0;
        $paragraphBreakCount = 0;
        $cellTabCount = 0;
        $cellBreakCount = 0;
        $contextBlockSequences = [];

        foreach ($body->childNodes as $child) {
            if (! $child instanceof DOMElement) {
                continue;
            }
            if ($child->namespaceURI !== self::WORD_NAMESPACE || ! in_array($child->localName, ['p', 'tbl'], true)) {
                continue;
            }

            $blockSequence++;
            if ($child->localName === 'p') {
                $paragraphIndex++;
                $payload = $this->paragraphPayload($child, $xpath);
                $tabCount += $payload['tab_count'];
                $breakCount += $payload['break_count'];
                $paragraphTabCount += $payload['tab_count'];
                $paragraphBreakCount += $payload['break_count'];
                $block = [
                    'block_sequence' => $blockSequence,
                    'block_kind' => 'paragraph',
                    'source_index' => $paragraphIndex,
                    'raw_text' => $payload['raw_text'],
                    'normalized_text' => $payload['normalized_text'],
                    'structure' => ['tokens' => $payload['tokens']],
                    'ambiguity_flags' => $payload['ambiguity_flags'],
                ];
                $block['provenance_hash'] = $this->provenanceHash($checksum, $block);
                $blocks[] = $block;
                $contextBlockSequences[] = $blockSequence;

                continue;
            }

            $tableIndex++;
            $table = $this->tablePayload(
                $child,
                $xpath,
                $checksum,
                $tableIndex,
                $blockSequence,
                $contextBlockSequences,
            );
            $tables[] = $table;
            $rowCount += count($table['rows']);
            foreach ($table['rows'] as $row) {
                $cellCount += count($row['cells']);
                foreach ($row['cells'] as $cell) {
                    $tabCount += $cell['tab_count'];
                    $breakCount += $cell['break_count'];
                    $cellTabCount += $cell['tab_count'];
                    $cellBreakCount += $cell['break_count'];
                }
            }
            $block = [
                'block_sequence' => $blockSequence,
                'block_kind' => 'table',
                'source_index' => $tableIndex,
                'raw_text' => null,
                'normalized_text' => null,
                'structure' => [
                    'table_index' => $tableIndex,
                    'grid_column_count' => $table['grid_column_count'],
                    'row_count' => count($table['rows']),
                    'context_block_sequences' => $contextBlockSequences,
                ],
                'ambiguity_flags' => $table['ambiguity_flags'],
            ];
            $block['provenance_hash'] = $this->provenanceHash($checksum, $block);
            $blocks[] = $block;
            $contextBlockSequences = [];
        }

        return [
            'checksum' => $checksum,
            'paragraph_count' => $paragraphIndex,
            'table_count' => $tableIndex,
            'row_count' => $rowCount,
            'cell_count' => $cellCount,
            'paragraph_tab_count' => $paragraphTabCount,
            'paragraph_break_count' => $paragraphBreakCount,
            'cell_tab_count' => $cellTabCount,
            'cell_break_count' => $cellBreakCount,
            'tab_count' => $tabCount,
            'break_count' => $breakCount,
            'blocks' => $blocks,
            'tables' => $tables,
        ];
    }

    /**
     * @param  list<int>  $contextBlockSequences
     * @return IqnTable
     */
    private function tablePayload(
        DOMElement $tableNode,
        DOMXPath $xpath,
        string $checksum,
        int $tableIndex,
        int $blockSequence,
        array $contextBlockSequences,
    ): array {
        $gridColumnNodes = $xpath->query('./w:tblGrid/w:gridCol', $tableNode);
        $gridColumns = $gridColumnNodes === false ? 0 : $gridColumnNodes->length;
        $rows = [];
        $tableFlags = $this->flags([]);
        $rowNodes = $xpath->query('./w:tr', $tableNode);
        if ($rowNodes === false) {
            throw new \RuntimeException("IQN table {$tableIndex} rows cannot be queried.");
        }

        foreach ($rowNodes as $rowOffset => $rowNode) {
            if (! $rowNode instanceof DOMElement) {
                continue;
            }
            $logicalColumn = 1;
            $cells = [];
            $rowFlags = [];
            $cellNodes = $xpath->query('./w:tc', $rowNode);
            if ($cellNodes === false) {
                throw new \RuntimeException("IQN table {$tableIndex} row ".($rowOffset + 1).' cells cannot be queried.');
            }

            foreach ($cellNodes as $cellOffset => $cellNode) {
                if (! $cellNode instanceof DOMElement) {
                    continue;
                }
                $gridSpan = $this->gridSpan($cellNode, $xpath);
                $verticalMerge = $this->verticalMerge($cellNode, $xpath);
                $text = $this->cellTextPayload($cellNode, $xpath);
                $cellFlags = $text['ambiguity_flags'];
                if ($gridSpan > 1) {
                    $cellFlags[] = 'HORIZONTAL_MERGE';
                    $rowFlags[] = 'HORIZONTAL_MERGE';
                }
                if ($verticalMerge === 'restart') {
                    $cellFlags[] = 'VERTICAL_MERGE_RESTART';
                    $rowFlags[] = 'VERTICAL_MERGE_RESTART';
                } elseif ($verticalMerge === 'continue') {
                    $cellFlags[] = 'VERTICAL_MERGE_CONTINUATION';
                    $rowFlags[] = 'VERTICAL_MERGE_CONTINUATION';
                    if ($text['normalized_text'] === '') {
                        $cellFlags[] = 'EMPTY_VERTICAL_MERGE_CONTINUATION';
                    }
                }
                $cell = [
                    'physical_column_index' => $cellOffset + 1,
                    'logical_column_index' => $logicalColumn,
                    'grid_span' => $gridSpan,
                    'vertical_merge' => $verticalMerge,
                    'raw_text' => $text['raw_text'],
                    'normalized_text' => $text['normalized_text'],
                    'tokens' => $text['tokens'],
                    'tab_count' => $text['tab_count'],
                    'break_count' => $text['break_count'],
                    'ambiguity_flags' => $this->flags($cellFlags),
                ];
                $cell['provenance_hash'] = $this->provenanceHash($checksum, [
                    'table_index' => $tableIndex,
                    'row_index' => $rowOffset + 1,
                    'cell' => $cell,
                ]);
                $cells[] = $cell;
                $logicalColumn += $gridSpan;
            }

            $logicalColumnCount = $logicalColumn - 1;
            if ($gridColumns > 0 && $logicalColumnCount !== $gridColumns) {
                $rowFlags[] = 'LOGICAL_COLUMN_COUNT_MISMATCH';
            }
            if ($cells === [] || count(array_filter(
                $cells,
                static fn (array $cell): bool => $cell['normalized_text'] !== '',
            )) === 0) {
                $rowFlags[] = 'EMPTY_ROW';
            }
            $rowFlags = $this->flags($rowFlags);
            $tableFlags = $this->flags([...$tableFlags, ...$rowFlags]);
            $row = [
                'block_sequence' => $blockSequence,
                'table_index' => $tableIndex,
                'row_index' => $rowOffset + 1,
                'physical_cell_count' => count($cells),
                'logical_column_count' => $logicalColumnCount,
                'cells' => $cells,
                'ambiguity_flags' => $rowFlags,
            ];
            $row['provenance_hash'] = $this->provenanceHash($checksum, $row);
            $rows[] = $row;
        }

        return [
            'block_sequence' => $blockSequence,
            'table_index' => $tableIndex,
            'grid_column_count' => $gridColumns,
            'context_block_sequences' => $contextBlockSequences,
            'rows' => $rows,
            'ambiguity_flags' => $this->flags($tableFlags),
        ];
    }

    /** @return array{raw_text:string,normalized_text:string,tokens:list<IqnToken>,tab_count:int,break_count:int,ambiguity_flags:list<string>} */
    private function cellTextPayload(DOMElement $cellNode, DOMXPath $xpath): array
    {
        $tokens = [];
        $raw = '';
        $tabCount = 0;
        $breakCount = 0;
        $paragraphs = $xpath->query('./w:p', $cellNode);
        if ($paragraphs === false) {
            throw new \RuntimeException('IQN cell paragraphs cannot be queried.');
        }
        foreach ($paragraphs as $paragraphOffset => $paragraph) {
            if (! $paragraph instanceof DOMElement) {
                continue;
            }
            if ($paragraphOffset > 0) {
                $tokens[] = ['type' => 'paragraph_break', 'value' => "\n"];
                $raw .= "\n";
            }
            $payload = $this->paragraphPayload($paragraph, $xpath);
            $tokens = [...$tokens, ...$payload['tokens']];
            $raw .= $payload['raw_text'];
            $tabCount += $payload['tab_count'];
            $breakCount += $payload['break_count'];
        }

        $flags = [];
        if ($tabCount > 0) {
            $flags[] = 'TAB_DELIMITED_TEXT';
        }
        if ($breakCount > 0) {
            $flags[] = 'EXPLICIT_LINE_BREAK';
        }

        return [
            'raw_text' => $raw,
            'normalized_text' => $this->normalizeText($raw),
            'tokens' => $tokens,
            'tab_count' => $tabCount,
            'break_count' => $breakCount,
            'ambiguity_flags' => $flags,
        ];
    }

    /** @return array{raw_text:string,normalized_text:string,tokens:list<IqnToken>,tab_count:int,break_count:int,ambiguity_flags:list<string>} */
    private function paragraphPayload(DOMElement $paragraph, DOMXPath $xpath): array
    {
        $tokens = [];
        $raw = '';
        $tabCount = 0;
        $breakCount = 0;
        $nodes = $xpath->query('.//w:t | .//w:tab | .//w:br | .//w:cr', $paragraph);
        if ($nodes === false) {
            throw new \RuntimeException('IQN paragraph tokens cannot be queried.');
        }

        foreach ($nodes as $node) {
            if (! $node instanceof DOMNode) {
                continue;
            }
            if ($node->localName === 't') {
                $value = $node->textContent;
                $tokens[] = ['type' => 'text', 'value' => $value];
                $raw .= $value;
            } elseif ($node->localName === 'tab') {
                $tokens[] = ['type' => 'tab', 'value' => "\t"];
                $raw .= "\t";
                $tabCount++;
            } else {
                $tokens[] = ['type' => 'break', 'value' => "\n"];
                $raw .= "\n";
                $breakCount++;
            }
        }

        $flags = [];
        if ($tabCount > 0) {
            $flags[] = 'TAB_DELIMITED_TEXT';
        }
        if ($breakCount > 0) {
            $flags[] = 'EXPLICIT_LINE_BREAK';
        }

        return [
            'raw_text' => $raw,
            'normalized_text' => $this->normalizeText($raw),
            'tokens' => $tokens,
            'tab_count' => $tabCount,
            'break_count' => $breakCount,
            'ambiguity_flags' => $flags,
        ];
    }

    private function gridSpan(DOMElement $cellNode, DOMXPath $xpath): int
    {
        $attributes = $xpath->query('./w:tcPr/w:gridSpan/@w:val', $cellNode);
        $attribute = $attributes === false ? null : $attributes->item(0);
        if (! $attribute instanceof DOMNode || ! ctype_digit($attribute->nodeValue ?? '')) {
            return 1;
        }

        return max(1, (int) $attribute->nodeValue);
    }

    private function verticalMerge(DOMElement $cellNode, DOMXPath $xpath): string
    {
        $nodes = $xpath->query('./w:tcPr/w:vMerge', $cellNode);
        $node = $nodes === false ? null : $nodes->item(0);
        if (! $node instanceof DOMElement) {
            return 'none';
        }
        $value = strtolower(trim($node->getAttributeNS(self::WORD_NAMESPACE, 'val')));

        return $value === 'restart' ? 'restart' : 'continue';
    }

    private function normalizeText(string $value): string
    {
        return trim(preg_replace('/\s+/u', ' ', $value) ?? '');
    }

    /**
     * @param  list<string>  $flags
     * @return list<string>
     */
    private function flags(array $flags): array
    {
        $flags = array_values(array_unique($flags));
        sort($flags, SORT_STRING);

        return $flags;
    }

    /** @param array<string, mixed> $payload */
    private function provenanceHash(string $checksum, array $payload): string
    {
        return hash('sha256', $this->json([
            'source_sha256' => $checksum,
            'payload' => $payload,
        ]));
    }

    /** @param array<string, mixed> $payload */
    private function json(array $payload): string
    {
        return json_encode(
            $payload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR,
        );
    }
}
