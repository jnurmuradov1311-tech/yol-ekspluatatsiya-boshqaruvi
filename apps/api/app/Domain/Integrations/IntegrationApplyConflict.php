<?php

namespace App\Domain\Integrations;

final class IntegrationApplyConflict extends \RuntimeException
{
    /**
     * @param  array<string, mixed>  $sourceValue
     * @param  array<string, mixed>  $currentValue
     */
    public function __construct(
        public readonly string $conflictCode,
        public readonly string $entityType,
        public readonly string $externalId,
        string $message,
        public readonly array $sourceValue = [],
        public readonly array $currentValue = [],
    ) {
        parent::__construct($message);
    }
}
