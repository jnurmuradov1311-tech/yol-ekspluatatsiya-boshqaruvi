<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Planning\AiWorkRecommendation;
use App\Http\Controllers\Controller;
use App\Security\AuthContext;
use App\Support\ApiScope;
use App\Support\DbRows;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use stdClass;

final class AiWorkRecommendationController extends Controller
{
    public function __invoke(Request $request, ApiScope $scope, AiWorkRecommendation $ai): JsonResponse
    {
        $validated = $request->validate([
            'sourceDefectId' => ['required', 'uuid'],
            'scheduledDate' => ['sometimes', 'date_format:Y-m-d'],
        ]);
        $date = (string) ($validated['scheduledDate'] ?? now('Asia/Tashkent')->format('Y-m-d'));
        $sourceId = (string) $validated['sourceDefectId'];
        $source = DbRows::selectOne(
            <<<'SQL'
                select dc.id, dc.updated_at::text source_version, dc.defect_type_id,
                       dc.iqn_topic_work_item_id topic_id,
                       coalesce(topic.normalized_name, dt.name) topic_name,
                       coalesce(dc.observed_issue, dc.description, dt.name) observed_issue,
                       dc.measured_quantity::text quantity, dc.measurement_unit unit,
                       lower(dc.chainage_span)::text chainage_start_m,
                       upper(dc.chainage_span)::text chainage_end_m
                from roadops.defect_cases dc
                join roadops.defect_types dt on dt.id = dc.defect_type_id
                left join roadops.iqn_work_items topic on topic.id = dc.iqn_topic_work_item_id
                where dc.id = ?::uuid and dc.status = 'open' and dc.verified_at is not null
                  and roadops.division_for_road_zone(
                    dc.road_id, dc.chainage_span,
                    (?::date + time '08:00') at time zone 'Asia/Tashkent'
                  ) = any(?::uuid[])
                  and exists (
                    select 1 from roadops.road_versions rv where rv.road_id = dc.road_id
                      and rv.valid_from <= (?::date + time '08:00') at time zone 'Asia/Tashkent'
                      and (rv.valid_until is null or rv.valid_until > (?::date + time '08:00') at time zone 'Asia/Tashkent')
                      and upper(dc.chainage_span) <= rv.length_m
                  )
            SQL,
            [$sourceId, $date, $scope->pgUuidArray($scope->roadUnitIds($request)), $date, $date],
        );
        if ($source === null) {
            return response()->json(['error' => [
                'code' => 'SOURCE_DEFECT_NOT_ACCESSIBLE',
                'message' => 'Tasdiqlangan ochiq nuqson topilmadi yoki bu yo‘l bo‘limiga tegishli emas.',
            ]], 422);
        }
        $rows = DbRows::select(
            <<<'SQL'
                with recursive parameters as (
                  select ?::uuid topic_id, ?::uuid defect_type_id, ?::date scheduled_date
                ), topic_items as (
                  select item.id from roadops.iqn_work_items item, parameters p where item.id = p.topic_id
                  union
                  select child.id from roadops.iqn_work_items child join topic_items parent on child.parent_item_id = parent.id
                )
                select v.id, wi.normalized_name work_name, coalesce(v.variant_label, '') variant_label,
                       concat(doc.code, coalesce(' · ' || nullif(wi.raw_code, ''), ''),
                              coalesce(' · ' || nullif(v.variant_label, ''), '')) norm_reference,
                       v.basis_unit unit
                from parameters p
                join roadops.iqn_work_variants v on v.interpretation_status = 'approved'
                  and v.planning_status = 'automatic'
                  and v.basis_quantity > 0 and v.basis_unit is not null
                join roadops.iqn_work_items wi on wi.id = v.work_item_id
                join roadops.iqn_documents doc on doc.id = wi.document_id
                where (
                  (p.topic_id is not null and wi.id in (select id from topic_items))
                  or (p.topic_id is null and exists (
                    select 1 from roadops.defect_work_variant_crosswalks mapping
                    where mapping.defect_type_id = p.defect_type_id and mapping.work_variant_id = v.id
                      and mapping.status = 'approved' and mapping.effective_from <= p.scheduled_date
                      and (mapping.effective_until is null or mapping.effective_until > p.scheduled_date)
                  ))
                )
                and exists (
                  select 1 from roadops.iqn_norm_sets ns
                  join roadops.iqn_norm_lines nl on nl.norm_set_id = ns.id
                  join roadops.iqn_resources resource on resource.id = nl.resource_id
                  where ns.work_variant_id = v.id and ns.status = 'approved'
                    and ns.effective_from <= p.scheduled_date
                    and (ns.effective_until is null or ns.effective_until > p.scheduled_date)
                    and resource.resource_kind = 'labor' and nl.minutes_per_basis > 0
                )
                order by doc.code, wi.source_sequence, v.variant_key, v.id
                limit 201
            SQL,
            [$source->topic_id, $source->defect_type_id, $date],
        );
        $catalog = array_map(static fn (stdClass $row): array => [
            'workVariantId' => (string) $row->id,
            'workName' => mb_substr((string) $row->work_name, 0, 800),
            'normReference' => mb_substr((string) $row->norm_reference, 0, 500),
            'variantLabel' => mb_substr((string) $row->variant_label, 0, 1000),
            'unit' => mb_substr((string) $row->unit, 0, 40),
        ], $rows);
        $evidence = [
            'topic' => mb_substr((string) $source->topic_name, 0, 800),
            'description' => mb_substr((string) $source->observed_issue, 0, 3000),
            'quantity' => (string) $source->quantity,
            'unit' => mb_substr((string) $source->unit, 0, 40),
            'chainageStartM' => (string) $source->chainage_start_m,
            'chainageEndM' => (string) $source->chainage_end_m,
        ];
        $result = $ai->recommend($evidence, $catalog);
        $recommendationId = (string) Str::uuid();
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        // Structured operational audit: never log the API key, source description or provider body.
        Log::info('AI work recommendation assessed.', [
            'recommendation_id' => $recommendationId,
            'source_defect_id' => $sourceId,
            'source_version' => (string) $source->source_version,
            'source_catalog_sha256' => hash('sha256', (string) json_encode([$evidence, $catalog], JSON_UNESCAPED_UNICODE)),
            'actor_user_id' => $context->userId,
            'request_id' => $request->header('X-Request-ID'),
            'status' => $result['status'],
            'model' => $result['model'],
            'provider_response_id' => $result['providerResponseId'],
            'candidate_ids' => array_column($result['candidates'], 'workVariantId'),
        ]);
        unset($result['model'], $result['providerResponseId']);

        return response()->json(['data' => array_merge($result, [
            'recommendationId' => $recommendationId,
            'sourceDefectId' => $sourceId,
            'requiresHumanApproval' => true,
        ])]);
    }
}
