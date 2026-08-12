<?php

namespace App\Domain\Norms;

use PhpOffice\PhpSpreadsheet\IOFactory;

final class RoadVisionCatalogAuditor
{
    private const MASTER_SHEET = 'RoadVision Master Attributes';

    private const SUMMARY_SHEET = 'Summary';

    private const MASTER_HEADERS = ['№', 'Element toifasi', 'Element turi / parametr', 'Yo‘nalish'];

    private const SUMMARY_HEADERS = ['Yo‘nalish', 'Atributlar soni', 'Tavsif'];

    public function audit(string $path): RoadVisionCatalogAudit
    {
        $book = IOFactory::load($path);
        try {
            $issues = [];
            $sheetNames = $book->getSheetNames();
            if ($sheetNames !== [self::MASTER_SHEET, self::SUMMARY_SHEET]) {
                $issues[] = $this->issue(
                    'WORKBOOK_SHEET_CONTRACT_MISMATCH',
                    'RoadVision workbook sheet names/order do not match the reviewed contract.',
                    ['actual' => $sheetNames, 'expected' => [self::MASTER_SHEET, self::SUMMARY_SHEET]],
                );
            }
            $master = $book->getSheetByName(self::MASTER_SHEET) ?? $book->getSheet(0);
            $summary = $book->getSheetByName(self::SUMMARY_SHEET) ?? ($book->getSheetCount() > 1 ? $book->getSheet(1) : null);
            $masterHeaders = [];
            foreach (range('A', 'D') as $column) {
                $masterHeaders[] = trim((string) $master->getCell("{$column}1")->getFormattedValue());
            }
            if ($masterHeaders !== self::MASTER_HEADERS) {
                $issues[] = $this->issue(
                    'MASTER_HEADER_CONTRACT_MISMATCH',
                    'RoadVision master headers do not match the reviewed contract.',
                    ['actual' => $masterHeaders, 'expected' => self::MASTER_HEADERS],
                );
            }

            $rows = [];
            $ids = [];
            $normalizedNames = [];
            $directionCounts = [];
            $highestRow = max(array_map(
                static fn (string $column): int => $master->getHighestDataRow($column),
                range('A', 'D'),
            ));
            for ($row = 2; $row <= $highestRow; $row++) {
                $values = [
                    trim((string) $master->getCell("A{$row}")->getFormattedValue()),
                    trim((string) $master->getCell("B{$row}")->getFormattedValue()),
                    trim((string) $master->getCell("C{$row}")->getFormattedValue()),
                    trim((string) $master->getCell("D{$row}")->getFormattedValue()),
                ];
                if ($values === ['', '', '', '']) {
                    continue;
                }
                foreach ($values as $column => $value) {
                    if ($value === '') {
                        $issues[] = $this->issue(
                            'REQUIRED_FIELD_MISSING',
                            'RoadVision master row has a blank required field.',
                            ['source_row' => $row, 'column' => $column + 1],
                        );
                    }
                }
                [$id, $category, $name, $direction] = $values;
                $ids[] = $id;
                $normalizedName = $this->normalize($name);
                $normalizedNames[$normalizedName][] = $row;
                $directionCounts[$direction] = ($directionCounts[$direction] ?? 0) + 1;
                $rows[] = [
                    'source_row' => $row,
                    'source_id' => $id,
                    'category' => $category,
                    'name' => $name,
                    'direction' => $direction,
                ];
            }

            $duplicateIds = $this->duplicates($ids);
            if ($duplicateIds !== []) {
                $issues[] = $this->issue(
                    'SOURCE_ID_DUPLICATE',
                    'RoadVision attribute identifier is duplicated.',
                    ['values' => $duplicateIds],
                );
            }
            foreach ($normalizedNames as $name => $sourceRows) {
                if ($name !== '' && count($sourceRows) > 1) {
                    $issues[] = $this->issue(
                        'NORMALIZED_NAME_COLLISION',
                        'Different RoadVision rows collapse to the same normalized attribute name.',
                        ['normalized_name' => $name, 'source_rows' => $sourceRows],
                    );
                }
            }
            foreach ($rows as $index => $row) {
                if ($row['source_id'] !== (string) ($index + 1)) {
                    $issues[] = $this->issue(
                        'SOURCE_ID_SEQUENCE_GAP',
                        'RoadVision attribute ID sequence has a gap or format error.',
                        ['source_row' => $row['source_row'], 'source_id' => $row['source_id']],
                    );
                    break;
                }
            }

            $summaryCounts = [];
            $declaredCount = null;
            if ($summary === null) {
                $issues[] = $this->issue('SUMMARY_SHEET_MISSING', 'RoadVision Summary sheet is missing.', []);
            } else {
                $summaryHeaders = [];
                foreach (range('A', 'C') as $column) {
                    $summaryHeaders[] = trim((string) $summary->getCell("{$column}1")->getFormattedValue());
                }
                if ($summaryHeaders !== self::SUMMARY_HEADERS) {
                    $issues[] = $this->issue(
                        'SUMMARY_HEADER_CONTRACT_MISMATCH',
                        'RoadVision summary headers do not match the reviewed contract.',
                        ['actual' => $summaryHeaders, 'expected' => self::SUMMARY_HEADERS],
                    );
                }
                $highestSummaryRow = max(array_map(
                    static fn (string $column): int => $summary->getHighestDataRow($column),
                    range('A', 'C'),
                ));
                for ($row = 2; $row <= $highestSummaryRow; $row++) {
                    $label = trim((string) $summary->getCell("A{$row}")->getFormattedValue());
                    $count = $summary->getCell("B{$row}")->getValue();
                    if ($label === '' && $count === null) {
                        continue;
                    }
                    if (! is_numeric($count)) {
                        $issues[] = $this->issue(
                            'SUMMARY_COUNT_INVALID',
                            'RoadVision summary count is not numeric.',
                            ['source_row' => $row, 'label' => $label, 'value' => $count],
                        );

                        continue;
                    }
                    if ($this->normalize($label) === $this->normalize('JAMI')) {
                        $declaredCount = (int) $count;
                    } else {
                        $canonicalLabel = $this->canonicalDirection($label);
                        $summaryCounts[$canonicalLabel] = (int) $count;
                    }
                }
            }

            if ($declaredCount !== null && $declaredCount !== count($rows)) {
                $issues[] = $this->issue(
                    'DECLARED_COUNT_MISMATCH',
                    'RoadVision summary total does not equal actual master rows.',
                    ['declared' => $declaredCount, 'actual' => count($rows)],
                );
            }
            foreach ($summaryCounts as $direction => $declared) {
                $actual = $directionCounts[$direction] ?? 0;
                if ($declared !== $actual) {
                    $issues[] = $this->issue(
                        'SUMMARY_SUBTOTAL_MISMATCH',
                        'RoadVision direction subtotal does not equal actual master rows.',
                        ['direction' => $direction, 'declared' => $declared, 'actual' => $actual],
                    );
                }
            }
            foreach (array_keys($directionCounts) as $direction) {
                if (! array_key_exists($direction, $summaryCounts)) {
                    $issues[] = $this->issue(
                        'SUMMARY_DIRECTION_MISSING',
                        'RoadVision master direction is absent from Summary.',
                        ['direction' => $direction, 'actual' => $directionCounts[$direction]],
                    );
                }
            }

            ksort($directionCounts, SORT_STRING);

            return new RoadVisionCatalogAudit(
                count($rows),
                $declaredCount,
                $issues,
                $rows,
                $directionCounts,
                $summaryCounts,
            );
        } finally {
            $book->disconnectWorksheets();
        }
    }

    /**
     * @param  array<string, mixed>  $context
     * @return array{code:string,message:string,context:array<string,mixed>,blocking:bool}
     */
    private function issue(string $code, string $message, array $context, bool $blocking = true): array
    {
        return compact('code', 'message', 'context', 'blocking');
    }

    private function canonicalDirection(string $value): string
    {
        return match ($this->normalize($value)) {
            $this->normalize('Yo‘l qoplamasi holati') => 'Yo‘l qoplamasi',
            $this->normalize('Yo‘l bo‘yi infratuzilma elementlari reyestri') => 'Yo‘l bo‘yi infratuzilma elementlari reyestri',
            $this->normalize('Xavfsizlik parametrlari') => 'Xavfsizlik parametrlari',
            default => trim($value),
        };
    }

    private function normalize(string $value): string
    {
        return mb_strtolower(trim(preg_replace('/\s+/u', ' ', $value) ?? ''), 'UTF-8');
    }

    /**
     * @param  list<string>  $values
     * @return list<string>
     */
    private function duplicates(array $values): array
    {
        $counts = array_count_values($values);
        $duplicates = array_keys(array_filter($counts, static fn (int $count): bool => $count > 1));
        sort($duplicates, SORT_STRING);

        return $duplicates;
    }
}
