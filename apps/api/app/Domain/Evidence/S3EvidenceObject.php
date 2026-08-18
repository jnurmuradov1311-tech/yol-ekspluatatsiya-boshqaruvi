<?php

namespace App\Domain\Evidence;

final readonly class S3EvidenceObject
{
    public function __construct(
        public string $bucket,
        public string $key,
        public string $contentType,
        public string $sha256,
    ) {}
}
