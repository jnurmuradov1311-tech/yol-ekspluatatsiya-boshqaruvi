<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Planning\DeterministicCrewAllocator;
use App\Domain\Planning\DeterministicEquipmentAllocator;
use App\Domain\Planning\LiveResourceGuard;
use App\Http\Controllers\Controller;
use App\Security\AuthContext;
use App\Support\ApiScope;
use App\Support\DbRows;
use App\Support\PagedResponse;
use App\Support\Pagination;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use stdClass;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

final class PlanningController extends Controller
{
    public function __construct(
        private readonly DeterministicCrewAllocator $crewAllocator,
        private readonly DeterministicEquipmentAllocator $equipmentAllocator,
        private readonly LiveResourceGuard $liveResourceGuard,
    ) {}

    public function candidates(Request $request, ApiScope $scope): JsonResponse
    {
        $pagination = Pagination::from($request);
        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $candidateSql = <<<'SQL'
                select 'DEFECT:' || dc.id candidate_id, dc.id entity_id,
                       coalesce(rvc.external_candidate_id, i.inspection_number, dc.id::text) source_reference,
                       case when dc.source_kind = 'manual_inspection'
                            then 'MANUAL_INSPECTION' else 'ROADVISION' end source_kind_label,
                       rv.official_code road_code, rv.name road_name,
                       lower(dc.chainage_span) chainage_from, upper(dc.chainage_span) chainage_to,
                       coalesce(topic.normalized_name, mapped.work_name, dt.name) work_name,
                       dc.measured_quantity exact_quantity, dc.measurement_unit exact_unit,
                       case when dc.source_kind = 'manual_inspection'
                            then null else mapped.norm_reference end norm_reference,
                       1 sort_group,
                       (dc.verified_at at time zone 'UTC')::timestamp sort_at
                from roadops.defect_cases dc
                join roadops.road_versions rv on rv.road_id = dc.road_id and rv.valid_until is null
                join roadops.defect_types dt on dt.id = dc.defect_type_id
                left join roadops.iqn_work_items topic on topic.id = dc.iqn_topic_work_item_id
                left join roadops.roadvision_candidates rvc on rvc.id = dc.roadvision_candidate_id
                left join roadops.inspection_observations io on io.id = dc.inspection_observation_id
                left join roadops.inspections i on i.id = io.inspection_id
                left join lateral (
                    select wi.normalized_name work_name,
                           concat(doc.code, coalesce(' · ' || nullif(wi.raw_code, ''), '')) norm_reference
                    from roadops.defect_work_variant_crosswalks x
                    join roadops.iqn_work_variants v on v.id = x.work_variant_id
                    join roadops.iqn_work_items wi on wi.id = v.work_item_id
                    join roadops.iqn_documents doc on doc.id = wi.document_id
                    where x.defect_type_id = dc.defect_type_id and x.status = 'approved'
                      and x.effective_from <= current_date
                      and (x.effective_until is null or x.effective_until > current_date)
                      and v.interpretation_status = 'approved' and v.planning_status = 'automatic'
                    order by x.effective_from desc, x.id
                    limit 1
                ) mapped on true
                where exists (
                    select 1 from roadops.road_division_assignments assignment
                    where assignment.road_id = dc.road_id
                      and assignment.division_id = any(?::uuid[])
                      and assignment.valid_from <= dc.observed_at
                      and (assignment.valid_until is null or assignment.valid_until > dc.observed_at)
                      and assignment.chainage_span && dc.chainage_span
                  )
                  and dc.status = 'open'
                  and lower(dc.chainage_span) >= 0
                  and upper(dc.chainage_span) <= rv.length_m
                  and not exists (
                    select 1 from roadops.plan_items pi
                    where pi.status <> 'cancelled'
                      and (
                        pi.defect_case_id = dc.id
                        or pi.formula_inputs #>> '{manualInput,sourceDefectId}' = dc.id::text
                      )
                  )
                union all
                select 'ANNUAL:' || api.id candidate_id, api.id entity_id,
                       coalesce(ap.source_reference, 'YILLIK-' || ap.program_year || '-' || api.id::text) source_reference,
                       'ANNUAL_PROGRAM' source_kind_label,
                       rv.official_code road_code, rv.name road_name,
                       null::numeric chainage_from, null::numeric chainage_to,
                       wi.normalized_name work_name, api.planned_quantity exact_quantity,
                       api.work_unit exact_unit,
                       concat(doc.code, coalesce(' · ' || nullif(wi.raw_code, ''), '')) norm_reference,
                       2 sort_group, lower(api.planned_period)::timestamp sort_at
                from roadops.annual_program_items api
                join roadops.annual_programs ap on ap.id = api.annual_program_id
                join roadops.road_versions rv on rv.road_id = api.road_id and rv.valid_until is null
                join roadops.iqn_work_variants v on v.id = api.work_variant_id
                join roadops.iqn_work_items wi on wi.id = v.work_item_id
                join roadops.iqn_documents doc on doc.id = wi.document_id
                where ap.division_id = any(?::uuid[])
                  and exists (
                    select 1 from roadops.road_division_assignments assignment
                    where assignment.road_id = api.road_id
                      and assignment.division_id = ap.division_id
                      and assignment.valid_from <= statement_timestamp()
                      and (assignment.valid_until is null
                           or assignment.valid_until > statement_timestamp())
                      and assignment.chainage_span @> numrange(0, rv.length_m, '[)')
                  )
                  and ap.status = 'approved'
                  and api.planned_period && daterange(current_date, current_date + 366, '[)')
                  and not exists (
                    select 1 from roadops.plan_items pi
                    where pi.annual_program_item_id = api.id and pi.status not in ('cancelled', 'completed')
                  )
            SQL;
        $bindings = [$divisionIds, $divisionIds];
        $total = (int) DB::scalar(
            'select count(*) from ('.$candidateSql.') scoped_candidates',
            $bindings,
        );
        $rows = DbRows::select(
            $candidateSql.' order by sort_group, sort_at nulls last, source_reference, entity_id limit ? offset ?',
            [...$bindings, $pagination->pageSize, $pagination->offset()],
        );

        return PagedResponse::make(
            array_map(fn (stdClass $row): array => $this->candidatePayload($row), $rows),
            $pagination->page,
            $pagination->pageSize,
            $total,
        );
    }

    public function options(Request $request, ApiScope $scope): JsonResponse
    {
        $validated = $request->validate([
            'roadId' => ['required', 'uuid'],
            'scheduledDate' => ['sometimes', 'date_format:Y-m-d'],
        ]);
        $selectedRoadId = (string) $validated['roadId'];
        $scheduledDate = isset($validated['scheduledDate'])
            ? (string) $validated['scheduledDate']
            : now('Asia/Tashkent')->format('Y-m-d');
        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $roads = DbRows::select(
            <<<'SQL'
                with parameters as (
                  select ?::uuid[] division_ids, ?::date scheduled_date,
                         ((?::date + time '08:00') at time zone 'Asia/Tashkent') scheduled_at,
                         ?::uuid selected_road_id
                )
                select r.id, rv.official_code code, rv.name, rv.length_m,
                       string_agg(distinct dv.name, ', ' order by dv.name) division_name
                from parameters p
                join roadops.roads r on r.retired_at is null or r.retired_at > p.scheduled_at
                join roadops.road_versions rv on rv.road_id = r.id
                  and rv.valid_from <= p.scheduled_at
                  and (rv.valid_until is null or rv.valid_until > p.scheduled_at)
                join roadops.road_division_assignments assignment on assignment.road_id = r.id
                  and assignment.division_id = any(p.division_ids)
                  and assignment.valid_from <= p.scheduled_at
                  and (assignment.valid_until is null
                       or assignment.valid_until > p.scheduled_at)
                join roadops.road_division_versions dv on dv.division_id = assignment.division_id
                  and dv.valid_from <= p.scheduled_at
                  and (dv.valid_until is null or dv.valid_until > p.scheduled_at)
                where r.id = p.selected_road_id
                  and assignment.chainage_span && numrange(0, rv.length_m, '[)')
                group by r.id, rv.official_code, rv.name, rv.length_m, rv.valid_from
                order by rv.official_code, rv.name, r.id
            SQL,
            [$divisionIds, $scheduledDate, $scheduledDate, $selectedRoadId],
        );
        if (count($roads) !== 1) {
            return response()->json(['error' => [
                'code' => 'ROAD_NOT_ACCESSIBLE',
                'message' => 'Tanlangan yo‘l YTP biriktiruvi yoki ruxsat doirasida topilmadi.',
            ]], 409);
        }
        $road = $roads[0];
        if ((float) $road->length_m <= 0) {
            return response()->json(['error' => [
                'code' => 'ROAD_LENGTH_INVALID',
                'message' => 'Tanlangan yo‘lning YTP uzunligi musbat qiymat bo‘lishi shart.',
            ]], 409);
        }

        $workVariants = DbRows::select(
            <<<'SQL'
                select v.id, coalesce(nullif(wi.normalized_code, ''), nullif(wi.raw_code, ''), v.variant_key) code,
                       wi.normalized_name name,
                       broad_topic.id iqn_topic_id,
                       broad_topic.normalized_name iqn_topic_name,
                       concat(doc.code, coalesce(' · ' || nullif(wi.raw_code, ''), ''),
                              coalesce(' · ' || nullif(v.variant_label, ''), '')) norm_reference,
                       v.basis_unit unit,
                       greatest(coalesce(skill.required_workers, 0), 1)::integer required_workers,
                       (labor.minutes_per_basis / v.basis_quantity)::numeric labor_minutes_per_unit
                from roadops.iqn_work_variants v
                join roadops.iqn_work_items wi on wi.id = v.work_item_id
                join roadops.iqn_documents doc on doc.id = wi.document_id
                left join lateral (
                  with recursive ancestry as (
                    select item.id, item.parent_item_id, item.normalized_name
                    from roadops.iqn_work_items item where item.id = wi.id
                    union all
                    select parent.id, parent.parent_item_id, parent.normalized_name
                    from roadops.iqn_work_items parent
                    join ancestry child on child.parent_item_id = parent.id
                  )
                  select ancestor.id, ancestor.normalized_name
                  from ancestry ancestor
                  where ancestor.parent_item_id is null
                  limit 1
                ) broad_topic on true
                join lateral (
                  select sum(nl.minutes_per_basis)::numeric minutes_per_basis
                  from roadops.iqn_norm_sets ns
                  join roadops.iqn_norm_lines nl on nl.norm_set_id = ns.id
                  join roadops.iqn_resources resource on resource.id = nl.resource_id
                  where ns.work_variant_id = v.id and ns.status = 'approved'
                    and ns.effective_from <= ?::date
                    and (ns.effective_until is null or ns.effective_until > ?::date)
                    and resource.resource_kind = 'labor' and nl.minutes_per_basis is not null
                ) labor on labor.minutes_per_basis > 0
                left join lateral (
                  select sum(sr.worker_count)::integer required_workers
                  from roadops.work_variant_skill_requirements sr
                  where sr.work_variant_id = v.id and sr.status = 'approved'
                    and sr.requirement_kind = 'worker'
                    and sr.effective_from <= ?::date
                    and (sr.effective_until is null or sr.effective_until > ?::date)
                ) skill on true
                where v.interpretation_status = 'approved'
                  and v.planning_status = 'automatic'
                  and v.basis_quantity is not null and v.basis_unit is not null
                order by doc.code, wi.source_sequence, v.variant_key, v.id
            SQL,
            [$scheduledDate, $scheduledDate, $scheduledDate, $scheduledDate],
        );
        $schemes = DbRows::select(
            <<<'SQL'
                with parameters as (
                  select ?::uuid road_id, ?::uuid[] division_ids, ?::date scheduled_date,
                         ((?::date + time '08:00') at time zone 'Asia/Tashkent') scheduled_at
                )
                select ss.id, ss.scheme_kind, ss.name,
                       coalesce(nullif(ss.instructions ->> 'description', ''), ss.name) description,
                       coalesce(sum(sr.required_quantity) filter (where sr.requirement_kind = 'staff'), 0)::integer required_safety_workers,
                       coalesce(sum(sr.required_quantity) filter (where sr.requirement_kind = 'sign'), 0)::integer required_signs,
                       coalesce(sum(sr.required_quantity) filter (where sr.requirement_kind = 'cone'), 0)::integer required_cones,
                       coalesce(sum(sr.required_quantity) filter (where sr.requirement_kind = 'barrier'), 0)::integer required_barriers
                from parameters p
                join roadops.safety_schemes ss on true
                left join roadops.safety_scheme_requirements sr on sr.safety_scheme_id = ss.id
                where ss.division_id = any(p.division_ids) and ss.status = 'approved'
                  and ss.effective_from <= p.scheduled_date
                  and (ss.effective_until is null or ss.effective_until > p.scheduled_date)
                  and ss.scheme_kind is not null
                  and exists (
                    select 1 from roadops.road_division_assignments assignment
                    where assignment.road_id = p.road_id
                      and assignment.division_id = ss.division_id
                      and assignment.valid_from <= p.scheduled_at
                      and (assignment.valid_until is null
                           or assignment.valid_until > p.scheduled_at)
                  )
                group by ss.id
                order by case ss.scheme_kind
                  when 'shoulder_work' then 1 when 'one_lane_closed' then 2
                  when 'half_road_closed' then 3 when 'alternating_flow' then 4
                  when 'full_closure_permit' then 5 else 99 end, ss.id
            SQL,
            [$road->id, $divisionIds, $scheduledDate, $scheduledDate],
        );
        $schemesByKind = [];
        foreach ($schemes as $scheme) {
            $kind = (string) $scheme->scheme_kind;
            if (! isset($schemesByKind[$kind])) {
                $schemesByKind[$kind] = $scheme;

                continue;
            }
            foreach ([
                'required_safety_workers', 'required_signs',
                'required_cones', 'required_barriers',
            ] as $field) {
                $schemesByKind[$kind]->{$field} = max(
                    (int) $schemesByKind[$kind]->{$field},
                    (int) $scheme->{$field},
                );
            }
        }
        $schemes = array_values($schemesByKind);
        if (count($schemes) !== 5 || $workVariants === []) {
            return response()->json(['error' => [
                'code' => 'PLANNING_OPTIONS_INCOMPLETE',
                'message' => 'Qo‘lda rejalashtirish uchun tasdiqlangan IQN normasi va beshta harakat xavfsizligi sxemasi to‘liq emas.',
            ]], 409);
        }

        $workers = DbRows::select(
            <<<'SQL'
                with parameters as (
                  select ?::uuid road_id, ?::uuid[] division_ids, ?::date scheduled_date,
                         ((?::date + time '08:00') at time zone 'Asia/Tashkent') scheduled_at
                ), eligible_divisions as (
                  select distinct road_assignment.division_id
                  from parameters p
                  join roadops.road_division_assignments road_assignment
                    on road_assignment.road_id = p.road_id
                   and road_assignment.division_id = any(p.division_ids)
                   and road_assignment.valid_from <= p.scheduled_at
                   and (road_assignment.valid_until is null
                        or road_assignment.valid_until > p.scheduled_at)
                )
                select w.id, wv.full_name,
                       coalesce(wv.position_name, max(assignment.job_title), 'Lavozim kiritilmagan') position_name,
                       coalesce(array_agg(distinct q.qualification_code order by q.qualification_code)
                         filter (where q.qualification_code is not null), '{}'::text[]) skills,
                       bool_or(exists (
                         select 1 from roadops.work_variant_skill_requirements skill
                         where skill.qualification_code = q.qualification_code
                           and skill.requirement_kind = 'worker' and skill.status = 'approved'
                           and skill.effective_from <= p.scheduled_date
                           and (skill.effective_until is null or skill.effective_until > p.scheduled_date)
                       )) road_worker_skill,
                       bool_or(exists (
                         select 1 from roadops.safety_scheme_requirements safety
                         join roadops.safety_schemes scheme on scheme.id = safety.safety_scheme_id
                         where safety.requirement_kind = 'staff'
                           and safety.qualification_code = q.qualification_code
                           and scheme.division_id = assignment.division_id
                           and scheme.status = 'approved'
                           and scheme.effective_from <= p.scheduled_date
                           and (scheme.effective_until is null or scheme.effective_until > p.scheduled_date)
                       )) safety_skill,
                       greatest(least(420, coalesce(availability.available_minutes, 0))
                         - coalesce(used.planned_minutes, 0), 0)::integer available_minutes
                from parameters p
                join roadops.workers w on true
                join roadops.worker_versions wv on wv.worker_id = w.id
                  and wv.employment_state = 'active'
                  and wv.valid_from <= p.scheduled_at
                  and (wv.valid_until is null or wv.valid_until > p.scheduled_at)
                join roadops.worker_division_assignments assignment
                  on assignment.worker_id = w.id
                  and assignment.valid_from <= p.scheduled_date
                  and (assignment.valid_until is null or assignment.valid_until > p.scheduled_date)
                join eligible_divisions eligible on eligible.division_id = assignment.division_id
                left join roadops.worker_qualification_versions q on q.worker_id = w.id
                  and q.valid_from <= p.scheduled_at
                  and (q.valid_until is null or q.valid_until > p.scheduled_at)
                left join lateral (
                  select case when wa.availability_code = 'available'
                              then wa.available_minutes else 0 end available_minutes
                  from roadops.worker_availability wa
                  where wa.worker_id = w.id and wa.work_date = p.scheduled_date
                    and wa.retired_at is null
                  order by wa.source_updated_at desc nulls last, wa.recorded_at desc, wa.id desc limit 1
                ) availability on true
                left join lateral (
                  select coalesce(sum(minutes), 0)::integer planned_minutes from (
                    select wa.planned_minutes::integer minutes from roadops.work_assignments wa
                    where wa.worker_id = w.id and wa.work_date = p.scheduled_date
                      and wa.status <> 'cancelled'
                    union all
                    select sa.planned_minutes::integer from roadops.safety_staff_assignments sa
                    where sa.worker_id = w.id and sa.work_date = p.scheduled_date
                      and sa.status <> 'cancelled'
                  ) reservations
                ) used on true
                where w.retired_at is null or w.retired_at > p.scheduled_at
                group by w.id, wv.full_name, wv.position_name,
                         availability.available_minutes, used.planned_minutes, wv.personnel_number,
                         p.scheduled_date
                order by wv.personnel_number, w.id
            SQL,
            [$road->id, $divisionIds, $scheduledDate, $scheduledDate],
        );
        $sourceDefects = DbRows::select(
            <<<'SQL'
                with parameters as (
                  select ?::uuid road_id, ?::uuid[] division_ids, ?::date scheduled_date,
                         ((?::date + time '08:00') at time zone 'Asia/Tashkent') scheduled_at
                )
                select dc.id, coalesce(i.inspection_number, dc.id::text) source_reference,
                       topic.id topic_id, coalesce(topic.normalized_name, dt.name) topic_name,
                       lower(dc.chainage_span) chainage_start_m,
                       upper(dc.chainage_span) chainage_end_m,
                       dc.measured_quantity, dc.measurement_unit
                from parameters p
                join roadops.defect_cases dc on dc.road_id = p.road_id
                join roadops.defect_types dt on dt.id = dc.defect_type_id
                left join roadops.iqn_work_items topic on topic.id = dc.iqn_topic_work_item_id
                left join roadops.inspection_observations observation
                  on observation.id = dc.inspection_observation_id
                left join roadops.inspections i on i.id = observation.inspection_id
                where dc.source_kind = 'manual_inspection' and dc.status = 'open'
                  and upper(dc.chainage_span) <= (
                    select version.length_m from roadops.road_versions version
                    where version.road_id = dc.road_id
                      and version.valid_from <= p.scheduled_at
                      and (version.valid_until is null or version.valid_until > p.scheduled_at)
                    order by version.valid_from desc limit 1
                  )
                  and roadops.division_for_road_zone(
                        dc.road_id, dc.chainage_span, p.scheduled_at
                      ) = any(p.division_ids)
                  and not exists (
                    select 1 from roadops.plan_items pi
                    where pi.status <> 'cancelled'
                      and (
                        pi.defect_case_id = dc.id
                        or pi.formula_inputs #>> '{manualInput,sourceDefectId}' = dc.id::text
                      )
                  )
                order by dc.observed_at desc, dc.id
            SQL,
            [$road->id, $divisionIds, $scheduledDate, $scheduledDate],
        );

        return response()->json(['data' => [
            'road' => [
                'id' => (string) $road->id,
                'code' => (string) $road->code,
                'name' => (string) $road->name,
                'divisionName' => (string) $road->division_name,
                'lengthM' => (int) $road->length_m,
            ],
            'workVariants' => array_map(static fn (stdClass $variant): array => [
                'id' => (string) $variant->id,
                'code' => (string) $variant->code,
                'name' => (string) $variant->name,
                'iqnTopicId' => $variant->iqn_topic_id === null
                    ? null
                    : (string) $variant->iqn_topic_id,
                'iqnTopicName' => $variant->iqn_topic_name === null
                    ? null
                    : (string) $variant->iqn_topic_name,
                'normReference' => (string) $variant->norm_reference,
                'unit' => (string) $variant->unit,
                'requiredWorkers' => (int) $variant->required_workers,
                'laborMinutesPerUnit' => (float) $variant->labor_minutes_per_unit,
            ], $workVariants),
            'safetySchemes' => array_map(fn (stdClass $scheme): array => $this->safetySchemePayload($scheme), $schemes),
            'sourceDefects' => array_map(static fn (stdClass $defect): array => [
                'id' => (string) $defect->id,
                'sourceReference' => (string) $defect->source_reference,
                'iqnTopic' => [
                    'id' => $defect->topic_id === null ? null : (string) $defect->topic_id,
                    'name' => (string) $defect->topic_name,
                ],
                'location' => [
                    'chainageStartM' => (string) $defect->chainage_start_m,
                    'chainageEndM' => (string) $defect->chainage_end_m,
                ],
                'measuredQuantity' => [
                    'value' => (string) $defect->measured_quantity,
                    'unit' => (string) $defect->measurement_unit,
                ],
            ], $sourceDefects),
            'workers' => array_map(function (stdClass $worker): array {
                $skills = $this->pgTextArray((string) $worker->skills);
                if ((bool) $worker->road_worker_skill) {
                    $skills[] = 'road_worker';
                }
                if ((bool) $worker->safety_skill) {
                    $skills[] = 'safety';
                }
                $skills = array_values(array_unique($skills));
                sort($skills, SORT_STRING);

                return [
                    'id' => (string) $worker->id,
                    'fullName' => (string) $worker->full_name,
                    'positionName' => (string) $worker->position_name,
                    'skills' => $skills,
                    'availableMinutes' => (int) $worker->available_minutes,
                ];
            }, $workers),
        ]]);
    }

