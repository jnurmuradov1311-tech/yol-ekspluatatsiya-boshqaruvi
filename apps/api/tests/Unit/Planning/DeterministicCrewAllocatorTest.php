<?php

namespace Tests\Unit\Planning;

use App\Domain\Planning\DeterministicCrewAllocator;
use PHPUnit\Framework\TestCase;

final class DeterministicCrewAllocatorTest extends TestCase
{
    public function test_it_matches_the_scarce_qualification_before_a_multi_skilled_worker_is_consumed(): void
    {
        $allocations = (new DeterministicCrewAllocator)->allocate(
            [
                ['id' => 'skill-a', 'qualificationCode' => 'A', 'workerCount' => 1],
                ['id' => 'skill-b', 'qualificationCode' => 'B', 'workerCount' => 1],
            ],
            [
                [
                    'id' => 'worker-multi',
                    'personnelNumber' => '002',
                    'remainingMinutes' => 420,
                    'qualifications' => ['A', 'B'],
                ],
                [
                    'id' => 'worker-a',
                    'personnelNumber' => '001',
                    'remainingMinutes' => 420,
                    'qualifications' => ['A'],
                ],
            ],
            420,
        );

        self::assertSame([
            'skill-a' => 'worker-a',
            'skill-b' => 'worker-multi',
        ], array_column($allocations, 'workerId', 'skillRequirementId'));
        self::assertSame(420, array_sum(array_column($allocations, 'plannedMinutes')));
    }

    public function test_it_adds_qualified_capacity_and_never_exceeds_the_ytp_daily_limit(): void
    {
        $allocations = (new DeterministicCrewAllocator)->allocate(
            [['id' => 'skill-a', 'qualificationCode' => 'A', 'workerCount' => 1]],
            [
                [
                    'id' => 'worker-1',
                    'personnelNumber' => '001',
                    'remainingMinutes' => 300,
                    'qualifications' => ['A'],
                ],
                [
                    'id' => 'worker-2',
                    'personnelNumber' => '002',
                    'remainingMinutes' => 200,
                    'qualifications' => ['A'],
                ],
                [
                    'id' => 'worker-ignored',
                    'personnelNumber' => '003',
                    'remainingMinutes' => 420,
                    'qualifications' => ['B'],
                ],
            ],
            450,
        );

        self::assertSame(450, array_sum(array_column($allocations, 'plannedMinutes')));
        self::assertSame(250, $allocations[0]['plannedMinutes']);
        self::assertSame(200, $allocations[1]['plannedMinutes']);
        self::assertLessThanOrEqual(420, max(array_column($allocations, 'plannedMinutes')));
    }

    public function test_insufficient_capacity_is_returned_as_a_truthful_partial_allocation(): void
    {
        $allocations = (new DeterministicCrewAllocator)->allocate(
            [['id' => 'skill-a', 'qualificationCode' => 'A', 'workerCount' => 1]],
            [
                [
                    'id' => 'worker-1',
                    'personnelNumber' => '001',
                    'remainingMinutes' => 300,
                    'qualifications' => ['A'],
                ],
                [
                    'id' => 'worker-2',
                    'personnelNumber' => '002',
                    'remainingMinutes' => 120,
                    'qualifications' => ['A'],
                ],
            ],
            600,
        );

        self::assertSame(420, array_sum(array_column($allocations, 'plannedMinutes')));
        self::assertSame([300, 120], array_column($allocations, 'plannedMinutes'));
    }

    public function test_same_inputs_produce_same_output_regardless_of_input_array_order(): void
    {
        $allocator = new DeterministicCrewAllocator;
        $skills = [
            ['id' => 'skill-b', 'qualificationCode' => 'B', 'workerCount' => 1],
            ['id' => 'skill-a', 'qualificationCode' => 'A', 'workerCount' => 1],
        ];
        $workers = [
            [
                'id' => 'worker-2',
                'personnelNumber' => '002',
                'remainingMinutes' => 420,
                'qualifications' => ['B'],
            ],
            [
                'id' => 'worker-1',
                'personnelNumber' => '001',
                'remainingMinutes' => 420,
                'qualifications' => ['A'],
            ],
        ];

        self::assertSame(
            $allocator->allocate($skills, $workers, 300),
            $allocator->allocate(array_reverse($skills), array_reverse($workers), 300),
        );
    }
}
