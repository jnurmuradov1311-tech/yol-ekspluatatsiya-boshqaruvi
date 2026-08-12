<?php

namespace Tests\Unit\Planning;

use App\Domain\Planning\BlockerCode;
use App\Domain\Planning\DeterministicPlanner;
use App\Domain\Planning\PlanningCandidate;
use App\Domain\Planning\PlanningPool;
use App\Domain\Planning\RoadZone;
use App\Domain\Planning\WorkerCapacity;
use DateTimeImmutable;
use PHPUnit\Framework\TestCase;

final class DeterministicPlannerTest extends TestCase
{
    public function test_it_schedules_in_explicit_order_and_never_exceeds_420_minutes(): void
    {
        $pool = new PlanningPool(
            ['2026-08-13', '2026-08-14'],
            [
                new WorkerCapacity('w-1', 'unit-1', ['road_worker'], [
                    '2026-08-13' => 420,
                    '2026-08-14' => 420,
                ]),
                new WorkerCapacity('w-2', 'unit-1', ['road_worker'], [
                    '2026-08-13' => 420,
                    '2026-08-14' => 420,
                ]),
            ],
            [],
            ['M-1' => 100.0, 'SAFETY-CONE' => 20.0],
        );

        $later = $this->candidate('candidate-b', 2, 1000, 1500, 520, ['M-1' => 10.0]);
        $first = $this->candidate('candidate-a', 1, 0, 100, 600, ['M-1' => 5.0]);

        $result = (new DeterministicPlanner)->plan([$later, $first], $pool);

        self::assertSame('candidate-a', $result->decisions[0]->candidateId);
        self::assertSame('SCHEDULED', $result->decisions[0]->status);
        self::assertCount(1, $result->decisions[0]->segments);
        self::assertSame(300, $result->decisions[0]->segments[0]->minutes);
        self::assertSame('SCHEDULED', $result->decisions[1]->status);
        self::assertSame(260, $result->decisions[1]->segments[0]->minutes);

        foreach ($result->remainingPool->workers as $worker) {
            foreach ($worker->availableMinutesByDate as $minutes) {
                self::assertGreaterThanOrEqual(0, $minutes);
                self::assertLessThanOrEqual(420, $minutes);
            }
        }
    }

    public function test_unverified_finding_is_blocked_without_consuming_resources(): void
    {
        $candidate = new PlanningCandidate(
            'candidate-a',
            'unit-1',
            new DateTimeImmutable('2026-08-10T09:00:00+05:00'),
            null,
            120,
            ['road_worker' => 1],
            [],
            ['M-1' => 4.0],
            'tcp-1',
            new RoadZone('road-1', 'A', 0, 100),
            true,
            [BlockerCode::FINDING_NOT_VERIFIED],
        );
        $pool = new PlanningPool(
            ['2026-08-13'],
            [new WorkerCapacity('w-1', 'unit-1', ['road_worker'], ['2026-08-13' => 420])],
            [],
            ['M-1' => 10.0],
        );

        $result = (new DeterministicPlanner)->plan([$candidate], $pool);

        self::assertSame('BLOCKED', $result->decisions[0]->status);
        self::assertSame([BlockerCode::FINDING_NOT_VERIFIED], $result->decisions[0]->blockers);
        self::assertSame(10.0, $result->remainingPool->materialBalances['M-1']);
    }

    public function test_material_shortage_returns_specific_blocker(): void
    {
        $candidate = $this->candidate('candidate-a', null, 0, 100, 120, ['ASPHALT' => 8.5]);
        $pool = new PlanningPool(
            ['2026-08-13'],
            [
                new WorkerCapacity('w-1', 'unit-1', ['road_worker'], ['2026-08-13' => 420]),
                new WorkerCapacity('w-2', 'unit-1', ['road_worker'], ['2026-08-13' => 420]),
            ],
            [],
            ['ASPHALT' => 8.49],
        );

        $result = (new DeterministicPlanner)->plan([$candidate], $pool);

        self::assertSame([BlockerCode::MATERIAL_SHORTAGE], $result->decisions[0]->blockers);
    }

    public function test_conflicting_zone_is_not_silently_ignored(): void
    {
        $candidate = $this->candidate('candidate-a', null, 100, 200, 120, []);
        $pool = new PlanningPool(
            ['2026-08-13'],
            [
                new WorkerCapacity('w-1', 'unit-1', ['road_worker'], ['2026-08-13' => 420]),
                new WorkerCapacity('w-2', 'unit-1', ['road_worker'], ['2026-08-13' => 420]),
            ],
            [],
            [],
            ['2026-08-13' => [new RoadZone('road-1', 'A', 150, 250)]],
        );

        $result = (new DeterministicPlanner)->plan([$candidate], $pool);

        self::assertSame('BLOCKED', $result->decisions[0]->status);
        self::assertContains(BlockerCode::ROAD_ZONE_CONFLICT, $result->decisions[0]->blockers);
    }

    /** @param array<string, float> $materials */
    private function candidate(
        string $id,
        ?int $order,
        int $from,
        int $to,
        int $personMinutes,
        array $materials,
    ): PlanningCandidate {
        return new PlanningCandidate(
            $id,
            'unit-1',
            new DateTimeImmutable('2026-08-10T09:00:00+05:00'),
            $order,
            $personMinutes,
            ['road_worker' => 2],
            [],
            $materials,
            'tcp-1',
            new RoadZone('road-1', 'A', $from, $to),
            true,
        );
    }
}
