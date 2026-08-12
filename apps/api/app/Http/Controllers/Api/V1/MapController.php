<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\ApiScope;
use App\Support\DbRows;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use stdClass;

final class MapController extends Controller
{
    private const PRIMARY_ROAD_CODE = 'D001';

    private const PRIMARY_ROAD_LENGTH_M = 67_000;

    public function __invoke(Request $request, ApiScope $scope): JsonResponse
    {
        if (($configurationError = $this->d001ConfigurationError()) !== null) {
            return $configurationError;
        }

        $validated = $request->validate([
            'roadId' => ['sometimes', 'uuid'],
        ]);
        $selectedRoadId = isset($validated['roadId']) ? (string) $validated['roadId'] : null;
        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $roads = DbRows::select(
            <<<'SQL'
                with parameters as (
                  select ?::uuid[] division_ids, nullif(?::text, '')::uuid selected_road_id
                )
                select r.id, rv.official_code, rv.name, rv.length_m,
                       rv.attributes -> 'geometry' geometry
                from parameters p
                join roadops.roads r on r.retired_at is null
                  or r.retired_at > statement_timestamp()
                join roadops.road_versions rv on rv.road_id = r.id
                  and rv.valid_from <= statement_timestamp()
                  and (rv.valid_until is null or rv.valid_until > statement_timestamp())
                where lower(rv.official_code) = lower('D001')
                  and exists (
                    select 1 from roadops.road_division_assignments assignment
                    where assignment.road_id = r.id
                      and assignment.division_id = any(p.division_ids)
                      and assignment.valid_from <= statement_timestamp()
                      and (assignment.valid_until is null
                           or assignment.valid_until > statement_timestamp())
                  )
                order by rv.official_code, rv.name, r.id
                limit 2
            SQL,
            [$divisionIds, $selectedRoadId ?? ''],
        );
        if ($selectedRoadId === null && count($roads) !== 1) {
            return response()->json(['error' => [
                'code' => 'D001_SOURCE_AMBIGUOUS',
                'message' => 'D001 yo‘lining amaldagi YTP yozuvi aynan bitta bo‘lishi kerak.',
            ]], 409);
        }
        if ($selectedRoadId !== null && $roads === []) {
            return response()->json(['error' => [
                'code' => 'ROAD_NOT_ACCESSIBLE',
                'message' => 'Tanlangan yo‘l amaldagi YTP ma’lumotlari yoki ruxsat doirasida mavjud emas.',
            ]], 404);
        }
        if (count($roads) !== 1) {
            return response()->json(['error' => [
                'code' => 'ROAD_SOURCE_AMBIGUOUS',
                'message' => 'Tanlangan yo‘lning amaldagi YTP yozuvi bir ma’noli aniqlanmadi.',
            ]], 409);
        }
        $road = $roads[0];
        if ($selectedRoadId !== null && (string) $road->id !== $selectedRoadId) {
            return response()->json(['error' => [
                'code' => 'D001_ROAD_ID_MISMATCH',
                'message' => 'Yuborilgan roadId amaldagi D001 yozuviga mos emas.',
            ]], 409);
        }
        if ((string) $road->official_code !== self::PRIMARY_ROAD_CODE
            || ! $this->hasExactPrimaryRoadLength($road->length_m)) {
            return response()->json(['error' => [
                'code' => 'D001_CONFIGURATION_MISMATCH',
                'message' => 'YTPdagi D001 yo‘li kodi yoki uzunligi 67 000 metr invariantiga mos emas.',
            ]], 409);
        }
        $lengthM = (float) self::PRIMARY_ROAD_LENGTH_M;

        $geometry = $this->jsonObject($road->geometry);
        $coordinates = $geometry['coordinates'] ?? null;
        if (($geometry['type'] ?? null) !== 'LineString'
            || ! is_array($coordinates) || count($coordinates) < 2) {
            return response()->json(['error' => [
                'code' => 'D001_GEOMETRY_UNAVAILABLE',
                'message' => 'D001 yo‘lining tasdiqlangan YTP LineString geometriyasi topilmadi.',
            ]], 409);
        }
        $coordinates = array_values(array_filter(array_map(
            static function (mixed $coordinate): ?array {
                if (! is_array($coordinate) || count($coordinate) < 2
                    || ! is_numeric($coordinate[0]) || ! is_numeric($coordinate[1])) {
                    return null;
                }
                $longitude = (float) $coordinate[0];
                $latitude = (float) $coordinate[1];
                if ($longitude < -180 || $longitude > 180 || $latitude < -90 || $latitude > 90) {
                    return null;
                }

                return [$longitude, $latitude];
            },
            $coordinates,
        )));
        if (count($coordinates) < 2) {
            return response()->json(['error' => [
                'code' => 'ROAD_GEOMETRY_INVALID',
                'message' => 'Tanlangan yo‘lning YTP geometriyasidagi koordinatalar yaroqsiz.',
            ]], 409);
        }

        $elementRows = DbRows::select(
            <<<'SQL'
                select ev.road_element_id id, ev.element_type, ev.name,
                       coalesce(ev.chainage_point_m, lower(ev.chainage_span)) chainage_start,
                       coalesce(ev.chainage_point_m, upper(ev.chainage_span)) chainage_end,
                       (ev.attributes #>> '{location,coordinates,1}')::numeric latitude,
                       (ev.attributes #>> '{location,coordinates,0}')::numeric longitude
                from roadops.road_element_versions ev
                join roadops.road_elements element on element.id = ev.road_element_id
                where ev.road_id = ? and ev.valid_until is null and element.retired_at is null
                  and jsonb_typeof(ev.attributes #> '{location,coordinates}') = 'array'
                  and exists (
                    select 1 from roadops.road_division_assignments a
                    where a.road_id = ev.road_id and a.division_id = any(?::uuid[])
                      and a.valid_from <= statement_timestamp()
                      and (a.valid_until is null or a.valid_until > statement_timestamp())
                      and (a.chainage_span @> ev.chainage_point_m
                           or (ev.chainage_span is not null and a.chainage_span && ev.chainage_span))
                  )
                order by chainage_start, ev.element_type, ev.road_element_id
            SQL,
            [$road->id, $divisionIds],
        );
        $defectRows = DbRows::select(
            <<<'SQL'
                select dc.id, lower(dc.chainage_span) chainage_start,
                       upper(dc.chainage_span) chainage_end,
                       coalesce(candidate.latitude,
                         (element.attributes #>> '{location,coordinates,1}')::numeric) latitude,
                       coalesce(candidate.longitude,
                         (element.attributes #>> '{location,coordinates,0}')::numeric) longitude,
                       dt.name kind_label, dc.status state_label
                from roadops.defect_cases dc
                join roadops.defect_types dt on dt.id = dc.defect_type_id
                left join roadops.roadvision_candidates candidate
                  on candidate.id = dc.roadvision_candidate_id
                left join roadops.road_element_versions element
                  on element.road_element_id = dc.road_element_id and element.valid_until is null
                where dc.road_id = ? and dc.status in ('open', 'planned', 'in_progress')
                  and roadops.division_for_road_zone(dc.road_id, dc.chainage_span, dc.observed_at)
                      = any(?::uuid[])
                  and coalesce(candidate.latitude,
                        (element.attributes #>> '{location,coordinates,1}')::numeric) is not null
                  and coalesce(candidate.longitude,
                        (element.attributes #>> '{location,coordinates,0}')::numeric) is not null
                order by dc.observed_at desc, dc.id
            SQL,
            [$road->id, $divisionIds],
        );
        $workRows = DbRows::select(
            <<<'SQL'
                select pi.id, lower(pi.chainage_span) chainage_start,
                       upper(pi.chainage_span) chainage_end,
                       coalesce(wi.normalized_name, dt.name, 'Yo‘l ishi') kind_label,
                       coalesce(wo.status, pi.status) state_label
                from roadops.plan_items pi
                join roadops.planning_runs run on run.id = pi.planning_run_id
                left join roadops.work_orders wo on wo.plan_item_id = pi.id
                left join roadops.iqn_work_variants variant on variant.id = pi.work_variant_id
                left join roadops.iqn_work_items wi on wi.id = variant.work_item_id
                left join roadops.defect_cases dc on dc.id = pi.defect_case_id
                left join roadops.defect_types dt on dt.id = dc.defect_type_id
                where pi.road_id = ? and run.division_id = any(?::uuid[])
                  and pi.status not in ('cancelled', 'completed')
                order by coalesce(lower(pi.scheduled_window), pi.created_at), pi.id
            SQL,
            [$road->id, $divisionIds],
        );

        $elements = array_map(
            fn (stdClass $row): array => $this->featurePayload(
                $row,
                'ELEMENT',
                $row->name === null ? (string) $row->element_type : (string) $row->name,
                'YTP elementi',
                (float) $row->latitude,
                (float) $row->longitude,
            ),
            $elementRows,
        );
        $defects = array_map(
            fn (stdClass $row): array => $this->featurePayload(
                $row,
                'DEFECT',
                (string) $row->kind_label,
                $this->defectState((string) $row->state_label),
                (float) $row->latitude,
                (float) $row->longitude,
            ),
            $defectRows,
        );
        $workZones = array_map(function (stdClass $row) use ($coordinates, $lengthM): array {
            $middle = ((float) $row->chainage_start + (float) $row->chainage_end) / 2;
            [$longitude, $latitude] = $this->coordinateAtChainage($coordinates, $lengthM, $middle);

            return $this->featurePayload(
                $row,
                'WORK_ZONE',
                (string) $row->kind_label,
                $this->workState((string) $row->state_label),
                $latitude,
                $longitude,
            );
        }, $workRows);

        return response()->json(['data' => [
            'road' => [
                'id' => (string) $road->id,
                'code' => (string) $road->official_code,
                'name' => (string) $road->name,
                'lengthM' => self::PRIMARY_ROAD_LENGTH_M,
                'geometry' => ['type' => 'LineString', 'coordinates' => $coordinates],
                'bounds' => $this->bounds($coordinates),
                'chainageMarkers' => $this->chainageMarkers($coordinates, self::PRIMARY_ROAD_LENGTH_M),
            ],
            'layers' => [
                'elements' => $elements,
                'defects' => $defects,
                'workZones' => $workZones,
            ],
        ]]);
    }

    private function d001ConfigurationError(): ?JsonResponse
    {
        if ((string) config('roadops.primary_road_code') === self::PRIMARY_ROAD_CODE
            && $this->hasExactPrimaryRoadLength(config('roadops.primary_road_length_m'))) {
            return null;
        }

        return response()->json(['error' => [
            'code' => 'D001_CONFIGURATION_MISMATCH',
            'message' => 'PRIMARY_ROAD_CODE=D001 va PRIMARY_ROAD_LENGTH_M=67000 qilib sozlanishi shart.',
        ]], 503);
    }

    private function hasExactPrimaryRoadLength(mixed $value): bool
    {
        return match (true) {
            is_int($value) => $value === self::PRIMARY_ROAD_LENGTH_M,
            is_float($value) => $value === (float) self::PRIMARY_ROAD_LENGTH_M,
            is_string($value) => preg_match('/^67000(?:\.0+)?$/D', $value) === 1,
            default => false,
        };
    }

    /** @return array<string, mixed> */
    private function featurePayload(
        stdClass $row,
        string $layer,
        string $kindLabel,
        string $stateLabel,
        float $latitude,
        float $longitude,
    ): array {
        $from = (float) $row->chainage_start;
        $to = (float) $row->chainage_end;

        return [
            'id' => (string) $row->id,
            'layer' => $layer,
            'locationLabel' => abs($to - $from) < 0.001
                ? sprintf('km %.3f', $from / 1000)
                : sprintf('km %.3f–%.3f', $from / 1000, $to / 1000),
            'kindLabel' => $kindLabel,
            'stateLabel' => $stateLabel,
            'latitude' => $latitude,
            'longitude' => $longitude,
            'chainageStartM' => $from,
            'chainageEndM' => $to,
        ];
    }

    /**
     * @param  non-empty-list<array{0: float, 1: float}>  $coordinates
     * @return list<array<string, mixed>>
     */
    private function chainageMarkers(array $coordinates, float $lengthM): array
    {
        $markers = [];
        for ($chainage = 0; $chainage < $lengthM; $chainage += 5000) {
            [$longitude, $latitude] = $this->coordinateAtChainage($coordinates, $lengthM, $chainage);
            $markers[] = [
                'chainageM' => $chainage,
                'label' => sprintf('%d+000', intdiv($chainage, 1000)),
                'latitude' => $latitude,
                'longitude' => $longitude,
            ];
        }
        [$longitude, $latitude] = $this->coordinateAtChainage($coordinates, $lengthM, $lengthM);
        $markers[] = [
            'chainageM' => (int) $lengthM,
            'label' => sprintf('%d+%03d', intdiv((int) $lengthM, 1000), (int) $lengthM % 1000),
            'latitude' => $latitude,
            'longitude' => $longitude,
        ];

        return $markers;
    }

    /**
     * @param  non-empty-list<array{0: float, 1: float}>  $coordinates
     * @return array{0: float, 1: float}
     */
    private function coordinateAtChainage(array $coordinates, float $lengthM, float $chainageM): array
    {
        $segmentLengths = [];
        $total = 0.0;
        for ($index = 1; $index < count($coordinates); $index++) {
            $left = $coordinates[$index - 1];
            $right = $coordinates[$index];
            $meanLatitude = deg2rad(($left[1] + $right[1]) / 2);
            $x = deg2rad($right[0] - $left[0]) * cos($meanLatitude);
            $y = deg2rad($right[1] - $left[1]);
            $distance = max(sqrt($x * $x + $y * $y) * 6_371_000, 0.001);
            $segmentLengths[] = $distance;
            $total += $distance;
        }
        $target = $total * min(max($chainageM / max($lengthM, 1), 0), 1);
        $travelled = 0.0;
        foreach ($segmentLengths as $index => $distance) {
            if ($travelled + $distance < $target) {
                $travelled += $distance;

                continue;
            }
            $fraction = min(max(($target - $travelled) / $distance, 0), 1);
            $left = $coordinates[$index];
            $right = $coordinates[$index + 1];

            return [
                $left[0] + ($right[0] - $left[0]) * $fraction,
                $left[1] + ($right[1] - $left[1]) * $fraction,
            ];
        }

        return $coordinates[array_key_last($coordinates)];
    }

    /**
     * @param  non-empty-list<array{0: float, 1: float}>  $coordinates
     * @return array{0: array{0: float, 1: float}, 1: array{0: float, 1: float}}
     */
    private function bounds(array $coordinates): array
    {
        $longitudes = array_column($coordinates, 0);
        $latitudes = array_column($coordinates, 1);

        return [[min($longitudes), min($latitudes)], [max($longitudes), max($latitudes)]];
    }

    /** @return array<string, mixed> */
    private function jsonObject(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        $decoded = json_decode((string) $value, true);

        return is_array($decoded) ? $decoded : [];
    }

    private function defectState(string $state): string
    {
        return match ($state) {
            'open' => 'Tasdiqlangan',
            'planned' => 'Rejalashtirilgan',
            'in_progress' => 'Bajarilmoqda',
            default => $state,
        };
    }

    private function workState(string $state): string
    {
        return match ($state) {
            'ready', 'approved' => 'Tayyor',
            'scheduled', 'issued', 'accepted' => 'Rejalashtirilgan',
            'in_progress' => 'Bajarilmoqda',
            'paused' => 'To‘xtatilgan',
            'blocked' => 'To‘siq bor',
            default => $state,
        };
    }
}
