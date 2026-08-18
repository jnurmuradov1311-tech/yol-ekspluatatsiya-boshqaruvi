<?php

namespace App\Domain\Evidence;

final readonly class S3EvidencePolicy
{
    /** @var list<string> */
    private const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'video/mp4'];

    public function __construct(
        public string $bucket,
        public string $region,
        public string $prefix,
        public int $maxBytes,
    ) {
        if (preg_match('/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/D', $bucket) !== 1
            || preg_match('/^[a-z0-9-]+$/D', $region) !== 1
            || $prefix === ''
            || str_starts_with($prefix, '/')
            || str_ends_with($prefix, '/')
            || str_contains($prefix, '//')
            || preg_match('#(?:^|/)(?:\.|\.\.)(?:/|$)#D', $prefix) === 1
            || preg_match('/[\\\\\x00-\x1f\x7f]/D', $prefix) === 1
            || $maxBytes < 1) {
            throw new EvidencePolicyException(
                'EVIDENCE_CONFIGURATION_INVALID',
                503,
                'Dalil saqlash hududi, regioni, prefiksi yoki hajm cheklovi to‘liq sozlanmagan.',
            );
        }
    }

    /** @param array<string, mixed> $configuration */
    public static function fromConfiguration(array $configuration): self
    {
        return new self(
            trim((string) ($configuration['s3_bucket'] ?? '')),
            trim((string) ($configuration['s3_region'] ?? '')),
            trim((string) ($configuration['s3_prefix'] ?? ''), '/'),
            (int) ($configuration['evidence_max_bytes'] ?? 0),
        );
    }

    public function object(string $uri, string $contentType, string $sha256): S3EvidenceObject
    {
        $parts = parse_url($uri);
        $scheme = is_array($parts) ? strtolower((string) ($parts['scheme'] ?? '')) : '';
        $bucket = is_array($parts) ? (string) ($parts['host'] ?? '') : '';
        $rawPath = is_array($parts) ? ltrim((string) ($parts['path'] ?? ''), '/') : '';
        $key = rawurldecode($rawPath);
        $hasForbiddenUriPart = ! is_array($parts)
            || array_key_exists('user', $parts)
            || array_key_exists('pass', $parts)
            || array_key_exists('port', $parts)
            || array_key_exists('query', $parts)
            || array_key_exists('fragment', $parts);
        $insidePrefix = $key !== $this->prefix
            && str_starts_with($key, $this->prefix.'/');

        if ($scheme !== 's3' || $hasForbiddenUriPart || ! hash_equals($this->bucket, $bucket)
            || $key === '' || ! $insidePrefix || ! mb_check_encoding($key, 'UTF-8')
            || preg_match('/[\x00-\x1f\x7f]/D', $key) === 1) {
            throw new EvidencePolicyException(
                'EVIDENCE_SOURCE_NOT_ALLOWED',
                422,
                'Dalil manbasi tasdiqlangan S3 bucket va prefiksiga tegishli emas.',
            );
        }
        if (! in_array($contentType, self::ALLOWED_CONTENT_TYPES, true)) {
            throw new EvidencePolicyException(
                'EVIDENCE_CONTENT_TYPE_REJECTED',
                415,
                'Dalil faylining turi ruxsat etilmagan.',
            );
        }
        if (preg_match('/^[a-f0-9]{64}$/D', $sha256) !== 1) {
            throw new EvidencePolicyException(
                'EVIDENCE_CHECKSUM_INVALID',
                422,
                'Dalil faylining saqlangan SHA-256 nazorat qiymati yaroqsiz.',
            );
        }

        return new S3EvidenceObject($bucket, $key, $contentType, $sha256);
    }

    /**
     * @param  array<string, mixed>  $metadata
     * @return array{contentType:string, contentLength:int, etag:string, versionId:?string}
     */
    public function validateHeadMetadata(S3EvidenceObject $object, array $metadata): array
    {
        $rawLength = $metadata['ContentLength'] ?? null;
        $contentLength = is_int($rawLength)
            ? $rawLength
            : (is_string($rawLength) && ctype_digit($rawLength) ? (int) $rawLength : 0);
        if ($contentLength < 1 || $contentLength > $this->maxBytes) {
            throw new EvidencePolicyException(
                'EVIDENCE_SIZE_REJECTED',
                413,
                'Dalil fayli bo‘sh yoki ruxsat etilgan hajmdan katta.',
            );
        }

        $contentType = trim((string) ($metadata['ContentType'] ?? ''));
        if (! in_array($contentType, self::ALLOWED_CONTENT_TYPES, true)
            || ! hash_equals($object->contentType, $contentType)) {
            throw new EvidencePolicyException(
                'EVIDENCE_CONTENT_TYPE_REJECTED',
                415,
                'S3 dagi dalil turi saqlangan ruxsat etilgan turga mos emas.',
            );
        }

        $etag = trim((string) ($metadata['ETag'] ?? ''));
        if ($etag === '' || preg_match('/[\r\n]/D', $etag) === 1) {
            throw new EvidencePolicyException(
                'EVIDENCE_METADATA_INVALID',
                503,
                'Dalil obyektining o‘zgarmas versiyasini tasdiqlab bo‘lmadi.',
            );
        }

        $userMetadata = $metadata['Metadata'] ?? [];
        $customChecksum = is_array($userMetadata) ? ($userMetadata['sha256'] ?? null) : null;
        $nativeChecksum = $metadata['ChecksumSHA256'] ?? null;
        if ($customChecksum !== null) {
            if (! is_string($customChecksum)
                || preg_match('/^[a-f0-9]{64}$/D', $customChecksum) !== 1
                || ! hash_equals($object->sha256, $customChecksum)) {
                throw new EvidencePolicyException(
                    'EVIDENCE_CHECKSUM_MISMATCH',
                    503,
                    'S3 foydalanuvchi metadata SHA-256 qiymati saqlangan dalil checksumiga mos emas.',
                );
            }
        }
        if ($nativeChecksum === null) {
            throw new EvidencePolicyException(
                'EVIDENCE_CHECKSUM_UNAVAILABLE',
                503,
                'S3 native to‘liq obyekt SHA-256 qiymati mavjud emas; dalil xavfsizlik sababli ochilmadi.',
            );
        }
        $checksumType = strtoupper(trim((string) ($metadata['ChecksumType'] ?? '')));
        $decoded = is_string($nativeChecksum) ? base64_decode($nativeChecksum, true) : false;
        if ($checksumType !== 'FULL_OBJECT') {
            throw new EvidencePolicyException(
                'EVIDENCE_CHECKSUM_TYPE_REJECTED',
                503,
                'Composite yoki turi noma’lum S3 checksum to‘liq fayl SHA-256 o‘rnini bosa olmaydi.',
            );
        }
        if (! is_string($decoded) || strlen($decoded) !== 32
            || ! hash_equals($object->sha256, bin2hex($decoded))) {
            throw new EvidencePolicyException(
                'EVIDENCE_CHECKSUM_MISMATCH',
                503,
                'S3 to‘liq obyekt SHA-256 qiymati saqlangan dalil checksumiga mos emas.',
            );
        }

        $versionId = $metadata['VersionId'] ?? null;

        return [
            'contentType' => $contentType,
            'contentLength' => $contentLength,
            'etag' => $etag,
            'versionId' => is_string($versionId) && $versionId !== '' ? $versionId : null,
        ];
    }
}
