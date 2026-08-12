<?php

namespace App\Domain\Integrations;

final class ContractViolation extends \RuntimeException
{
    /** @param array<string, mixed> $details */
    public function __construct(
        public readonly string $contractCode,
        string $message,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }
}
