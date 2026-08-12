<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Security\AuthContext;
use App\Support\ApiScope;
use App\Support\DbRows;
use App\Support\PagedResponse;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use stdClass;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

final class ManualInspectionController extends Controller
{
    private const PRIMARY_ROAD_CODE = 'D001';

    private const PRIMARY_ROAD_LENGTH_M = 67_000;

    public function options(Request $request, ApiScope $scope): JsonResponse
    {
        if (($configurationError = $this->d001ConfigurationError()) !== null) {
            return $configurationError;
        }

        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $roads = DbRows::select(
            <<<'SQL'
                select r.id, rv.official_code, rv.name, rv.length_m,
                       string_agg(distinct dv.name, ', ' order by dv.name) division_name
                from roadops.roads r
                join roadops.road_versions rv on rv.road_id = r.id
                  and rv.valid_from <= statement_timestamp()
                  and (rv.valid_until is null or rv.valid_until > statement_timestamp())
                join roadops.road_division_assignments assignment on assignment.road_id = r.id
                  and assignment.division_id = any(?::uuid[])
                  and assignment.valid_from <= statement_timestamp()
                  and (assignment.valid_until is null
                       or assignment.valid_until > statement_timestamp())
                join roadops.road_division_versions dv on dv.division_id = assignment.division_id
                  and dv.valid_from <= statement_timestamp()
                  and (dv.valid_until is null or dv.valid_until > statement_timestamp())
                where (r.retired_at is null or r.retired_at > statement_timestamp())
                  and lower(rv.official_code) = lower('D001')
                group by r.id, rv.official_code, rv.name, rv.length_m
                order by lower(rv.official_code), lower(rv.name), r.id
                limit 2
            SQL,
            [$divisionIds],
        );
        if (count($roads) !== 1
            || (string) $roads[0]->official_code !== self::PRIMARY_ROAD_CODE
            || ! $this->hasExactPrimaryRoadLength($roads[0]->length_m)) {
            return response()->json(['error' => [
                'code' => 'D001_SOURCE_MISSING_OR_AMBIGUOUS',
                'message' => 'YTP manbasida aynan bitta D001 yo‘li va uning uzunligi 67000 metr bo‘lishi shart.',
            ]], 409);
        }
        $defectTypes = DbRows::select(
            <<<'SQL'
                select id, code, name, measurement_unit
                from roadops.defect_types
                where active_from <= current_date
                  and (active_until is null or active_until > current_date)
                order by name, code
            SQL,
        );

        return response()->json(['data' => [
            'roads' => array_map(static fn (stdClass $road): array => [
                'id' => (string) $road->id,
                'code' => (string) $road->official_code,
                'name' => (string) $road->name,
                'divisionName' => (string) $road->division_name,
                'lengthM' => (int) $road->length_m,
            ], $roads),
            'defectTypes' => array_map(static fn (stdClass $row): array => [
                'id' => (string) $row->id,
                'code' => (string) $row->code,
                'name' => (string) $row->name,
                'unit' => (string) $row->measurement_unit,
            ], $defectTypes),
        ]]);
    }