    public function preview(Request $request, ApiScope $scope): JsonResponse
    {
        $validated = $request->validate([
            'candidateIds' => ['required', 'array', 'min:1', 'max:100'],
            'candidateIds.*' => ['required', 'string', 'distinct', 'regex:/^(DEFECT|ANNUAL):[0-9a-f-]{36}$/i'],
            'dateFrom' => ['required', 'date_format:Y-m-d'],
            'dateTo' => ['required', 'date_format:Y-m-d', 'after_or_equal:dateFrom'],
        ]);
        $first = new \DateTimeImmutable($validated['dateFrom']);
        $last = new \DateTimeImmutable($validated['dateTo']);
        $maxHorizonDays = (int) (DB::scalar(
            "select setting_value #>> '{}' from roadops.system_settings where setting_key = 'planning_horizon_days'",
        ) ?? 14);
        if ($first->diff($last)->days + 1 > $maxHorizonDays) {
            return response()->json(['error' => [
                'code' => 'PLANNING_WINDOW_TOO_LONG',
                'message' => "Rejalashtirish oralig‘i {$maxHorizonDays} kundan oshmasligi kerak.",
                'details' => ['maximumDays' => $maxHorizonDays],
            ]], 422);
        }
        $dateCount = max(1, $first->diff($last)->days + 1);

        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $records = [];
        foreach ($validated['candidateIds'] as $position => $candidateId) {
            $scheduledDate = $first->modify('+'.($position % $dateCount).' days')->format('Y-m-d');
            $record = $this->loadCandidate((string) $candidateId, $divisionIds, $scheduledDate);
            if ($record === null) {
                $assignmentIssue = $this->candidateAssignmentIssue(
                    (string) $candidateId,
                    $divisionIds,
                    $scheduledDate,
                );
                if ($assignmentIssue !== null) {
                    return response()->json(['error' => [
                        'code' => $assignmentIssue['code'],
                        'message' => $assignmentIssue['message'],
                        'details' => ['candidateIds' => [(string) $candidateId]],
                    ]], 422);
                }

                return response()->json(['error' => [
                    'code' => 'PLANNING_CANDIDATE_UNAVAILABLE',
                    'message' => 'Tanlangan yozuv topilmadi, ruxsat doirasidan tashqarida yoki allaqachon rejalashtirilgan.',
                    'details' => ['candidateIds' => [(string) $candidateId]],
                ]], 422);
            }
            if ((string) $record->source_kind === 'manual_inspection') {
                return response()->json(['error' => [
                    'code' => 'MANUAL_VARIANT_SELECTION_REQUIRED',
                    'message' => 'Yo‘l ustasi qayd etgan umumiy IQN mavzusi uchun operator aniq ish variantini tanlashi kerak.',
                    'details' => ['candidateIds' => [(string) $candidateId]],
                ]], 422);
            }
            $record->scheduled_date = $scheduledDate;
            $records[] = $record;
        }
        $recordDivisions = array_values(array_unique(array_map(
            static fn (stdClass $row): string => (string) $row->division_id,
            $records,
        )));
        if (count($recordDivisions) !== 1) {
            return response()->json(['error' => [
                'code' => 'SINGLE_DIVISION_REQUIRED',
                'message' => 'Bitta reja faqat bitta yo‘l bo‘limi yozuvlaridan tuziladi.',
            ]], 422);
        }

        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        $inputSnapshot = [
            'candidateIds' => array_values($validated['candidateIds']),
            'dateFrom' => $validated['dateFrom'],
            'dateTo' => $validated['dateTo'],
            'planningHorizonDays' => $maxHorizonDays,
        ];
        $inputHash = hash('sha256', json_encode($inputSnapshot, JSON_THROW_ON_ERROR));

        $runId = DB::transaction(function () use (
            $records,
            $recordDivisions,
            $context,
            $validated,
            $inputHash,
        ): string {
            // Preview creation and reservation are serialized per division. This
            // keeps two simultaneous planner requests from selecting the same
            // YTP capacity while leaving unrelated divisions independent.
            DbRows::select(
                'select pg_advisory_xact_lock(hashtextextended(?::text, 20260812))',
                [$recordDivisions[0]],
            );
            foreach ($records as $record) {
                if ((string) $record->entity_type !== 'defect_case') {
                    continue;
                }
                $lockedCandidate = DbRows::selectOne(
                    <<<'SQL'
                        select dc.id
                        from roadops.defect_cases dc
                        where dc.id=? and dc.status='open' and dc.updated_at::text=?
                          and not exists (
                            select 1
                            from roadops.plan_items pi
                            where pi.status <> 'cancelled'
                              and (
                                pi.defect_case_id=dc.id
                                or pi.formula_inputs #>> '{manualInput,sourceDefectId}'=dc.id::text
                              )
                          )
                        for update of dc
                    SQL,
                    [$record->entity_id, $record->source_version],
                    false,
                );
                if ($lockedCandidate === null) {
                    throw ValidationException::withMessages([
                        'candidateIds' => [
                            'Nuqson o‘zgargan, yopilgan yoki boshqa faol reja bandiga biriktirilgan.',
                        ],
                    ]);
                }
            }
            $run = DbRows::selectOne(
                <<<'SQL'
                    insert into roadops.planning_runs
                        (division_id, planning_window, as_of, algorithm_version,
                         input_snapshot_hash, created_by)
                    values (?, daterange(?::date, ?::date + 1, '[)'), clock_timestamp(),
                            'roadops-contract-v1', decode(?, 'hex'), ?)
                    returning id
                SQL,
                [$recordDivisions[0], $validated['dateFrom'], $validated['dateTo'], $inputHash, $context->userId],
            );
            if ($run === null) {
                throw new \RuntimeException('Planning run could not be created.');
            }
            $runId = (string) $run->id;

            foreach ($records as $position => $record) {
                $scheduledDate = (string) $record->scheduled_date;
                $safety = DbRows::selectOne(
                    <<<'SQL'
                        select scheme.id
                        from roadops.work_variant_safety_scheme_rules rule
                        join roadops.safety_schemes scheme on scheme.id = rule.safety_scheme_id
                        where rule.work_variant_id = ? and rule.status = 'approved'
                          and rule.is_default
                          and rule.effective_from <= ?::date
                          and (rule.effective_until is null or rule.effective_until > ?::date)
                          and scheme.division_id = ? and scheme.status = 'approved'
                          and scheme.effective_from <= ?::date
                          and (scheme.effective_until is null or scheme.effective_until > ?::date)
                        order by rule.effective_from desc, scheme.code, scheme.id
                        limit 1
                    SQL,
                    [
                        $record->work_variant_id,
                        $scheduledDate,
                        $scheduledDate,
                        $record->division_id,
                        $scheduledDate,
                        $scheduledDate,
                    ],
                );
                $formulaInputs = [
                    'candidateId' => (string) $record->candidate_id,
                    'selectionOrder' => $position + 1,
                    'sourceReference' => (string) $record->source_reference,
                    'workName' => (string) $record->work_name,
                ];
                $item = DbRows::selectOne(
                    <<<'SQL'
                        insert into roadops.plan_items
                            (planning_run_id, defect_case_id, annual_program_item_id,
                             road_id, work_variant_id, chainage_span, work_quantity,
                             work_unit, formula_inputs, scheduled_window, safety_scheme_id)
                        values (?, ?, ?, ?, ?, numrange(?, ?, '[)'), ?, ?, ?::jsonb,
                                tstzrange(
                                  (?::date + time '08:00') at time zone 'Asia/Tashkent',
                                  (?::date + time '15:00') at time zone 'Asia/Tashkent', '[)'
                                ), ?)
                        returning id
                    SQL,
                    [
                        $runId,
                        $record->entity_type === 'defect_case' ? $record->entity_id : null,
                        $record->entity_type === 'annual_program_item' ? $record->entity_id : null,
                        $record->road_id,
                        $record->work_variant_id,
                        $record->chainage_from,
                        $record->chainage_to,
                        $record->work_quantity,
                        $record->work_unit,
                        json_encode($formulaInputs, JSON_THROW_ON_ERROR),
                        $scheduledDate,
                        $scheduledDate,
                        $safety?->id,
                    ],
                );
                if ($item === null) {
                    throw new \RuntimeException('Plan item could not be created.');
                }
                DB::insert(
                    <<<'SQL'
                        insert into roadops.planning_run_inputs
                            (planning_run_id, entity_type, entity_id, source_version,
                             payload_hash, captured_at)
                        values (?, ?, ?, ?, decode(?, 'hex'), clock_timestamp())
                    SQL,
                    [
                        $runId,
                        $record->entity_type,
                        $record->entity_id,
                        (string) $record->source_version,
                        hash('sha256', json_encode($formulaInputs, JSON_THROW_ON_ERROR)),
                    ],
                );
            }
            $this->rebuildAllBlockers($runId);
            $this->allocateResources($runId, $recordDivisions[0], $context->userId);
            foreach (DbRows::select(
                <<<'SQL'
                    select id from roadops.plan_items where planning_run_id = ?
                    order by (formula_inputs ->> 'selectionOrder')::integer, id
                SQL,
                [$runId],
            ) as $planItem) {
                $this->allocateSafety(
                    (string) $planItem->id,
                    $recordDivisions[0],
                    $context->userId,
                    null,
                );
            }
            $this->rebuildAllBlockers($runId);

            return $runId;
        });

        return response()->json(['data' => $this->previewPayload(
            $runId,
            $validated['dateFrom'],
            $validated['dateTo'],
            $context,
        )], 201);
    }

