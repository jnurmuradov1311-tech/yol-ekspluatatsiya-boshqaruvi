<?php

namespace Tests\Unit\Norms;

use App\Domain\Norms\IqnReviewManifestValidator;
use PHPUnit\Framework\TestCase;

final class IqnReviewManifestValidatorTest extends TestCase
{
    private const ACCEPTED_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    private const REJECTED_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    private const BLOCK_HASH = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

    private const SOURCE_SHA256 = '443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177';

    private const BATCH_ID = '10000000-0000-4000-8000-000000000001';

    private const REVIEWER_ID = '10000000-0000-4000-8000-000000000002';

    private const ATTESTATION_ID = '10000000-0000-4000-8000-000000000003';

    public function test_complete_explicit_review_can_validate(): void
    {
        $result = $this->validate($this->manifest());

        self::assertCount(1, $result['block_decisions']);
        self::assertCount(2, $result['row_decisions']);
        self::assertCount(29, $result['catalog']['work_items']);
        self::assertSame('approved', $result['catalog']['variants'][0]['interpretation_status']);
        self::assertSame(self::REVIEWER_ID, $result['reviewer_attestation']['reviewed_by']);
    }

    public function test_iqn_02_publication_requires_all_29_inspection_topics(): void
    {
        $manifest = $this->manifest();
        array_pop($manifest['catalog']['work_items']);

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('requires exactly 29 approved top-level manual inspection topics; 28 were provided');

        $this->validate($manifest);
    }

    public function test_iqn_02_inspection_topic_numbers_must_be_unique(): void
    {
        $manifest = $this->manifest();
        $manifest['catalog']['work_items'][1]['source_location']['topic_number'] = 1;

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('Duplicate IQN 02 manual inspection topic_number 1');

        $this->validate($manifest);
    }

    public function test_iqn_02_inspection_topic_number_must_be_in_source_range(): void
    {
        $manifest = $this->manifest();
        $manifest['catalog']['work_items'][28]['source_location']['topic_number'] = 30;

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('topic_number must be an integer from 1 through 29');

        $this->validate($manifest);
    }

    public function test_iqn_02_inspection_topic_must_be_a_top_level_group(): void
    {
        $manifest = $this->manifest();
        $manifest['catalog']['work_items'][1]['parent_key'] = 'work-1';

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('must be a top-level work item');

        $this->validate($manifest);
    }

    public function test_iqn_02_inspection_topic_cannot_be_published_as_a_task(): void
    {
        $manifest = $this->manifest();
        $manifest['catalog']['work_items'][0]['item_kind'] = 'task';

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('must have item_kind=group');

        $this->validate($manifest);
    }

    public function test_an_undecided_source_row_blocks_publication(): void
    {
        $manifest = $this->manifest();
        array_pop($manifest['row_decisions']);

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('Every staged row needs an explicit decision');

        $this->validate($manifest);
    }

    public function test_an_undecided_source_block_blocks_publication(): void
    {
        $manifest = $this->manifest();
        $manifest['block_decisions'] = [];

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('Every staged block needs an explicit decision');

        $this->validate($manifest);
    }

    public function test_duplicate_source_decision_blocks_publication(): void
    {
        $manifest = $this->manifest();
        $manifest['row_decisions'][] = $manifest['row_decisions'][0];

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('Duplicate row decision');

        $this->validate($manifest);
    }

    public function test_ambiguous_accepted_row_requires_an_explicit_resolution(): void
    {
        $manifest = $this->manifest();
        unset($manifest['row_decisions'][0]['ambiguity_resolution']);

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('ambiguity_resolution');

        $this->validate($manifest);
    }

    public function test_catalog_entity_must_be_claimed_by_its_accepted_canonical_payload(): void
    {
        $manifest = $this->manifest();
        $manifest['row_decisions'][0]['canonical_payload']['catalog_keys'] = [];

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('key is not claimed');

        $this->validate($manifest);
    }

    public function test_accepted_source_cannot_claim_a_phantom_catalog_key(): void
    {
        $manifest = $this->manifest();
        $manifest['row_decisions'][0]['canonical_payload']['catalog_keys'][] = 'phantom-key';

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('1 phantom claims and 0 unclaimed records');

        $this->validate($manifest);
    }

    public function test_catalog_entity_can_be_backed_by_an_accepted_source_block(): void
    {
        $manifest = $this->manifest();
        $manifest['block_decisions'][0] = [
            'provenance_hash' => self::BLOCK_HASH,
            'decision' => 'accepted',
            'review_note' => 'Expert approved the section heading block.',
            'canonical_payload' => [
                'role' => 'catalog_heading_source',
                'catalog_keys' => ['section-1'],
            ],
        ];
        $manifest['row_decisions'][0]['canonical_payload']['catalog_keys'] = array_values(array_filter(
            $manifest['row_decisions'][0]['canonical_payload']['catalog_keys'],
            fn (string $key): bool => $key !== 'section-1',
        ));
        $manifest['catalog']['sections'][0]['source_location'] = [
            'block_provenance_hash' => self::BLOCK_HASH,
            'block_sequence' => 1,
        ];

        $result = $this->validate($manifest);

        self::assertSame('accepted', $result['block_decisions'][self::BLOCK_HASH]['decision']);
    }