    public function index(Request $request, ApiScope $scope): JsonResponse
    {
        if (($configurationError = $this->d001ConfigurationError()) !== null) {
            return $configurationError;
        }

        $pagination = Pagination::from($request);
        $state = strtoupper((string) $request->query('state', 'DRAFT'));
        if (! in_array($state, ['DRAFT', 'PENDING_REVIEW', 'VERIFIED', 'REJECTED'], true)) {
            return response()->json(['error' => [
                'code' => 'STATE_INVALID',
                'message' => 'Ko‘rik holati yaroqsiz.',
            ]], 422);
        }
        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $stateSql = match ($state) {
            'DRAFT' => "i.status in ('draft', 'returned')",
            'PENDING_REVIEW' => "i.status = 'submitted'",
            'VERIFIED' => "i.status = 'approved' and exists (
                select 1 from roadops.inspection_observations approved
                where approved.inspection_id = i.id and approved.review_status = 'approved'
            )",
            'REJECTED' => "i.status = 'approved' and not exists (
                select 1 from roadops.inspection_observations approved
                where approved.inspection_id = i.id and approved.review_status = 'approved'
            )",
        };
        $inspectionSql = str_replace(
            '__STATE_FILTER__',
            $stateSql,
            <<<'SQL'
                select i.id, i.inspection_number, i.inspection_started_at::date observed_date,
                       i.status, i.submitted_at, i.approved_at reviewed_at,
                       i.return_note, i.created_at, u.full_name inspector_name,
                       rv.official_code road_code, rv.name road_name,
                       dv.id division_id, dv.name division_name,
                       coalesce((
                         select jsonb_agg(jsonb_build_object(
                           'id', o.id,
                           'locationLabel', concat(
                             to_char(lower(o.chainage_span) / 1000, 'FM999990.000'), '–',
                             to_char(upper(o.chainage_span) / 1000, 'FM999990.000'), ' km',
                             case when o.lane_label is null then '' else ', ' || o.lane_label end
                           ),
                           'observedIssue', dt.name,
                           'exactQuantity', jsonb_build_object(
                             'value', o.measured_quantity::text, 'unit', o.measurement_unit
                           ),
                           'laneLabel', o.lane_label,
                           'reviewStatus', o.review_status,
                           'reviewNote', o.review_note
                         ) order by o.observed_at, o.id)
                         from roadops.inspection_observations o
                         join roadops.defect_types dt on dt.id = o.defect_type_id
                         where o.inspection_id = i.id
                       ), '[]'::jsonb) observations,
                       (select string_agg(distinct o.review_note, E'\n' order by o.review_note)
                          from roadops.inspection_observations o
                         where o.inspection_id = i.id and o.review_note is not null) reviewer_note
                from roadops.inspections i
                join roadops.app_users u on u.id = i.inspector_user_id
                join roadops.road_versions rv on rv.road_id = i.road_id and rv.valid_until is null
                join roadops.road_division_versions dv on dv.division_id = i.division_id
                  and dv.valid_until is null
                where i.division_id = any(?::uuid[])
                  and rv.official_code = 'D001'
                  and rv.length_m = 67000
                  and __STATE_FILTER__
            SQL,
        );
        $total = (int) DB::scalar(
            'select count(*) from ('.$inspectionSql.') scoped_inspections',
            [$divisionIds],
        );
        $rows = DbRows::select(
            $inspectionSql.' order by i.created_at desc, i.id desc limit ? offset ?',
            [$divisionIds, $pagination->pageSize, $pagination->offset()],
        );

        return PagedResponse::make(
            array_map(fn (stdClass $row): array => $this->inspectionPayload($row), $rows),
            $pagination->page,
            $pagination->pageSize,
            $total,
        );
    }

    public function store(Request $request): JsonResponse
    {
        if (($configurationError = $this->d001ConfigurationError()) !== null) {
            return $configurationError;
        }

        $validated = $request->validate([
            'roadId' => ['required', 'uuid'],
            'defectTypeId' => ['required', 'uuid'],
            'observedDate' => ['required', 'date_format:Y-m-d', 'before_or_equal:today'],
            'chainageStartM' => ['required', 'integer', 'min:0', 'max:66999'],
            'chainageEndM' => ['nullable', 'integer', 'gt:chainageStartM'],
            'direction' => ['nullable', 'string', 'max:100'],
            'laneLabel' => ['nullable', 'string', 'max:100'],
            'observedIssue' => ['required', 'string', 'max:500'],
            'exactQuantity' => ['required', 'numeric', 'gt:0'],
            'unit' => ['required', 'string', 'max:30'],
            'note' => ['nullable', 'string', 'max:5000'],
            'evidence' => ['nullable', 'array', 'max:20'],
            'evidence.*.objectUri' => ['required', 'string', 'max:2048', 'regex:/^s3:\/\/[A-Za-z0-9._-]+\/.+$/'],
            'evidence.*.contentType' => ['required', 'in:image/jpeg,image/png,video/mp4'],
            'evidence.*.capturedAt' => ['required', 'date'],
            'evidence.*.latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'evidence.*.longitude' => ['nullable', 'numeric', 'between:-180,180'],
        ]);
        $context = $request->attributes->get(AuthContext::class);
        if (! $context instanceof AuthContext) {
            abort(401);
        }
        $end = isset($validated['chainageEndM'])
            ? (int) $validated['chainageEndM']
            : (int) $validated['chainageStartM'] + 1;
        if ($end > self::PRIMARY_ROAD_LENGTH_M) {
            return response()->json(['error' => [
                'code' => 'CHAINAGE_OUTSIDE_D001',
                'message' => 'Piketaj D001 yo‘lining 0–67000 metr chegarasidan tashqarida.',
            ]], 422);
        }
        $roads = DbRows::select(
            <<<'SQL'
                with parameters as (
                  select ?::uuid road_id, ?::numeric chainage_start, ?::numeric chainage_end,
                         ((?::date + time '12:00') at time zone 'Asia/Tashkent') observed_at
                )
                select r.id, rv.official_code, rv.name, rv.length_m, zone.division_id
                from parameters p
                join roadops.roads r on r.retired_at is null or r.retired_at > p.observed_at
                join roadops.road_versions rv on rv.road_id = r.id
                  and rv.valid_from <= p.observed_at
                  and (rv.valid_until is null or rv.valid_until > p.observed_at)
                cross join lateral (
                  select roadops.division_for_road_zone(
                    r.id, numrange(p.chainage_start, p.chainage_end, '[)'), p.observed_at
                  ) division_id
                ) zone
                where lower(rv.official_code) = lower('D001')
                order by rv.valid_from desc, r.id
                limit 2
            SQL,
            [
                $validated['roadId'], $validated['chainageStartM'], $end, $validated['observedDate'],
            ],
        );
        if ($roads === []) {
            return response()->json(['error' => [
                'code' => 'ROAD_NOT_ACCESSIBLE',
                'message' => 'Tanlangan yo‘l kuzatuv sanasida amaldagi YTP ma’lumotlari yoki ruxsat doirasida mavjud emas.',
            ]], 404);
        }
        if (count($roads) !== 1) {
            return response()->json(['error' => [
                'code' => 'ROAD_SOURCE_AMBIGUOUS',
                'message' => 'Tanlangan yo‘lning kuzatuv sanasidagi YTP yozuvi bir ma’noli aniqlanmadi.',
            ]], 409);
        }
        $road = $roads[0];
        if ((string) $road->id !== (string) $validated['roadId']) {
            return response()->json(['error' => [
                'code' => 'D001_ROAD_ID_MISMATCH',
                'message' => 'Yuborilgan roadId amaldagi D001 yozuviga mos emas.',
            ]], 409);
        }
        if ((string) $road->official_code !== self::PRIMARY_ROAD_CODE
            || ! $this->hasExactPrimaryRoadLength($road->length_m)) {
            return response()->json(['error' => [
                'code' => 'D001_CONFIGURATION_MISMATCH',
                'message' => 'YTP manbasidagi D001 yo‘li uzunligi aynan 67000 metr bo‘lishi shart.',
            ]], 409);
        }
        if ($road->division_id === null) {
            return response()->json(['error' => [
                'code' => 'ROAD_ASSIGNMENT_MISSING_OR_AMBIGUOUS',
                'message' => 'Tanlangan kesim va kuzatuv sanasi uchun bitta amaldagi YTP yo‘l bo‘limi aniqlanmadi.',
            ]], 422);
        }
        if (! $context->canAccessRoadUnit((string) $road->division_id)) {
            return response()->json(['error' => [
                'code' => 'ROAD_ZONE_NOT_ACCESSIBLE',
                'message' => 'Tanlangan yo‘l kesimi ruxsat doirasidan tashqarida.',
            ]], 404);
        }
        $defect = DbRows::selectOne(
            <<<'SQL'
                select id, name, measurement_unit from roadops.defect_types
                where id = ? and active_from <= ?::date
                  and (active_until is null or active_until > ?::date)
            SQL,
            [$validated['defectTypeId'], $validated['observedDate'], $validated['observedDate']],
        );
        if ($defect === null || (string) $defect->measurement_unit !== (string) $validated['unit']) {
            return response()->json(['error' => [
                'code' => 'DEFECT_TYPE_OR_UNIT_INVALID',
                'message' => 'Nuqson turi faol emas yoki o‘lchov birligi katalogga mos emas.',
            ]], 422);
        }
        $rawEvidence = $validated['evidence'] ?? [];
        if (! is_array($rawEvidence)) {
            throw ValidationException::withMessages([
                'evidence' => ['Dalillar ro‘yxat ko‘rinishida bo‘lishi kerak.'],
            ]);
        }
        $evidence = $this->validatedEvidence($rawEvidence);

        $inspectionId = (string) Str::uuid();
        $observationId = (string) Str::uuid();
        DB::transaction(function () use (
            $validated,
            $context,
            $road,
            $end,
            $evidence,
            $inspectionId,
            $observationId,
        ): void {
            DB::insert(
                <<<'SQL'
                    insert into roadops.inspections
                        (id, inspection_number, division_id, road_id, status,
                         inspection_started_at, inspector_user_id, source_reference)
                    values (?, ?, ?, ?, 'draft', ?::date + interval '12 hours', ?, 'manual-web')
                SQL,
                [
                    $inspectionId,
                    'INSP-'.now('Asia/Tashkent')->format('Ymd').'-'.strtoupper(substr(str_replace('-', '', $inspectionId), 0, 10)),
                    $road->division_id,
                    $validated['roadId'],
                    $validated['observedDate'],
                    $context->userId,
                ],
            );
            $source = [
                'inspection_id' => $inspectionId,
                'defect_type_id' => $validated['defectTypeId'],
                'chainage_start_m' => (int) $validated['chainageStartM'],
                'chainage_end_m' => $end,
                'direction' => $validated['direction'] ?? null,
                'lane' => $validated['laneLabel'] ?? null,
                'quantity' => (string) $validated['exactQuantity'],
                'unit' => $validated['unit'],
                'evidence' => $evidence,
            ];
            DB::insert(
                <<<'SQL'
                    insert into roadops.inspection_observations
                        (id, inspection_id, defect_type_id, chainage_span, observed_at,
                         measured_quantity, measurement_unit, direction, lane_label,
                         description, evidence, source_hash)
                    values (?, ?, ?, numrange(?, ?, '[)'), ?::date + interval '12 hours',
                            ?, ?, ?, ?, ?, ?::jsonb, decode(?, 'hex'))
                SQL,
                [
                    $observationId,
                    $inspectionId,
                    $validated['defectTypeId'],
                    $validated['chainageStartM'],
                    $end,
                    $validated['observedDate'],
                    $validated['exactQuantity'],
                    $validated['unit'],
                    $validated['direction'] ?? null,
                    $validated['laneLabel'] ?? null,
                    trim((string) ($validated['note'] ?? $validated['observedIssue'])),
                    json_encode($evidence, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                    hash('sha256', json_encode($source, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)),
                ],
            );
            DB::insert(
                <<<'SQL'
                    insert into roadops.inspection_events
                        (inspection_id, observation_id, from_status, to_status,
                         event_code, actor_user_id, request_id)
                    values (?, ?, null, 'draft', 'manual_inspection_created', ?, roadops.current_request_id())
                SQL,
                [$inspectionId, $observationId, $context->userId],
            );
        });

        return response()->json(['data' => ['id' => $inspectionId]], 201);
    }

    public function submit(string $id): JsonResponse
    {
        if (($configurationError = $this->d001ConfigurationError()) !== null) {
            return $configurationError;
        }

        $this->assertUuid($id);
        $this->findPayload($id);
        try {
            DB::transaction(static function () use ($id): void {
                DB::select('select roadops.submit_inspection(?)', [$id]);
            });
        } catch (\Throwable $exception) {
            return $this->workflowError($exception, 'INSPECTION_SUBMIT_REJECTED');
        }

        return response()->json(['data' => $this->findPayload($id)]);
    }

    public function decide(Request $request, string $id): JsonResponse
    {
        if (($configurationError = $this->d001ConfigurationError()) !== null) {
            return $configurationError;
        }

        $this->assertUuid($id);
        $this->findPayload($id);
        $validated = $request->validate([
            'decision' => ['required', 'in:VERIFIED,REJECTED'],
            'note' => ['nullable', 'string', 'max:5000'],
        ]);
        if ($validated['decision'] === 'REJECTED'
            && trim((string) ($validated['note'] ?? '')) === '') {
            return response()->json(['error' => [
                'code' => 'NOTE_REQUIRED',
                'message' => 'Rad etish sababini yozing.',
            ]], 422);
        }
        try {
            DB::transaction(function () use ($id, $validated): void {
                $observations = DbRows::select(
                    <<<'SQL'
                        select o.id
                        from roadops.inspection_observations o
                        join roadops.inspections i on i.id = o.inspection_id
                        where i.id = ? and i.status = 'submitted' and o.review_status = 'pending'
                        order by o.observed_at, o.id
                        for update of i, o
                    SQL,
                    [$id],
                );
                if ($observations === []) {
                    throw new \DomainException('INSPECTION_NOT_PENDING_REVIEW');
                }
                $decision = $validated['decision'] === 'VERIFIED' ? 'approved' : 'rejected';
                foreach ($observations as $observation) {
                    DB::select(
                        'select roadops.review_inspection_observation(?, ?, ?)',
                        [$observation->id, $decision, $validated['note'] ?? null],
                    );
                }
            });
        } catch (\Throwable $exception) {
            return $this->workflowError($exception, 'INSPECTION_DECISION_REJECTED');
        }

        return response()->json(['data' => $this->findPayload($id)]);
    }

    /**
     * @param  array<array-key, mixed>  $items
     * @return list<array<string, mixed>>
     */
    private function validatedEvidence(array $items): array
    {
        $bucket = trim((string) config('roadops.manual_evidence_s3_bucket'));
        $result = [];
        foreach ($items as $item) {
            if (! is_array($item)) {
                throw ValidationException::withMessages([
                    'evidence' => ['Har bir dalil obyekt ko‘rinishida bo‘lishi kerak.'],
                ]);
            }
            $parts = parse_url((string) $item['objectUri']);
            $itemBucket = is_array($parts) ? (string) ($parts['host'] ?? '') : '';
            if ($bucket === '' || ! hash_equals($bucket, $itemBucket)) {
                throw ValidationException::withMessages([
                    'evidence' => ['Dalil faqat sozlangan qo‘lda ko‘rik S3 hududidan qabul qilinadi.'],
                ]);
            }
            $hasLatitude = isset($item['latitude']) && $item['latitude'] !== '';
            $hasLongitude = isset($item['longitude']) && $item['longitude'] !== '';
            if ($hasLatitude !== $hasLongitude) {
                throw ValidationException::withMessages([
                    'evidence' => ['GPS kenglik va uzunlik qiymatlari birga kiritiladi.'],
                ]);
            }
            $result[] = [
                'objectUri' => (string) $item['objectUri'],
                'contentType' => (string) $item['contentType'],
                'capturedAt' => (string) $item['capturedAt'],
                'latitude' => $hasLatitude ? (float) $item['latitude'] : null,
                'longitude' => $hasLongitude ? (float) $item['longitude'] : null,
            ];
        }

        return $result;
    }

    /** @return array<string, mixed> */
    private function findPayload(string $id): array
    {
        $row = DbRows::selectOne(
            <<<'SQL'
                select i.id, i.inspection_number, i.inspection_started_at::date observed_date,
                       i.status, i.submitted_at, i.approved_at reviewed_at,
                       i.return_note, i.created_at, u.full_name inspector_name,
                       rv.official_code road_code, rv.name road_name,
                       dv.id division_id, dv.name division_name,
                       coalesce((select jsonb_agg(jsonb_build_object(
                         'id', o.id,
                         'locationLabel', concat(
                           to_char(lower(o.chainage_span) / 1000, 'FM999990.000'), '–',
                           to_char(upper(o.chainage_span) / 1000, 'FM999990.000'), ' km',
                           case when o.lane_label is null then '' else ', ' || o.lane_label end
                         ),
                         'observedIssue', dt.name,
                         'exactQuantity', jsonb_build_object('value', o.measured_quantity::text, 'unit', o.measurement_unit),
                         'laneLabel', o.lane_label,
                         'reviewStatus', o.review_status,
                         'reviewNote', o.review_note
                       ) order by o.observed_at, o.id)
                       from roadops.inspection_observations o
                       join roadops.defect_types dt on dt.id = o.defect_type_id
                       where o.inspection_id = i.id), '[]'::jsonb) observations,
                       (select string_agg(distinct o.review_note, E'\n' order by o.review_note)
                          from roadops.inspection_observations o
                         where o.inspection_id = i.id and o.review_note is not null) reviewer_note
                from roadops.inspections i
                join roadops.app_users u on u.id = i.inspector_user_id
                join roadops.road_versions rv on rv.road_id = i.road_id and rv.valid_until is null
                join roadops.road_division_versions dv on dv.division_id = i.division_id and dv.valid_until is null
                where i.id = ?
                  and rv.official_code = 'D001'
                  and rv.length_m = 67000
            SQL,
            [$id],
        );
        if ($row === null) {
            abort(404);
        }

        return $this->inspectionPayload($row);
    }

    /** @return array<string, mixed> */
    private function inspectionPayload(stdClass $row): array
    {
        $observations = $this->jsonArray($row->observations);
        $approved = count(array_filter(
            $observations,
            static fn (mixed $item): bool => is_array($item) && ($item['reviewStatus'] ?? null) === 'approved',
        ));
        $state = match ((string) $row->status) {
            'submitted' => 'PENDING_REVIEW',
            'approved' => $approved > 0 ? 'VERIFIED' : 'REJECTED',
            default => 'DRAFT',
        };
        $cleanObservations = array_map(static function (mixed $item): mixed {
            if (! is_array($item)) {
                return $item;
            }
            unset($item['reviewStatus'], $item['reviewNote']);

            return $item;
        }, $observations);

        return [
            'id' => (string) $row->id,
            'inspectionNumber' => (string) $row->inspection_number,
            'road' => ['code' => (string) $row->road_code, 'name' => (string) $row->road_name],
            'division' => ['id' => (string) $row->division_id, 'name' => (string) $row->division_name],
            'observedDate' => (string) $row->observed_date,
            'inspectorName' => (string) $row->inspector_name,
            'state' => $state,
            'observations' => $cleanObservations,
            'note' => $row->return_note === null ? null : (string) $row->return_note,
            'reviewerNote' => $row->reviewer_note === null ? null : (string) $row->reviewer_note,
            'submittedAt' => $row->submitted_at === null ? null : (string) $row->submitted_at,
            'reviewedAt' => $row->reviewed_at === null ? null : (string) $row->reviewed_at,
        ];
    }

    /** @return list<mixed> */
    private function jsonArray(mixed $value): array
    {
        if (is_array($value)) {
            return array_values($value);
        }
        $decoded = json_decode((string) $value, true);

        return is_array($decoded) ? array_values($decoded) : [];
    }

    private function assertUuid(string $id): void
    {
        if (! preg_match('/^[0-9a-f-]{36}$/i', $id)) {
            abort(404);
        }
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

    private function workflowError(\Throwable $exception, string $code): JsonResponse
    {
        if ($exception instanceof HttpExceptionInterface) {
            throw $exception;
        }
        $message = match (true) {
            str_contains($exception->getMessage(), 'assigned inspector') => 'Faqat ko‘rikni kiritgan yo‘l ustasi uni yuborishi mumkin.',
            str_contains($exception->getMessage(), 'Independent verifier') => 'Ko‘rikni uni kiritmagan vakolatli tekshiruvchi tasdiqlashi kerak.',
            str_contains($exception->getMessage(), 'INSPECTION_NOT_PENDING_REVIEW') => 'Ko‘rik qaror kutayotgan holatda emas.',
            str_contains($exception->getMessage(), 'not found') => 'Ko‘rik topilmadi.',
            default => 'Ko‘rik amali ma’lumotlar bazasi qoidalari bo‘yicha rad etildi.',
        };

        return response()->json(['error' => ['code' => $code, 'message' => $message]], 422);
    }
}
