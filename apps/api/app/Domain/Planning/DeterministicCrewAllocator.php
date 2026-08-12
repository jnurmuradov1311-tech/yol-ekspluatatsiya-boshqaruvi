<?php

namespace App\Domain\Planning;

/**
 * Assigns workers without a score, rank, or inferred priority.
 *
 * Candidate order is owned by the caller. Inside a single candidate this
 * allocator first satisfies the approved qualification/head-count template,
 * then uses only remaining daily capacity as a tie-breaker. The output is
 * stable for the same inputs.
 */
final class DeterministicCrewAllocator
{
    /**
     * @param  list<array{id: string, qualificationCode: string, workerCount: int}>  $skillRequirements
     * @param  list<array{
     *     id: string,
     *     personnelNumber: string,
     *     remainingMinutes: int,
     *     qualifications: list<string>
     * }>  $workers
     * @return list<array{workerId: string, skillRequirementId: string, plannedMinutes: int}>
     */
    public function allocate(array $skillRequirements, array $workers, int $requiredMinutes): array
    {
        if ($requiredMinutes <= 0 || $skillRequirements === [] || $workers === []) {
            return [];
        }

        $skills = $this->normalizeSkills($skillRequirements);
        $workerPool = $this->normalizeWorkers($workers);
        if ($skills === [] || $workerPool === []) {
            return [];
        }

        $slots = [];
        foreach ($skills as $skill) {
            for ($position = 1; $position <= $skill['workerCount']; $position++) {
                $slotId = $skill['id'].'#'.$position;
                $eligible = array_values(array_filter(
                    array_keys($workerPool),
                    static fn (string $workerId): bool => in_array(
                        $skill['qualificationCode'],
                        $workerPool[$workerId]['qualifications'],
                        true,
                    ),
                ));
                usort($eligible, fn (string $left, string $right): int => $this->compareWorkers(
                    $workerPool[$left],
                    $workerPool[$right],
                ));
                $slots[$slotId] = [
                    'id' => $slotId,
                    'skillRequirementId' => $skill['id'],
                    'qualificationCode' => $skill['qualificationCode'],
                    'position' => $position,
                    'eligibleWorkerIds' => $eligible,
                ];
            }
        }

        uasort($slots, static function (array $left, array $right): int {
            return count($left['eligibleWorkerIds']) <=> count($right['eligibleWorkerIds'])
                ?: strcmp($left['qualificationCode'], $right['qualificationCode'])
                ?: strcmp($left['skillRequirementId'], $right['skillRequirementId'])
                ?: $left['position'] <=> $right['position'];
        });

        /** @var array<string, string> $workerToSlot */
        $workerToSlot = [];
        /** @var array<string, string> $slotToWorker */
        $slotToWorker = [];
        foreach (array_keys($slots) as $slotId) {
            $visitedWorkers = [];
            $this->matchSlot(
                $slotId,
                $slots,
                $workerToSlot,
                $slotToWorker,
                $visitedWorkers,
            );
        }

        $selected = [];
        foreach ($slotToWorker as $slotId => $workerId) {
            $selected[$workerId] = [
                'workerId' => $workerId,
                'skillRequirementId' => $slots[$slotId]['skillRequirementId'],
                'qualificationCode' => $slots[$slotId]['qualificationCode'],
                'personnelNumber' => $workerPool[$workerId]['personnelNumber'],
                'capacity' => $workerPool[$workerId]['remainingMinutes'],
            ];
        }

        $selectedCapacity = array_sum(array_column($selected, 'capacity'));
        if ($selectedCapacity < $requiredMinutes) {
            $unusedWorkers = array_filter(
                $workerPool,
                static fn (array $worker, string $workerId): bool => ! isset($selected[$workerId]),
                ARRAY_FILTER_USE_BOTH,
            );
            uasort($unusedWorkers, fn (array $left, array $right): int => $this->compareWorkers($left, $right));

            foreach ($unusedWorkers as $workerId => $worker) {
                $matchingSkill = null;
                foreach ($skills as $skill) {
                    if (in_array($skill['qualificationCode'], $worker['qualifications'], true)) {
                        $matchingSkill = $skill;
                        break;
                    }
                }
                if ($matchingSkill === null) {
                    continue;
                }
                $selected[$workerId] = [
                    'workerId' => $workerId,
                    'skillRequirementId' => $matchingSkill['id'],
                    'qualificationCode' => $matchingSkill['qualificationCode'],
                    'personnelNumber' => $worker['personnelNumber'],
                    'capacity' => $worker['remainingMinutes'],
                ];
                $selectedCapacity += $worker['remainingMinutes'];
                if ($selectedCapacity >= $requiredMinutes) {
                    break;
                }
            }
        }

        $selected = array_values($selected);
        usort($selected, static function (array $left, array $right): int {
            return strcmp($left['qualificationCode'], $right['qualificationCode'])
                ?: strcmp($left['skillRequirementId'], $right['skillRequirementId'])
                ?: strcmp($left['personnelNumber'], $right['personnelNumber'])
                ?: strcmp($left['workerId'], $right['workerId']);
        });

        $targetMinutes = min($requiredMinutes, array_sum(array_column($selected, 'capacity')));
        if ($targetMinutes <= 0) {
            return [];
        }

        // A database assignment cannot contain zero minutes. When capacity is
        // only partial, create a truthful partial allocation and let the second
        // validation pass retain the exact shortage blocker.
        if ($targetMinutes < count($selected)) {
            $selected = array_slice($selected, 0, $targetMinutes);
        }

        $suffixCapacity = array_fill(0, count($selected) + 1, 0);
        for ($index = count($selected) - 1; $index >= 0; $index--) {
            $suffixCapacity[$index] = $suffixCapacity[$index + 1] + $selected[$index]['capacity'];
        }

        $remaining = $targetMinutes;
        $allocations = [];
        foreach ($selected as $index => $worker) {
            $workersLeft = count($selected) - $index;
            $minimumForThisWorker = max(1, $remaining - $suffixCapacity[$index + 1]);
            $maximumLeavingOneEach = $remaining - ($workersLeft - 1);
            $evenShare = intdiv($remaining + $workersLeft - 1, $workersLeft);
            $minutes = min(
                $worker['capacity'],
                $maximumLeavingOneEach,
                max($minimumForThisWorker, $evenShare),
            );

            $allocations[] = [
                'workerId' => $worker['workerId'],
                'skillRequirementId' => $worker['skillRequirementId'],
                'plannedMinutes' => $minutes,
            ];
            $remaining -= $minutes;
        }

        return $allocations;
    }

