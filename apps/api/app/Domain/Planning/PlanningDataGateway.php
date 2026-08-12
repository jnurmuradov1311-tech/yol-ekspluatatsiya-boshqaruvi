<?php

namespace App\Domain\Planning;

interface PlanningDataGateway
{
    /**
     * Loads immutable candidate and capacity snapshots for a run.
     *
     * @param  list<string>  $selectedIds
     * @return array{list<PlanningCandidate>, PlanningPool, array<string, mixed>}
     */
    public function load(string $roadUnitId, string $dateFrom, string $dateTo, array $selectedIds): array;

    /**
     * @param  array<string, mixed>  $requestSnapshot
     */
    public function createRun(string $actorId, array $requestSnapshot, string $inputHash): string;

    public function savePreview(string $runId, PlanningResult $result): void;

    /** @return array<string, mixed> */
    public function publish(string $runId, string $actorId, string $expectedInputHash): array;
}
