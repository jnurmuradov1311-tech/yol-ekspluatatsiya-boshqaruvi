<?php

namespace Tests\Feature;

use App\Http\Controllers\Api\V1\PlanningController;
use ReflectionClass;
use Tests\TestCase;

final class MultiRoadPlanningTest extends TestCase
{
    public function test_planning_has_no_single_road_code_or_fixed_length_guard(): void
    {
        $source = $this->source(PlanningController::class);

        self::assertStringNotContainsString("PRIMARY_ROAD_CODE = 'D001'", $source);
        self::assertStringNotContainsString('PRIMARY_ROAD_LENGTH_M = 67_000', $source);
        self::assertStringNotContainsString("rv.official_code = 'D001'", $source);
        self::assertStringNotContainsString('rv.length_m = 67000', $source);
        self::assertStringNotContainsString('d001ConfigurationError', $source);
        self::assertStringNotContainsString('d001RunExists', $source);
    }

    public function test_automatic_candidates_cover_all_scoped_roads_but_one_run_stays_in_one_division(): void
    {
        $source = $this->source(PlanningController::class);

        self::assertStringContainsString('assignment.road_id = dc.road_id', $source);
        self::assertStringContainsString('assignment.road_id = api.road_id', $source);
        self::assertStringContainsString('assignment.division_id = any(?::uuid[])', $source);
        self::assertStringContainsString('$record->road_id', $source);
        self::assertStringContainsString('count($recordDivisions) !== 1', $source);
        self::assertStringContainsString("'code' => 'SINGLE_DIVISION_REQUIRED'", $source);
    }

    public function test_options_require_and_scope_every_road_resource_to_the_selected_road(): void
    {
        $source = $this->source(PlanningController::class);

        self::assertStringContainsString("'roadId' => ['required', 'uuid']", $source);
        self::assertStringContainsString('where r.id = p.selected_road_id', $source);
        self::assertStringContainsString('select ?::uuid road_id, ?::uuid[] division_ids', $source);
        self::assertStringContainsString('join roadops.defect_cases dc on dc.road_id = p.road_id', $source);
        self::assertStringContainsString("'sourceDefects' => array_map", $source);
    }

    public function test_manual_planning_uses_one_location_and_the_selected_road_length(): void
    {
        $source = $this->source(PlanningController::class);

        self::assertStringContainsString("'chainageStartM' => ['required'", $source);
        self::assertStringContainsString("'chainageEndM' => ['sometimes', 'nullable'", $source);
        self::assertStringContainsString("'laneLabel' => ['sometimes', 'nullable'", $source);
        self::assertStringContainsString("'direction' => ['sometimes', 'nullable'", $source);
        self::assertStringContainsString('$chainageStart >= $roadLength', $source);
        self::assertStringContainsString('$chainageEnd = min($chainageStart + 1, $roadLength)', $source);
        self::assertStringContainsString("'chainageEndM' => (string) \$chainageStart", $source);
        self::assertStringContainsString("'code' => 'CHAINAGE_OUTSIDE_ROAD'", $source);
    }

    public function test_manual_defect_keeps_the_broad_iqn_topic_while_operator_selects_an_exact_variant(): void
    {
        $source = $this->source(PlanningController::class);

        self::assertStringContainsString("'sourceDefectId' => ['sometimes', 'nullable', 'uuid']", $source);
        self::assertStringContainsString('dc.iqn_topic_work_item_id', $source);
        self::assertStringContainsString("dc.source_kind = 'manual_inspection'", $source);
        self::assertStringContainsString('with recursive ancestry as', $source);
        self::assertStringContainsString("'code' => 'IQN_VARIANT_TOPIC_MISMATCH'", $source);
        self::assertStringContainsString("'sourceIqnTopicId'", $source);
        self::assertStringContainsString("'code' => 'SOURCE_DEFECT_LOCATION_MISMATCH'", $source);
        self::assertStringContainsString('lower(dc.chainage_span)::text source_chainage_start_m', $source);
        self::assertStringContainsString("'sourceChainageStartM'", $source);
        self::assertStringContainsString("'sourceQuantity'", $source);
        self::assertStringContainsString('lower(chainage_span)::text source_chainage_start_m', $source);
        self::assertStringContainsString('$lockedSourceDefect', $source);
        self::assertStringContainsString('for update of dc', $source);
        self::assertStringContainsString('dc.updated_at::text=?', $source);
        self::assertStringContainsString("pi.formula_inputs #>> '{manualInput,sourceDefectId}'=dc.id::text", $source);
        self::assertGreaterThanOrEqual(5, substr_count($source, "pi.status <> 'cancelled'"));
        self::assertStringContainsString('$lockedCandidate', $source);
        self::assertStringContainsString('[$record->entity_id, $record->source_version]', $source);
    }

    public function test_approval_and_publish_accept_any_valid_scoped_road_set(): void
    {
        $source = $this->source(PlanningController::class);

        self::assertStringContainsString('if (! $this->scopedRunExists($id))', $source);
        self::assertStringContainsString('assignment.division_id = run.division_id', $source);
        self::assertStringContainsString('assignment.chainage_span @> item.chainage_span', $source);
        self::assertStringContainsString('upper(item.chainage_span) <= road.length_m', $source);
        self::assertStringNotContainsString("road.official_code='D001'", $source);
    }

    /** @param class-string $class */
    private function source(string $class): string
    {
        $path = (new ReflectionClass($class))->getFileName();
        self::assertIsString($path);

        return (string) file_get_contents($path);
    }
}
