<?php

namespace Tests\Feature;

use App\Domain\Evidence\S3EvidenceStreamer;
use App\Http\Controllers\Api\V1\ManualInspectionController;
use App\Http\Controllers\Api\V1\RoadVisionFindingController;
use ReflectionClass;
use ReflectionMethod;
use Tests\TestCase;

final class EvidenceMediaSecurityTest extends TestCase
{
    public function test_private_evidence_uses_indexed_authorized_routes(): void
    {
        $routes = (string) file_get_contents(base_path('routes/api.php'));
        $roadVision = $this->source(RoadVisionFindingController::class);
        $manual = $this->source(ManualInspectionController::class);
        $streamer = $this->source(S3EvidenceStreamer::class);

        self::assertStringContainsString("/roadvision/findings/{id}/evidence/{index}", $routes);
        self::assertStringContainsString("/manual-inspections/{id}/observations/{observationId}/evidence/{index}", $routes);
        self::assertStringContainsString("roadops.permission:defects.read', 'throttle:60,1", $routes);
        self::assertStringContainsString("'evidence' => \$this->roadVisionEvidence", $roadVision);
        self::assertStringContainsString("'evidence' => \$this->manualEvidence", $manual);
        self::assertStringContainsString("'ChecksumMode' => 'ENABLED'", $streamer);
        self::assertStringContainsString("'Cross-Origin-Resource-Policy' => 'same-origin'", $streamer);
    }

    public function test_manual_capture_requires_checksum_and_separate_store_scope(): void
    {
        $manual = $this->source(ManualInspectionController::class);
        $configuration = (string) file_get_contents(config_path('roadops.php'));

        self::assertStringContainsString("'evidence.*.sha256' => ['required'", $manual);
        self::assertStringContainsString("config('roadops.manual_evidence'", $manual);
        self::assertStringContainsString("'s3_region' => env('MANUAL_EVIDENCE_S3_REGION')", $configuration);
        self::assertStringContainsString("'s3_prefix' => env('MANUAL_EVIDENCE_S3_PREFIX'", $configuration);
        self::assertStringContainsString("'evidence_max_bytes' => (int) env('MANUAL_EVIDENCE_MAX_BYTES'", $configuration);
    }

    public function test_roadvision_payload_returns_every_complete_media_item_without_s3_uri(): void
    {
        $method = new ReflectionMethod(RoadVisionFindingController::class, 'roadVisionEvidence');
        $findingId = '11111111-1111-4111-8111-111111111111';
        $media = [
            [
                'media_id' => 'media-1',
                'object_uri' => 's3://private/results/one.jpg',
                'content_type' => 'image/jpeg',
                'sha256' => str_repeat('a', 64),
                'captured_at' => '2026-08-18T08:00:00Z',
            ],
            [
                'media_id' => 'media-2',
                'object_uri' => 's3://private/results/two.mp4',
                'content_type' => 'video/mp4',
                'sha256' => str_repeat('b', 64),
                'captured_at' => '2026-08-18T08:01:00Z',
            ],
        ];

        $result = $method->invoke(new RoadVisionFindingController, json_encode($media), $findingId);

        self::assertIsArray($result);
        self::assertCount(2, $result);
        self::assertSame('/api/v1/roadvision/findings/'.$findingId.'/evidence/0', $result[0]['url']);
        self::assertSame('/api/v1/roadvision/findings/'.$findingId.'/evidence/1', $result[1]['url']);
        self::assertArrayNotHasKey('objectUri', $result[0]);
        self::assertStringNotContainsString('s3://', json_encode($result, JSON_THROW_ON_ERROR));
    }

    /** @param class-string $class */
    private function source(string $class): string
    {
        $path = (new ReflectionClass($class))->getFileName();
        self::assertIsString($path);

        return (string) file_get_contents($path);
    }
}
