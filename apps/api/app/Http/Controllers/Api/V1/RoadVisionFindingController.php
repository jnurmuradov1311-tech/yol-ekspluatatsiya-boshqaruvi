<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Evidence\EvidencePolicyException;
use App\Domain\Evidence\S3EvidencePolicy;
use App\Domain\Evidence\S3EvidenceStreamer;
use App\Http\Controllers\Controller;
use App\Support\ApiScope;
use App\Support\DbRows;
use App\Support\PagedResponse;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

final class RoadVisionFindingController extends Controller
{
    public function index(Request $request, ApiScope $scope): JsonResponse
    {
        $pagination = Pagination::from($request);
        $ids = $scope->pgUuidArray($scope->roadUnitIds($request));
        $state = strtoupper((string) $request->query('state', 'PENDING_REVIEW'));
        $statuses = match ($state) {
            'VERIFIED' => '{confirmed}',
            'REJECTED' => '{rejected}',
            'DUPLICATE' => '{rejected}',
            'PENDING_REVIEW' => '{received,unmatched,awaiting_verification}',
            default => null,
        };
        if ($statuses === null) {
            return response()->json(['error' => ['code' => 'STATE_INVALID', 'message' => 'Ko‘rik holati yaroqsiz.']], 422);
        }
        $rows = DbRows::select(
            <<<'SQL'
                select c.id, c.external_candidate_id, c.observed_at, c.ingested_at, c.status,
                       c.evidence, c.lane_label,
                       lower(c.chainage_span) chainage_from,
                       upper(c.chainage_span) chainage_to, rv.official_code road_code,
                       rv.name road_name, owner.division_id, dv.name division_name,
                       coalesce(ac.external_name, dt.name, 'Moslanmagan atribut') attribute_name,
                       v.measured_quantity, v.measurement_unit, v.note
                from roadops.roadvision_candidates c
                join roadops.road_versions rv on rv.road_id=c.road_id and rv.valid_until is null
                cross join lateral (
                  select roadops.division_for_road_zone(c.road_id, c.chainage_span, c.observed_at) division_id
                ) owner
                left join roadops.road_division_versions dv
                  on dv.division_id=owner.division_id and dv.valid_until is null
                left join roadops.roadvision_attribute_catalog ac on ac.id=c.attribute_catalog_id
                left join roadops.defect_types dt on dt.id=c.defect_type_id
                left join roadops.roadvision_candidate_verifications v on v.candidate_id=c.id
                where c.status=any(?::text[]) and owner.division_id=any(?::uuid[])
                  and (? = 'all'
                    or (? = 'duplicate' and coalesce(v.note, '') like '[DUPLICATE]%')
                    or (? = 'rejected' and coalesce(v.note, '') not like '[DUPLICATE]%'))
                order by c.observed_at desc, c.id desc
                limit ? offset ?
            SQL,
            [
                $statuses, $ids,
                $this->decisionFilter($state), $this->decisionFilter($state), $this->decisionFilter($state),
                $pagination->pageSize, $pagination->offset(),
            ],
        );
        $count = (int) DB::scalar(
            <<<'SQL'
                select count(*) from roadops.roadvision_candidates c
                join roadops.road_versions rv on rv.road_id=c.road_id and rv.valid_until is null
                cross join lateral (
                  select roadops.division_for_road_zone(c.road_id, c.chainage_span, c.observed_at) division_id
                ) owner
                left join roadops.roadvision_candidate_verifications v on v.candidate_id=c.id
                where c.status=any(?::text[]) and owner.division_id=any(?::uuid[])
                  and (? = 'all'
                    or (? = 'duplicate' and coalesce(v.note, '') like '[DUPLICATE]%')
                    or (? = 'rejected' and coalesce(v.note, '') not like '[DUPLICATE]%'))
            SQL,
            [$statuses, $ids, $this->decisionFilter($state), $this->decisionFilter($state), $this->decisionFilter($state)],
        );

        return PagedResponse::make(
            array_map(fn (object $row): array => $this->payload($row), $rows),
            $pagination->page,
            $pagination->pageSize,
            $count,
        );
    }

