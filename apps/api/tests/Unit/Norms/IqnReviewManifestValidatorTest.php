<?php

namespace Tests\Unit\Norms;

use App\Domain\Norms\IqnReviewManifestValidator;
use PHPUnit\Framework\TestCase;

final class IqnReviewManifestValidatorTest extends TestCase
{
    private const ACCEPTED_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    private const REJECTED_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    public function test_complete_explicit_review_can_validate(): void
    {
        $result = (new IqnReviewManifestValidator)->validate(
            $this->manifest(),
            $this->stagedRows(),
            'iqn_02',
        );

        self::assertCount(2, $result['decisions']);
        self::assertSame('approved', $result['catalog']['variants'][0]['interpretation_status']);
    }

    public function test_an_undecided_source_row_blocks_publication(): void
    {
        $manifest = $this->manifest();
        array_pop($manifest['row_decisions']);

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('Every staged row needs an explicit decision');

        (new IqnReviewManifestValidator)->validate($manifest, $this->stagedRows(), 'iqn_02');
    }

    public function test_ambiguous_accepted_row_requires_an_explicit_resolution(): void
    {
        $manifest = $this->manifest();
        unset($manifest['row_decisions'][0]['ambiguity_resolution']);

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('ambiguity_resolution');

        (new IqnReviewManifestValidator)->validate($manifest, $this->stagedRows(), 'iqn_02');
    }

    public function test_catalog_entity_must_be_claimed_by_its_accepted_canonical_payload(): void
    {
        $manifest = $this->manifest();
        $manifest['row_decisions'][0]['canonical_payload']['catalog_keys'] = [];

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('key is not claimed');

        (new IqnReviewManifestValidator)->validate($manifest, $this->stagedRows(), 'iqn_02');
    }

    /** @return list<array{provenance_hash:string,ambiguity_flags:list<string>}> */
    private function stagedRows(): array
    {
        return [
            ['provenance_hash' => self::ACCEPTED_HASH, 'ambiguity_flags' => ['VERTICAL_MERGE_CONTINUATION']],
            ['provenance_hash' => self::REJECTED_HASH, 'ambiguity_flags' => []],
        ];
    }

    /** @return array<string,mixed> */
    private function manifest(): array
    {
        $source = ['row_provenance_hash' => self::ACCEPTED_HASH, 'table_index' => 3, 'row_index' => 2];

        return [
            'document' => [
                'code' => 'IQN-02-24',
                'title' => 'Reviewed IQN fixture',
                'revision' => '24',
                'document_kind' => 'iqn_02',
                'effective_from' => '2026-01-01',
            ],
            'row_decisions' => [
                [
                    'provenance_hash' => self::ACCEPTED_HASH,
                    'decision' => 'accepted',
                    'review_note' => 'Expert verified the logical merged row.',
                    'ambiguity_resolution' => 'Continuation inherits the restart cell above.',
                    'canonical_payload' => [
                        'role' => 'norm_source',
                        'catalog_keys' => [
                            'section-1', 'work-1', 'variant-1',
                            'resource-1', 'norm-set-1', 'line-1',
                        ],
                    ],
                ],
                [
                    'provenance_hash' => self::REJECTED_HASH,
                    'decision' => 'rejected',
                    'review_note' => 'Header-only row is not a norm.',
                    'canonical_payload' => null,
                ],
            ],
            'catalog' => [
                'sections' => [[
                    'key' => 'section-1', 'sequence_number' => 1,
                    'raw_heading' => 'Section', 'normalized_heading' => 'Section',
                    'source_location' => $source,
                ]],
                'work_items' => [[
                    'key' => 'work-1', 'section_key' => 'section-1', 'source_sequence' => 1,
                    'raw_name' => 'Work', 'normalized_name' => 'Work', 'item_kind' => 'task',
                    'source_location' => $source,
                ]],
                'variants' => [[
                    'key' => 'variant-1', 'work_item_key' => 'work-1', 'variant_key' => 'v1',
                    'basis_quantity' => '100', 'basis_unit' => 'm2', 'formula_type' => 'linear',
                    'formula_parameters' => ['reviewed' => true],
                    'interpretation_status' => 'approved', 'planning_status' => 'automatic',
                    'source_location' => $source,
                ]],
                'resources' => [[
                    'key' => 'resource-1', 'resource_kind' => 'labor',
                    'raw_name' => 'Labor', 'normalized_name' => 'Labor', 'unit' => 'person_hour',
                    'source_location' => $source,
                ]],
                'norm_sets' => [[
                    'key' => 'norm-set-1', 'variant_key' => 'variant-1', 'norm_set_key' => 'base',
                    'status' => 'approved', 'effective_from' => '2026-01-01',
                    'source_location' => $source,
                ]],
                'norm_lines' => [[
                    'key' => 'line-1', 'norm_set_key' => 'norm-set-1', 'resource_key' => 'resource-1',
                    'source_line_number' => 1, 'quantity_per_basis' => '1.05',
                    'minutes_per_basis' => '63', 'unit' => 'person_hour',
                    'source_location' => $source,
                ]],
            ],
        ];
    }
}