    /**
     * @param  list<array{id: string, qualificationCode: string, workerCount: int}>  $skills
     * @return list<array{id: string, qualificationCode: string, workerCount: int}>
     */
    private function normalizeSkills(array $skills): array
    {
        $normalized = array_values(array_filter($skills, static fn (array $skill): bool => (
            $skill['id'] !== '' && $skill['qualificationCode'] !== '' && $skill['workerCount'] > 0
        )));
        usort($normalized, static function (array $left, array $right): int {
            return strcmp($left['qualificationCode'], $right['qualificationCode'])
                ?: strcmp($left['id'], $right['id']);
        });

        return $normalized;
    }

    /**
     * @param  list<array{
     *     id: string,
     *     personnelNumber: string,
     *     remainingMinutes: int,
     *     qualifications: list<string>
     * }>  $workers
     * @return array<string, array{
     *     id: string,
     *     personnelNumber: string,
     *     remainingMinutes: int,
     *     qualifications: list<string>
     * }>
     */
    private function normalizeWorkers(array $workers): array
    {
        $normalized = [];
        foreach ($workers as $worker) {
            if ($worker['id'] === '' || $worker['remainingMinutes'] <= 0) {
                continue;
            }
            $qualifications = array_values(array_unique(array_filter(
                $worker['qualifications'],
                static fn (string $code): bool => $code !== '',
            )));
            sort($qualifications, SORT_STRING);
            if ($qualifications === []) {
                continue;
            }
            $worker['remainingMinutes'] = min(420, $worker['remainingMinutes']);
            $worker['qualifications'] = $qualifications;
            $normalized[$worker['id']] = $worker;
        }

        return $normalized;
    }

    /**
     * @param  array<string, array{
     *     id: string,
     *     skillRequirementId: string,
     *     qualificationCode: string,
     *     position: int,
     *     eligibleWorkerIds: list<string>
     * }>  $slots
     * @param  array<string, string>  $workerToSlot
     * @param  array<string, string>  $slotToWorker
     * @param  array<string, true>  $visitedWorkers
     */
    private function matchSlot(
        string $slotId,
        array $slots,
        array &$workerToSlot,
        array &$slotToWorker,
        array &$visitedWorkers,
    ): bool {
        foreach ($slots[$slotId]['eligibleWorkerIds'] as $workerId) {
            if (isset($visitedWorkers[$workerId])) {
                continue;
            }
            $visitedWorkers[$workerId] = true;
            $previousSlot = $workerToSlot[$workerId] ?? null;
            if ($previousSlot !== null && ! $this->matchSlot(
                $previousSlot,
                $slots,
                $workerToSlot,
                $slotToWorker,
                $visitedWorkers,
            )) {
                continue;
            }

            $workerToSlot[$workerId] = $slotId;
            $slotToWorker[$slotId] = $workerId;

            return true;
        }

        return false;
    }

    /**
     * @param  array{id: string, personnelNumber: string, remainingMinutes: int, qualifications: list<string>}  $left
     * @param  array{id: string, personnelNumber: string, remainingMinutes: int, qualifications: list<string>}  $right
     */
    private function compareWorkers(array $left, array $right): int
    {
        return $right['remainingMinutes'] <=> $left['remainingMinutes']
            ?: strcmp($left['personnelNumber'], $right['personnelNumber'])
            ?: strcmp($left['id'], $right['id']);
    }
}
