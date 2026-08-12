<?php

namespace Tests\Unit\Norms;

use App\Domain\Norms\RoadVisionCatalogAuditor;
use PHPUnit\Framework\TestCase;

final class RoadVisionCatalogAuditorTest extends TestCase
{
    public function test_real_workbook_has_152_valid_master_rows_and_two_summary_mismatches(): void
    {
        $path = dirname(__DIR__, 6).'/source-materials/RoadVisionAI_atributlar_royxati_uzbekcha.xlsx';
        if (! is_file($path)) {
            self::markTestSkipped('Source-materials fixture is unavailable.');
        }

        $audit = (new RoadVisionCatalogAuditor)->audit($path);

        self::assertSame(152, $audit->actualCount);
        self::assertSame(153, $audit->declaredCount);
        self::assertSame([
            'Xavfsizlik parametrlari' => 50,
            'Yo‘l bo‘yi infratuzilma elementlari reyestri' => 83,
            'Yo‘l qoplamasi' => 19,
        ], $audit->directionCounts);
        self::assertSame(
            ['DECLARED_COUNT_MISMATCH', 'SUMMARY_SUBTOTAL_MISMATCH'],
            array_column($audit->issues, 'code'),
        );
        self::assertSame('Yo‘l qoplamasi', $audit->rows[0]['direction']);
        self::assertArrayNotHasKey('description', $audit->rows[0]);
    }
}