    public function confirmedDefects(Request $request, ApiScope $scope): JsonResponse
    {
        $state = strtoupper((string) $request->query('state', 'OPEN'));
        if (! in_array($state, ['OPEN', 'PLANNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED'], true)) {
            return response()->json(['error' => [
                'code' => 'STATE_INVALID',
                'message' => 'Tasdiqlangan nuqson holati yaroqsiz.',
            ]], 422);
        }

        $pagination = Pagination::from($request);
        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $bindings = [strtolower($state), $divisionIds];
        $fromSql = <<<'SQL'
            from roadops.defect_cases defect
            join roadops.defect_types kind on kind.id=defect.defect_type_id
            join roadops.road_versions road
              on road.road_id=defect.road_id
             and road.valid_from <= statement_timestamp()
             and (road.valid_until is null or road.valid_until > statement_timestamp())
            left join roadops.roadvision_candidates roadvision
              on roadvision.id=defect.roadvision_candidate_id
            left join roadops.inspection_observations observation
              on observation.id=defect.inspection_observation_id
            left join roadops.iqn_work_items topic
              on topic.id=coalesce(defect.iqn_topic_work_item_id, observation.iqn_topic_work_item_id)
            left join roadops.inspections inspection on inspection.id=observation.inspection_id
            cross join lateral (
              select roadops.division_for_road_zone(
                defect.road_id, defect.chainage_span, defect.observed_at
              ) division_id
            ) owner
            join roadops.road_division_versions division
              on division.division_id=owner.division_id
             and division.valid_from <= defect.observed_at
             and (division.valid_until is null or division.valid_until > defect.observed_at)
            where defect.status=? and owner.division_id=any(?::uuid[])
        SQL;
        $total = (int) DB::scalar('select count(*) '.$fromSql, $bindings);
        $rows = DbRows::select(
            <<<'SQL'
                select defect.id, defect.source_kind,
                       coalesce(roadvision.external_candidate_id, inspection.inspection_number, defect.id::text)
                         source_reference,
                       defect.observed_at, lower(defect.chainage_span) chainage_from,
                       upper(defect.chainage_span) chainage_to,
                       coalesce(topic.normalized_name, kind.name) defect_name,
                       defect.measured_quantity, defect.measurement_unit, defect.status,
                       road.official_code road_code, road.name road_name,
                       owner.division_id, division.name division_name
            SQL.' '.$fromSql.' order by defect.observed_at desc, defect.id desc limit ? offset ?',
            [...$bindings, $pagination->pageSize, $pagination->offset()],
        );
        $items = array_map(static fn (\stdClass $row): array => [
            'id' => (string) $row->id,
            'sourceKind' => strtoupper((string) $row->source_kind),
            'sourceReference' => (string) $row->source_reference,
            'road' => ['code' => (string) $row->road_code, 'name' => (string) $row->road_name],
            'division' => ['id' => (string) $row->division_id, 'name' => (string) $row->division_name],
            'observedAt' => (string) $row->observed_at,
            'locationLabel' => sprintf(
                'km %.3f–%.3f',
                (float) $row->chainage_from / 1000,
                (float) $row->chainage_to / 1000,
            ),
            'chainageStartM' => (float) $row->chainage_from,
            'chainageEndM' => (float) $row->chainage_to,
            'defectName' => (string) $row->defect_name,
            'exactQuantity' => [
                'value' => (string) $row->measured_quantity,
                'unit' => (string) $row->measurement_unit,
            ],
            'state' => strtoupper((string) $row->status),
        ], $rows);

        return PagedResponse::make($items, $pagination->page, $pagination->pageSize, $total);
    }

