<?php

namespace Tests\Unit\Norms;

use App\Domain\Norms\Iqn02DocxStager;
use App\Domain\Norms\Iqn03LayoutJsonStager;
use PHPUnit\Framework\TestCase;

final class IqnPublicationSecurityContractTest extends TestCase
{
    public function test_both_uploaded_iqn_sources_are_checksum_gated(): void
    {
        self::assertSame(
            '443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177',
            Iqn02DocxStager::APPROVED_SOURCE_SHA256,
        );
        self::assertSame(
            'f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e',
            Iqn03LayoutJsonStager::APPROVED_SOURCE_SHA256,
        );
        self::assertSame(51, Iqn03LayoutJsonStager::APPROVED_PAGE_COUNT);
    }

    public function test_cli_consumes_a_persisted_approval_instead_of_accepting_identity_or_manifest(): void
    {
        $command = $this->source('app/Console/Commands/PublishIqnCatalogCommand.php');
        self::assertStringNotContainsString('review-manifest', $command);
        self::assertStringNotContainsString('reviewed-by', $command);
        self::assertStringContainsString(
            '$publisher->publish((string) $this->argument(\'batch\'))',
            $command,
        );

        $publisher = $this->source('app/Domain/Norms/IqnCatalogPublisher.php');
        self::assertStringNotContainsString('file_get_contents', $publisher);
        self::assertStringContainsString("review_state !== 'validated'", $publisher);
        self::assertStringContainsString('reviewer_session_id', $publisher);
        self::assertStringContainsString('approval_request_id', $publisher);
        self::assertStringContainsString('membership.division_id is null', $publisher);
        self::assertStringContainsString("permission.code in ('catalog.manage', 'system.all')", $publisher);
        self::assertStringContainsString('session_user::text publisher_db_role', $publisher);
        self::assertStringContainsString('(approval_expires_at > clock_timestamp())::integer', $publisher);
        self::assertStringContainsString('clock_timestamp() <= approval_expires_at', $publisher);
        self::assertStringNotContainsString("new \\DateTimeImmutable('now')", $publisher);
        self::assertStringContainsString('count($stagedRows)', $publisher);
        self::assertStringContainsString('$acceptedRowCount', $publisher);
        self::assertStringContainsString("set review_state = 'published'", $publisher);
    }

    public function test_authenticated_approval_and_database_policy_bind_the_real_actor_session_and_request(): void
    {
        $controller = $this->source('app/Http/Controllers/Api/V1/IqnReviewApprovalController.php');
        self::assertStringContainsString(
            'array_key_exists(\'reviewer_attestation\', $manifest)',
            $controller,
        );
        self::assertStringContainsString(
            "'reviewed_by' => strtolower(\$context->userId)",
            $controller,
        );
        self::assertStringContainsString('$context->sessionId', $controller);
        self::assertStringContainsString("'validated', ?::uuid", $controller);

        $migration = $this->source('database/migrations/20260818000800_iqn_publication_fail_closed.sql');
        self::assertStringContainsString("roadops.has_permission('catalog.manage', null)", $migration);
        self::assertStringContainsString('reviewed_by = roadops.current_actor_id()', $migration);
        self::assertStringContainsString('reviewer_session_id = roadops.current_session_id()', $migration);
        self::assertStringContainsString('approval_request_id = roadops.current_request_id()', $migration);
        self::assertStringContainsString('canonical_manifest_hash', $migration);
        self::assertStringContainsString('approved_source_sha256', $migration);
        self::assertStringContainsString('iqn_import_reviews_audit', $migration);
        self::assertStringContainsString(
            'revoke insert, delete, update on roadops.iqn_import_reviews from roadops_sync',
            $migration,
        );
        self::assertStringContainsString('guard_iqn_review_publication', $migration);
        self::assertStringContainsString("old.review_state <> 'validated'", $migration);
        self::assertStringContainsString("new.review_state <> 'published'", $migration);
        self::assertStringContainsString('iqn_staged_blocks_reviewed_by_idx', $migration);
        self::assertStringContainsString('iqn_staged_rows_reviewed_by_idx', $migration);
        self::assertStringContainsString('iqn_import_reviews_reviewer_session_idx', $migration);
        self::assertStringContainsString('iqn_import_reviews_reviewed_by_idx', $migration);
        self::assertStringContainsString(Iqn02DocxStager::APPROVED_SOURCE_SHA256, $migration);
        self::assertStringContainsString(Iqn03LayoutJsonStager::APPROVED_SOURCE_SHA256, $migration);
    }

    public function test_validator_requires_exact_block_and_row_coverage_and_a_nonempty_catalog(): void
    {
        $validator = $this->source('app/Domain/Norms/IqnReviewManifestValidator.php');
        self::assertStringContainsString("'block_decisions'", $validator);
        self::assertStringContainsString("'row_decisions'", $validator);
        self::assertStringContainsString('Every staged %s needs an explicit decision', $validator);
        self::assertStringContainsString("['work_items', 'variants', 'resources', 'norm_sets', 'norm_lines']", $validator);
        self::assertStringContainsString('canonical_manifest_sha256', $validator);
    }

    private function source(string $relativePath): string
    {
        $contents = file_get_contents(dirname(__DIR__, 3).'/'.$relativePath);
        self::assertIsString($contents);

        return $contents;
    }
}
