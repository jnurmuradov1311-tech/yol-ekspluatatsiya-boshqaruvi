<?php

namespace App\Domain\Planning;

final class DeterministicPlanner
{
    /**
     * @param  list<PlanningCandidate>  $candidates
     */
    public function plan(array $candidates, PlanningPool $pool): PlanningResult
    {
        usort($candidates, [$this, 'compareCandidates']);

        $workerMinutes = $this->workerMinutes($pool);
        $equipmentDates = $this->equipmentDates($pool);
        $materials = $pool->materialBalances;
        $zones = $pool->occupiedZonesByDate;
        $decisions = [];

        foreach ($candidates as $candidate) {
            $staticBlockers = $candidate->validationBlockers;
            if ($candidate->trafficControlPlanId === null) {
                $staticBlockers[] = BlockerCode::TRAFFIC_CONTROL_PLAN_MISSING;
            }
            if ($staticBlockers !== []) {
                $decisions[] = PlanningDecision::blocked($candidate->id, $staticBlockers);

                continue;
            }

            $materialBlockers = $this->materialBlockers($candidate, $materials);
            if ($materialBlockers !== []) {
                $decisions[] = PlanningDecision::blocked($candidate->id, $materialBlockers);

                continue;
            }

            $trialWorkerMinutes = $workerMinutes;
            $trialEquipmentDates = $equipmentDates;
            $trialZones = $zones;
            $remainingDuration = $candidate->durationMinutes();
            $segments = [];
            $attemptBlockers = [];

            if (! $candidate->divisible && $remainingDuration > 420) {
                $decisions[] = PlanningDecision::blocked(
                    $candidate->id,
                    [BlockerCode::WORKER_HOURS_INSUFFICIENT],
                );

                continue;
            }

            foreach ($pool->dates as $date) {
                if ($remainingDuration <= 0) {
                    break;
                }

                $segmentMinutes = min(420, $remainingDuration);
                [$workers, $workerBlocker] = $this->selectWorkers(
                    $candidate,
                    $date,
                    $segmentMinutes,
                    $pool->workers,
                    $trialWorkerMinutes,
                );
                if ($workerBlocker !== null) {
                    $attemptBlockers[] = $workerBlocker;

                    continue;
                }

                [$equipment, $equipmentBlocker] = $this->selectEquipment(
                    $candidate,
                    $date,
                    $pool->equipment,
                    $trialEquipmentDates,
                );
                if ($equipmentBlocker !== null) {
                    $attemptBlockers[] = $equipmentBlocker;

                    continue;
                }

                if ($this->zoneConflicts($candidate->zone, $trialZones[$date] ?? [])) {
                    $attemptBlockers[] = BlockerCode::ROAD_ZONE_CONFLICT;

                    continue;
                }

                foreach ($workers as $workerId) {
                    $trialWorkerMinutes[$workerId][$date] -= $segmentMinutes;
                }
                foreach ($equipment as $equipmentId) {
                    $trialEquipmentDates[$equipmentId][$date] = false;
                }
                $trialZones[$date][] = $candidate->zone;
                $segments[] = new ScheduledSegment($date, $segmentMinutes, $workers, $equipment);
                $remainingDuration -= $segmentMinutes;
            }

            if ($remainingDuration > 0) {
                $decisions[] = PlanningDecision::blocked(
                    $candidate->id,
                    $attemptBlockers === []
                        ? [BlockerCode::WORKER_HOURS_INSUFFICIENT]
                        : $attemptBlockers,
                );

                continue;
            }

            foreach ($candidate->materialsByCode as $code => $quantity) {
                $materials[$code] -= $quantity;
            }
            $workerMinutes = $trialWorkerMinutes;
            $equipmentDates = $trialEquipmentDates;
            $zones = $trialZones;
            $decisions[] = PlanningDecision::scheduled($candidate->id, $segments);
        }

        return new PlanningResult(
            $decisions,
            $this->remainingPool($pool, $workerMinutes, $equipmentDates, $materials, $zones),
        );
    }

    private function compareCandidates(PlanningCandidate $a, PlanningCandidate $b): int
    {
        if ($a->explicitOrder !== null || $b->explicitOrder !== null) {
            $left = $a->explicitOrder ?? PHP_INT_MAX;
            $right = $b->explicitOrder ?? PHP_INT_MAX;
            if ($left !== $right) {
                return $left <=> $right;
            }
        }

        $byDate = $a->verifiedAt <=> $b->verifiedAt;

        return $byDate !== 0 ? $byDate : strcmp($a->id, $b->id);
    }

    /** @return array<string, array<string, int>> */
    private function workerMinutes(PlanningPool $pool): array
    {
        $result = [];
        foreach ($pool->workers as $worker) {
            $result[$worker->workerId] = $worker->availableMinutesByDate;
        }

        return $result;
    }

