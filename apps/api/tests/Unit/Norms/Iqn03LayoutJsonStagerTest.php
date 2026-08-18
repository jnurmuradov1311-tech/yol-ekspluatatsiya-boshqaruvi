<?php

namespace Tests\Unit\Norms;

use App\Domain\Norms\Iqn03LayoutJsonStager;
use PHPUnit\Framework\TestCase;

final class Iqn03LayoutJsonStagerTest extends TestCase
{
    public function test_complete_layout_is_staged_without_dropping_placeholder_cells_or_geometry(): void
    {
        $result = (new Iqn03LayoutJsonStager)->stagePayload(
            $this->payload(),
            Iqn03LayoutJsonStager::APPROVED_SOURCE_SHA256,
            str_repeat('a', 64),
        );

        self::assertSame('iqn03-layout-json-1-aaaaaaaaaaaa', $result['parser_version']);
        self::assertSame(51, $result['counts']['page_count']);
        self::assertSame(2, $result['counts']['block_count']);
        self::assertSame(1, $result['counts']['table_row_count']);
        self::assertSame(2, $result['counts']['table_cell_slot_count']);
        self::assertSame(1, $result['counts']['non_placeholder_cell_count']);
        self::assertCount(2, $result['blocks']);
        self::assertCount(1, $result['tables']);

        $row = $result['tables'][0]['rows'][0];
        self::assertSame([50, 200, 300, 240], $row['bbox']);
        self::assertSame(1, $row['physical_cell_count']);
        self::assertSame(2, $row['logical_column_count']);
        self::assertSame([50, 200, 200, 240], $row['cells'][0]['bbox']);
        self::assertNull($row['cells'][1]['bbox']);
        self::assertNull($row['cells'][1]['raw_text']);
        self::assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $row['provenance_hash']);
        self::assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $row['cells'][0]['provenance_hash']);
    }

    public function test_provenance_is_deterministic_for_identical_layout_content(): void
    {
        $stager = new Iqn03LayoutJsonStager;
        $first = $stager->stagePayload($this->payload(), Iqn03LayoutJsonStager::APPROVED_SOURCE_SHA256);
        $second = $stager->stagePayload($this->payload(), Iqn03LayoutJsonStager::APPROVED_SOURCE_SHA256);

        self::assertSame(
            $first['tables'][0]['rows'][0]['provenance_hash'],
            $second['tables'][0]['rows'][0]['provenance_hash'],
        );
        self::assertSame(
            $first['tables'][0]['rows'][0]['cells'][0]['provenance_hash'],
            $second['tables'][0]['rows'][0]['cells'][0]['provenance_hash'],
        );
    }

    public function test_unapproved_or_mismatched_source_hash_is_rejected(): void
    {
        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('source checksum is not approved');

        (new Iqn03LayoutJsonStager)->stagePayload($this->payload(), str_repeat('0', 64));
    }

    public function test_declared_counts_prevent_silent_row_or_cell_loss(): void
    {
        $payload = $this->payload();
        $payload['pages'][0]['blocks'][1]['rows'][0]['cells'] = [
            $payload['pages'][0]['blocks'][1]['rows'][0]['cells'][0],
        ];

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('table_cell_slot_count declares 2, but 1 records were validated');

        (new Iqn03LayoutJsonStager)->stagePayload(
            $payload,
            Iqn03LayoutJsonStager::APPROVED_SOURCE_SHA256,
        );
    }

    public function test_duplicate_word_sequence_is_rejected_even_when_counts_match(): void
    {
        $payload = $this->payload();
        $payload['pages'][0]['blocks'][1]['rows'][0]['cells'][0]['words'][0]['word_sequence'] = 1;

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('Duplicate word_sequence 1');

        (new Iqn03LayoutJsonStager)->stagePayload(
            $payload,
            Iqn03LayoutJsonStager::APPROVED_SOURCE_SHA256,
        );
    }

    public function test_published_schema_locks_the_exact_approved_source(): void
    {
        $path = dirname(__DIR__, 5).'/docs/iqn/schemas/iqn03-layout-json-v1.schema.json';
        $schema = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);

        self::assertSame(
            Iqn03LayoutJsonStager::APPROVED_SOURCE_SHA256,
            $schema['properties']['source']['properties']['sha256']['const'],
        );
        self::assertSame(51, $schema['properties']['source']['properties']['page_count']['const']);
        self::assertSame(
            'expert_review_required',
            $schema['properties']['approval']['properties']['norm_interpretation']['const'],
        );
    }

    /** @return array<string, mixed> */
    private function payload(): array
    {
        $pages = [];
        for ($pageNumber = 1; $pageNumber <= 51; $pageNumber++) {
            $pages[] = [
                'page_number' => $pageNumber,
                'width' => 595.32,
                'height' => 841.92,
                'rotation' => 0,
                'blocks' => [],
            ];
        }
        $pages[0]['blocks'] = [
            [
                'block_sequence' => 1,
                'block_kind' => 'text',
                'bbox' => [50, 100, 180, 115],
                'raw_text' => 'Йиллик сақлаш дастури',
                'words' => [
                    [
                        'word_sequence' => 1,
                        'text' => 'Йиллик',
                        'bbox' => [50, 100, 80, 115],
                        'doctop' => 100,
                        'upright' => true,
                        'direction' => 'ltr',
                    ],
                ],
                'ambiguity_flags' => [],
            ],
            [
                'block_sequence' => 2,
                'block_kind' => 'table',
                'table_index' => 1,
                'bbox' => [50, 200, 300, 240],
                'raw_text' => "Иш тури\t",
                'orphan_words' => [],
                'rows' => [
                    [
                        'row_index' => 1,
                        'bbox' => [50, 200, 300, 240],
                        'cells' => [
                            [
                                'column_index' => 1,
                                'is_placeholder' => false,
                                'bbox' => [50, 200, 200, 240],
                                'raw_text' => 'Иш тури',
                                'words' => [
                                    [
                                        'word_sequence' => 2,
                                        'text' => 'Иш',
                                        'bbox' => [60, 210, 75, 225],
                                        'doctop' => 210,
                                        'upright' => true,
                                        'direction' => 'ltr',
                                    ],
                                ],
                                'ambiguity_flags' => [],
                            ],
                            [
                                'column_index' => 2,
                                'is_placeholder' => true,
                                'bbox' => null,
                                'raw_text' => null,
                                'words' => [],
                                'ambiguity_flags' => ['PDF_MERGED_CELL_PLACEHOLDER'],
                            ],
                        ],
                        'ambiguity_flags' => ['PDF_MERGED_CELL_PLACEHOLDER'],
                    ],
                ],
                'ambiguity_flags' => [],
            ],
        ];

        return [
            'schema_version' => Iqn03LayoutJsonStager::SCHEMA_VERSION,
            'document_kind' => 'iqn_03',
            'coordinate_system' => Iqn03LayoutJsonStager::COORDINATE_SYSTEM,
            'source' => [
                'filename' => 'ИҚН 03-24 29.01.2025.pdf',
                'media_type' => 'application/pdf',
                'sha256' => Iqn03LayoutJsonStager::APPROVED_SOURCE_SHA256,
                'page_count' => 51,
                'pdf_version' => '1.5',
            ],
            'extractor' => [
                'name' => 'roadops-pdfplumber-layout',
                'version' => '1.0.0+pdfplumber-test',
            ],
            'approval' => [
                'layout_contract' => 'approved',
                'norm_interpretation' => 'expert_review_required',
            ],
            'counts' => [
                'page_count' => 51,
                'block_count' => 2,
                'text_block_count' => 1,
                'table_count' => 1,
                'table_row_count' => 1,
                'table_cell_slot_count' => 2,
                'non_placeholder_cell_count' => 1,
                'word_count' => 2,
            ],
            'pages' => $pages,
        ];
    }
}