    public function test_catalog_source_must_identify_exactly_one_block_or_row(): void
    {
        $manifest = $this->manifest();
        $manifest['catalog']['sections'][0]['source_location']['block_provenance_hash'] = self::BLOCK_HASH;

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('must identify exactly one staged block or row');

        $this->validate($manifest);
    }

    public function test_iqn_03_empty_catalog_cannot_be_published(): void
    {
        $manifest = $this->manifest();
        $manifest['document']['document_kind'] = 'iqn_03';
        foreach (array_keys($manifest['catalog']) as $collection) {
            $manifest['catalog'][$collection] = [];
        }
        $manifest['row_decisions'][0]['canonical_payload']['catalog_keys'] = [];

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('IQN 03 catalog.work_items cannot be empty');

        $this->validate($manifest, 'iqn_03');
    }

    public function test_attestation_must_match_the_command_reviewer(): void
    {
        $manifest = $this->attest(
            $this->manifest(),
            '10000000-0000-4000-8000-000000000099',
        );

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('does not match the authenticated reviewer');

        $this->validateAttested($manifest);
    }

    public function test_body_tampering_after_attestation_is_rejected(): void
    {
        $manifest = $this->attest($this->manifest());
        $manifest['catalog']['resources'][0]['normalized_name'] = 'Changed after approval';

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('does not match the canonical review payload');

        $this->validateAttested($manifest);
    }

    /** @return list<array{provenance_hash:string,ambiguity_flags:list<string>}> */
    private function stagedBlocks(): array
    {
        return [
            ['provenance_hash' => self::BLOCK_HASH, 'ambiguity_flags' => []],
        ];
    }

    /** @return list<array{provenance_hash:string,ambiguity_flags:list<string>}> */
    private function stagedRows(): array
    {
        return [
            ['provenance_hash' => self::ACCEPTED_HASH, 'ambiguity_flags' => ['VERTICAL_MERGE_CONTINUATION']],
            ['provenance_hash' => self::REJECTED_HASH, 'ambiguity_flags' => []],
        ];
    }

    /**
     * @param  array<string, mixed>  $manifest
     * @return array<string, mixed>
     */
    private function validate(array $manifest, string $documentKind = 'iqn_02'): array
    {
        return $this->validateAttested($this->attest($manifest), $documentKind);
    }

    /**
     * @param  array<string, mixed>  $manifest
     * @return array<string, mixed>
     */
    private function validateAttested(array $manifest, string $documentKind = 'iqn_02'): array
    {
        return (new IqnReviewManifestValidator)->validate(
            $manifest,
            $this->stagedBlocks(),
            $this->stagedRows(),
            $documentKind,
            self::BATCH_ID,
            self::SOURCE_SHA256,
            self::REVIEWER_ID,
        );
    }

    /**
     * @param  array<string, mixed>  $manifest
     * @return array<string, mixed>
     */
    private function attest(array $manifest, string $reviewedBy = self::REVIEWER_ID): array
    {
        $validator = new IqnReviewManifestValidator;
        $manifest['reviewer_attestation'] = [
            'attestation_id' => self::ATTESTATION_ID,
            'canonical_manifest_sha256' => $validator->reviewPayloadHash($manifest),
            'confirmation' => 'IQN_CATALOG_REVIEW_APPROVED',
            'confirmed_at' => '2026-08-18T12:00:00+05:00',
            'expires_at' => '2026-08-19T12:00:00+05:00',
            'import_batch_id' => self::BATCH_ID,
            'reviewed_by' => $reviewedBy,
            'source_sha256' => self::SOURCE_SHA256,
        ];

        return $manifest;
    }

    /** @return array<string,mixed> */
    private function manifest(): array
    {
        $source = ['row_provenance_hash' => self::ACCEPTED_HASH, 'table_index' => 3, 'row_index' => 2];
        $workItems = [];
        for ($topicNumber = 1; $topicNumber <= 29; $topicNumber++) {
            $workItems[] = [
                'key' => 'work-'.$topicNumber,
                'section_key' => 'section-1',
                'source_sequence' => $topicNumber,
                'raw_name' => "IQN topic {$topicNumber}",
                'normalized_name' => "IQN topic {$topicNumber}",
                'item_kind' => 'group',
                'source_location' => [
                    ...$source,
                    'catalog_role' => 'manual_inspection_topic',
                    'topic_number' => $topicNumber,
                ],
            ];
        }

        return [
            'document' => [
                'code' => 'IQN-02-24',
                'title' => 'Reviewed IQN fixture',
                'revision' => '24',
                'document_kind' => 'iqn_02',
                'effective_from' => '2026-01-01',
            ],
            'block_decisions' => [[
                'provenance_hash' => self::BLOCK_HASH,
                'decision' => 'rejected',
                'review_note' => 'Decorative paragraph is not a catalog source.',
                'canonical_payload' => null,
            ]],
            'row_decisions' => [
                [
                    'provenance_hash' => self::ACCEPTED_HASH,
                    'decision' => 'accepted',
                    'review_note' => 'Expert verified the logical merged row.',
                    'ambiguity_resolution' => 'Continuation inherits the restart cell above.',
                    'canonical_payload' => [
                        'role' => 'norm_source',
                        'catalog_keys' => [
                            'section-1', ...array_column($workItems, 'key'), 'variant-1',
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
                'work_items' => $workItems,
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