    public function manualPreview(Request $request, ApiScope $scope): JsonResponse
    {
        $validated = $request->validate([
            'roadId' => ['required', 'uuid'],
            'workVariantId' => ['required', 'uuid'],
            'exactQuantity' => ['required', 'string', 'regex:/^[0-9]+(?:\.[0-9]+)?$/'],
            'chainageStartM' => ['required', 'string', 'regex:/^[0-9]+(?:\.[0-9]+)?$/'],
            'chainageEndM' => ['sometimes', 'nullable', 'string', 'regex:/^[0-9]+(?:\.[0-9]+)?$/'],
            'laneLabel' => ['sometimes', 'nullable', 'string', 'max:100'],
            'direction' => ['sometimes', 'nullable', 'string', 'max:50'],
            'sourceDefectId' => ['sometimes', 'nullable', 'uuid'],
            'scheduledDate' => ['required', 'date_format:Y-m-d'],
            'safetySchemeId' => ['required', 'uuid'],
            'workerIds' => ['required', 'array', 'min:1', 'max:100'],
            'workerIds.*' => ['required', 'uuid', 'distinct'],
            'permitNumber' => ['sometimes', 'string', 'max:200'],
        ]);
        $chainageStart = (float) $validated['chainageStartM'];
        if (isset($validated['chainageEndM'])
            && abs((float) $validated['chainageEndM'] - $chainageStart) > 0.000001) {
            return response()->json(['error' => [
                'code' => 'ROAD_LOCATION_POINT_REQUIRED',
                'message' => 'Qo‘lda rejalashtirishda bitta lokatsiya tanlanadi; tugash piketi bo‘sh yoki boshlanish piketiga teng bo‘lishi kerak.',
            ]], 422);
        }

        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $roads = DbRows::select(
            <<<'SQL'
                with parameters as (
                  select ?::uuid road_id, ?::numeric chainage_point,
                         ?::date scheduled_date,
                         ((?::date + time '08:00') at time zone 'Asia/Tashkent') scheduled_at,
                         ?::uuid[] division_ids
                )
                select r.id, rv.official_code, rv.name, rv.length_m,
                       zone.division_id,
                       coalesce(zone.division_id = any(p.division_ids), false) zone_accessible
                from parameters p
                join roadops.roads r on r.retired_at is null or r.retired_at > p.scheduled_at
                join roadops.road_versions rv on rv.road_id = r.id
                  and rv.valid_from <= p.scheduled_at
                  and (rv.valid_until is null or rv.valid_until > p.scheduled_at)
                cross join lateral (
                  select roadops.division_for_road_point(
                    r.id, p.chainage_point, p.scheduled_at
                  ) division_id
                ) zone
                where r.id = p.road_id
                order by rv.valid_from desc, r.id
                limit 2
            SQL,
            [
                $validated['roadId'], $chainageStart,
                $validated['scheduledDate'], $validated['scheduledDate'], $divisionIds,
            ],
        );
        if (count($roads) !== 1) {
            return response()->json(['error' => [
                'code' => 'ROAD_NOT_FOUND_OR_AMBIGUOUS',
                'message' => 'Tanlangan roadId va sana uchun bitta amaldagi YTP yo‘l yozuvi topilmadi.',
            ]], 409);
        }
        $road = $roads[0];
        $roadLength = (float) $road->length_m;
        if ($roadLength <= 0) {
            return response()->json(['error' => [
                'code' => 'ROAD_LENGTH_INVALID',
                'message' => 'Tanlangan yo‘lning YTP uzunligi musbat qiymat bo‘lishi shart.',
            ]], 409);
        }
        if ($chainageStart < 0 || $chainageStart >= $roadLength) {
            return response()->json(['error' => [
                'code' => 'CHAINAGE_OUTSIDE_ROAD',
                'message' => 'Lokatsiya tanlangan yo‘lning 0 dan YTP uzunligigacha bo‘lgan chegarasida bo‘lishi kerak.',
                'details' => ['roadLengthM' => (string) $road->length_m],
            ]], 422);
        }
        $chainageEnd = min($chainageStart + 1, $roadLength);
        if ($road->division_id === null) {
            return response()->json(['error' => [
                'code' => 'ROAD_ASSIGNMENT_MISSING_OR_AMBIGUOUS',
                'message' => 'Tanlangan zona va sana uchun bitta amaldagi YTP yo‘l bo‘limi aniqlanmadi.',
            ]], 422);
        }
        if (! (bool) $road->zone_accessible) {
            return response()->json(['error' => [
                'code' => 'ROAD_ZONE_NOT_ACCESSIBLE',
                'message' => 'Tanlangan yo‘l zonasi ruxsat doirasidan tashqarida.',
            ]], 404);
        }
        $sourceDefect = null;
        if (isset($validated['sourceDefectId'])) {
            $sourceDefect = DbRows::selectOne(
                <<<'SQL'
                    select dc.id, dc.updated_at::text source_version,
                           topic.id topic_id, topic.normalized_name topic_name,
                           lower(dc.chainage_span)::text source_chainage_start_m,
                           upper(dc.chainage_span)::text source_chainage_end_m,
                           dc.measured_quantity::text source_quantity,
                           dc.measurement_unit source_unit,
                           coalesce(i.inspection_number, dc.id::text) source_reference
                    from roadops.defect_cases dc
                    left join roadops.iqn_work_items topic on topic.id = dc.iqn_topic_work_item_id
                    left join roadops.inspection_observations observation
                      on observation.id = dc.inspection_observation_id
                    left join roadops.inspections i on i.id = observation.inspection_id
                    where dc.id = ? and dc.road_id = ?
                      and dc.source_kind = 'manual_inspection' and dc.status = 'open'
                      and lower(dc.chainage_span) >= 0
                      and upper(dc.chainage_span) <= ?::numeric
                      and roadops.division_for_road_zone(
                            dc.road_id, dc.chainage_span,
                            (?::date + time '08:00') at time zone 'Asia/Tashkent'
                          ) = ?::uuid
                      and roadops.division_for_road_zone(
                            dc.road_id, dc.chainage_span,
                            (?::date + time '08:00') at time zone 'Asia/Tashkent'
                          ) = any(?::uuid[])
                      and not exists (
                        select 1 from roadops.plan_items pi
                        where pi.status <> 'cancelled'
                          and (
                            pi.defect_case_id = dc.id
                            or pi.formula_inputs #>> '{manualInput,sourceDefectId}' = dc.id::text
                          )
                      )
                SQL,
                [
                    $validated['sourceDefectId'],
                    $road->id,
                    $road->length_m,
                    $validated['scheduledDate'],
                    $road->division_id,
                    $validated['scheduledDate'],
                    $divisionIds,
                ],
            );
            if ($sourceDefect === null) {
                return response()->json(['error' => [
                    'code' => 'SOURCE_DEFECT_NOT_ACCESSIBLE',
                    'message' => 'Tanlangan nuqson shu yo‘l va yo‘l bo‘limiga tegishli emas, yopilgan yoki allaqachon rejalashtirilgan.',
                ]], 422);
            }
            if ($sourceDefect->topic_id === null) {
                return response()->json(['error' => [
                    'code' => 'SOURCE_DEFECT_IQN_TOPIC_MISSING',
                    'message' => 'Yo‘l ustasi qaydida IQN 02-24 umumiy ish mavzusi ko‘rsatilmagan.',
                ]], 422);
            }
            if (! (bool) DB::scalar(
                'select ?::numeric = ?::numeric',
                [$validated['chainageStartM'], $sourceDefect->source_chainage_start_m],
            )) {
                return response()->json(['error' => [
                    'code' => 'SOURCE_DEFECT_LOCATION_MISMATCH',
                    'message' => 'Tanlangan lokatsiya manba nuqsonning qayd etilgan piketiga teng bo‘lishi kerak.',
                ]], 422);
            }
        }
        $variant = DbRows::selectOne(
            <<<'SQL'
                select v.id, v.work_item_id, v.basis_unit, wi.normalized_name work_name,
                       concat(doc.code, coalesce(' · ' || nullif(wi.raw_code, ''), '')) norm_reference
                from roadops.iqn_work_variants v
                join roadops.iqn_work_items wi on wi.id = v.work_item_id
                join roadops.iqn_documents doc on doc.id = wi.document_id
                where v.id = ? and v.interpretation_status = 'approved'
                  and v.planning_status = 'automatic'
                  and exists (
                    select 1 from roadops.iqn_norm_sets ns
                    where ns.work_variant_id = v.id and ns.status = 'approved'
                      and ns.effective_from <= ?::date
                      and (ns.effective_until is null or ns.effective_until > ?::date)
                  )
            SQL,
            [$validated['workVariantId'], $validated['scheduledDate'], $validated['scheduledDate']],
        );
        if ($variant === null) {
            return response()->json(['error' => [
                'code' => 'IQN_VARIANT_NOT_PLANNABLE',
                'message' => 'Tanlangan IQN ish varianti uchun shu sanada tasdiqlangan avtomatik norma yo‘q.',
            ]], 422);
        }
        if ($sourceDefect !== null && ! (bool) DB::scalar(
            <<<'SQL'
                with recursive ancestry as (
                  select item.id, item.parent_item_id
                  from roadops.iqn_work_items item where item.id = ?
                  union all
                  select parent.id, parent.parent_item_id
                  from roadops.iqn_work_items parent
                  join ancestry child on child.parent_item_id = parent.id
                )
                select exists (select 1 from ancestry where id = ?)
            SQL,
            [$variant->work_item_id, $sourceDefect->topic_id],
        )) {
            return response()->json(['error' => [
                'code' => 'IQN_VARIANT_TOPIC_MISMATCH',
                'message' => 'Tanlangan aniq IQN ish varianti yo‘l ustasi qayd etgan umumiy ish mavzusiga kirmaydi.',
            ]], 422);
        }
        $scheme = DbRows::selectOne(
            <<<'SQL'
                select ss.id, ss.scheme_kind, ss.name,
                       coalesce(nullif(ss.instructions ->> 'description', ''), ss.name) description,
                       coalesce(sum(sr.required_quantity) filter (where sr.requirement_kind = 'staff'), 0)::integer required_safety_workers,
                       coalesce(sum(sr.required_quantity) filter (where sr.requirement_kind = 'sign'), 0)::integer required_signs,
                       coalesce(sum(sr.required_quantity) filter (where sr.requirement_kind = 'cone'), 0)::integer required_cones,
                       coalesce(sum(sr.required_quantity) filter (where sr.requirement_kind = 'barrier'), 0)::integer required_barriers
                from roadops.safety_schemes ss
                left join roadops.safety_scheme_requirements sr on sr.safety_scheme_id = ss.id
                where ss.division_id = ? and ss.status = 'approved'
                  and ss.effective_from <= ?::date
                  and (ss.effective_until is null or ss.effective_until > ?::date)
                  and ss.scheme_kind = (
                    select selected.scheme_kind
                    from roadops.safety_schemes selected
                    where selected.id = ? and selected.division_id = any(?::uuid[])
                      and selected.status = 'approved' and selected.scheme_kind is not null
                    limit 1
                  )
                group by ss.id
                order by ss.effective_from desc, ss.code, ss.id
                limit 1
            SQL,
            [
                $road->division_id,
                $validated['scheduledDate'],
                $validated['scheduledDate'],
                $validated['safetySchemeId'],
                $divisionIds,
            ],
        );
        if ($scheme === null) {
            return response()->json(['error' => [
                'code' => 'SAFETY_SCHEME_UNAVAILABLE',
                'message' => 'Tanlangan harakat xavfsizligi sxemasi bu bo‘lim va sana uchun tasdiqlanmagan.',
            ]], 422);
        }
        if ((string) $scheme->scheme_kind === 'full_closure_permit'
            && trim((string) ($validated['permitNumber'] ?? '')) === '') {
            return response()->json(['error' => [
                'code' => 'FULL_CLOSURE_PERMIT_REQUIRED',
                'message' => 'Yo‘lni to‘liq yopish sxemasi uchun ruxsatnoma raqami majburiy.',
            ]], 422);
        }

        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        $workerIds = array_values(array_map('strval', $validated['workerIds']));
        $direction = trim((string) ($validated['direction'] ?? ''));
        $laneLabel = trim((string) ($validated['laneLabel'] ?? ''));
        $runData = DB::transaction(function () use (
            $validated,
            $chainageStart,
            $chainageEnd,
            $road,
            $variant,
            $scheme,
            $sourceDefect,
            $context,
            $workerIds,
            $direction,
            $laneLabel,
        ): array {
            DbRows::select('select pg_advisory_xact_lock(hashtextextended(?::text, 20260812))', [
                $road->division_id,
            ]);
            if ($sourceDefect !== null) {
                $lockedSourceDefect = DbRows::selectOne(
                    <<<'SQL'
                        select dc.id
                        from roadops.defect_cases dc
                        where dc.id=? and dc.road_id=? and dc.status='open'
                          and dc.updated_at::text=?
                          and not exists (
                            select 1
                            from roadops.plan_items pi
                            where pi.status <> 'cancelled'
                              and (
                                pi.defect_case_id=dc.id
                                or pi.formula_inputs #>> '{manualInput,sourceDefectId}'=dc.id::text
                              )
                          )
                        for update of dc
                    SQL,
                    [$sourceDefect->id, $road->id, $sourceDefect->source_version],
                    false,
                );
                if ($lockedSourceDefect === null) {
                    throw ValidationException::withMessages([
                        'sourceDefectId' => [
                            'Manba nuqson o‘zgargan, yopilgan yoki boshqa faol reja bandiga biriktirilgan.',
                        ],
                    ]);
                }
            }
            $manualRequest = DbRows::selectOne(
                <<<'SQL'
                    insert into roadops.manual_work_requests (
                      division_id, road_id, work_variant_id, safety_scheme_id,
                      chainage_span, work_quantity, work_unit, direction, lane_label,
                      requested_date, permit_reference, status, created_by
                    ) values (?, ?, ?, ?, numrange(?::numeric, ?::numeric, '[)'),
                              ?::numeric, ?, ?, ?, ?::date, ?, 'evaluated', ?)
                    returning id, updated_at::text source_version, work_quantity::text
                SQL,
                [
                    $road->division_id,
                    $road->id,
                    $variant->id,
                    $scheme->id,
                    $chainageStart,
                    $chainageEnd,
                    $validated['exactQuantity'],
                    $variant->basis_unit,
                    $direction === '' ? null : $direction,
                    $laneLabel === '' ? null : $laneLabel,
                    $validated['scheduledDate'],
                    $validated['permitNumber'] ?? null,
                    $context->userId,
                ],
            );
            if ($manualRequest === null) {
                throw new \RuntimeException('Manual work request could not be created.');
            }
            $candidateId = 'MANUAL:'.$manualRequest->id;
            $manualInput = [
                'roadId' => (string) $road->id,
                'workVariantId' => (string) $variant->id,
                'exactQuantity' => (string) $manualRequest->work_quantity,
                'chainageStartM' => (string) $chainageStart,
                'chainageEndM' => (string) $chainageStart,
                'laneLabel' => $laneLabel,
                'direction' => $direction,
                'sourceDefectId' => $sourceDefect === null ? null : (string) $sourceDefect->id,
                'sourceDefectVersion' => $sourceDefect === null ? null : (string) $sourceDefect->source_version,
                'sourceIqnTopicId' => $sourceDefect === null ? null : (string) $sourceDefect->topic_id,
                'sourceIqnTopicName' => $sourceDefect === null ? null : (string) $sourceDefect->topic_name,
                'sourceChainageStartM' => $sourceDefect === null ? null : (string) $sourceDefect->source_chainage_start_m,
                'sourceChainageEndM' => $sourceDefect === null ? null : (string) $sourceDefect->source_chainage_end_m,
                'sourceQuantity' => $sourceDefect === null ? null : (string) $sourceDefect->source_quantity,
                'sourceUnit' => $sourceDefect === null ? null : (string) $sourceDefect->source_unit,
                'scheduledDate' => (string) $validated['scheduledDate'],
                'safetySchemeId' => (string) $scheme->id,
                'workerIds' => $workerIds,
                'permitNumber' => $validated['permitNumber'] ?? null,
            ];
            $inputHash = hash('sha256', json_encode($manualInput, JSON_THROW_ON_ERROR));
            $run = DbRows::selectOne(
                <<<'SQL'
                    insert into roadops.planning_runs (
                      division_id, planning_window, as_of, algorithm_version,
                      input_snapshot_hash, planning_mode, created_by
                    ) values (?, daterange(?::date, ?::date + 1, '[)'), clock_timestamp(),
                              'roadops-contract-v1', decode(?, 'hex'), 'manual', ?)
                    returning id
                SQL,
                [
                    $road->division_id,
                    $validated['scheduledDate'],
                    $validated['scheduledDate'],
                    $inputHash,
                    $context->userId,
                ],
            );
            if ($run === null) {
                throw new \RuntimeException('Manual planning run could not be created.');
            }
            $formulaInputs = [
                'candidateId' => $candidateId,
                'selectionOrder' => 1,
                'sourceReference' => $sourceDefect === null
                    ? $candidateId
                    : (string) $sourceDefect->source_reference,
                'workName' => (string) $variant->work_name,
                'manualInput' => $manualInput,
            ];
            $item = DbRows::selectOne(
                <<<'SQL'
                    insert into roadops.plan_items (
                      planning_run_id, manual_work_request_id, road_id, work_variant_id,
                      chainage_span, work_quantity, work_unit, formula_inputs,
                      scheduled_window, safety_scheme_id, permit_reference
                    ) values (?, ?, ?, ?, numrange(?::numeric, ?::numeric, '[)'),
                              ?::numeric, ?, ?::jsonb,
                              tstzrange(
                                (?::date + time '08:00') at time zone 'Asia/Tashkent',
                                (?::date + time '15:00') at time zone 'Asia/Tashkent', '[)'
                              ), ?, ?)
                    returning id
                SQL,
                [
                    $run->id,
                    $manualRequest->id,
                    $road->id,
                    $variant->id,
                    $chainageStart,
                    $chainageEnd,
                    $manualRequest->work_quantity,
                    $variant->basis_unit,
                    json_encode($formulaInputs, JSON_THROW_ON_ERROR),
                    $validated['scheduledDate'],
                    $validated['scheduledDate'],
                    $scheme->id,
                    $validated['permitNumber'] ?? null,
                ],
            );
            if ($item === null) {
                throw new \RuntimeException('Manual plan item could not be created.');
            }
            DB::insert(
                <<<'SQL'
                    insert into roadops.planning_run_inputs (
                      planning_run_id, entity_type, entity_id, source_version,
                      payload_hash, captured_at
                    ) values (?, 'manual_work_request', ?, ?, decode(?, 'hex'), clock_timestamp())
                SQL,
                [
                    $run->id,
                    $manualRequest->id,
                    $manualRequest->source_version,
                    hash('sha256', json_encode($formulaInputs, JSON_THROW_ON_ERROR)),
                ],
            );
            $this->rebuildAllBlockers((string) $run->id);
            $this->allocateResources(
                (string) $run->id,
                (string) $road->division_id,
                $context->userId,
                $workerIds,
            );
            $this->allocateSafety(
                (string) $item->id,
                (string) $road->division_id,
                $context->userId,
                $workerIds,
            );
            $this->rebuildAllBlockers((string) $run->id);

            return ['runId' => (string) $run->id, 'inputHash' => $inputHash];
        });

        return response()->json(['data' => $this->previewPayload(
            $runData['runId'],
            $validated['scheduledDate'],
            $validated['scheduledDate'],
            $context,
        )], 201);
    }

    public function index(Request $request, ApiScope $scope): JsonResponse
    {
        $pagination = Pagination::from($request);
        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);
        $rows = DbRows::select(
            <<<'SQL'
                select pr.id, pr.status, lower(pr.planning_window) date_from,
                       upper(pr.planning_window) - 1 date_to, pr.created_at,
                       pr.planning_mode, pr.created_by, creator.full_name created_by_name,
                       roadops.has_permission('planning.approve', pr.division_id) can_approve_permission,
                       count(distinct pi.id) item_count,
                       count(distinct pb.id) filter (where pb.resolved_at is null) blocker_count
                from roadops.planning_runs pr
                join roadops.app_users creator on creator.id = pr.created_by
                left join roadops.plan_items pi on pi.planning_run_id = pr.id
                left join roadops.planning_blockers pb on pb.planning_run_id = pr.id
                where pr.division_id = any(?::uuid[])
                  and exists (
                    select 1 from roadops.plan_items scoped_item
                    where scoped_item.planning_run_id = pr.id
                      and scoped_item.status <> 'cancelled'
                  )
                  and (
                    roadops.has_permission('planning.read', pr.division_id)
                    or roadops.has_permission('planning.write', pr.division_id)
                    or roadops.has_permission('planning.approve', pr.division_id)
                  )
                group by pr.id, creator.full_name
                order by pr.created_at desc, pr.id desc
                limit ? offset ?
            SQL,
            [$divisionIds, $pagination->pageSize, $pagination->offset()],
        );
        $total = (int) DB::scalar(
            <<<'SQL'
                select count(*)
                from roadops.planning_runs pr
                join roadops.app_users creator on creator.id = pr.created_by
                where pr.division_id = any(?::uuid[])
                  and exists (
                    select 1 from roadops.plan_items scoped_item
                    where scoped_item.planning_run_id = pr.id
                      and scoped_item.status <> 'cancelled'
                  )
                  and (
                    roadops.has_permission('planning.read', pr.division_id)
                    or roadops.has_permission('planning.write', pr.division_id)
                    or roadops.has_permission('planning.approve', pr.division_id)
                  )
            SQL,
            [$divisionIds],
        );

