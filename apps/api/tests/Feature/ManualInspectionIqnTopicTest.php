<?php

namespace Tests\Feature;

use App\Domain\Norms\IqnReviewManifestValidator;
use App\Http\Controllers\Api\V1\ManualInspectionController;
use ReflectionClass;
use Tests\TestCase;

final class ManualInspectionIqnTopicTest extends TestCase
{
    public function test_manual_options_fail_closed_to_the_29_published_iqn_topics(): void
    {
        $controller = $this->source(ManualInspectionController::class);

        self::assertStringContainsString("document.document_kind = 'iqn_02'", $controller);
        self::assertStringContainsString("review.review_state = 'published'", $controller);
        self::assertStringContainsString("'catalog_role' = 'manual_inspection_topic'", $controller);
        self::assertStringContainsString('count($workTopics) !== 29', $controller);
        self::assertStringContainsString('$topicNumbers !== range(1, 29)', $controller);
        self::assertStringContainsString('IQN_TOPICS_NOT_APPROVED', $controller);
        self::assertStringNotContainsString("'defectTypes' =>", $controller);
    }

    public function test_manual_capture_preserves_topic_provenance_and_uses_one_location(): void
    {
        $controller = $this->source(ManualInspectionController::class);
        $migration = (string) file_get_contents(database_path(
            'migrations/20260818000300_manual_inspection_iqn_topics.sql',
        ));

        self::assertStringContainsString("'iqnTopicId' => ['required', 'uuid']", $controller);
        self::assertStringContainsString('iqn_topic_work_item_id', $controller);
        self::assertStringContainsString("(int) \$validated['chainageStartM'] + 1", $controller);
        self::assertStringContainsString('CHAINAGE_OUTSIDE_ROAD', $controller);
        self::assertStringContainsString('validate_manual_inspection_iqn_topic', $migration);
        self::assertStringContainsString('copy_manual_inspection_iqn_topic', $migration);
    }

    public function test_iqn_publication_requires_all_top_level_topic_markers(): void
    {
        $validator = $this->source(IqnReviewManifestValidator::class);

        self::assertStringContainsString('manual_inspection_topic', $validator);
        self::assertStringContainsString('range(1, 29)', $validator);
        self::assertStringContainsString('item_kind', $validator);
        self::assertStringContainsString('parent_key', $validator);
    }

    /** @param class-string $class */
    private function source(string $class): string
    {
        $path = (new ReflectionClass($class))->getFileName();
        self::assertIsString($path);

        return (string) file_get_contents($path);
    }
}
