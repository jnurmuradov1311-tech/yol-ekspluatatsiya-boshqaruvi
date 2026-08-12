<?php

namespace Tests\Unit\Norms;

use App\Domain\Norms\RoadVisionCatalogReviewValidator;
use PHPUnit\Framework\TestCase;

final class RoadVisionCatalogReviewValidatorTest extends TestCase
{
    public function test_complete_hash_bound_classification_validates(): void
    {
        $result = (new RoadVisionCatalogReviewValidator)->validate(
            $this->manifest(),
            $this->stagedRows(),
        );

        self::assertCount(2, $result['rows']);
        self::assertSame('pothole', $result['rows']['1']['defect_type_code']);
    }

    public function test_missing_classification_blocks_publish(): void
    {
        $manifest = $this->manifest();
        array_pop($manifest['rows']);

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('Every staged RoadVision row needs an explicit classification');

        (new RoadVisionCatalogReviewValidator)->validate($manifest, $this->stagedRows());
    }

    public function test_normalized_name_collision_blocks_publish(): void
    {
        $rows = $this->stagedRows();
        $rows[1]['external_name'] = '  CHUQUR  ';

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('normalized-name collision');

        (new RoadVisionCatalogReviewValidator)->validate($this->manifest(), $rows);
    }

    /** @return list<array{external_code:string,external_name:string,row_hash:string}> */
    private function stagedRows(): array
    {
        return [
            ['external_code' => '1', 'external_name' => 'Chuqur', 'row_hash' => str_repeat('a', 64)],
            ['external_code' => '2', 'external_name' => 'Ko‘prik', 'row_hash' => str_repeat('b', 64)],
        ];
    }

    /** @return array<string,mixed> */
    private function manifest(): array
    {
        return [
            'catalog_revision' => 'rv-reviewed-v1',
            'active_from' => '2026-08-12',
            'review_note' => 'All source attributes explicitly classified.',
            'rows' => [
                [
                    'external_code' => '1', 'expected_row_hash' => str_repeat('a', 64),
                    'record_kind' => 'defect_candidate', 'defect_type_code' => 'pothole',
                    'review_note' => 'Mapped to approved pothole defect type.',
                ],
                [
                    'external_code' => '2', 'expected_row_hash' => str_repeat('b', 64),
                    'record_kind' => 'asset_observation',
                    'review_note' => 'Registry asset, not a defect candidate.',
                ],
            ],
        ];
    }
}