    /** @return array<string, array<string, bool>> */
    private function equipmentDates(PlanningPool $pool): array
    {
        $result = [];
        foreach ($pool->equipment as $item) {
            foreach ($item->availableDates as $date) {
                $result[$item->equipmentId][$date] = true;
            }
        }

        return $result;
    }

    /**
     * @param  array<string, float>  $materials
     * @return list<BlockerCode>
     */
    private function materialBlockers(PlanningCandidate $candidate, array $materials): array
    {
        foreach ($candidate->materialsByCode as $code => $quantity) {
            if ($quantity < 0 || ($materials[$code] ?? 0.0) + 1e-9 < $quantity) {
                return [str_starts_with($code, 'SAFETY-')
                    ? BlockerCode::SAFETY_EQUIPMENT_SHORTAGE
                    : BlockerCode::MATERIAL_SHORTAGE];
            }
        }

        return [];
    }

    /**
     * @param  list<WorkerCapacity>  $workers
     * @param  array<string, array<string, int>>  $minutes
     * @return array{list<string>, ?BlockerCode}
     */
    private function selectWorkers(
        PlanningCandidate $candidate,
        string $date,
        int $segmentMinutes,
        array $workers,
        array $minutes,
    ): array {
        $selected = [];

        foreach ($candidate->crewBySkill as $skill => $count) {
            $eligible = array_values(array_filter(
                $workers,
                static fn (WorkerCapacity $worker): bool => $worker->roadUnitId === $candidate->roadUnitId
                    && in_array($skill, $worker->skills, true),
            ));
            if (count($eligible) < $count) {
                return [[], str_contains($skill, 'operator')
                    ? BlockerCode::OPERATOR_UNAVAILABLE
                    : BlockerCode::REQUIRED_SKILL_MISSING];
            }

            usort($eligible, static fn (WorkerCapacity $a, WorkerCapacity $b): int => strcmp($a->workerId, $b->workerId));
            $added = 0;
            foreach ($eligible as $worker) {
                if (in_array($worker->workerId, $selected, true)) {
                    continue;
                }
                if (($minutes[$worker->workerId][$date] ?? 0) < $segmentMinutes) {
                    continue;
                }
                $selected[] = $worker->workerId;
                $added++;
                if ($added === $count) {
                    break;
                }
            }
            if ($added < $count) {
                return [[], BlockerCode::WORKER_HOURS_INSUFFICIENT];
            }
        }

        return [$selected, null];
    }

    /**
     * @param  list<EquipmentCapacity>  $equipment
     * @param  array<string, array<string, bool>>  $availability
     * @return array{list<string>, ?BlockerCode}
     */
    private function selectEquipment(
        PlanningCandidate $candidate,
        string $date,
        array $equipment,
        array $availability,
    ): array {
        $selected = [];
        foreach ($candidate->equipmentByType as $type => $count) {
            $eligible = array_values(array_filter(
                $equipment,
                static fn (EquipmentCapacity $item): bool => $item->roadUnitId === $candidate->roadUnitId
                    && $item->typeCode === $type
                    && ($availability[$item->equipmentId][$date] ?? false),
            ));
            usort($eligible, static fn (EquipmentCapacity $a, EquipmentCapacity $b): int => strcmp($a->equipmentId, $b->equipmentId));
            if (count($eligible) < $count) {
                return [[], BlockerCode::EQUIPMENT_UNAVAILABLE];
            }
            foreach (array_slice($eligible, 0, $count) as $item) {
                $selected[] = $item->equipmentId;
            }
        }

        return [$selected, null];
    }

    /** @param list<RoadZone> $occupied */
    private function zoneConflicts(RoadZone $zone, array $occupied): bool
    {
        foreach ($occupied as $existing) {
            if ($zone->conflictsWith($existing)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<string, array<string, int>>  $workerMinutes
     * @param  array<string, array<string, bool>>  $equipmentDates
     * @param  array<string, float>  $materials
     * @param  array<string, list<RoadZone>>  $zones
     */
    private function remainingPool(
        PlanningPool $original,
        array $workerMinutes,
        array $equipmentDates,
        array $materials,
        array $zones,
    ): PlanningPool {
        $workers = array_map(
            static fn (WorkerCapacity $worker): WorkerCapacity => new WorkerCapacity(
                $worker->workerId,
                $worker->roadUnitId,
                $worker->skills,
                $workerMinutes[$worker->workerId],
            ),
            $original->workers,
        );
        $equipment = array_map(
            static fn (EquipmentCapacity $item): EquipmentCapacity => new EquipmentCapacity(
                $item->equipmentId,
                $item->roadUnitId,
                $item->typeCode,
                array_keys(array_filter($equipmentDates[$item->equipmentId] ?? [])),
            ),
            $original->equipment,
        );

        return new PlanningPool($original->dates, $workers, $equipment, $materials, $zones);
    }
}
