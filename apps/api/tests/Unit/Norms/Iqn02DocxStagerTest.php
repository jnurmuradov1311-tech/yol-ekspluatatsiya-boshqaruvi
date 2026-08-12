<?php

namespace Tests\Unit\Norms;

use App\Domain\Norms\Iqn02DocxStager;
use PHPUnit\Framework\TestCase;

final class Iqn02DocxStagerTest extends TestCase
{
    public function test_real_source_structure_and_lossless_controls_are_regression_locked(): void
    {
        $path = $this->sourcePath('ИҚН 02-24.docx');
        $result = (new Iqn02DocxStager)->extract($path);

        self::assertSame(691, $result['paragraph_count']);
        self::assertSame(99, $result['table_count']);
        self::assertSame(1260, $result['row_count']);
        self::assertSame(5735, $result['cell_count']);
        self::assertSame(300, $result['paragraph_tab_count']);
        self::assertSame(2, $result['paragraph_break_count']);
        self::assertSame(4113, $result['cell_tab_count']);
        self::assertSame(10, $result['cell_break_count']);
        self::assertSame(4413, $result['tab_count']);
        self::assertSame(12, $result['break_count']);
        self::assertCount(790, $result['blocks']);

        $gridSpans = 0;
        $mergeRestarts = 0;
        $mergeContinuations = 0;
        $repairedTabText = false;
        foreach ($result['tables'] as $table) {
            foreach ($table['rows'] as $row) {
                self::assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $row['provenance_hash']);
                foreach ($row['cells'] as $cell) {
                    $gridSpans += $cell['grid_span'] > 1 ? 1 : 0;
                    $mergeRestarts += $cell['vertical_merge'] === 'restart' ? 1 : 0;
                    $mergeContinuations += $cell['vertical_merge'] === 'continue' ? 1 : 0;
                    if ($cell['raw_text'] === "\tВақт\nмеъёри") {
                        $repairedTabText = $cell['normalized_text'] === 'Вақт меъёри';
                    }
                }
            }
        }
        self::assertSame(250, $gridSpans);
        self::assertSame(91, $mergeRestarts);
        self::assertSame(237, $mergeContinuations);
        self::assertTrue($repairedTabText);
    }

    public function test_provenance_is_deterministic_for_the_same_source(): void
    {
        $stager = new Iqn02DocxStager;
        $first = $stager->extract($this->sourcePath('ИҚН 02-24.docx'));
        $second = $stager->extract($this->sourcePath('ИҚН 02-24.docx'));

        self::assertSame($first['blocks'][0]['provenance_hash'], $second['blocks'][0]['provenance_hash']);
        self::assertSame(
            $first['tables'][20]['rows'][29]['provenance_hash'],
            $second['tables'][20]['rows'][29]['provenance_hash'],
        );
    }

    private function sourcePath(string $name): string
    {
        $path = dirname(__DIR__, 6).'/source-materials/'.$name;
        if (! is_file($path)) {
            self::markTestSkipped('Source-materials fixture is unavailable.');
        }

        return $path;
    }
}
