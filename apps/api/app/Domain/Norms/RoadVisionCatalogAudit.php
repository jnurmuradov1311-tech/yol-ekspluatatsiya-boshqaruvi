<?php

namespace App\Domain\Norms;

final readonly class RoadVisionCatalogAudit
{
    /**
     * @param  list<array{code:string,message:string,context:array<string,mixed>,blocking:bool}>  $issues
     * @param  list<array<string,mixed>>  $rows
     * @param  array<string,int>  $directionCounts
     * @param  array<string,int>  $summaryCounts
     */
    public function __construct(
        public int $actualCount,
        public ?int $declaredCount,
        public array $issues,
        public array $rows,
        public array $directionCounts = [],
        public array $summaryCounts = [],
    ) {}

    public function canPublish(): bool
    {
        return count(array_filter($this->issues, static fn (array $issue): bool => $issue['blocking'])) === 0;
    }
}