    public function decide(Request $request, string $id): JsonResponse
    {
        if (! preg_match('/^[0-9a-f-]{36}$/i', $id)) {
            abort(404);
        }
        if (! $this->findingExists($id)) {
            abort(404);
        }
        $validated = $request->validate([
            'decision' => ['required', 'in:VERIFIED,REJECTED,DUPLICATE'],
            'note' => ['nullable', 'string', 'max:5000'],
            'measuredQuantity.value' => ['required_if:decision,VERIFIED', 'nullable', 'numeric', 'gt:0'],
            'measuredQuantity.unit' => ['required_if:decision,VERIFIED', 'nullable', 'string', 'max:30'],
        ]);
        if (in_array($validated['decision'], ['REJECTED', 'DUPLICATE'], true)
            && trim((string) ($validated['note'] ?? '')) === '') {
            return response()->json(['error' => ['code' => 'NOTE_REQUIRED', 'message' => 'Rad etish yoki dublikat uchun izoh majburiy.']], 422);
        }
        $decision = $validated['decision'] === 'VERIFIED' ? 'confirmed' : 'rejected';
        $note = $validated['decision'] === 'DUPLICATE'
            ? '[DUPLICATE] '.trim((string) $validated['note'])
            : ($validated['note'] ?? null);
        $quantity = $validated['measuredQuantity']['value'] ?? null;
        $unit = $validated['measuredQuantity']['unit'] ?? null;

        try {
            DbRows::selectOne(
                'select roadops.verify_roadvision_candidate(?, ?, ?, ?, ?) as defect_id',
                [$id, $decision, $quantity, $unit, $note],
            );
        } catch (\Throwable $exception) {
            return response()->json(['error' => [
                'code' => 'FINDING_DECISION_REJECTED',
                'message' => $this->safeMessage($exception),
            ]], 422);
        }
        $row = DbRows::selectOne(
            <<<'SQL'
                select c.id, c.external_candidate_id, c.observed_at, c.ingested_at, c.status,
                       c.evidence, c.lane_label,
                       lower(c.chainage_span) chainage_from,
                       upper(c.chainage_span) chainage_to, rv.official_code road_code,
                       rv.name road_name, owner.division_id, dv.name division_name,
                       coalesce(ac.external_name, dt.name, 'Moslanmagan atribut') attribute_name,
                       v.measured_quantity, v.measurement_unit, v.note
                from roadops.roadvision_candidates c
                left join roadops.road_versions rv on rv.road_id=c.road_id and rv.valid_until is null
                cross join lateral (
                  select roadops.division_for_road_zone(c.road_id, c.chainage_span, c.observed_at) division_id
                ) owner
                left join roadops.road_division_versions dv
                  on dv.division_id=owner.division_id and dv.valid_until is null
                left join roadops.roadvision_attribute_catalog ac on ac.id=c.attribute_catalog_id
                left join roadops.defect_types dt on dt.id=c.defect_type_id
                left join roadops.roadvision_candidate_verifications v on v.candidate_id=c.id
                where c.id=?
            SQL,
            [$id],
        );
        if ($row === null) {
            abort(404);
        }
        $payload = $this->payload($row);
        if ($validated['decision'] === 'DUPLICATE') {
            $payload['state'] = 'DUPLICATE';
        }

        return response()->json(['data' => $payload]);
    }

    public function evidence(
        Request $request,
        S3EvidenceStreamer $streamer,
        string $id,
        string $index,
    ): Response {
        if (! preg_match('/^[0-9a-f-]{36}$/i', $id)) {
            abort(404);
        }
        if (preg_match('/^(?:0|[1-9][0-9]?)$/D', $index) !== 1) {
            abort(404);
        }
        $row = DbRows::selectOne(
            <<<'SQL'
                select candidate.evidence
                from roadops.roadvision_candidates candidate
                join roadops.road_versions road
                  on road.road_id=candidate.road_id and road.valid_until is null
                where candidate.id=?
            SQL,
            [$id],
        );
        if ($row === null) {
            abort(404);
        }
        $media = $this->jsonArray($row->evidence);
        $item = $media[(int) $index] ?? null;
        if (! is_array($item)) {
            abort(404);
        }
        try {
            $policy = S3EvidencePolicy::fromConfiguration(
                (array) config('roadops.integrations.roadvision', []),
            );
            $evidence = $policy->object(
                (string) ($item['object_uri'] ?? ''),
                (string) ($item['content_type'] ?? ''),
                (string) ($item['sha256'] ?? ''),
            );
        } catch (EvidencePolicyException $exception) {
            return $streamer->policyError($exception);
        }

        return $streamer->stream($request, $policy, $evidence);
    }

