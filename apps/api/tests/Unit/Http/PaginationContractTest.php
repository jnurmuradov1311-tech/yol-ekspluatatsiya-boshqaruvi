<?php

namespace Tests\Unit\Http;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class PaginationContractTest extends TestCase
{
    #[DataProvider('pagedControllers')]
    public function test_list_controllers_use_validated_limit_offset_and_an_independent_total(string $controller): void
    {
        $source = file_get_contents(__DIR__.'/../../../app/Http/Controllers/Api/V1/'.$controller);

        self::assertIsString($source);
        self::assertStringContainsString('Pagination::from($request)', $source);
        self::assertStringContainsString('limit ? offset ?', $source);
        self::assertStringContainsString('DB::scalar(', $source);
        self::assertStringContainsString('$pagination->pageSize', $source);
        self::assertStringContainsString('$pagination->offset()', $source);
    }

    public function test_planning_candidates_are_counted_and_paginated_after_the_union(): void
    {
        $source = file_get_contents(__DIR__.'/../../../app/Http/Controllers/Api/V1/PlanningController.php');

        self::assertIsString($source);
        self::assertStringContainsString('union all', $source);
        self::assertStringContainsString("select count(*) from ('.\$candidateSql.') scoped_candidates", $source);
        self::assertStringContainsString(
            'order by sort_group, sort_at nulls last, source_reference, entity_id limit ? offset ?',
            $source,
        );
    }

    /** @return iterable<string, array{string}> */
    public static function pagedControllers(): iterable
    {
        yield 'RoadVision findings' => ['RoadVisionFindingController.php'];
        yield 'planning runs and candidates' => ['PlanningController.php'];
        yield 'work orders' => ['WorkOrderController.php'];
        yield 'annual program' => ['AnnualProgramController.php'];
        yield 'resources' => ['ResourceController.php'];
        yield 'manual inspections' => ['ManualInspectionController.php'];
    }
}