        return PagedResponse::make(array_values(array_map(static fn (stdClass $row): array => [
            'id' => (string) $row->id,
            'state' => strtoupper((string) $row->status),
            'dateFrom' => (string) $row->date_from,
            'dateTo' => (string) $row->date_to,
            'planningMode' => strtoupper((string) $row->planning_mode),
            'itemCount' => (int) $row->item_count,
            'blockerCount' => (int) $row->blocker_count,
            'createdAt' => (string) $row->created_at,
            'createdByName' => (string) $row->created_by_name,
            'createdByMe' => (string) $row->created_by === $context->userId,
            'canApprove' => (string) $row->status === 'evaluated'
                && (int) $row->blocker_count === 0
                && (string) $row->created_by !== $context->userId
                && (bool) $row->can_approve_permission,
            'canPublish' => (string) $row->status === 'approved'
                && (int) $row->blocker_count === 0
                && (bool) $row->can_approve_permission,
        ], $rows)), $pagination->page, $pagination->pageSize, $total);
    }

    public function show(Request $request, ApiScope $scope, string $id): JsonResponse
    {
        if (! preg_match('/^[0-9a-f-]{36}$/i', $id)) {
            abort(404);
        }
        $divisionIds = $scope->pgUuidArray($scope->roadUnitIds($request));
        $run = DbRows::selectOne(
            <<<'SQL'
                select lower(planning_window)::text date_from,
                       (upper(planning_window) - 1)::text date_to
                from roadops.planning_runs
                where id = ? and division_id = any(?::uuid[])
                  and exists (
                    select 1 from roadops.plan_items scoped_item
                    where scoped_item.planning_run_id = planning_runs.id
                      and scoped_item.status <> 'cancelled'
                  )
                  and (
                    roadops.has_permission('planning.read', division_id)
                    or roadops.has_permission('planning.write', division_id)
                    or roadops.has_permission('planning.approve', division_id)
                  )
            SQL,
            [$id, $divisionIds],
        );
        if ($run === null) {
            abort(404);
        }
        /** @var AuthContext $context */
        $context = $request->attributes->get(AuthContext::class);

        return response()->json(['data' => $this->previewPayload(
            $id,
            (string) $run->date_from,
            (string) $run->date_to,
            $context,
        )]);
    }

    public function approve(string $id): JsonResponse
    {
        if (! preg_match('/^[0-9a-f-]{36}$/i', $id)) {
            abort(404);
        }
        try {
            DB::transaction(function () use ($id): void {
                $run = DbRows::selectOne(
                    'select status from roadops.planning_runs where id = ? for update',
                    [$id],
                );
                if ($run === null) {
                    abort(404);
                }
                if (! $this->scopedRunExists($id)) {
                    abort(404);
                }
                if ($run->status === 'approved') {
                    return;
                }
                if ($run->status !== 'evaluated') {
                    throw new \DomainException('PLAN_NOT_EVALUATED');
                }
                $this->assertSnapshotCurrent($id);
                $this->rebuildAllBlockers($id);
                $this->assertSnapshotCurrent($id);
                DbRows::select('select roadops.approve_planning_run(?)', [$id]);
            });
        } catch (\Throwable $exception) {
            if ($exception instanceof HttpExceptionInterface) {
                throw $exception;
            }

            return response()->json(['error' => [
                'code' => $this->isSnapshotConflict($exception)
                    ? 'PLAN_INPUT_SNAPSHOT_STALE'
                    : 'PLAN_APPROVAL_REJECTED',
                'message' => $this->approvalError($exception),
            ]], 409);
        }

        return response()->json(['data' => ['planId' => $id, 'state' => 'APPROVED']]);
    }

    public function publish(string $id): JsonResponse
    {
        if (! preg_match('/^[0-9a-f-]{36}$/i', $id)) {
            abort(404);
        }
        try {
            $created = DB::transaction(function () use ($id): int {
                $run = DbRows::selectOne('select status from roadops.planning_runs where id = ? for update', [$id]);
                if ($run === null) {
                    abort(404);
                }
                if (! $this->scopedRunExists($id)) {
                    abort(404);
                }
                if ($run->status === 'published') {
                    return 0;
                }
                if ($run->status !== 'approved') {
                    throw new \DomainException('PLAN_NOT_READY');
                }
                $this->assertSnapshotCurrent($id);
                $this->assertLiveResourcesCurrent($id);
                $result = DbRows::selectOne('select roadops.publish_planning_run(?) created_count', [$id]);
                DB::update(
                    <<<'SQL'
                        update roadops.manual_work_requests request
                        set status = 'published'
                        where request.id in (
                          select pi.manual_work_request_id
                          from roadops.plan_items pi
                          where pi.planning_run_id = ? and pi.manual_work_request_id is not null
                        ) and request.status in ('draft', 'evaluated')
                    SQL,
                    [$id],
                );

                return $result === null ? 0 : (int) $result->created_count;
            });
        } catch (\Throwable $exception) {
            if ($exception instanceof HttpExceptionInterface) {
                throw $exception;
            }

            return response()->json(['error' => [
                'code' => $this->isSnapshotConflict($exception)
                    ? 'PLAN_INPUT_SNAPSHOT_STALE'
                    : 'PLAN_PUBLISH_REJECTED',
                'message' => $this->publishError($exception),
            ]], 409);
        }

        return response()->json(['data' => ['planId' => $id, 'state' => 'PUBLISHED'], 'meta' => [
            'createdWorkOrders' => $created,
        ]]);
    }

    /** @return array<string, mixed> */
    private function candidatePayload(stdClass $row): array
    {
        $location = isset($row->chainage_from)
            ? sprintf('km %.3f–%.3f', (float) $row->chainage_from / 1000, (float) $row->chainage_to / 1000)
            : 'Yillik dasturdagi yo‘l bo‘yicha';

        return [
            'id' => (string) $row->candidate_id,
            'sourceReference' => (string) $row->source_reference,
            'sourceKind' => (string) $row->source_kind_label,
            'road' => ['code' => (string) $row->road_code, 'name' => (string) $row->road_name],
            'locationLabel' => $location,
            'workName' => (string) $row->work_name,
            'exactQuantity' => [
                'value' => (string) $row->exact_quantity,
                'unit' => (string) $row->exact_unit,
            ],
            'normReference' => $row->norm_reference === null ? null : (string) $row->norm_reference,
            'verificationState' => $row->source_kind_label === 'ANNUAL_PROGRAM' ? 'APPROVED' : 'VERIFIED',
        ];
    }

    private function loadCandidate(string $candidateId, string $divisionIds, string $scheduledDate): ?stdClass
    {
        [$kind, $id] = explode(':', $candidateId, 2);
        if (strtoupper($kind) === 'DEFECT') {
            return DbRows::selectOne(
                <<<'SQL'
                    select ? candidate_id, 'defect_case' entity_type, dc.id entity_id,
                           dc.source_kind,
                           dc.updated_at::text source_version,
                           roadops.division_for_road_zone(
                             dc.road_id, dc.chainage_span,
                             (work.scheduled_date + time '08:00') at time zone 'Asia/Tashkent'
                           ) division_id,
                           dc.road_id,
                           mapped.work_variant_id, lower(dc.chainage_span) chainage_from,
                           upper(dc.chainage_span) chainage_to,
                           dc.measured_quantity * coalesce(mapped.factor, 1) work_quantity,
                           coalesce(mapped.basis_unit, dc.measurement_unit) work_unit,
                           coalesce(mapped.work_name, dt.name) work_name,
                           coalesce(rvc.external_candidate_id, i.inspection_number, dc.id::text) source_reference
                    from roadops.defect_cases dc
                    join roadops.road_versions rv on rv.road_id = dc.road_id and rv.valid_until is null
                    join roadops.defect_types dt on dt.id = dc.defect_type_id
                    left join roadops.roadvision_candidates rvc on rvc.id = dc.roadvision_candidate_id
                    left join roadops.inspection_observations io on io.id = dc.inspection_observation_id
                    left join roadops.inspections i on i.id = io.inspection_id
                    cross join lateral (select ?::date scheduled_date) work
                    left join lateral (
                        select x.work_variant_id, x.measured_to_basis_factor factor,
                               v.basis_unit, wi.normalized_name work_name
                        from roadops.defect_work_variant_crosswalks x
                        join roadops.iqn_work_variants v on v.id = x.work_variant_id
                        join roadops.iqn_work_items wi on wi.id = v.work_item_id
                        where x.defect_type_id = dc.defect_type_id and x.status = 'approved'
                          and x.effective_from <= work.scheduled_date
                          and (x.effective_until is null or x.effective_until > work.scheduled_date)
                          and v.interpretation_status = 'approved' and v.planning_status = 'automatic'
                          and exists (
                            select 1 from roadops.iqn_norm_sets norm
                            where norm.work_variant_id = v.id and norm.status = 'approved'
                              and norm.effective_from <= work.scheduled_date
                              and (norm.effective_until is null or norm.effective_until > work.scheduled_date)
                          )
                        order by x.effective_from desc, x.id limit 1
                    ) mapped on true
                    where dc.id = ?
                      and lower(dc.chainage_span) >= 0
                      and upper(dc.chainage_span) <= rv.length_m
                      and roadops.division_for_road_zone(
                            dc.road_id, dc.chainage_span,
                            (work.scheduled_date + time '08:00') at time zone 'Asia/Tashkent'
                          ) = any(?::uuid[])
                      and dc.status = 'open'
                      and not exists (
                        select 1 from roadops.plan_items pi
                        where pi.status <> 'cancelled'
                          and (
                            pi.defect_case_id = dc.id
                            or pi.formula_inputs #>> '{manualInput,sourceDefectId}' = dc.id::text
                          )
                      )
                SQL,
                [$candidateId, $scheduledDate, $id, $divisionIds],
            );
        }

        return DbRows::selectOne(
            <<<'SQL'
                select ? candidate_id, 'annual_program_item' entity_type, api.id entity_id,
                       'annual_program'::text source_kind,
                       api.updated_at::text source_version,
                       ap.division_id,
                       api.road_id,
                       api.work_variant_id, 0::numeric chainage_from, rv.length_m chainage_to,
                       api.planned_quantity work_quantity, api.work_unit,
                       wi.normalized_name work_name,
                       coalesce(ap.source_reference, 'YILLIK-' || ap.program_year || '-' || api.id::text) source_reference
                from roadops.annual_program_items api
                join roadops.annual_programs ap on ap.id = api.annual_program_id
                join roadops.road_versions rv on rv.road_id = api.road_id and rv.valid_until is null
                join roadops.iqn_work_variants v on v.id = api.work_variant_id
                join roadops.iqn_work_items wi on wi.id = v.work_item_id
                cross join lateral (select ?::date scheduled_date) work
                where api.id = ?
                  and ap.division_id = any(?::uuid[])
                  and exists (
                    select 1 from roadops.road_division_assignments assignment
                    where assignment.road_id = api.road_id
                      and assignment.division_id = ap.division_id
                      and assignment.valid_from <=
                        (work.scheduled_date + time '08:00') at time zone 'Asia/Tashkent'
                      and (assignment.valid_until is null
                           or assignment.valid_until >
                              (work.scheduled_date + time '08:00') at time zone 'Asia/Tashkent')
                      and assignment.chainage_span @> numrange(0, rv.length_m, '[)')
                  )
                  and ap.status = 'approved'
                  and not exists (
                    select 1 from roadops.plan_items pi
                    where pi.annual_program_item_id = api.id and pi.status not in ('cancelled', 'completed')
                  )
            SQL,
            [$candidateId, $scheduledDate, $id, $divisionIds],
        );
    }

    /** @return array{code: string, message: string}|null */
    private function candidateAssignmentIssue(
        string $candidateId,
        string $divisionIds,
        string $scheduledDate,
    ): ?array {
        [$kind, $id] = explode(':', $candidateId, 2);
        if (strtoupper($kind) === 'DEFECT') {
            $ownership = DbRows::selectOne(
                <<<'SQL'
                    select count(a.id) filter (where a.chainage_span @> dc.chainage_span) owner_count,
                           count(a.id) filter (where a.chainage_span && dc.chainage_span) overlap_count
                    from roadops.defect_cases dc
                    join roadops.road_versions rv
                      on rv.road_id = dc.road_id and rv.valid_until is null
                    cross join lateral (select ?::date scheduled_date) work
                    left join roadops.road_division_assignments a
                      on a.road_id = dc.road_id
                     and a.valid_from <= (work.scheduled_date + time '08:00') at time zone 'Asia/Tashkent'
                     and (a.valid_until is null
                          or a.valid_until > (work.scheduled_date + time '08:00') at time zone 'Asia/Tashkent')
                     and a.division_id = any(?::uuid[])
                    where dc.id = ? and dc.status = 'open'
                    group by dc.id
                SQL,
                [$scheduledDate, $divisionIds, $id],
            );
        } else {
            $ownership = DbRows::selectOne(
                <<<'SQL'
                    select count(a.id) filter (
                             where a.chainage_span @> numrange(0, rv.length_m, '[)')
                           ) owner_count,
                           count(a.id) filter (
                             where a.chainage_span && numrange(0, rv.length_m, '[)')
                           ) overlap_count
                    from roadops.annual_program_items api
                    join roadops.annual_programs ap on ap.id = api.annual_program_id
                    join roadops.road_versions rv
                      on rv.road_id = api.road_id and rv.valid_until is null
                    cross join lateral (select ?::date scheduled_date) work
                    left join roadops.road_division_assignments a
                      on a.road_id = api.road_id
                     and a.division_id = ap.division_id
                     and a.valid_from <= (work.scheduled_date + time '08:00') at time zone 'Asia/Tashkent'
                     and (a.valid_until is null
                          or a.valid_until > (work.scheduled_date + time '08:00') at time zone 'Asia/Tashkent')
                     and a.division_id = any(?::uuid[])
                    where api.id = ? and ap.status = 'approved'
                      and ap.division_id = any(?::uuid[])
                    group by api.id
                SQL,
                [$scheduledDate, $divisionIds, $id, $divisionIds],
            );
        }

        if ($ownership === null) {
            return null;
        }
        if ((int) $ownership->owner_count === 1) {
            return null;
        }
        if ((int) $ownership->overlap_count === 0) {
            return [
                'code' => 'ROAD_ASSIGNMENT_MISSING',
                'message' => 'Tanlangan aniq yo‘l zonasi uchun amaldagi YTP bo‘lim biriktiruvi topilmadi.',
            ];
        }

        return [
            'code' => 'ROAD_ASSIGNMENT_AMBIGUOUS',
            'message' => 'Tanlangan yo‘l zonasi bitta YTP bo‘lim biriktiruvi ichiga to‘liq tushmaydi. Yo‘l kesimini aniq ajrating.',
        ];
    }

    /** @param list<string>|null $allowedWorkerIds */
    private function allocateResources(
        string $runId,
        string $divisionId,
        string $actorId,
        ?array $allowedWorkerIds = null,
    ): void {
        $this->allocateLabor($runId, $divisionId, $actorId, $allowedWorkerIds);
        $this->allocateEquipment($runId, $divisionId, $actorId);
        $this->allocateMaterials($runId, $divisionId, $actorId);
    }

    /** @param list<string>|null $allowedWorkerIds */
    private function allocateLabor(
        string $runId,
        string $divisionId,
        string $actorId,
        ?array $allowedWorkerIds,
    ): void {
        $requirements = DbRows::select(
            <<<'SQL'
                select pi.id plan_item_id, pi.work_variant_id,
                       pi.scheduled_window::text scheduled_window,
                       (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date work_date,
                       (array_agg(pr.id order by nl.source_line_number, pr.id))[1]
                         labor_requirement_id,
                       sum(pr.required_minutes)::integer required_minutes,
                       min(nl.source_line_number) first_source_line
                from roadops.plan_items pi
                join roadops.plan_resource_requirements pr on pr.plan_item_id = pi.id
                join roadops.iqn_norm_lines nl on nl.id = pr.norm_line_id
                where pi.planning_run_id = ? and pi.scheduled_window is not null
                  and pr.resource_kind = 'labor' and pr.required_minutes is not null
                  and not exists (
                    select 1 from roadops.planning_blockers b
                    where b.plan_item_id = pi.id and b.resolved_at is null
                      and b.blocker_code not in (
                        'LABOR_ASSIGNMENT_INCOMPLETE', 'WORK_TEMPLATE_CREW_INCOMPLETE',
                        'EQUIPMENT_RESERVATION_INCOMPLETE', 'MATERIAL_RESERVATION_INCOMPLETE',
                        'SAFETY_STAFF_SHORTAGE', 'SAFETY_EQUIPMENT_SHORTAGE',
                        'FULL_CLOSURE_PERMIT_REQUIRED'
                      )
                  )
                group by pi.id, pi.work_variant_id, pi.scheduled_window, pi.formula_inputs
                order by (pi.formula_inputs ->> 'selectionOrder')::integer, pi.id,
                         first_source_line
            SQL,
            [$runId],
        );

        foreach ($requirements as $item) {
            $skills = DbRows::select(
                <<<'SQL'
                    select id, qualification_code, worker_count
                    from roadops.work_variant_skill_requirements
                    where work_variant_id = ? and status = 'approved'
                      and effective_from <= ?::date
                      and (effective_until is null or effective_until > ?::date)
                    order by qualification_code, id
                SQL,
                [$item->work_variant_id, $item->work_date, $item->work_date],
            );
            if ($skills === []) {
                continue;
            }

            $workerRows = DbRows::select(
                <<<'SQL'
                    select distinct w.id, wv.personnel_number, q.qualification_code,
                           greatest(
                             least(420, case
                               when availability.id is null then 0
                               when availability.availability_code = 'available'
                                 then availability.available_minutes
                               else 0
                             end) - coalesce(used.planned_minutes, 0),
                             0
                           )::integer remaining_minutes
                    from roadops.workers w
                    join roadops.worker_versions wv on wv.worker_id = w.id
                      and wv.employment_state = 'active'
                      and wv.valid_from <= lower(?::tstzrange)
                      and (wv.valid_until is null or wv.valid_until > lower(?::tstzrange))
                    join roadops.worker_division_assignments worker_assignment
                      on worker_assignment.worker_id = w.id
                     and worker_assignment.division_id = ?
                     and worker_assignment.valid_from <= ?::date
                     and (worker_assignment.valid_until is null
                          or worker_assignment.valid_until > ?::date)
                    join roadops.worker_qualification_versions q on q.worker_id = w.id
                      and q.valid_from <= lower(?::tstzrange)
                      and (q.valid_until is null or q.valid_until > lower(?::tstzrange))
                    join roadops.work_variant_skill_requirements skill
                      on skill.work_variant_id = ?
                     and skill.qualification_code = q.qualification_code
                     and skill.status = 'approved'
                     and skill.effective_from <= ?::date
                     and (skill.effective_until is null or skill.effective_until > ?::date)
                    left join lateral (
                      select wa.id, wa.available_minutes, wa.availability_code
                      from roadops.worker_availability wa
                      where wa.worker_id = w.id and wa.work_date = ?::date
                        and wa.retired_at is null
                      order by wa.source_updated_at desc nulls last, wa.recorded_at desc, wa.id desc
                      limit 1
                    ) availability on true
                    left join lateral (
                      select coalesce(sum(used_minutes.minutes), 0)::integer planned_minutes
                      from (
                        select assignment.planned_minutes::integer minutes
                        from roadops.work_assignments assignment
                        where assignment.worker_id = w.id and assignment.work_date = ?::date
                          and assignment.status <> 'cancelled'
                        union all
                        select safety.planned_minutes::integer
                        from roadops.safety_staff_assignments safety
                        where safety.worker_id = w.id and safety.work_date = ?::date
                          and safety.status <> 'cancelled'
                      ) used_minutes
                    ) used on true
                    where w.retired_at is null
                      and not exists (
                      select 1 from roadops.work_assignments assignment
                      where assignment.worker_id = w.id and assignment.status <> 'cancelled'
                        and assignment.scheduled_window && ?::tstzrange
                    )
                      and not exists (
                        select 1 from roadops.safety_staff_assignments safety
                        where safety.worker_id = w.id and safety.status <> 'cancelled'
                          and safety.scheduled_window && ?::tstzrange
                      )
                      and greatest(
                        least(420, case
                          when availability.id is null then 0
                          when availability.availability_code = 'available'
                            then availability.available_minutes
                          else 0
                        end) - coalesce(used.planned_minutes, 0),
                        0
                      ) > 0
                    order by remaining_minutes desc, wv.personnel_number, w.id, q.qualification_code
                SQL,
                [
                    $item->scheduled_window,
                    $item->scheduled_window,
                    $divisionId,
                    $item->work_date,
                    $item->work_date,
                    $item->scheduled_window,
                    $item->scheduled_window,
                    $item->work_variant_id,
                    $item->work_date,
                    $item->work_date,
                    $item->work_date,
                    $item->work_date,
                    $item->work_date,
                    $item->scheduled_window,
                    $item->scheduled_window,
                ],
            );

            /** @var array<string, array{
             *     id: string,
             *     personnelNumber: string,
             *     remainingMinutes: int,
             *     qualifications: list<string>
             * }> $workers
             */
            $workers = [];
            foreach ($workerRows as $worker) {
                $workerId = (string) $worker->id;
                if ($allowedWorkerIds !== null && ! in_array($workerId, $allowedWorkerIds, true)) {
                    continue;
                }
                $workers[$workerId] ??= [
                    'id' => $workerId,
                    'personnelNumber' => (string) $worker->personnel_number,
                    'remainingMinutes' => (int) $worker->remaining_minutes,
                    'qualifications' => [],
                ];
                $workers[$workerId]['qualifications'][] = (string) $worker->qualification_code;
            }

            $allocations = $this->crewAllocator->allocate(
                array_map(static fn (stdClass $skill): array => [
                    'id' => (string) $skill->id,
                    'qualificationCode' => (string) $skill->qualification_code,
                    'workerCount' => (int) $skill->worker_count,
                ], $skills),
                array_values($workers),
                (int) $item->required_minutes,
            );

            foreach ($allocations as $allocation) {
                DB::insert(
                    <<<'SQL'
                        insert into roadops.work_assignments (
                          plan_item_id, labor_requirement_id, skill_requirement_id,
                          worker_id, work_date, scheduled_window, planned_minutes,
                          status, assigned_by
                        ) values (?, ?, ?, ?, ?::date, ?::tstzrange, ?, 'scheduled', ?)
                    SQL,
                    [
                        $item->plan_item_id,
                        $item->labor_requirement_id,
                        $allocation['skillRequirementId'],
                        $allocation['workerId'],
                        $item->work_date,
                        $item->scheduled_window,
                        $allocation['plannedMinutes'],
                        $actorId,
                    ],
                );
            }
        }
    }

    private function allocateEquipment(string $runId, string $divisionId, string $actorId): void
    {
        $requirements = DbRows::select(
            <<<'SQL'
                select pi.id plan_item_id, pr.id requirement_id, nl.resource_id,
                       pr.required_quantity::text required_quantity, pr.unit,
                       pi.scheduled_window::text scheduled_window,
                       (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date work_date
                from roadops.plan_items pi
                join roadops.plan_resource_requirements pr on pr.plan_item_id = pi.id
                join roadops.iqn_norm_lines nl on nl.id = pr.norm_line_id
                where pi.planning_run_id = ? and pi.scheduled_window is not null
                  and pr.resource_kind = 'equipment'
                  and not exists (
                    select 1 from roadops.planning_blockers b
                    where b.plan_item_id = pi.id and b.resolved_at is null
                      and b.blocker_code not in (
                        'LABOR_ASSIGNMENT_INCOMPLETE', 'WORK_TEMPLATE_CREW_INCOMPLETE',
                        'EQUIPMENT_RESERVATION_INCOMPLETE', 'MATERIAL_RESERVATION_INCOMPLETE',
                        'EQUIPMENT_UNIT_CONVERSION_REQUIRED', 'EQUIPMENT_CAPACITY_INSUFFICIENT'
                        ,'SAFETY_STAFF_SHORTAGE', 'SAFETY_EQUIPMENT_SHORTAGE',
                        'FULL_CLOSURE_PERMIT_REQUIRED'
                      )
                  )
                order by (pi.formula_inputs ->> 'selectionOrder')::integer,
                         nl.source_line_number, pr.id
            SQL,
            [$runId],
        );

        foreach ($requirements as $requirement) {
            $equipmentUnits = DbRows::select(
                <<<'SQL'
                    select e.id, 420::integer available_minutes
                    from roadops.equipment_units e
                    where e.division_id = ? and e.iqn_resource_id = ?
                      and e.state = 'active'
                      and e.effective_from <= ?::date
                      and (e.effective_until is null or e.effective_until > ?::date)
                      and not exists (
                        select 1 from roadops.equipment_unavailability u
                        where u.equipment_unit_id = e.id
                          and u.unavailable_window && ?::tstzrange
                      )
                      and not exists (
                        select 1 from roadops.equipment_reservations reserved
                        where reserved.equipment_unit_id = e.id
                          and reserved.status in ('reserved', 'checked_out')
                          and reserved.reserved_window && ?::tstzrange
                      )
                    order by e.inventory_code, e.id
                SQL,
                [
                    $divisionId,
                    $requirement->resource_id,
                    $requirement->work_date,
                    $requirement->work_date,
                    $requirement->scheduled_window,
                    $requirement->scheduled_window,
                ],
            );

            $allocations = $this->equipmentAllocator->allocate(
                (string) $requirement->unit,
                (string) $requirement->required_quantity,
                array_map(static fn (stdClass $equipment): array => [
                    'id' => (string) $equipment->id,
                    'availableMinutes' => (int) $equipment->available_minutes,
                ], $equipmentUnits),
            );
            $allocatedQuantity = $this->sumDecimalQuantities(array_column(
                $allocations,
                'allocatedQuantity',
            ));
            $unitNeedsConversion = $this->equipmentUnitNeedsConversion((string) $requirement->unit);
            if ($unitNeedsConversion) {
                DbRows::select('select roadops.put_allocator_blocker(?, ?, ?, ?, ?, ?::jsonb)', [
                    $runId,
                    $requirement->plan_item_id,
                    'EQUIPMENT_UNIT_CONVERSION_REQUIRED',
                    'plan_resource_requirement',
                    $requirement->requirement_id,
                    json_encode([
                        'required_quantity' => (string) $requirement->required_quantity,
                        'unit' => (string) $requirement->unit,
                    ], JSON_THROW_ON_ERROR),
                ]);
            } else {
                DbRows::select('select roadops.resolve_allocator_blocker(?, ?, ?, ?)', [
                    $runId,
                    $requirement->plan_item_id,
                    'EQUIPMENT_UNIT_CONVERSION_REQUIRED',
                    $requirement->requirement_id,
                ]);
            }
            if (! $unitNeedsConversion && $allocatedQuantity !== (string) $requirement->required_quantity) {
                DbRows::select('select roadops.put_allocator_blocker(?, ?, ?, ?, ?, ?::jsonb)', [
                    $runId,
                    $requirement->plan_item_id,
                    'EQUIPMENT_CAPACITY_INSUFFICIENT',
                    'plan_resource_requirement',
                    $requirement->requirement_id,
                    json_encode([
                        'required_quantity' => (string) $requirement->required_quantity,
                        'allocated_quantity' => $allocatedQuantity,
                        'unit' => (string) $requirement->unit,
                    ], JSON_THROW_ON_ERROR),
                ]);
            } else {
                DbRows::select('select roadops.resolve_allocator_blocker(?, ?, ?, ?)', [
                    $runId,
                    $requirement->plan_item_id,
                    'EQUIPMENT_CAPACITY_INSUFFICIENT',
                    $requirement->requirement_id,
                ]);
            }
            foreach ($allocations as $allocation) {
                DB::insert(
                    <<<'SQL'
                        insert into roadops.equipment_reservations (
                          plan_item_id, equipment_requirement_id, equipment_unit_id,
                          reserved_window, allocated_quantity, unit, status, reserved_by
                        ) values (?, ?, ?, ?::tstzrange, ?::numeric, ?, 'reserved', ?)
                    SQL,
                    [
                        $requirement->plan_item_id,
                        $requirement->requirement_id,
                        $allocation['equipmentUnitId'],
                        $requirement->scheduled_window,
                        $allocation['allocatedQuantity'],
                        $requirement->unit,
                        $actorId,
                    ],
                );
            }
        }
    }

    /** @param list<string> $quantities */
    private function sumDecimalQuantities(array $quantities): string
    {
        $micros = 0;
        foreach ($quantities as $quantity) {
            if (! preg_match('/^(\d+)\.(\d{6})$/', $quantity, $matches)) {
                return '-1.000000';
            }
            $whole = ltrim($matches[1], '0');
            $whole = $whole === '' ? '0' : $whole;
            if (strlen($whole) > 12) {
                return '-1.000000';
            }
            $micros += ((int) $whole * 1_000_000) + (int) $matches[2];
        }

        return intdiv($micros, 1_000_000).'.'.str_pad(
            (string) ($micros % 1_000_000),
            6,
            '0',
            STR_PAD_LEFT,
        );
    }

    private function equipmentUnitNeedsConversion(string $unit): bool
    {
        return ! in_array(mb_strtolower(trim($unit), 'UTF-8'), [
            'machine_minute', 'machine_hour',
        ], true);
    }

    private function allocateMaterials(string $runId, string $divisionId, string $actorId): void
    {
        // Multiple IQN norm lines may refer to the same approved catalog
        // material. Aggregate those lines first because a plan item has one
        // reservation row per material and stock location.
        $requirements = DbRows::select(
            <<<'SQL'
                select pi.id plan_item_id,
                       (array_agg(pr.id order by nl.source_line_number, pr.id))[1] requirement_id,
                       nl.resource_id, pr.unit,
                       sum(pr.required_quantity)::text required_quantity,
                       min(nl.source_line_number) first_source_line
                from roadops.plan_items pi
                join roadops.plan_resource_requirements pr on pr.plan_item_id = pi.id
                join roadops.iqn_norm_lines nl on nl.id = pr.norm_line_id
                where pi.planning_run_id = ? and pr.resource_kind = 'material'
                  and not exists (
                    select 1 from roadops.planning_blockers b
                    where b.plan_item_id = pi.id and b.resolved_at is null
                      and b.blocker_code not in (
                        'LABOR_ASSIGNMENT_INCOMPLETE', 'WORK_TEMPLATE_CREW_INCOMPLETE',
                        'EQUIPMENT_RESERVATION_INCOMPLETE', 'MATERIAL_RESERVATION_INCOMPLETE',
                        'SAFETY_STAFF_SHORTAGE', 'SAFETY_EQUIPMENT_SHORTAGE',
                        'FULL_CLOSURE_PERMIT_REQUIRED'
                      )
                  )
                group by pi.id, pi.formula_inputs, nl.resource_id, pr.unit
                order by (pi.formula_inputs ->> 'selectionOrder')::integer,
                         first_source_line, nl.resource_id, pr.unit
            SQL,
            [$runId],
        );

        foreach ($requirements as $requirement) {
            DB::insert(
                <<<'SQL'
                    with parameters as (
                      select ?::uuid plan_item_id, ?::uuid requirement_id,
                             ?::uuid division_id, ?::uuid resource_id,
                             ?::text unit, ?::numeric required_quantity,
                             ?::uuid actor_id
                    ), stock as (
                      select m.id material_id, m.code material_code,
                             sl.id stock_location_id, sl.code stock_location_code,
                             greatest(
                               sum(tx.quantity_delta) - coalesce((
                                 select sum(reservation.quantity)
                                 from roadops.material_reservations reservation
                                 where reservation.material_id = m.id
                                   and reservation.stock_location_id = sl.id
                                   and reservation.status = 'reserved'
                               ), 0),
                               0
                             )::numeric available_quantity
                      from parameters p
                      join roadops.materials m
                        on m.iqn_resource_id = p.resource_id and m.unit = p.unit and m.active
                      join roadops.stock_locations sl
                        on sl.division_id = p.division_id and sl.active
                      join roadops.inventory_transactions tx
                        on tx.material_id = m.id
                       and tx.stock_location_id = sl.id
                      where not exists (
                        select 1 from roadops.material_reservations existing
                        where existing.plan_item_id = p.plan_item_id
                          and existing.material_id = m.id
                          and existing.stock_location_id = sl.id
                      )
                      group by m.id, m.code, sl.id, sl.code
                    ), ordered_stock as (
                      select stock.*,
                             coalesce(sum(available_quantity) over (
                               order by material_code, stock_location_code, material_id, stock_location_id
                               rows between unbounded preceding and 1 preceding
                             ), 0)::numeric available_before
                      from stock
                      where available_quantity > 0
                    )
                    insert into roadops.material_reservations (
                      plan_item_id, material_requirement_id, stock_location_id,
                      material_id, quantity, status, reserved_by
                    )
                    select p.plan_item_id, p.requirement_id, stock.stock_location_id,
                           stock.material_id,
                           least(
                             stock.available_quantity,
                             greatest(p.required_quantity - stock.available_before, 0)
                           )::numeric(20,6),
                           'reserved', p.actor_id
                    from parameters p
                    join ordered_stock stock on stock.available_before < p.required_quantity
                    where least(
                      stock.available_quantity,
                      greatest(p.required_quantity - stock.available_before, 0)
                    ) > 0
                    order by stock.material_code, stock.stock_location_code,
                             stock.material_id, stock.stock_location_id
                SQL,
                [
                    $requirement->plan_item_id,
                    $requirement->requirement_id,
                    $divisionId,
                    $requirement->resource_id,
                    $requirement->unit,
                    $requirement->required_quantity,
                    $actorId,
                ],
            );
        }
    }

    /** @param list<string>|null $allowedWorkerIds */
    private function allocateSafety(
        string $planItemId,
        string $divisionId,
        string $actorId,
        ?array $allowedWorkerIds,
    ): void {
        $workerIds = $allowedWorkerIds === null ? null : '{'.implode(',', $allowedWorkerIds).'}';
        $staffRequirements = DbRows::select(
            <<<'SQL'
                select requirement.id, requirement.qualification_code,
                       requirement.required_quantity::integer required_workers,
                       requirement.required_minutes::integer required_minutes,
                       pi.scheduled_window::text scheduled_window,
                       (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date work_date
                from roadops.plan_items pi
                join roadops.safety_scheme_requirements requirement
                  on requirement.safety_scheme_id = pi.safety_scheme_id
                 and requirement.requirement_kind = 'staff'
                where pi.id = ? and pi.scheduled_window is not null
                order by requirement.resource_code, requirement.id
            SQL,
            [$planItemId],
        );
        foreach ($staffRequirements as $requirement) {
            $workers = DbRows::select(
                <<<'SQL'
                    select w.id
                    from roadops.workers w
                    join roadops.worker_versions profile on profile.worker_id = w.id
                      and profile.employment_state = 'active'
                      and profile.valid_from <= lower(?::tstzrange)
                      and (profile.valid_until is null or profile.valid_until > lower(?::tstzrange))
                    join roadops.worker_division_assignments assignment
                      on assignment.worker_id = w.id and assignment.division_id = ?
                     and assignment.valid_from <= ?::date
                     and (assignment.valid_until is null or assignment.valid_until > ?::date)
                    join roadops.worker_qualification_versions qualification
                      on qualification.worker_id = w.id and qualification.qualification_code = ?
                     and qualification.valid_from <= lower(?::tstzrange)
                     and (qualification.valid_until is null
                          or qualification.valid_until > lower(?::tstzrange))
                    left join lateral (
                      select case when wa.availability_code = 'available'
                                  then wa.available_minutes else 0 end available_minutes
                      from roadops.worker_availability wa
                      where wa.worker_id = w.id and wa.work_date = ?::date and wa.retired_at is null
                      order by wa.source_updated_at desc nulls last, wa.recorded_at desc, wa.id desc limit 1
                    ) availability on true
                    left join lateral (
                      select coalesce(sum(minutes), 0)::integer planned_minutes from (
                        select work.planned_minutes::integer minutes
                        from roadops.work_assignments work
                        where work.worker_id = w.id and work.work_date = ?::date
                          and work.status <> 'cancelled'
                        union all
                        select safety.planned_minutes::integer
                        from roadops.safety_staff_assignments safety
                        where safety.worker_id = w.id and safety.work_date = ?::date
                          and safety.status <> 'cancelled'
                      ) reservations
                    ) used on true
                    where (?::uuid[] is null or w.id = any(?::uuid[])) and w.retired_at is null
                      and least(420, coalesce(availability.available_minutes, 0))
                          - coalesce(used.planned_minutes, 0) >= ?
                      and not exists (
                        select 1 from roadops.work_assignments work
                        where work.worker_id = w.id and work.status <> 'cancelled'
                          and work.scheduled_window && ?::tstzrange
                      )
                      and not exists (
                        select 1 from roadops.safety_staff_assignments safety
                        where safety.worker_id = w.id and safety.status <> 'cancelled'
                          and safety.scheduled_window && ?::tstzrange
                      )
                    order by profile.personnel_number, w.id
                    limit ?
                SQL,
                [
                    $requirement->scheduled_window,
                    $requirement->scheduled_window,
                    $divisionId,
                    $requirement->work_date,
                    $requirement->work_date,
                    $requirement->qualification_code,
                    $requirement->scheduled_window,
                    $requirement->scheduled_window,
                    $requirement->work_date,
                    $requirement->work_date,
                    $requirement->work_date,
                    $workerIds,
                    $workerIds,
                    $requirement->required_minutes,
                    $requirement->scheduled_window,
                    $requirement->scheduled_window,
                    $requirement->required_workers,
                ],
            );
            foreach ($workers as $worker) {
                DB::insert(
                    <<<'SQL'
                        insert into roadops.safety_staff_assignments (
                          plan_item_id, requirement_id, worker_id, work_date,
                          scheduled_window, planned_minutes, status, assigned_by
                        ) values (?, ?, ?, ?::date, ?::tstzrange, ?, 'scheduled', ?)
                    SQL,
                    [
                        $planItemId,
                        $requirement->id,
                        $worker->id,
                        $requirement->work_date,
                        $requirement->scheduled_window,
                        $requirement->required_minutes,
                        $actorId,
                    ],
                );
            }
        }

        $inventoryRequirements = DbRows::select(
            <<<'SQL'
                select requirement.id, requirement.requirement_kind,
                       requirement.resource_code, requirement.required_quantity,
                       requirement.unit, pi.scheduled_window::text scheduled_window
                from roadops.plan_items pi
                join roadops.safety_scheme_requirements requirement
                  on requirement.safety_scheme_id = pi.safety_scheme_id
                 and requirement.requirement_kind in ('sign', 'cone', 'barrier')
                where pi.id = ? and pi.scheduled_window is not null
                order by requirement.requirement_kind, requirement.resource_code, requirement.id
            SQL,
            [$planItemId],
        );
        foreach ($inventoryRequirements as $requirement) {
            DB::insert(
                <<<'SQL'
                    insert into roadops.safety_resource_reservations (
                      plan_item_id, requirement_id, inventory_id, reserved_window,
                      quantity, status, reserved_by
                    )
                    select ?, ?, inventory.id, ?::tstzrange,
                           least(
                             ?::numeric,
                             greatest(inventory.available_quantity - coalesce(reserved.quantity, 0), 0)
                           ),
                           'reserved', ?
                    from roadops.safety_resource_inventory inventory
                    left join lateral (
                      select sum(existing.quantity)::numeric quantity
                      from roadops.safety_resource_reservations existing
                      where existing.inventory_id = inventory.id
                        and existing.status in ('reserved', 'checked_out')
                        and existing.reserved_window && ?::tstzrange
                    ) reserved on true
                    where inventory.division_id = ? and inventory.active
                      and inventory.resource_kind = ? and inventory.resource_code = ?
                      and inventory.unit = ?
                      and greatest(inventory.available_quantity - coalesce(reserved.quantity, 0), 0) > 0
                    order by inventory.resource_code, inventory.id
                    limit 1
                SQL,
                [
                    $planItemId,
                    $requirement->id,
                    $requirement->scheduled_window,
                    $requirement->required_quantity,
                    $actorId,
                    $requirement->scheduled_window,
                    $divisionId,
                    $requirement->requirement_kind,
                    $requirement->resource_code,
                    $requirement->unit,
                ],
            );
        }
    }

    private function rebuildAllBlockers(string $runId): void
    {
        DbRows::select('select * from roadops.rebuild_plan_blockers(?)', [$runId]);
        DbRows::select('select * from roadops.rebuild_plan_safety_blockers(?)', [$runId]);
        DbRows::select('select roadops.add_equipment_operator_blockers(?)', [$runId]);
    }

    /** @return array<string, mixed> */
    private function previewPayload(
        string $runId,
        string $dateFrom,
        string $dateTo,
        AuthContext $context,
    ): array {
        $blockerRows = DbRows::select(
            <<<'SQL'
                select b.blocker_code, b.details,
                       pi.formula_inputs ->> 'candidateId' candidate_id
                from roadops.planning_blockers b
                left join roadops.plan_items pi on pi.id = b.plan_item_id
                where b.planning_run_id = ? and b.resolved_at is null
                order by coalesce((pi.formula_inputs ->> 'selectionOrder')::integer, 2147483647), b.blocker_code
            SQL,
            [$runId],
        );
        $jobs = DbRows::select(
            <<<'SQL'
                select pi.formula_inputs ->> 'candidateId' candidate_id,
                       pi.formula_inputs ->> 'workName' work_name,
                       (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date scheduled_date,
                       (select string_agg(distinct wv.full_name, ', ' order by wv.full_name)
                          from roadops.work_assignments wa
                          join roadops.worker_versions wv on wv.worker_id = wa.worker_id and wv.valid_until is null
                         where wa.plan_item_id = pi.id and wa.status <> 'cancelled') team_name,
                       coalesce((select sum(pr.required_minutes) from roadops.plan_resource_requirements pr
                                  where pr.plan_item_id = pi.id and pr.resource_kind = 'labor'), 0) labor_minutes,
                       coalesce((select jsonb_agg(distinct pr.resource_code order by pr.resource_code)
                                  from roadops.plan_resource_requirements pr
                                  where pr.plan_item_id = pi.id and pr.resource_kind = 'equipment'), '[]'::jsonb) equipment,
                       coalesce((select jsonb_agg(jsonb_build_object(
                                    'name', pr.resource_code, 'quantity', pr.required_quantity::text, 'unit', pr.unit
                                  ) order by pr.resource_code)
                                  from roadops.plan_resource_requirements pr
                                  where pr.plan_item_id = pi.id and pr.resource_kind in ('material', 'safety')), '[]'::jsonb) materials
                from roadops.plan_items pi
                where pi.planning_run_id = ?
                order by (pi.formula_inputs ->> 'selectionOrder')::integer
            SQL,
            [$runId],
        );
        $run = DbRows::selectOne(
            <<<'SQL'
                select run.status, run.created_by, run.planning_mode, run.created_at,
                       creator.full_name created_by_name,
                       roadops.has_permission('planning.approve', run.division_id) can_approve_permission
                from roadops.planning_runs run
                join roadops.app_users creator on creator.id = run.created_by
                where run.id = ?
            SQL,
            [$runId],
        );
        if ($run === null) {
            throw new \RuntimeException('Planning preview disappeared.');
        }
        $scheme = DbRows::selectOne(
            <<<'SQL'
                select ss.id, ss.scheme_kind, ss.name,
                       coalesce(nullif(ss.instructions ->> 'description', ''), ss.name) description,
                       coalesce(sum(requirement.required_quantity) filter (where requirement.requirement_kind = 'staff'), 0)::integer required_safety_workers,
                       coalesce(sum(requirement.required_quantity) filter (where requirement.requirement_kind = 'sign'), 0)::integer required_signs,
                       coalesce(sum(requirement.required_quantity) filter (where requirement.requirement_kind = 'cone'), 0)::integer required_cones,
                       coalesce(sum(requirement.required_quantity) filter (where requirement.requirement_kind = 'barrier'), 0)::integer required_barriers
                from roadops.plan_items pi
                join roadops.safety_schemes ss on ss.id = pi.safety_scheme_id
                left join roadops.safety_scheme_requirements requirement
                  on requirement.safety_scheme_id = ss.id
                where pi.planning_run_id = ?
                group by ss.id
                order by ss.id
                limit 1
            SQL,
            [$runId],
        );
        $workerRows = DbRows::select(
            <<<'SQL'
                with relevant_workers as (
                  select assignment.worker_id,
                         assignment.work_date,
                         assignment.planned_minutes::integer assigned_minutes
                  from roadops.work_assignments assignment
                  join roadops.plan_items pi on pi.id = assignment.plan_item_id
                  where pi.planning_run_id = ? and assignment.status <> 'cancelled'
                  union all
                  select assignment.worker_id,
                         assignment.work_date,
                         assignment.planned_minutes::integer
                  from roadops.safety_staff_assignments assignment
                  join roadops.plan_items pi on pi.id = assignment.plan_item_id
                  where pi.planning_run_id = ? and assignment.status <> 'cancelled'
                ), per_day as (
                  select worker_id, work_date, sum(assigned_minutes)::integer assigned_minutes
                  from relevant_workers group by worker_id, work_date
                ), balances as (
                  select day.worker_id, day.assigned_minutes,
                         least(420, coalesce(availability.available_minutes, 0))::integer before_minutes,
                         greatest(
                           least(420, coalesce(availability.available_minutes, 0)) - day.assigned_minutes,
                           0
                         )::integer remaining_minutes
                  from per_day day
                  left join lateral (
                    select case when wa.availability_code = 'available'
                                then wa.available_minutes else 0 end available_minutes
                    from roadops.worker_availability wa
                    where wa.worker_id = day.worker_id and wa.work_date = day.work_date
                      and wa.retired_at is null
                    order by wa.source_updated_at desc nulls last, wa.recorded_at desc, wa.id desc limit 1
                  ) availability on true
                )
                select balances.worker_id, profile.full_name,
                       min(balances.before_minutes)::integer before_minutes,
                       max(balances.assigned_minutes)::integer assigned_minutes,
                       min(balances.remaining_minutes)::integer remaining_minutes
                from balances
                join roadops.worker_versions profile
                  on profile.worker_id = balances.worker_id and profile.valid_until is null
                group by balances.worker_id, profile.full_name, profile.personnel_number
                order by profile.personnel_number, balances.worker_id
            SQL,
            [$runId, $runId],
        );
        $resourceTotals = DbRows::selectOne(
            <<<'SQL'
                select
                  (select count(*) from roadops.plan_resource_requirements requirement
                    join roadops.plan_items pi on pi.id = requirement.plan_item_id
                    where pi.planning_run_id = ? and requirement.resource_kind = 'labor') labor_required,
                  (select count(*) from roadops.work_assignments assignment
                    join roadops.plan_items pi on pi.id = assignment.plan_item_id
                    where pi.planning_run_id = ? and assignment.status <> 'cancelled') labor_assigned,
                  (select count(*) from roadops.plan_resource_requirements requirement
                    join roadops.plan_items pi on pi.id = requirement.plan_item_id
                    where pi.planning_run_id = ? and requirement.resource_kind = 'equipment') equipment_required,
                  (select count(*) from (
                    select requirement.id
                    from roadops.plan_resource_requirements requirement
                    join roadops.plan_items pi on pi.id = requirement.plan_item_id
                    left join roadops.equipment_reservations reservation
                      on reservation.equipment_requirement_id = requirement.id
                     and reservation.status in ('reserved', 'checked_out')
                    where pi.planning_run_id = ? and requirement.resource_kind = 'equipment'
                    group by requirement.id, requirement.required_quantity
                    having coalesce(sum(reservation.allocated_quantity), 0) >= requirement.required_quantity
                  ) complete) equipment_available,
                  (select count(*) from roadops.plan_resource_requirements requirement
                    join roadops.plan_items pi on pi.id = requirement.plan_item_id
                    where pi.planning_run_id = ? and requirement.resource_kind = 'material') material_required,
                  (select count(*) from (
                    select requirement.id
                    from roadops.plan_resource_requirements requirement
                    join roadops.plan_items pi on pi.id = requirement.plan_item_id
                    left join roadops.material_reservations reservation
                      on reservation.material_requirement_id = requirement.id
                     and reservation.status = 'reserved'
                    where pi.planning_run_id = ? and requirement.resource_kind = 'material'
                    group by requirement.id, requirement.required_quantity
                    having coalesce(sum(reservation.quantity), 0) >= requirement.required_quantity
                  ) complete) material_available,
                  (select count(*) from roadops.safety_scheme_requirements requirement
                    where requirement.safety_scheme_id = (
                      select pi.safety_scheme_id from roadops.plan_items pi
                      where pi.planning_run_id = ? order by pi.id limit 1
                    )) safety_required
            SQL,
            [$runId, $runId, $runId, $runId, $runId, $runId, $runId],
        );
        $resourceChecks = $this->resourceChecks($blockerRows, $resourceTotals);
        $state = match ((string) $run->status) {
            'approved' => 'APPROVED',
            'published' => 'PUBLISHED',
            default => 'AWAITING_APPROVAL',
        };
        $resourcesReady = $blockerRows === [] && $jobs !== []
            && ! array_filter(
                $resourceChecks,
                static fn (array $check): bool => ! (bool) $check['sufficient'],
            );

        return [
            'draftId' => $runId,
            'state' => $state,
            'dateFrom' => $dateFrom,
            'dateTo' => $dateTo,
            'planningMode' => strtoupper((string) $run->planning_mode),
            'createdByName' => (string) $run->created_by_name,
            'createdAt' => (string) $run->created_at,
            'jobs' => array_map(fn (stdClass $row): array => [
                'candidateId' => (string) $row->candidate_id,
                'workName' => (string) $row->work_name,
                'scheduledDate' => $row->scheduled_date === null ? null : (string) $row->scheduled_date,
                'teamName' => $row->team_name === null ? null : (string) $row->team_name,
                'laborHours' => number_format((int) $row->labor_minutes / 60, 2, '.', ''),
                'equipment' => $this->jsonArray($row->equipment),
                'materials' => $this->jsonArray($row->materials),
            ], $jobs),
            'blockers' => array_map(fn (stdClass $row): array => $this->blockerPayload($row), $blockerRows),
            'resourceChecks' => $resourceChecks,
            'workerMinutesRemaining' => array_map(static fn (stdClass $worker): array => [
                'workerId' => (string) $worker->worker_id,
                'fullName' => (string) $worker->full_name,
                'beforeMinutes' => (int) $worker->before_minutes,
                'assignedMinutes' => (int) $worker->assigned_minutes,
                'remainingMinutes' => (int) $worker->remaining_minutes,
            ], $workerRows),
            'safetyScheme' => $scheme === null ? null : $this->safetySchemePayload($scheme),
            'resourcesReady' => $resourcesReady,
            'canApprove' => $resourcesReady && (string) $run->status === 'evaluated'
                && (bool) $run->can_approve_permission && (string) $run->created_by !== $context->userId,
            'canPublish' => $resourcesReady && (string) $run->status === 'approved'
                && (bool) $run->can_approve_permission,
        ];
    }

    /** @return array<string, mixed> */
    private function blockerPayload(stdClass $row): array
    {
        $code = (string) $row->blocker_code;
        [$title, $explanation, $resolution] = match ($code) {
            'PLAN_EMPTY' => [
                'Rejada ish yo‘q',
                'Rejalashtirish hisobiga birorta ham ish yozuvi kiritilmagan.',
                'Kamida bitta tekshirilgan nuqson yoki tasdiqlangan yillik dastur bandini tanlang.',
            ],
            'ROAD_SOURCE_VERSION_UNAVAILABLE' => [
                'Yo‘lning YTP manba versiyasi topilmadi',
                'Reja hisoblangan vaqt uchun yo‘l va uni boshqaruvchi bo‘limning amaldagi YTP yozuvi yo‘q.',
                'YTP sinxronlashuvini va yo‘lning bo‘limga biriktirilgan davrini tekshiring.',
            ],
            'ROAD_ASSIGNMENT_MISSING' => [
                'Yo‘l zonasi YTP bo‘limiga biriktirilmagan',
                'Ishning aniq kilometr oralig‘i uchun amaldagi YTP bo‘lim biriktiruvi topilmadi.',
                'YTPdagi yo‘l–bo‘lim biriktiruvini tuzating va ma’lumotni qayta sinxronlang.',
            ],
            'ROAD_ASSIGNMENT_AMBIGUOUS' => [
                'Yo‘l zonasi bir nechta bo‘lim oralig‘iga tushmoqda',
                'Ish zonasi bitta amaldagi YTP bo‘lim kesimi ichida to‘liq joylashmagan.',
                'Ishni bo‘lim chegaralari bo‘yicha aniq kesimlarga ajrating.',
            ],
            'ROAD_ASSIGNMENT_DIVISION_MISMATCH' => [
                'Yo‘l zonasi boshqa YTP bo‘limiga tegishli',
                'Ish zonasi reja ochilgan bo‘limdan boshqa amaldagi YTP bo‘limiga biriktirilgan.',
                'Rejani to‘g‘ri yo‘l bo‘limida qayta tuzing yoki YTP biriktiruvini tuzating.',
            ],
            'DEFECT_NOT_PLANNABLE' => [
                'Nuqson rejalashtirishga yopiq',
                'Nuqson holati ochiq yoki avval rejalashtirilgan holatlardan birida emas.',
                'Nuqson ish jarayonini tekshiring; yopilgan yozuvdan yangi reja tuzmang.',
            ],
            'ANNUAL_PROGRAM_NOT_APPROVED' => [
                'Yillik dastur tasdiqlanmagan',
                'Ish bandi tasdiqlangan yillik saqlash dasturiga tegishli emas.',
                'Yillik dastur bo‘yicha ko‘rib chiqish va tasdiqlash jarayonini yakunlang.',
            ],
            'IQN_WORK_VARIANT_MISSING', 'IQN_MAPPING_NOT_APPROVED' => [
                'Tasdiqlangan IQN mosligi yo‘q',
                'Nuqson turi uchun amaldagi va tasdiqlangan IQN ish varianti topilmadi.',
                'Soha egasi nuqson–IQN mosligini tekshirib, tasdiqlashi kerak.',
            ],
            'IQN_VARIANT_NOT_AUTOMATICALLY_PLANNABLE' => [
                'IQN varianti avtomatik hisobga ruxsat bermaydi',
                'IQN talqini tasdiqlanmagan yoki uning rejalashtirish holati avtomatik emas.',
                'IQN ekspert tekshiruvini tugating yoki bandni qo‘lda rejalashtiring.',
            ],
            'IQN_APPROVED_NORM_SET_MISSING', 'IQN_NORM_LINES_MISSING' => [
                'Amaldagi IQN norma tarkibi yo‘q',
                'Tanlangan sana uchun tasdiqlangan norma to‘plami yoki uning resurs satrlari topilmadi.',
                'Manba sahifa va jadval dalili bilan IQN norma variantini tasdiqlang.',
            ],
            'IQN_FORMULA_ENGINE_INPUT_REQUIRED', 'IQN_INCREMENT_FORMULA_INCOMPLETE',
            'IQN_FIXED_PERIOD_INPUT_INCOMPLETE' => [
                'IQN formula kirishlari to‘liq emas',
                'Ushbu norma formulasi uchun zarur bazis, qadam yoki davr qiymati yetishmaydi.',
                'Ekspert tasdiqlagan formula parametrlarini va reja davrini to‘ldiring.',
            ],
            'RESOURCE_SNAPSHOT_INCOMPLETE' => [
                'IQN resurs hisobi to‘liq olinmadi',
                'Norma satrlari soni reja uchun muzlatilgan resurs hisoblari bilan teng emas.',
                'Norma satrlaridagi miqdor va formula qiymatlarini tekshirib, hisobni qayta bajaring.',
            ],
            'WORK_QUANTITY_MISSING', 'WORK_UNIT_MISMATCH' => [
                'Aniq ish hajmi yoki birligi mos emas',
                'Norma hisoblash uchun hajm va IQN bazis birligi bir-biriga mos bo‘lishi shart.',
                'Dalil o‘lchovini va o‘lchov birligini tekshiring.',
            ],
            'SCHEDULE_WINDOW_MISSING', 'SCHEDULE_OUTSIDE_PLAN_WINDOW' => [
                'Ish sanasi reja oralig‘iga mos emas',
                'Ish vaqti belgilanmagan yoki tanlangan rejalashtirish davridan tashqarida.',
                'Ish sanasini reja oralig‘i ichidan tanlab, qayta hisoblang.',
            ],
            'SAFETY_SCHEME_MISSING' => [
                'Harakat xavfsizligi sxemasi yo‘q',
                'Tanlangan sana va yo‘l bo‘limi uchun tasdiqlangan ish zonasi sxemasi topilmadi.',
                'Amaldagi xavfsizlik sxemasini tasdiqlang va ishga biriktiring.',
            ],
            'SAFETY_SCHEME_TYPE_UNSUPPORTED' => [
                'Harakat xavfsizligi sxemasi turi to‘liq emas',
                'Sxema tasdiqlangan bo‘lsa ham uning operatsion turi belgilanmagan.',
                'Sxemani beshta qo‘llab-quvvatlanadigan ish zonasi turidan biriga bog‘lang.',
            ],
            'FULL_CLOSURE_PERMIT_REQUIRED' => [
                'Yo‘lni yopish ruxsatnomasi yo‘q',
                'Yo‘lni to‘liq yopish sxemasi vakolatli organning ruxsatnoma raqamisiz rejalashtirilmaydi.',
                'Ruxsatnoma raqamini kiriting va rejani qayta hisoblang.',
            ],
            'SAFETY_STAFF_SHORTAGE' => [
                'Harakat xavfsizligi xodimlari yetishmaydi',
                'Sxemadagi malaka va ish vaqti talabini tanlangan xodimlar to‘liq qoplamaydi.',
                'Mos malakali xavfsizlik xodimlarini 420 daqiqalik limit doirasida biriktiring.',
            ],
            'SAFETY_EQUIPMENT_SHORTAGE' => [
                'Yo‘l belgisi yoki to‘siq inventari yetishmaydi',
                'Tasdiqlangan sxema talab qilgan belgilar, konuslar yoki to‘siqlar to‘liq rezerv qilinmagan.',
                'Bo‘lim inventarini va shu vaqt oralig‘idagi bandlikni tekshiring.',
            ],
            'WORK_TEMPLATE_MISSING' => [
                'Tasdiqlangan brigada malaka shabloni yo‘q',
                'IQN mehnat vaqtini xodimlarga taqsimlash uchun ekspert tasdiqlagan malaka tarkibi topilmadi.',
                'Ish varianti uchun malaka kodi va zarur xodimlar sonini ikki bosqichli tartibda tasdiqlang.',
            ],
            'EQUIPMENT_OPERATOR_SKILL_MISSING' => [
                'Tasdiqlangan texnika operatori malakasi yo‘q',
                'IQN texnika talab qiladi, lekin ushbu ish turi uchun amaldagi operator malaka shabloni tasdiqlanmagan.',
                'Texnika operatori malaka kodi va zarur operatorlar sonini ikki bosqichli tartibda tasdiqlang.',
            ],
            'LABOR_ASSIGNMENT_INCOMPLETE', 'WORK_TEMPLATE_CREW_INCOMPLETE', 'WORKER_NOT_ELIGIBLE' => [
                'Ishchi yoki malaka yetishmaydi',
                'IQN bo‘yicha talab etilgan mehnat hajmi mos malakali ishchilarga to‘liq biriktirilmagan.',
                'Smena, malaka va 420 daqiqalik kunlik chegarani hisobga olib brigada biriktiring.',
            ],
            'EQUIPMENT_RESERVATION_INCOMPLETE', 'EQUIPMENT_CATALOG_MAPPING_MISMATCH',
            'EQUIPMENT_CAPACITY_INSUFFICIENT' => [
                'Texnika band qilinmagan',
                'IQN texnika ehtiyoji uchun mos katalogga bog‘langan, bo‘sh va soz texnika to‘liq ajratilmagan.',
                'Texnika–IQN katalog bog‘lanishi, bandlik davri, nosozlik va operator mavjudligini tekshiring.',
            ],
            'EQUIPMENT_UNIT_CONVERSION_REQUIRED' => [
                'Texnika norma birligi talqin qilinmagan',
                'IQN texnika miqdorini ish oynasi quvvatiga o‘girish uchun tasdiqlangan birlik konversiyasi yo‘q.',
                'Norma birligini mashina-soat yoki mashina-daqiqaga ekspert tomonidan tasdiqlangan tarzda moslang.',
            ],
            'MATERIAL_RESERVATION_INCOMPLETE', 'MATERIAL_CATALOG_MAPPING_MISMATCH' => [
                'Material rezervi yetishmaydi',
                'Mos IQN katalog materialining ombordagi mavjud va band qilinmagan hajmi ehtiyojni qoplamaydi.',
                'Material–IQN bog‘lanishi, o‘lchov birligi va bo‘lim omborlari qoldig‘ini tekshiring.',
            ],
            'ROAD_ZONE_TIME_CONFLICT' => [
                'Ish zonalari to‘qnashmoqda',
                'Shu yo‘l va piket oralig‘ida bir vaqtda boshqa faol ish rejalashtirilgan.',
                'Sana yoki ish zonasini o‘zgartiring.',
            ],
            default => [
                'Rejalashtirish sharti bajarilmadi',
                'Tekshiruv qoidasi '.$code.' ushbu yozuvni tasdiqlashga to‘sqinlik qilmoqda.',
                'Integratsiya, norma va resurs ma’lumotlarini tekshirib, reja variantini qayta hisoblang.',
            ],
        };

        return [
            'code' => $code,
            'title' => $title,
            'explanation' => $explanation,
            'resolution' => $resolution,
            'candidateId' => $row->candidate_id === null ? null : (string) $row->candidate_id,
            'level' => 'BLOCKING',
        ];
    }

    /**
     * @param  list<stdClass>  $blockers
     * @return list<array<string, bool|string>>
     */
    private function resourceChecks(array $blockers, ?stdClass $totals): array
    {
        $codes = array_map(static fn (stdClass $blocker): string => (string) $blocker->blocker_code, $blockers);
        $hasAny = static fn (array $expected): bool => array_intersect($codes, $expected) !== [];
        $laborRequired = $totals === null ? 0 : (int) $totals->labor_required;
        $laborAssigned = $totals === null ? 0 : (int) $totals->labor_assigned;
        $equipmentRequired = $totals === null ? 0 : (int) $totals->equipment_required;
        $equipmentAvailable = $totals === null ? 0 : (int) $totals->equipment_available;
        $materialRequired = $totals === null ? 0 : (int) $totals->material_required;
        $materialAvailable = $totals === null ? 0 : (int) $totals->material_available;
        $safetyRequired = $totals === null ? 0 : (int) $totals->safety_required;

        return [
            [
                'kind' => 'WORKERS',
                'label' => 'Brigada malakasi',
                'required' => $laborRequired.' ta IQN mehnat talabi',
                'available' => $laborAssigned.' ta xodim biriktiruvi',
                'sufficient' => ! $hasAny([
                    'WORK_TEMPLATE_MISSING', 'WORK_TEMPLATE_CREW_INCOMPLETE',
                    'WORKER_NOT_ELIGIBLE', 'EQUIPMENT_OPERATOR_SKILL_MISSING',
                ]),
            ],
            [
                'kind' => 'WORKER_TIME',
                'label' => 'Kunlik ish vaqti',
                'required' => 'Har bir xodim uchun ko‘pi bilan 420 daqiqa',
                'available' => $laborAssigned.' ta amaldagi vaqt biriktiruvi',
                'sufficient' => ! $hasAny(['LABOR_ASSIGNMENT_INCOMPLETE', 'SAFETY_STAFF_SHORTAGE']),
            ],
            [
                'kind' => 'EQUIPMENT',
                'label' => 'Texnika rezervi',
                'required' => $equipmentRequired.' ta IQN texnika talabi',
                'available' => $equipmentAvailable.' ta talab to‘liq rezerv qilindi',
                'sufficient' => ! $hasAny([
                    'EQUIPMENT_RESERVATION_INCOMPLETE', 'EQUIPMENT_CATALOG_MAPPING_MISMATCH',
                    'EQUIPMENT_CAPACITY_INSUFFICIENT', 'EQUIPMENT_UNIT_CONVERSION_REQUIRED',
                ]),
            ],
            [
                'kind' => 'MATERIALS',
                'label' => 'Material rezervi',
                'required' => $materialRequired.' ta IQN material talabi',
                'available' => $materialAvailable.' ta talab to‘liq rezerv qilindi',
                'sufficient' => ! $hasAny([
                    'MATERIAL_RESERVATION_INCOMPLETE', 'MATERIAL_CATALOG_MAPPING_MISMATCH',
                ]),
            ],
            [
                'kind' => 'SAFETY_EQUIPMENT',
                'label' => 'Harakat xavfsizligi resurslari',
                'required' => $safetyRequired.' ta sxema talabi',
                'available' => $hasAny(['SAFETY_STAFF_SHORTAGE', 'SAFETY_EQUIPMENT_SHORTAGE'])
                    ? 'To‘liq emas'
                    : 'To‘liq ajratilgan',
                'sufficient' => ! $hasAny([
                    'SAFETY_SCHEME_MISSING', 'SAFETY_SCHEME_TYPE_UNSUPPORTED',
                    'SAFETY_STAFF_SHORTAGE', 'SAFETY_EQUIPMENT_SHORTAGE',
                ]),
            ],
            [
                'kind' => 'PERMIT',
                'label' => 'Yo‘lni yopish ruxsatnomasi',
                'required' => 'To‘liq yopish sxemasida majburiy',
                'available' => $hasAny(['FULL_CLOSURE_PERMIT_REQUIRED']) ? 'Kiritilmagan' : 'Talab bajarilgan',
                'sufficient' => ! $hasAny(['FULL_CLOSURE_PERMIT_REQUIRED']),
            ],
        ];
    }

    /** @return array<string, bool|int|string> */
    private function safetySchemePayload(stdClass $scheme): array
    {
        return [
            'id' => (string) $scheme->id,
            'code' => match ((string) $scheme->scheme_kind) {
                'shoulder_work' => 'ROAD_SHOULDER_WORK',
                'one_lane_closed' => 'SINGLE_LANE_CLOSURE',
                'half_road_closed' => 'HALF_ROAD_CLOSURE',
                'alternating_flow' => 'ALTERNATING_TRAFFIC',
                'full_closure_permit' => 'FULL_CLOSURE',
                default => throw new \DomainException('Unsupported safety scheme kind.'),
            },
            'name' => (string) $scheme->name,
            'description' => (string) $scheme->description,
            'requiredSafetyWorkers' => (int) $scheme->required_safety_workers,
            'requiredSigns' => (int) $scheme->required_signs,
            'requiredCones' => (int) $scheme->required_cones,
            'requiredBarriers' => (int) $scheme->required_barriers,
            'requiresPermit' => (string) $scheme->scheme_kind === 'full_closure_permit',
        ];
    }

    /** @return list<string> */
    private function pgTextArray(string $value): array
    {
        if ($value === '{}' || $value === '') {
            return [];
        }
        if (str_starts_with($value, '[')) {
            return array_values(array_map('strval', $this->jsonArray($value)));
        }

        $items = [];
        foreach (str_getcsv(trim($value, '{}'), ',', '"', '\\') as $item) {
            if (is_string($item) && $item !== '') {
                $items[] = $item;
            }
        }

        return $items;
    }

    private function assertSnapshotCurrent(string $runId): void
    {
        $run = DbRows::selectOne(
            <<<'SQL'
                select id, planning_mode, encode(input_snapshot_hash, 'hex') input_hash,
                       lower(planning_window)::text date_from,
                       (upper(planning_window) - 1)::text date_to
                from roadops.planning_runs where id = ?
            SQL,
            [$runId],
        );
        $inputs = DbRows::select(
            <<<'SQL'
                select input.entity_type, input.entity_id, input.source_version,
                       encode(input.payload_hash, 'hex') payload_hash,
                       pi.formula_inputs,
                       case input.entity_type
                         when 'defect_case' then (
                           select defect.updated_at::text from roadops.defect_cases defect
                           where defect.id = input.entity_id
                         )
                         when 'annual_program_item' then (
                           select annual.updated_at::text from roadops.annual_program_items annual
                           where annual.id = input.entity_id
                         )
                         when 'manual_work_request' then (
                           select manual.updated_at::text from roadops.manual_work_requests manual
                           where manual.id = input.entity_id
                         )
                         else null
                       end current_source_version
                from roadops.planning_run_inputs input
                left join roadops.plan_items pi
                  on pi.planning_run_id = input.planning_run_id
                 and (
                   (input.entity_type = 'defect_case' and pi.defect_case_id = input.entity_id)
                   or (input.entity_type = 'annual_program_item' and pi.annual_program_item_id = input.entity_id)
                   or (input.entity_type = 'manual_work_request' and pi.manual_work_request_id = input.entity_id)
                 )
                where input.planning_run_id = ?
                order by coalesce((pi.formula_inputs ->> 'selectionOrder')::integer, 2147483647), input.id
            SQL,
            [$runId],
        );
        $itemCount = (int) DB::scalar(
            "select count(*) from roadops.plan_items where planning_run_id = ? and status <> 'cancelled'",
            [$runId],
        );
        if ($run === null || $inputs === [] || count($inputs) !== $itemCount) {
            throw new \DomainException('PLAN_INPUT_SNAPSHOT_STALE');
        }

        $candidateIds = [];
        $manualInput = null;
        foreach ($inputs as $input) {
            $lockedSourceVersion = $this->lockInputSourceVersion(
                (string) $input->entity_type,
                (string) $input->entity_id,
            );
            if ($input->current_source_version === null || $lockedSourceVersion === null
                || ! hash_equals((string) $input->source_version, $lockedSourceVersion)
                || ! hash_equals((string) $input->current_source_version, $lockedSourceVersion)) {
                throw new \DomainException('PLAN_INPUT_SNAPSHOT_STALE');
            }
            $formula = json_decode((string) $input->formula_inputs, true, 512, JSON_THROW_ON_ERROR);
            if (! is_array($formula)) {
                throw new \DomainException('PLAN_INPUT_SNAPSHOT_STALE');
            }
            $candidateId = (string) ($formula['candidateId'] ?? '');
            $fingerprint = [
                'candidateId' => $candidateId,
                'selectionOrder' => (int) ($formula['selectionOrder'] ?? 0),
                'sourceReference' => (string) ($formula['sourceReference'] ?? ''),
                'workName' => (string) ($formula['workName'] ?? ''),
            ];
            if ($input->entity_type === 'manual_work_request') {
                if (! isset($formula['manualInput']) || ! is_array($formula['manualInput'])) {
                    throw new \DomainException('PLAN_INPUT_SNAPSHOT_STALE');
                }
                $manualInput = $this->canonicalManualInput($formula['manualInput']);
                if ($manualInput['sourceDefectId'] !== null) {
                    $sourceDefect = DbRows::selectOne(
                        <<<'SQL'
                            select updated_at::text source_version, road_id,
                                   iqn_topic_work_item_id topic_id, status,
                                   lower(chainage_span)::text source_chainage_start_m,
                                   upper(chainage_span)::text source_chainage_end_m,
                                   measured_quantity::text source_quantity,
                                   measurement_unit source_unit
                            from roadops.defect_cases where id = ? for share
                        SQL,
                        [$manualInput['sourceDefectId']],
                    );
                    if ($sourceDefect === null || (string) $sourceDefect->status !== 'open'
                        || (string) $sourceDefect->road_id !== $manualInput['roadId']
                        || (string) $sourceDefect->topic_id !== (string) $manualInput['sourceIqnTopicId']
                        || $manualInput['sourceChainageStartM'] === null
                        || $manualInput['sourceChainageEndM'] === null
                        || $manualInput['sourceQuantity'] === null
                        || $manualInput['sourceUnit'] === null
                        || ! (bool) DB::scalar(
                            'select (?::numeric, ?::numeric, ?::numeric)
                                  = (?::numeric, ?::numeric, ?::numeric)',
                            [
                                $manualInput['sourceChainageStartM'],
                                $manualInput['sourceChainageEndM'],
                                $manualInput['sourceQuantity'],
                                $sourceDefect->source_chainage_start_m,
                                $sourceDefect->source_chainage_end_m,
                                $sourceDefect->source_quantity,
                            ],
                        )
                        || $manualInput['sourceUnit'] !== (string) $sourceDefect->source_unit
                        || ! hash_equals(
                            (string) $sourceDefect->source_version,
                            (string) $manualInput['sourceDefectVersion'],
                        )) {
                        throw new \DomainException('PLAN_INPUT_SNAPSHOT_STALE');
                    }
                }
                $fingerprint['manualInput'] = $manualInput;
            }
            $expectedPayloadHash = hash('sha256', json_encode($fingerprint, JSON_THROW_ON_ERROR));
            if (! hash_equals((string) $input->payload_hash, $expectedPayloadHash)) {
                throw new \DomainException('PLAN_INPUT_SNAPSHOT_STALE');
            }
            $candidateIds[] = $candidateId;
        }

        if ((string) $run->planning_mode === 'manual') {
            if ($manualInput === null) {
                throw new \DomainException('PLAN_INPUT_SNAPSHOT_STALE');
            }
            $expectedInputHash = hash('sha256', json_encode($manualInput, JSON_THROW_ON_ERROR));
        } else {
            $horizon = (int) (DB::scalar(
                "select setting_value #>> '{}' from roadops.system_settings where setting_key = 'planning_horizon_days'",
            ) ?? 14);
            $expectedInputHash = hash('sha256', json_encode([
                'candidateIds' => $candidateIds,
                'dateFrom' => (string) $run->date_from,
                'dateTo' => (string) $run->date_to,
                'planningHorizonDays' => $horizon,
            ], JSON_THROW_ON_ERROR));
        }
        if (! hash_equals((string) $run->input_hash, $expectedInputHash)) {
            throw new \DomainException('PLAN_INPUT_SNAPSHOT_STALE');
        }

        $validItemCount = (int) DB::scalar(
            <<<'SQL'
                select count(*)
                from roadops.plan_items pi
                join roadops.planning_runs run on run.id = pi.planning_run_id
                join roadops.iqn_work_variants variant on variant.id = pi.work_variant_id
                join roadops.safety_schemes scheme on scheme.id = pi.safety_scheme_id
                where pi.planning_run_id = ? and pi.status <> 'cancelled'
                  and roadops.division_for_road_zone(
                        pi.road_id, pi.chainage_span, coalesce(lower(pi.scheduled_window), run.as_of)
                      ) = run.division_id
                  and variant.interpretation_status = 'approved'
                  and variant.planning_status = 'automatic'
                  and exists (
                    select 1 from roadops.iqn_norm_sets norm
                    where norm.work_variant_id = variant.id and norm.status = 'approved'
                      and norm.effective_from <= (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date
                      and (norm.effective_until is null
                           or norm.effective_until > (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date)
                  )
                  and not exists (
                    select 1
                    from roadops.plan_resource_requirements requirement
                    join roadops.iqn_norm_lines line on line.id = requirement.norm_line_id
                    where requirement.plan_item_id = pi.id
                      and line.norm_set_id is distinct from (
                        select active.id
                        from roadops.iqn_norm_sets active
                        where active.work_variant_id = variant.id and active.status = 'approved'
                          and active.effective_from <= (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date
                          and (active.effective_until is null
                               or active.effective_until > (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date)
                        order by active.effective_from desc, active.id
                        limit 1
                      )
                  )
                  and (
                    select count(*)
                    from roadops.iqn_norm_lines expected
                    where expected.norm_set_id = (
                      select active.id
                      from roadops.iqn_norm_sets active
                      where active.work_variant_id = variant.id and active.status = 'approved'
                        and active.effective_from <= (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date
                        and (active.effective_until is null
                             or active.effective_until > (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date)
                      order by active.effective_from desc, active.id
                      limit 1
                    )
                  ) = (
                    select count(*) from roadops.plan_resource_requirements actual
                    where actual.plan_item_id = pi.id
                  )
                  and scheme.division_id = run.division_id and scheme.status = 'approved'
                  and scheme.effective_from <= (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date
                  and (scheme.effective_until is null
                       or scheme.effective_until > (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date)
                  and (
                    (pi.defect_case_id is not null and exists (
                      select 1 from roadops.defect_cases defect
                      join roadops.defect_work_variant_crosswalks mapping
                        on mapping.defect_type_id = defect.defect_type_id
                       and mapping.work_variant_id = pi.work_variant_id
                       and mapping.status = 'approved'
                       and mapping.effective_from <= (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date
                       and (mapping.effective_until is null
                            or mapping.effective_until > (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date)
                      where defect.id = pi.defect_case_id and defect.status in ('open', 'planned')
                    ))
                    or (pi.annual_program_item_id is not null and exists (
                      select 1 from roadops.annual_program_items annual
                      join roadops.annual_programs program on program.id = annual.annual_program_id
                      where annual.id = pi.annual_program_item_id and program.status = 'approved'
                        and annual.work_variant_id = pi.work_variant_id
                        and annual.planned_quantity = pi.work_quantity
                        and annual.work_unit = pi.work_unit
                    ))
                    or (pi.manual_work_request_id is not null and exists (
                      select 1 from roadops.manual_work_requests manual
                      where manual.id = pi.manual_work_request_id and manual.status in ('draft', 'evaluated')
                        and manual.division_id = run.division_id and manual.road_id = pi.road_id
                        and manual.work_variant_id = pi.work_variant_id
                        and manual.safety_scheme_id = pi.safety_scheme_id
                        and manual.chainage_span = pi.chainage_span
                        and manual.work_quantity = pi.work_quantity and manual.work_unit = pi.work_unit
                        and manual.requested_date = (lower(pi.scheduled_window) at time zone 'Asia/Tashkent')::date
                        and manual.permit_reference is not distinct from pi.permit_reference
                    ))
                  )
            SQL,
            [$runId],
        );
        if ($validItemCount !== $itemCount) {
            throw new \DomainException('PLAN_INPUT_SNAPSHOT_STALE');
        }
    }

    private function assertLiveResourcesCurrent(string $runId): void
    {
        $run = DbRows::selectOne(
            'select division_id from roadops.planning_runs where id = ? for update',
            [$runId],
        );
        if ($run === null) {
            throw new \DomainException('PLAN_INPUT_SNAPSHOT_STALE');
        }
        $workerIds = DbRows::select(
            <<<'SQL'
                select distinct worker_id from (
                  select assignment.worker_id
                  from roadops.work_assignments assignment
                  join roadops.plan_items pi on pi.id = assignment.plan_item_id
                  where pi.planning_run_id = ? and assignment.status <> 'cancelled'
                  union
                  select assignment.worker_id
                  from roadops.safety_staff_assignments assignment
                  join roadops.plan_items pi on pi.id = assignment.plan_item_id
                  where pi.planning_run_id = ? and assignment.status <> 'cancelled'
                ) assigned_workers
                order by worker_id
            SQL,
            [$runId, $runId],
        );
        $equipmentIds = DbRows::select(
            <<<'SQL'
                select distinct reservation.equipment_unit_id
                from roadops.equipment_reservations reservation
                join roadops.plan_items pi on pi.id = reservation.plan_item_id
                where pi.planning_run_id = ?
                  and reservation.status in ('reserved', 'checked_out')
                order by reservation.equipment_unit_id
            SQL,
            [$runId],
        );
        $materialIds = DbRows::select(
            <<<'SQL'
                select distinct reservation.material_id, reservation.stock_location_id
                from roadops.material_reservations reservation
                join roadops.plan_items pi on pi.id = reservation.plan_item_id
                where pi.planning_run_id = ? and reservation.status = 'reserved'
                order by reservation.material_id, reservation.stock_location_id
            SQL,
            [$runId],
        );
        $safetyInventoryIds = DbRows::select(
            <<<'SQL'
                select distinct reservation.inventory_id
                from roadops.safety_resource_reservations reservation
                join roadops.plan_items pi on pi.id = reservation.plan_item_id
                where pi.planning_run_id = ?
                  and reservation.status in ('reserved', 'checked_out')
                order by reservation.inventory_id
            SQL,
            [$runId],
        );

        foreach ($workerIds as $worker) {
            DbRows::selectOne('select id from roadops.workers where id = ? for share', [$worker->worker_id]);
        }
        foreach ($equipmentIds as $equipment) {
            DbRows::selectOne('select id from roadops.equipment_units where id = ? for share', [$equipment->equipment_unit_id]);
        }
        foreach ($materialIds as $material) {
            DbRows::selectOne('select id from roadops.materials where id = ? for share', [$material->material_id]);
            DbRows::selectOne('select id from roadops.stock_locations where id = ? for share', [$material->stock_location_id]);
        }
        foreach ($safetyInventoryIds as $inventory) {
            DbRows::selectOne('select id from roadops.safety_resource_inventory where id = ? for share', [$inventory->inventory_id]);
        }

        $invalidCount = (int) DB::scalar(
            <<<'SQL'
                with run_items as (
                  select pi.*, run.division_id
                  from roadops.plan_items pi
                  join roadops.planning_runs run on run.id = pi.planning_run_id
                  where pi.planning_run_id = ? and pi.status = 'approved'
                ), active_worker_assignments as (
                  select 'work'::text assignment_kind, assignment.id,
                         assignment.plan_item_id, assignment.worker_id,
                         assignment.scheduled_window
                  from roadops.work_assignments assignment
                  where assignment.status <> 'cancelled'
                  union all
                  select 'safety'::text, assignment.id, assignment.plan_item_id,
                         assignment.worker_id, assignment.scheduled_window
                  from roadops.safety_staff_assignments assignment
                  where assignment.status <> 'cancelled'
                ), labor_totals as (
                  select item.id plan_item_id,
                         coalesce(sum(requirement.required_minutes), 0)::integer required_minutes,
                         coalesce((
                           select sum(assignment.planned_minutes)::integer
                           from roadops.work_assignments assignment
                           where assignment.plan_item_id = item.id and assignment.status <> 'cancelled'
                         ), 0) assigned_minutes
                  from run_items item
                  left join roadops.plan_resource_requirements requirement
                    on requirement.plan_item_id = item.id and requirement.resource_kind = 'labor'
                  group by item.id
                ), invalid_items as (
                  select item.id
                  from run_items item
                  join labor_totals labor on labor.plan_item_id = item.id
                  where labor.assigned_minutes < labor.required_minutes
                     or exists (
                       select 1
                       from roadops.work_variant_skill_requirements skill
                       where skill.work_variant_id = item.work_variant_id
                         and skill.status = 'approved'
                         and skill.effective_from <= (lower(item.scheduled_window) at time zone 'Asia/Tashkent')::date
                         and (skill.effective_until is null
                              or skill.effective_until > (lower(item.scheduled_window) at time zone 'Asia/Tashkent')::date)
                         and (
                           select count(distinct assignment.worker_id)
                           from roadops.work_assignments assignment
                           where assignment.plan_item_id = item.id
                             and assignment.skill_requirement_id = skill.id
                             and assignment.status <> 'cancelled'
                         ) < skill.worker_count
                     )
                     or exists (
                       select 1 from roadops.work_assignments assignment
                       join roadops.work_variant_skill_requirements skill
                         on skill.id = assignment.skill_requirement_id
                       where assignment.plan_item_id = item.id and assignment.status <> 'cancelled'
                         and (
                           roadops.division_for_worker_assignment(assignment.worker_id, assignment.work_date)
                             is distinct from item.division_id
                           or not exists (
                             select 1 from roadops.worker_versions profile
                             where profile.worker_id = assignment.worker_id
                               and profile.employment_state = 'active'
                               and profile.valid_from <= lower(assignment.scheduled_window)
                               and (profile.valid_until is null
                                    or profile.valid_until > lower(assignment.scheduled_window))
                           )
                           or not exists (
                             select 1 from roadops.worker_qualification_versions qualification
                             where qualification.worker_id = assignment.worker_id
                               and qualification.qualification_code = skill.qualification_code
                               and qualification.valid_from <= lower(assignment.scheduled_window)
                               and (qualification.valid_until is null
                                    or qualification.valid_until > lower(assignment.scheduled_window))
                           )
                         )
                     )
                     or exists (
                       select 1
                       from active_worker_assignments selected_assignment
                       where selected_assignment.plan_item_id = item.id
                         and selected_assignment.scheduled_window <> item.scheduled_window
                     )
                     or exists (
                       select 1
                       from active_worker_assignments selected_assignment
                       join active_worker_assignments overlap
                         on overlap.worker_id = selected_assignment.worker_id
                        and overlap.scheduled_window && selected_assignment.scheduled_window
                        and (overlap.assignment_kind, overlap.id)
                            <> (selected_assignment.assignment_kind, selected_assignment.id)
                       where selected_assignment.plan_item_id = item.id
                     )
                     or exists (
                       select 1 from (
                         select assignment.worker_id, assignment.work_date,
                                sum(assignment.planned_minutes)::integer assigned_minutes
                         from (
                           select work.worker_id, work.work_date, work.planned_minutes
                           from roadops.work_assignments work where work.status <> 'cancelled'
                           union all
                           select safety.worker_id, safety.work_date, safety.planned_minutes
                           from roadops.safety_staff_assignments safety where safety.status <> 'cancelled'
                         ) assignment
                         where assignment.worker_id in (
                           select work.worker_id from roadops.work_assignments work
                           where work.plan_item_id = item.id and work.status <> 'cancelled'
                           union
                           select safety.worker_id from roadops.safety_staff_assignments safety
                           where safety.plan_item_id = item.id and safety.status <> 'cancelled'
                         )
                         group by assignment.worker_id, assignment.work_date
                       ) daily
                       left join lateral (
                         select case when availability.availability_code = 'available'
                                     then availability.available_minutes else 0 end available_minutes
                         from roadops.worker_availability availability
                         where availability.worker_id = daily.worker_id
                           and availability.work_date = daily.work_date
                           and availability.retired_at is null
                         order by availability.source_updated_at desc nulls last,
                                  availability.recorded_at desc, availability.id desc limit 1
                       ) availability on true
                       where daily.assigned_minutes > least(420, coalesce(availability.available_minutes, 0))
                     )
                     or exists (
                       select 1 from roadops.plan_resource_requirements requirement
                       where requirement.plan_item_id = item.id and requirement.resource_kind = 'equipment'
                         and (
                           lower(requirement.unit) not in ('machine_minute', 'machine_hour')
                           or exists (
                             select 1
                             from roadops.equipment_reservations reservation
                             where reservation.equipment_requirement_id = requirement.id
                               and reservation.status in ('reserved', 'checked_out')
                               and (
                                 reservation.unit <> requirement.unit
                                 or reservation.reserved_window <> item.scheduled_window
                                 or reservation.allocated_quantity > case lower(requirement.unit)
                                   when 'machine_hour' then
                                     extract(epoch from (
                                       upper(reservation.reserved_window)
                                       - lower(reservation.reserved_window)
                                     )) / 3600
                                   when 'machine_minute' then
                                     extract(epoch from (
                                       upper(reservation.reserved_window)
                                       - lower(reservation.reserved_window)
                                     )) / 60
                                   else 0
                                 end
                               )
                           )
                           or coalesce((
                             select sum(reservation.allocated_quantity)
                             from roadops.equipment_reservations reservation
                             join roadops.equipment_units equipment
                               on equipment.id = reservation.equipment_unit_id
                             where reservation.equipment_requirement_id = requirement.id
                               and reservation.status in ('reserved', 'checked_out')
                               and equipment.division_id = item.division_id and equipment.state = 'active'
                               and equipment.iqn_resource_id = (
                                 select norm.resource_id from roadops.iqn_norm_lines norm
                                 where norm.id = requirement.norm_line_id
                               )
                               and equipment.effective_from <= (lower(reservation.reserved_window) at time zone 'Asia/Tashkent')::date
                               and (equipment.effective_until is null
                                    or equipment.effective_until > (lower(reservation.reserved_window) at time zone 'Asia/Tashkent')::date)
                               and not exists (
                                 select 1 from roadops.equipment_unavailability unavailable
                                 where unavailable.equipment_unit_id = equipment.id
                                   and unavailable.unavailable_window && reservation.reserved_window
                               )
                               and not exists (
                                 select 1 from roadops.equipment_reservations overlap
                                 where overlap.equipment_unit_id = equipment.id
                                   and overlap.id <> reservation.id
                                   and overlap.status in ('reserved', 'checked_out')
                                   and overlap.reserved_window && reservation.reserved_window
                               )
                           ), 0) < requirement.required_quantity
                         )
                     )
                     or (
                       exists (
                         select 1 from roadops.plan_resource_requirements requirement
                         where requirement.plan_item_id = item.id and requirement.resource_kind = 'equipment'
                       ) and not exists (
                         select 1 from roadops.work_variant_skill_requirements skill
                         where skill.work_variant_id = item.work_variant_id
                           and skill.requirement_kind = 'equipment_operator'
                           and skill.status = 'approved'
                           and skill.effective_from <= (lower(item.scheduled_window) at time zone 'Asia/Tashkent')::date
                           and (skill.effective_until is null
                                or skill.effective_until > (lower(item.scheduled_window) at time zone 'Asia/Tashkent')::date)
                       )
                     )
                     or exists (
                       select 1 from roadops.plan_resource_requirements requirement
                       where requirement.plan_item_id = item.id and requirement.resource_kind = 'material'
                         and coalesce((
                           select sum(reservation.quantity)
                           from roadops.material_reservations reservation
                           join roadops.materials material on material.id = reservation.material_id
                           join roadops.stock_locations location on location.id = reservation.stock_location_id
                           where reservation.material_requirement_id = requirement.id
                             and reservation.status = 'reserved'
                             and material.active and location.active
                             and location.division_id = item.division_id
                             and material.unit = requirement.unit
                             and material.iqn_resource_id = (
                               select norm.resource_id from roadops.iqn_norm_lines norm
                               where norm.id = requirement.norm_line_id
                             )
                         ), 0) < requirement.required_quantity
                     )
                     or exists (
                       select 1
                       from (
                         select distinct reservation.material_id, reservation.stock_location_id
                         from roadops.material_reservations reservation
                         where reservation.plan_item_id = item.id and reservation.status = 'reserved'
                       ) selected_stock
                       where coalesce((
                         select sum(active_reservation.quantity)
                         from roadops.material_reservations active_reservation
                         where active_reservation.material_id = selected_stock.material_id
                           and active_reservation.stock_location_id = selected_stock.stock_location_id
                           and active_reservation.status = 'reserved'
                       ), 0) > coalesce((
                         select sum(transaction.quantity_delta)
                         from roadops.inventory_transactions transaction
                         where transaction.material_id = selected_stock.material_id
                           and transaction.stock_location_id = selected_stock.stock_location_id
                       ), 0)
                     )
                     or exists (
                       select 1 from roadops.safety_scheme_requirements requirement
                       where requirement.safety_scheme_id = item.safety_scheme_id
                         and (
                           (requirement.requirement_kind = 'staff' and (
                             select count(distinct assignment.worker_id)
                             from roadops.safety_staff_assignments assignment
                             where assignment.plan_item_id = item.id
                               and assignment.requirement_id = requirement.id
                               and assignment.status <> 'cancelled'
                               and roadops.division_for_worker_assignment(
                                 assignment.worker_id,
                                 assignment.work_date
                               ) = item.division_id
                               and exists (
                                 select 1 from roadops.worker_versions profile
                                 where profile.worker_id = assignment.worker_id
                                   and profile.employment_state = 'active'
                                   and profile.valid_from <= lower(assignment.scheduled_window)
                                   and (profile.valid_until is null
                                        or profile.valid_until > lower(assignment.scheduled_window))
                               )
                               and exists (
                                 select 1 from roadops.worker_qualification_versions qualification
                                 where qualification.worker_id = assignment.worker_id
                                   and qualification.qualification_code = requirement.qualification_code
                                   and qualification.valid_from <= lower(assignment.scheduled_window)
                                   and (qualification.valid_until is null
                                        or qualification.valid_until > lower(assignment.scheduled_window))
                               )
                           ) < requirement.required_quantity)
                           or (requirement.requirement_kind <> 'staff' and coalesce((
                             select sum(reservation.quantity)
                             from roadops.safety_resource_reservations reservation
                             join roadops.safety_resource_inventory inventory
                               on inventory.id = reservation.inventory_id
                             where reservation.plan_item_id = item.id
                               and reservation.requirement_id = requirement.id
                               and reservation.status in ('reserved', 'checked_out')
                               and inventory.active and inventory.division_id = item.division_id
                               and inventory.resource_kind = requirement.requirement_kind
                               and inventory.resource_code = requirement.resource_code
                               and inventory.unit = requirement.unit
                           ), 0) < requirement.required_quantity)
                         )
                     )
                     or exists (
                       select 1 from roadops.safety_resource_reservations selected_reservation
                       join roadops.safety_resource_inventory inventory
                         on inventory.id = selected_reservation.inventory_id
                       where selected_reservation.plan_item_id = item.id
                         and selected_reservation.status in ('reserved', 'checked_out')
                         and coalesce((
                           select sum(active_reservation.quantity)
                           from roadops.safety_resource_reservations active_reservation
                           where active_reservation.inventory_id = selected_reservation.inventory_id
                             and active_reservation.status in ('reserved', 'checked_out')
                             and active_reservation.reserved_window && selected_reservation.reserved_window
                         ), 0) > inventory.available_quantity
                     )
                     or exists (
                       select 1 from roadops.safety_schemes scheme
                       where scheme.id = item.safety_scheme_id
                         and scheme.scheme_kind = 'full_closure_permit'
                         and coalesce(btrim(item.permit_reference), '') = ''
                     )
                )
                select count(*) from invalid_items
            SQL,
            [$runId],
        );
        $this->liveResourceGuard->assertCurrent($invalidCount);
    }

    private function lockInputSourceVersion(string $entityType, string $entityId): ?string
    {
        $sql = match ($entityType) {
            'defect_case' => 'select updated_at::text source_version from roadops.defect_cases where id = ? for share',
            'annual_program_item' => 'select updated_at::text source_version from roadops.annual_program_items where id = ? for share',
            'manual_work_request' => 'select updated_at::text source_version from roadops.manual_work_requests where id = ? for share',
            default => null,
        };
        if ($sql === null) {
            return null;
        }
        $row = DbRows::selectOne($sql, [$entityId]);

        return $row === null ? null : (string) $row->source_version;
    }

    /**
     * @param  array<mixed>  $input
     * @return array{
     *   roadId: string,
     *   workVariantId: string,
     *   exactQuantity: string,
     *   chainageStartM: string,
     *   chainageEndM: string,
     *   laneLabel: string,
     *   direction: string,
     *   sourceDefectId: string|null,
     *   sourceDefectVersion: string|null,
     *   sourceIqnTopicId: string|null,
     *   sourceIqnTopicName: string|null,
     *   sourceChainageStartM: string|null,
     *   sourceChainageEndM: string|null,
     *   sourceQuantity: string|null,
     *   sourceUnit: string|null,
     *   scheduledDate: string,
     *   safetySchemeId: string,
     *   workerIds: list<string>,
     *   permitNumber: string|null
     * }
     */
    private function canonicalManualInput(array $input): array
    {
        return [
            'roadId' => (string) ($input['roadId'] ?? ''),
            'workVariantId' => (string) ($input['workVariantId'] ?? ''),
            'exactQuantity' => (string) ($input['exactQuantity'] ?? ''),
            'chainageStartM' => (string) ($input['chainageStartM'] ?? ''),
            'chainageEndM' => (string) ($input['chainageEndM'] ?? ''),
            'laneLabel' => (string) ($input['laneLabel'] ?? ''),
            'direction' => (string) ($input['direction'] ?? ''),
            'sourceDefectId' => isset($input['sourceDefectId'])
                ? (string) $input['sourceDefectId']
                : null,
            'sourceDefectVersion' => isset($input['sourceDefectVersion'])
                ? (string) $input['sourceDefectVersion']
                : null,
            'sourceIqnTopicId' => isset($input['sourceIqnTopicId'])
                ? (string) $input['sourceIqnTopicId']
                : null,
            'sourceIqnTopicName' => isset($input['sourceIqnTopicName'])
                ? (string) $input['sourceIqnTopicName']
                : null,
            'sourceChainageStartM' => isset($input['sourceChainageStartM'])
                ? (string) $input['sourceChainageStartM']
                : null,
            'sourceChainageEndM' => isset($input['sourceChainageEndM'])
                ? (string) $input['sourceChainageEndM']
                : null,
            'sourceQuantity' => isset($input['sourceQuantity'])
                ? (string) $input['sourceQuantity']
                : null,
            'sourceUnit' => isset($input['sourceUnit'])
                ? (string) $input['sourceUnit']
                : null,
            'scheduledDate' => (string) ($input['scheduledDate'] ?? ''),
            'safetySchemeId' => (string) ($input['safetySchemeId'] ?? ''),
            'workerIds' => array_values(array_map('strval', is_array($input['workerIds'] ?? null)
                ? $input['workerIds']
                : [])),
            'permitNumber' => isset($input['permitNumber']) ? (string) $input['permitNumber'] : null,
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

    private function scopedRunExists(string $runId): bool
    {
        return (bool) DB::scalar(
            <<<'SQL'
                select exists (
                  select 1 from roadops.planning_runs run
                  where run.id = ?
                    and (
                      roadops.has_permission('planning.read', run.division_id)
                      or roadops.has_permission('planning.write', run.division_id)
                      or roadops.has_permission('planning.approve', run.division_id)
                    )
                    and exists (
                      select 1 from roadops.plan_items item
                      where item.planning_run_id=run.id
                        and item.status <> 'cancelled'
                    )
                    and not exists (
                      select 1 from roadops.plan_items item
                      where item.planning_run_id=run.id
                        and item.status <> 'cancelled'
                        and (
                          not exists (
                            select 1 from roadops.road_versions road
                            where road.road_id = item.road_id
                              and road.valid_from <= coalesce(lower(item.scheduled_window), run.as_of)
                              and (road.valid_until is null
                                   or road.valid_until > coalesce(lower(item.scheduled_window), run.as_of))
                              and lower(item.chainage_span) >= 0
                              and upper(item.chainage_span) <= road.length_m
                          )
                          or not exists (
                            select 1 from roadops.road_division_assignments assignment
                            where assignment.road_id = item.road_id
                              and assignment.division_id = run.division_id
                              and assignment.valid_from <= coalesce(lower(item.scheduled_window), run.as_of)
                              and (assignment.valid_until is null
                                   or assignment.valid_until > coalesce(lower(item.scheduled_window), run.as_of))
                              and assignment.chainage_span @> item.chainage_span
                          )
                        )
                    )
                )
            SQL,
            [$runId],
        );
    }

    private function publishError(\Throwable $exception): string
    {
        $message = $exception->getMessage();

        return match (true) {
            $this->isSnapshotConflict($exception) => 'Reja tuzilgandan keyin manba, IQN, yo‘l biriktiruvi yoki resurs holati o‘zgargan. Rejani qayta hisoblang.',
            str_contains($message, 'creator cannot approve') => 'Rejani tuzgan foydalanuvchi uni o‘zi tasdiqlay olmaydi. Boshqa vakolatli tasdiqlovchi kerak.',
            str_contains($message, 'unresolved blockers') => 'Rejada yechilmagan to‘siqlar bor.',
            str_contains($message, 'PLAN_NOT_READY') => 'Faqat hisoblangan va tasdiqlangan reja chop etiladi.',
            default => 'Rejani chop etish DB ish jarayoni qoidalari bo‘yicha rad etildi.',
        };
    }

    private function approvalError(\Throwable $exception): string
    {
        $message = $exception->getMessage();

        return match (true) {
            $this->isSnapshotConflict($exception) => 'Reja tuzilgandan keyin manba yoki operatsion holat o‘zgargan. Rejani qayta hisoblang.',
            str_contains(mb_strtolower($message), 'creator cannot approve') => 'Rejani tuzgan foydalanuvchi uni o‘zi tasdiqlay olmaydi. Boshqa vakolatli tasdiqlovchi kerak.',
            str_contains($message, 'unresolved blockers') => 'Rejada yechilmagan to‘siqlar bor.',
            str_contains($message, 'PLAN_NOT_EVALUATED') => 'Faqat hisoblangan va tasdiq kutilayotgan reja tasdiqlanadi.',
            default => 'Rejani tasdiqlash DB ish jarayoni qoidalari bo‘yicha rad etildi.',
        };
    }

    private function isSnapshotConflict(\Throwable $exception): bool
    {
        $previous = $exception->getPrevious();

        return (string) $exception->getCode() === '40001'
            || str_contains($exception->getMessage(), 'PLAN_INPUT_SNAPSHOT_STALE')
            || ($previous !== null && (string) $previous->getCode() === '40001');
    }
}