    /** @return array<string, mixed> */
    private function payload(\stdClass $row): array
    {
        $state = match ((string) $row->status) {
            'confirmed' => 'VERIFIED',
            'rejected' => str_starts_with((string) $row->note, '[DUPLICATE]') ? 'DUPLICATE' : 'REJECTED',
            default => 'PENDING_REVIEW',
        };

        return [
            'id' => (string) $row->id,
            'vendorReference' => (string) $row->external_candidate_id,
            'attributeName' => (string) $row->attribute_name,
            'road' => ['code' => (string) $row->road_code, 'name' => (string) $row->road_name],
            'division' => ['id' => (string) $row->division_id, 'name' => (string) $row->division_name],
            'chainageStartM' => (float) $row->chainage_from,
            'chainageEndM' => $row->chainage_to === null ? null : (float) $row->chainage_to,
            'laneLabel' => $row->lane_label === null ? null : (string) $row->lane_label,
            'observedAt' => (string) $row->observed_at,
            'receivedAt' => (string) $row->ingested_at,
            'state' => $state,
            'measuredQuantity' => $row->measured_quantity === null ? null : [
                'value' => (string) $row->measured_quantity,
                'unit' => (string) $row->measurement_unit,
            ],
            'evidence' => $this->roadVisionEvidence($row->evidence, (string) $row->id),
            'reviewerNote' => $row->note === null ? null : (string) $row->note,
        ];
    }

    private function safeMessage(\Throwable $exception): string
    {
        $message = $exception->getMessage();
        foreach ([
            'requires road, defect, chainage, quantity, and unit' => 'Tasdiqlash uchun yo‘l, nuqson turi, piketaj, miqdor va birlik majburiy.',
            'not awaiting human verification' => 'Kuzatuv hozir inson ko‘rigini kutmayapti.',
            'cannot verify this division' => 'Bu yo‘l bo‘limidagi kuzatuvni tasdiqlashga ruxsat yo‘q.',
        ] as $needle => $translation) {
            if (str_contains($message, $needle)) {
                return $translation;
            }
        }

        return 'Qaror DB qoidalari bo‘yicha qabul qilinmadi.';
    }

    private function decisionFilter(string $state): string
    {
        return match ($state) {
            'DUPLICATE' => 'duplicate',
            'REJECTED' => 'rejected',
            default => 'all',
        };
    }

    private function findingExists(string $id): bool
    {
        return (int) DB::scalar(
            <<<'SQL'
                select count(*)
                from roadops.roadvision_candidates candidate
                where candidate.id=?
            SQL,
            [$id],
        ) === 1;
    }

    /** @return list<array<string, mixed>> */
    private function roadVisionEvidence(mixed $value, string $findingId): array
    {
        $result = [];
        foreach ($this->jsonArray($value) as $index => $item) {
            if (! is_array($item)
                || ! isset($item['object_uri'], $item['content_type'], $item['sha256'], $item['captured_at'])
                || ! is_string($item['object_uri'])
                || preg_match('#^s3://[^/]+/.+$#D', $item['object_uri']) !== 1
                || ! in_array($item['content_type'], ['image/jpeg', 'image/png', 'video/mp4'], true)
                || ! is_string($item['sha256'])
                || preg_match('/^[a-f0-9]{64}$/D', $item['sha256']) !== 1) {
                continue;
            }
            $result[] = [
                'index' => $index,
                'mediaId' => isset($item['media_id']) ? (string) $item['media_id'] : null,
                'contentType' => (string) $item['content_type'],
                'capturedAt' => (string) $item['captured_at'],
                'sha256' => (string) $item['sha256'],
                'url' => '/api/v1/roadvision/findings/'.rawurlencode($findingId)
                    .'/evidence/'.$index,
            ];
        }

        return $result;
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
}
