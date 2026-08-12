<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\ApiScope;
use App\Support\DbRows;
use App\Support\HttpByteRange;
use App\Support\PagedResponse;
use App\Support\Pagination;
use Aws\S3\S3Client;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class RoadVisionFindingController extends Controller
{
    private const PRIMARY_ROAD_CODE = 'D001';

    public function index(Request $request, ApiScope $scope): JsonResponse
    {
        if (($configurationError = $this->d001ConfigurationError()) !== null) {
            return $configurationError;
        }

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
                       c.evidence_reference, c.evidence_media_type, c.lane_label,
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
                  and rv.official_code='D001' and rv.length_m=67000
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
                  and rv.official_code='D001' and rv.length_m=67000
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
        if (($configurationError = $this->d001ConfigurationError()) !== null) {
            return $configurationError;
        }

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
              and road.official_code='D001' and road.length_m=67000
        SQL;
        $total = (int) DB::scalar('select count(*) '.$fromSql, $bindings);
        $rows = DbRows::select(
            <<<'SQL'
                select defect.id, defect.source_kind,
                       coalesce(roadvision.external_candidate_id, inspection.inspection_number, defect.id::text)
                         source_reference,
                       defect.observed_at, lower(defect.chainage_span) chainage_from,
                       upper(defect.chainage_span) chainage_to, kind.name defect_name,
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
        if (($configurationError = $this->d001ConfigurationError()) !== null) {
            return $configurationError;
        }

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
                       c.evidence_reference, c.evidence_media_type, c.lane_label,
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
                where c.id=? and rv.official_code='D001' and rv.length_m=67000
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

    public function evidence(Request $request, string $id): Response
    {
        if (($configurationError = $this->d001ConfigurationError()) !== null) {
            return $configurationError;
        }

        if (! preg_match('/^[0-9a-f-]{36}$/i', $id)) {
            abort(404);
        }
        $row = DbRows::selectOne(
            <<<'SQL'
                select candidate.evidence_reference
                from roadops.roadvision_candidates candidate
                join roadops.road_versions road
                  on road.road_id=candidate.road_id and road.valid_until is null
                where candidate.id=? and road.official_code='D001' and road.length_m=67000
            SQL,
            [$id],
        );
        if ($row === null || trim((string) $row->evidence_reference) === '') {
            abort(404);
        }

        $uri = (string) $row->evidence_reference;
        $parts = parse_url($uri);
        $configuredBucket = trim((string) config('roadops.integrations.roadvision.s3_bucket'));
        $scheme = is_array($parts) ? (string) ($parts['scheme'] ?? '') : '';
        $bucket = is_array($parts) ? (string) ($parts['host'] ?? '') : '';
        $key = is_array($parts) ? rawurldecode(ltrim((string) ($parts['path'] ?? ''), '/')) : '';
        $configuredPrefix = trim((string) config('roadops.integrations.roadvision.s3_prefix'), '/');
        $keyInsidePrefix = $configuredPrefix !== ''
            && str_starts_with($key, $configuredPrefix.'/')
            && $key !== $configuredPrefix;
        if ($scheme !== 's3' || $configuredBucket === ''
            || ! hash_equals($configuredBucket, $bucket) || $key === '' || ! $keyInsidePrefix) {
            return response()->json(['error' => [
                'code' => 'EVIDENCE_SOURCE_NOT_ALLOWED',
                'message' => 'Dalil manbasi tasdiqlangan RoadVision S3 hududiga tegishli emas.',
            ]], 422);
        }

        $client = new S3Client([
            'version' => 'latest',
            'region' => (string) config('roadops.integrations.roadvision.s3_region'),
        ]);
        try {
            $metadata = $client->headObject(['Bucket' => $bucket, 'Key' => $key]);
        } catch (\Throwable) {
            return response()->json(['error' => [
                'code' => 'EVIDENCE_UNAVAILABLE',
                'message' => 'RoadVision dalil faylini hozir olib bo‘lmadi.',
            ]], 503);
        }

        $rawLength = $metadata['ContentLength'] ?? null;
        $etag = trim((string) ($metadata['ETag'] ?? ''));
        $contentLength = is_int($rawLength) || (is_string($rawLength) && ctype_digit($rawLength))
            ? (int) $rawLength
            : 0;
        $maxBytes = (int) config('roadops.integrations.roadvision.evidence_max_bytes');
        if ($maxBytes < 1) {
            return response()->json(['error' => [
                'code' => 'EVIDENCE_CONFIGURATION_INVALID',
                'message' => 'RoadVision dalil hajmi cheklovi sozlanmagan.',
            ]], 503);
        }
        if ($etag === '') {
            return response()->json(['error' => [
                'code' => 'EVIDENCE_METADATA_INVALID',
                'message' => 'RoadVision dalil fayli versiyasini tasdiqlab bo‘lmadi.',
            ]], 503);
        }
        if ($contentLength < 1 || $contentLength > $maxBytes) {
            return response()->json(['error' => [
                'code' => 'EVIDENCE_SIZE_REJECTED',
                'message' => 'Dalil fayli bo‘sh yoki ruxsat etilgan hajmdan katta.',
            ]], 413);
        }

        $contentType = (string) ($metadata['ContentType'] ?? 'application/octet-stream');
        if (! in_array($contentType, ['image/jpeg', 'image/png', 'video/mp4'], true)) {
            return response()->json(['error' => [
                'code' => 'EVIDENCE_CONTENT_TYPE_REJECTED',
                'message' => 'Dalil faylining turi ruxsat etilmagan.',
            ]], 415);
        }

        try {
            $range = HttpByteRange::parse($request->header('Range'), $contentLength);
        } catch (\InvalidArgumentException) {
            return response('', 416, [
                'Accept-Ranges' => 'bytes',
                'Content-Range' => "bytes */{$contentLength}",
                'Cache-Control' => 'private, no-store, max-age=0',
            ]);
        }

        $parameters = ['Bucket' => $bucket, 'Key' => $key, 'IfMatch' => $etag];
        if ($range !== null) {
            $parameters['Range'] = $range->s3Range();
        }
        try {
            $object = $client->getObject($parameters);
        } catch (\Throwable) {
            return response()->json(['error' => [
                'code' => 'EVIDENCE_UNAVAILABLE',
                'message' => 'RoadVision dalil faylini hozir olib bo‘lmadi.',
            ]], 503);
        }

        $body = $object['Body'];

        return new StreamedResponse(static function () use ($body): void {
            while (! $body->eof()) {
                echo $body->read(1024 * 1024);
                if (connection_aborted()) {
                    break;
                }
            }
        }, $range === null ? 200 : 206, array_filter([
            'Content-Type' => $contentType,
            'Content-Length' => (string) ($range?->length() ?? $contentLength),
            'Accept-Ranges' => 'bytes',
            'Content-Range' => $range?->contentRange(),
            'Cache-Control' => 'private, no-store, max-age=0',
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ], static fn (mixed $value): bool => $value !== null));
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
            'evidenceUrl' => $row->evidence_reference === null
                ? null
                : '/api/v1/roadvision/findings/'.rawurlencode((string) $row->id).'/evidence',
            'evidenceMediaType' => $row->evidence_media_type === null
                ? null
                : (string) $row->evidence_media_type,
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
                join roadops.road_versions road
                  on road.road_id=candidate.road_id and road.valid_until is null
                where candidate.id=? and road.official_code='D001' and road.length_m=67000
            SQL,
            [$id],
        ) === 1;
    }

    private function d001ConfigurationError(): ?JsonResponse
    {
        if ((string) config('roadops.primary_road_code') === self::PRIMARY_ROAD_CODE
            && preg_match('/^67000(?:\.0+)?$/D', (string) config('roadops.primary_road_length_m')) === 1) {
            return null;
        }

        return response()->json(['error' => [
            'code' => 'D001_CONFIGURATION_MISMATCH',
            'message' => 'PRIMARY_ROAD_CODE=D001 va PRIMARY_ROAD_LENGTH_M=67000 qilib sozlanishi shart.',
        ]], 503);
    }
}
