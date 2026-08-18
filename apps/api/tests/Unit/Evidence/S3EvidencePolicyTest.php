<?php

namespace Tests\Unit\Evidence;

use App\Domain\Evidence\EvidencePolicyException;
use App\Domain\Evidence\S3EvidencePolicy;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class S3EvidencePolicyTest extends TestCase
{
    public function test_it_accepts_only_the_configured_bucket_prefix_type_and_checksum(): void
    {
        $policy = $this->policy();
        $object = $policy->object(
            's3://roadops-evidence/results/2026/photo%201.png',
            'image/png',
            str_repeat('a', 64),
        );

        self::assertSame('roadops-evidence', $object->bucket);
        self::assertSame('results/2026/photo 1.png', $object->key);

        foreach ([
            's3://other-bucket/results/photo.png',
            's3://roadops-evidence/private/photo.png',
            's3://roadops-evidence/results',
            's3://roadops-evidence/results/photo.png?versionId=unsafe',
        ] as $uri) {
            try {
                $policy->object($uri, 'image/png', str_repeat('a', 64));
                self::fail('An out-of-scope object URI was accepted.');
            } catch (EvidencePolicyException $exception) {
                self::assertSame('EVIDENCE_SOURCE_NOT_ALLOWED', $exception->errorCode);
            }
        }
    }

    public function test_it_requires_and_accepts_matching_full_object_native_sha256(): void
    {
        $policy = $this->policy();
        $object = $policy->object(
            's3://roadops-evidence/results/photo.png',
            'image/png',
            str_repeat('a', 64),
        );
        $base = [
            'ContentLength' => 1024,
            'ContentType' => 'image/png',
            'ETag' => '"immutable-etag"',
        ];
        $native = $policy->validateHeadMetadata($object, $base + [
            'Metadata' => ['sha256' => str_repeat('a', 64)],
            'ChecksumSHA256' => base64_encode((string) hex2bin(str_repeat('a', 64))),
            'ChecksumType' => 'FULL_OBJECT',
        ]);
        self::assertSame(1024, $native['contentLength']);
        self::assertSame('image/png', $native['contentType']);
    }

    #[DataProvider('unsafeMetadata')]
    public function test_it_fails_closed_for_unverifiable_or_mismatched_metadata(
        array $metadata,
        string $errorCode,
    ): void {
        $policy = $this->policy();
        $object = $policy->object(
            's3://roadops-evidence/results/photo.png',
            'image/png',
            str_repeat('a', 64),
        );

        try {
            $policy->validateHeadMetadata($object, $metadata);
            self::fail('Unsafe S3 metadata was accepted.');
        } catch (EvidencePolicyException $exception) {
            self::assertSame($errorCode, $exception->errorCode);
        }
    }

    /** @return iterable<string, array{array<string, mixed>, string}> */
    public static function unsafeMetadata(): iterable
    {
        $base = [
            'ContentLength' => 1024,
            'ContentType' => 'image/png',
            'ETag' => '"immutable-etag"',
        ];
        $verifiable = $base + [
            'ChecksumSHA256' => base64_encode((string) hex2bin(str_repeat('a', 64))),
            'ChecksumType' => 'FULL_OBJECT',
        ];

        yield 'checksum missing' => [$base, 'EVIDENCE_CHECKSUM_UNAVAILABLE'];
        yield 'custom metadata is not a substitute' => [$base + [
            'Metadata' => ['sha256' => str_repeat('a', 64)],
        ], 'EVIDENCE_CHECKSUM_UNAVAILABLE'];
        yield 'custom checksum mismatch' => [$base + [
            'Metadata' => ['sha256' => str_repeat('b', 64)],
        ], 'EVIDENCE_CHECKSUM_MISMATCH'];
        yield 'native composite checksum' => [$base + [
            'ChecksumSHA256' => base64_encode((string) hex2bin(str_repeat('a', 64))),
            'ChecksumType' => 'COMPOSITE',
        ], 'EVIDENCE_CHECKSUM_TYPE_REJECTED'];
        yield 'native checksum mismatch' => [$base + [
            'ChecksumSHA256' => base64_encode((string) hex2bin(str_repeat('b', 64))),
            'ChecksumType' => 'FULL_OBJECT',
        ], 'EVIDENCE_CHECKSUM_MISMATCH'];
        yield 'stored content type mismatch' => [array_replace($verifiable, [
            'ContentType' => 'image/jpeg',
            'Metadata' => ['sha256' => str_repeat('a', 64)],
        ]), 'EVIDENCE_CONTENT_TYPE_REJECTED'];
        yield 'oversize object' => [array_replace($verifiable, [
            'ContentLength' => 2049,
            'Metadata' => ['sha256' => str_repeat('a', 64)],
        ]), 'EVIDENCE_SIZE_REJECTED'];
    }

    private function policy(): S3EvidencePolicy
    {
        return new S3EvidencePolicy('roadops-evidence', 'us-east-1', 'results', 2048);
    }
}
