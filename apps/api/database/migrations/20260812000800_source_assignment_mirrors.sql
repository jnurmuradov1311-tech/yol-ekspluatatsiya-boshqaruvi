begin;

-- These columns are legacy, whole-entity compatibility projections.  The
-- authoritative source ownership is recorded below and may legitimately be
-- multi-segment (road) or temporarily unassigned (road/worker).
alter table roadops.road_versions alter column division_id drop not null;
alter table roadops.worker_versions alter column division_id drop not null;

alter table roadops.road_element_versions alter column chainage_span drop not null;
alter table roadops.road_element_versions
  add column chainage_point_m numeric(14,3),
  drop constraint road_element_versions_chainage_ck;
alter table roadops.road_element_versions
  add constraint road_element_versions_chainage_ck check (
    (chainage_point_m is not null and chainage_point_m >= 0 and chainage_span is null)
    or (
      chainage_point_m is null and chainage_span is not null
      and not isempty(chainage_span) and lower_inc(chainage_span)
      and not upper_inc(chainage_span) and lower(chainage_span) >= 0
      and upper(chainage_span) > lower(chainage_span)
    )
  );

alter table roadops.worker_qualification_versions
  add column source_system_id uuid references roadops.source_systems(id) on delete restrict,
  add column external_id text;
alter table roadops.worker_qualification_versions
  add constraint worker_qualification_external_shape_ck check (
    (source_system_id is null and external_id is null)
    or (source_system_id is not null and coalesce(btrim(external_id), '') <> '')
  ),
  add constraint worker_qualification_external_revision_uk
    unique (source_system_id, external_id, source_version);

alter table roadops.worker_availability
  add column source_system_id uuid references roadops.source_systems(id) on delete restrict,
  add column external_id text,
  add column source_reason_code text,
  add column retired_at timestamptz;
alter table roadops.worker_availability
  drop constraint worker_availability_availability_code_check;
alter table roadops.worker_availability
  add constraint worker_availability_availability_code_check check (
    availability_code in (
      'available', 'leave', 'sick', 'training', 'not_scheduled', 'source_reported'
    )
  ),
  add constraint worker_availability_external_shape_ck check (
    (source_system_id is null and external_id is null)
    or (source_system_id is not null and coalesce(btrim(external_id), '') <> '')
  ),
  add constraint worker_availability_external_revision_uk
    unique (source_system_id, external_id, source_version);

create table roadops.failed_jobs (
  id bigserial primary key,
  uuid varchar(255) not null unique,
  connection text not null,
  queue text not null,
  payload text not null,
  exception text not null,
  failed_at timestamptz not null default clock_timestamp()
);

-- Transport provenance is separate from the vendor event envelope.  The envelope
-- remains byte/hash-addressable in payload/payload_hash while S3 manifest and
-- HTTP collection context can be retained without mutating the approved payload.
alter table roadops.integration_inbox
  add column transport_context jsonb not null default '{}'::jsonb;

alter table roadops.integration_inbox
  drop constraint if exists integration_inbox_state_ck;
alter table roadops.integration_inbox
  drop constraint if exists integration_inbox_state_check;

alter table roadops.integration_inbox
  add constraint integration_inbox_state_check
  check (state in (
    'pending', 'processing', 'processed', 'failed', 'conflict', 'dead_letter'
  ));
alter table roadops.integration_inbox
  add constraint integration_inbox_processed_check
  check (
    (state = 'processed' and processed_at is not null)
    or (state <> 'processed' and processed_at is null)
  );

-- A dependency conflict may be resolved deterministically when a later source
-- event supplies the missing master row.  Human ignore/reject decisions still
-- require an authenticated user.
alter table roadops.sync_conflicts
  drop constraint if exists sync_conflicts_resolution_ck;
alter table roadops.sync_conflicts
  add constraint sync_conflicts_resolution_ck check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or (
      status = 'resolved_from_source'
      and resolved_at is not null
      and coalesce(btrim(resolution_note), '') <> ''
    )
    or (
      status in ('ignored_as_duplicate', 'rejected')
      and resolved_at is not null
      and resolved_by is not null
      and coalesce(btrim(resolution_note), '') <> ''
    )
  );
create unique index sync_conflicts_one_open_code_idx
  on roadops.sync_conflicts (inbox_id, conflict_code)
  where status = 'open';

create table roadops.road_division_assignments (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid not null references roadops.source_systems(id) on delete restrict,
  external_id text not null check (btrim(external_id) <> ''),
  road_id uuid not null references roadops.roads(id) on delete restrict,
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  source_version text not null check (btrim(source_version) <> ''),
  chainage_span numrange not null,
  valid_from timestamptz not null,
  valid_until timestamptz,
  source_updated_at timestamptz,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint road_division_assignments_span_ck check (
    not isempty(chainage_span)
    and lower_inc(chainage_span)
    and not upper_inc(chainage_span)
    and lower(chainage_span) >= 0
    and upper(chainage_span) > lower(chainage_span)
  ),
  constraint road_division_assignments_period_ck check (
    valid_until is null or valid_until > valid_from
  ),
  unique (source_system_id, external_id, source_version),
  exclude using gist (
    road_id with =,
    chainage_span with &&,
    (tstzrange(valid_from, coalesce(valid_until, 'infinity'::timestamptz), '[)')) with &&
  )
);

create index road_division_assignments_road_time_idx
  on roadops.road_division_assignments using gist (
    road_id, chainage_span,
    tstzrange(valid_from, coalesce(valid_until, 'infinity'::timestamptz), '[)')
  );
create index road_division_assignments_division_current_idx
  on roadops.road_division_assignments (division_id, road_id)
  where valid_until is null;
create unique index road_division_assignments_external_current_idx
  on roadops.road_division_assignments (source_system_id, external_id)
  where valid_until is null;

create table roadops.worker_division_assignments (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid not null references roadops.source_systems(id) on delete restrict,
  external_id text not null check (btrim(external_id) <> ''),
  worker_id uuid not null references roadops.workers(id) on delete restrict,
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  source_version text not null check (btrim(source_version) <> ''),
  job_title text,
  valid_from date not null,
  valid_until date,
  source_updated_at timestamptz,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint worker_division_assignments_period_ck check (
    valid_until is null or valid_until > valid_from
  ),
  unique (source_system_id, external_id, source_version),
  exclude using gist (
    worker_id with =,
    (daterange(valid_from, coalesce(valid_until, 'infinity'::date), '[)')) with &&
  )
);

create index worker_division_assignments_division_current_idx
  on roadops.worker_division_assignments (division_id, worker_id)
  where valid_until is null;
create unique index worker_division_assignments_external_current_idx
  on roadops.worker_division_assignments (source_system_id, external_id)
  where valid_until is null;

create or replace function roadops.validate_assignment_span_within_road()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  road_length numeric;
begin
  select rv.length_m into road_length
  from roadops.road_versions rv
  where rv.road_id = new.road_id
    and rv.valid_from <= new.valid_from
    and (rv.valid_until is null or rv.valid_until > new.valid_from)
  order by rv.valid_from desc
  limit 1;

  if road_length is null then
    raise exception using errcode = '23514',
      message = 'No effective road version for assignment chainage validation';
  end if;
  if lower(new.chainage_span) < 0 or upper(new.chainage_span) > road_length then
    raise exception using errcode = '23514',
      message = 'Road assignment chainage exceeds effective road length';
  end if;
  return new;
end
$function$;

create trigger road_division_assignments_validate_span
before insert or update of road_id, chainage_span, valid_from
on roadops.road_division_assignments
for each row execute function roadops.validate_assignment_span_within_road();

create trigger road_division_assignments_sync_write_guard
before insert or update or delete on roadops.road_division_assignments
for each row execute function roadops.assert_sync_writer();
create trigger worker_division_assignments_sync_write_guard
before insert or update or delete on roadops.worker_division_assignments
for each row execute function roadops.assert_sync_writer();

create or replace function roadops.validate_span_within_road()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  road_length numeric;
  effective_at timestamptz;
begin
  effective_at := coalesce(new.valid_from, statement_timestamp());
  select rv.length_m into road_length
  from roadops.road_versions rv
  where rv.road_id = new.road_id
    and rv.valid_from <= effective_at
    and (rv.valid_until is null or rv.valid_until > effective_at)
  order by rv.valid_from desc limit 1;
  if road_length is null then
    raise exception using errcode = '23514', message = 'No effective road version for chainage validation';
  end if;
  if (new.chainage_span is not null
      and (lower(new.chainage_span) < 0 or upper(new.chainage_span) > road_length))
     or (new.chainage_point_m is not null
         and (new.chainage_point_m < 0 or new.chainage_point_m > road_length)) then
    raise exception using errcode = '23514', message = 'Chainage exceeds effective road length';
  end if;
  return new;
end
$function$;

-- Returns a compatibility owner only when one active source assignment contains
-- the complete requested zone.  Multi-segment or ambiguous ownership returns
-- NULL and must become an operational planning blocker.
create or replace function roadops.division_for_road_zone(
  p_road_id uuid,
  p_chainage_span numrange,
  p_at timestamptz default statement_timestamp()
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select min(a.division_id::text)::uuid
  from roadops.road_division_assignments a
  where a.road_id = p_road_id
    and a.valid_from <= p_at
    and (a.valid_until is null or a.valid_until > p_at)
    and a.chainage_span @> p_chainage_span
  having count(*) = 1
$function$;

create or replace function roadops.division_for_worker_assignment(
  p_worker_id uuid,
  p_on_date date default current_date
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select min(a.division_id::text)::uuid
  from roadops.worker_division_assignments a
  where a.worker_id = p_worker_id
    and a.valid_from <= p_on_date
    and (a.valid_until is null or a.valid_until > p_on_date)
  having count(*) = 1
$function$;

create or replace function roadops.division_for_road_point(
  p_road_id uuid,
  p_chainage_m numeric,
  p_at timestamptz default statement_timestamp()
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select min(a.division_id::text)::uuid
  from roadops.road_division_assignments a
  where a.road_id = p_road_id
    and a.valid_from <= p_at
    and (a.valid_until is null or a.valid_until > p_at)
    and a.chainage_span @> p_chainage_m
  having count(*) = 1
$function$;

create or replace function roadops.division_for_road_element(p_element_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when ev.chainage_span is not null
      then roadops.division_for_road_zone(ev.road_id, ev.chainage_span, ev.valid_from)
    else roadops.division_for_road_point(ev.road_id, ev.chainage_point_m, ev.valid_from)
  end
  from roadops.road_element_versions ev
  where ev.road_element_id = p_element_id and ev.valid_until is null
  order by ev.valid_from desc limit 1
$function$;

create or replace function roadops.division_for_worker(p_worker_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select roadops.division_for_worker_assignment(p_worker_id, current_date)
$function$;

create or replace function roadops.division_for_candidate(p_candidate_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select roadops.division_for_road_zone(c.road_id, c.chainage_span, c.observed_at)
  from roadops.roadvision_candidates c
  where c.id = p_candidate_id and c.road_id is not null and c.chainage_span is not null
$function$;

create or replace function roadops.division_for_defect(p_defect_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select roadops.division_for_road_zone(d.road_id, d.chainage_span, d.observed_at)
  from roadops.defect_cases d where d.id = p_defect_id
$function$;

create or replace function roadops.validate_work_assignment_links()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  required_kind text;
  required_plan_item uuid;
  template_variant_id uuid;
  template_code text;
  template_status text;
  template_from date;
  template_until date;
  item_variant_id uuid;
  item_division_id uuid;
begin
  select pr.resource_kind, pr.plan_item_id
  into required_kind, required_plan_item
  from roadops.plan_resource_requirements pr where pr.id = new.labor_requirement_id;
  if required_kind is distinct from 'labor' or required_plan_item is distinct from new.plan_item_id then
    raise exception using errcode = '23514', message = 'Assignment must reference a labor requirement for the same plan item';
  end if;

  select sr.work_variant_id, sr.qualification_code, sr.status,
         sr.effective_from, sr.effective_until
  into template_variant_id, template_code, template_status, template_from, template_until
  from roadops.work_variant_skill_requirements sr where sr.id = new.skill_requirement_id;
  select pi.work_variant_id, run.division_id
  into item_variant_id, item_division_id
  from roadops.plan_items pi
  join roadops.planning_runs run on run.id = pi.planning_run_id
  where pi.id = new.plan_item_id;
  if template_variant_id is distinct from item_variant_id or template_status <> 'approved'
     or template_from > new.work_date
     or (template_until is not null and template_until <= new.work_date) then
    raise exception using errcode = '23514', message = 'Assignment skill template is not approved for this work item and date';
  end if;
  if roadops.division_for_worker_assignment(new.worker_id, new.work_date)
       is distinct from item_division_id
     or not exists (
       select 1 from roadops.worker_versions wv
       where wv.worker_id = new.worker_id and wv.employment_state = 'active'
         and wv.valid_from <= lower(new.scheduled_window)
         and (wv.valid_until is null or wv.valid_until > lower(new.scheduled_window))
     )
     or not exists (
       select 1 from roadops.worker_qualification_versions q
       where q.worker_id = new.worker_id and q.qualification_code = template_code
         and q.valid_from <= lower(new.scheduled_window)
         and (q.valid_until is null or q.valid_until > lower(new.scheduled_window))
     ) then
    raise exception using errcode = '23514', message = 'Worker does not satisfy source assignment, active profile, and approved skill template';
  end if;
  return new;
end
$function$;

create or replace function roadops.rebuild_plan_assignment_blockers(p_run_id uuid)
returns table (blocker_code text, blocker_count bigint)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  run_row roadops.planning_runs%rowtype;
  item record;
  containing_count integer;
  intersecting_count integer;
  assignment_division_id uuid;
begin
  select r.* into run_row from roadops.planning_runs r where r.id = p_run_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Planning run not found';
  end if;
  if run_row.status not in ('draft', 'evaluated') then
    raise exception using errcode = '55000', message = 'Only draft or evaluated plan can be assignment-validated';
  end if;
  if not roadops.has_permission('planning.write', run_row.division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot validate this division plan';
  end if;

  update roadops.planning_blockers b set resolved_at = clock_timestamp()
  where b.planning_run_id = p_run_id and b.source = 'engine'
    and b.resolved_at is null and b.blocker_code in (
      'ROAD_SOURCE_VERSION_UNAVAILABLE', 'ROAD_ASSIGNMENT_MISSING',
      'ROAD_ASSIGNMENT_AMBIGUOUS', 'ROAD_ASSIGNMENT_DIVISION_MISMATCH'
    );

  for item in
    select pi.id, pi.road_id, pi.chainage_span,
           coalesce(lower(pi.scheduled_window), run_row.as_of) ownership_at
    from roadops.plan_items pi
    where pi.planning_run_id = p_run_id and pi.status <> 'cancelled'
    order by pi.id
  loop
    select count(*), min(a.division_id::text)::uuid
      into containing_count, assignment_division_id
    from roadops.road_division_assignments a
    where a.road_id = item.road_id
      and a.valid_from <= item.ownership_at
      and (a.valid_until is null or a.valid_until > item.ownership_at)
      and a.chainage_span @> item.chainage_span;

    select count(*) into intersecting_count
    from roadops.road_division_assignments a
    where a.road_id = item.road_id
      and a.valid_from <= item.ownership_at
      and (a.valid_until is null or a.valid_until > item.ownership_at)
      and a.chainage_span && item.chainage_span;

    if containing_count = 0 and intersecting_count = 0 then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'ROAD_ASSIGNMENT_MISSING', 'road', item.road_id,
        jsonb_build_object(
          'ownership_at', item.ownership_at,
          'chainage_span', item.chainage_span,
          'containing_assignments', containing_count,
          'intersecting_assignments', intersecting_count
        )
      );
    elsif containing_count <> 1 or intersecting_count <> 1 then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'ROAD_ASSIGNMENT_AMBIGUOUS', 'road', item.road_id,
        jsonb_build_object(
          'ownership_at', item.ownership_at,
          'chainage_span', item.chainage_span,
          'containing_assignments', containing_count,
          'intersecting_assignments', intersecting_count,
          'resolved_division_id', assignment_division_id
        )
      );
    elsif assignment_division_id is distinct from run_row.division_id then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'ROAD_ASSIGNMENT_DIVISION_MISMATCH', 'road', item.road_id,
        jsonb_build_object(
          'ownership_at', item.ownership_at,
          'chainage_span', item.chainage_span,
          'assignment_division_id', assignment_division_id,
          'planning_division_id', run_row.division_id
        )
      );
    end if;
  end loop;

  update roadops.plan_items pi set status = case
    when exists (
      select 1 from roadops.planning_blockers b
      where b.plan_item_id = pi.id and b.resolved_at is null
    ) then 'blocked' else 'ready' end
  where pi.planning_run_id = p_run_id and pi.status in ('candidate', 'blocked', 'ready');

  return query
  select b.blocker_code, count(*) from roadops.planning_blockers b
  where b.planning_run_id = p_run_id and b.resolved_at is null
  group by b.blocker_code order by b.blocker_code;
end
$function$;

-- Keep the full blocker engine from 006 as a private implementation detail and
-- make the established public workflow fail closed on authoritative YTP road
-- assignment mirrors.  Existing callers cannot accidentally skip ownership.
alter function roadops.rebuild_plan_blockers(uuid)
  rename to rebuild_plan_core_blockers;
revoke all on function roadops.rebuild_plan_core_blockers(uuid)
  from public, roadops_api;

create or replace function roadops.rebuild_plan_blockers(p_run_id uuid)
returns table (blocker_code text, blocker_count bigint)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform * from roadops.rebuild_plan_core_blockers(p_run_id);
  perform * from roadops.rebuild_plan_assignment_blockers(p_run_id);

  return query
  select b.blocker_code, count(*)
  from roadops.planning_blockers b
  where b.planning_run_id = p_run_id and b.resolved_at is null
  group by b.blocker_code
  order by b.blocker_code;
end
$function$;
revoke all on function roadops.rebuild_plan_blockers(uuid) from public;

create or replace function roadops.match_roadvision_candidate(
  p_candidate_id uuid,
  p_road_id uuid,
  p_road_element_id uuid,
  p_defect_type_id uuid,
  p_chainage_span numrange
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := roadops.current_actor_id();
  candidate roadops.roadvision_candidates%rowtype;
  division_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authenticated actor context is required';
  end if;
  select c.* into candidate from roadops.roadvision_candidates c
  where c.id = p_candidate_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RoadVision candidate not found';
  end if;
  if candidate.status not in ('received', 'unmatched', 'awaiting_verification') then
    raise exception using errcode = '55000', message = 'Final RoadVision candidate cannot be rematched';
  end if;
  if candidate.attribute_catalog_id is null or exists (
    select 1 from roadops.roadvision_attribute_catalog ac
    where ac.id = candidate.attribute_catalog_id and ac.record_kind <> 'defect_candidate'
  ) then
    raise exception using errcode = '23514', message = 'Only a classified defect_candidate attribute can be matched';
  end if;
  division_id := roadops.division_for_road_zone(p_road_id, p_chainage_span, candidate.observed_at);
  if division_id is null then
    raise exception using errcode = '23514', message = 'Road zone has missing or ambiguous YTP assignment';
  end if;
  if not roadops.has_permission('defects.verify', division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot match candidates for this division';
  end if;
  if p_road_element_id is not null and not exists (
    select 1 from roadops.road_element_versions ev
    where ev.road_element_id = p_road_element_id and ev.road_id = p_road_id
      and ev.valid_from <= candidate.observed_at
      and (ev.valid_until is null or ev.valid_until > candidate.observed_at)
      and ((ev.chainage_span is not null and ev.chainage_span && p_chainage_span)
           or (ev.chainage_point_m is not null and p_chainage_span @> ev.chainage_point_m))
  ) then
    raise exception using errcode = '23514', message = 'Road element does not belong to the selected road zone';
  end if;
  if not exists (
    select 1 from roadops.defect_types dt where dt.id = p_defect_type_id
      and dt.active_from <= candidate.observed_at::date
      and (dt.active_until is null or dt.active_until > candidate.observed_at::date)
  ) then
    raise exception using errcode = '23514', message = 'Defect type is not active at observation time';
  end if;

  update roadops.roadvision_candidates
  set road_id = p_road_id, road_element_id = p_road_element_id,
      defect_type_id = p_defect_type_id, chainage_span = p_chainage_span,
      status = 'awaiting_verification'
  where id = p_candidate_id;
  insert into roadops.roadvision_candidate_events (
    candidate_id, from_status, to_status, event_code, actor_user_id, details, request_id
  ) values (
    p_candidate_id, candidate.status, 'awaiting_verification', 'human_match', actor_id,
    jsonb_build_object(
      'road_id', p_road_id, 'road_element_id', p_road_element_id,
      'defect_type_id', p_defect_type_id, 'chainage_span', p_chainage_span,
      'division_id', division_id
    ), roadops.current_request_id()
  );
end
$function$;

create or replace function roadops.verify_roadvision_candidate(
  p_candidate_id uuid,
  p_decision text,
  p_measured_quantity numeric default null,
  p_measurement_unit text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := roadops.current_actor_id();
  candidate roadops.roadvision_candidates%rowtype;
  division_id uuid;
  created_defect_id uuid;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'Authenticated actor context is required';
  end if;
  if p_decision not in ('confirmed', 'rejected') then
    raise exception using errcode = '22023', message = 'Decision must be confirmed or rejected';
  end if;
  select c.* into candidate from roadops.roadvision_candidates c
  where c.id = p_candidate_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'RoadVision candidate not found';
  end if;
  if (p_decision = 'confirmed' and candidate.status <> 'awaiting_verification')
     or (p_decision = 'rejected' and candidate.status not in ('received', 'unmatched', 'awaiting_verification')) then
    raise exception using errcode = '55000', message = 'Candidate is not in a human-verifiable state';
  end if;
  if candidate.road_id is not null and candidate.chainage_span is not null then
    division_id := roadops.division_for_road_zone(
      candidate.road_id, candidate.chainage_span, candidate.observed_at
    );
    if division_id is null then
      raise exception using errcode = '23514', message = 'Candidate road zone has missing or ambiguous YTP assignment';
    end if;
  end if;
  if (division_id is not null and not roadops.has_permission('defects.verify', division_id))
     or (division_id is null and not roadops.has_permission('defects.verify', null)) then
    raise exception using errcode = '42501', message = 'Actor cannot verify this division candidate';
  end if;
  if p_decision = 'confirmed' and (
    candidate.road_id is null or candidate.defect_type_id is null or candidate.chainage_span is null
    or p_measured_quantity is null or p_measured_quantity <= 0
    or p_measurement_unit is null or btrim(p_measurement_unit) = ''
  ) then
    raise exception using errcode = '23514', message = 'Confirmed candidate requires road, defect, chainage, quantity, and unit';
  end if;
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception using errcode = '23514', message = 'Rejected candidate requires a note';
  end if;

  insert into roadops.roadvision_candidate_verifications (
    candidate_id, decision, verified_by, measured_quantity, measurement_unit, note, request_id
  ) values (
    candidate.id, p_decision, actor_id, p_measured_quantity, p_measurement_unit,
    p_note, roadops.current_request_id()
  );
  update roadops.roadvision_candidates set status = p_decision where id = candidate.id;
  insert into roadops.roadvision_candidate_events (
    candidate_id, from_status, to_status, event_code, actor_user_id, details, request_id
  ) values (
    candidate.id, candidate.status, p_decision, 'human_verification', actor_id,
    jsonb_build_object('note', p_note, 'division_id', division_id),
    roadops.current_request_id()
  );

  if p_decision = 'confirmed' then
    insert into roadops.defect_cases (
      source_kind, roadvision_candidate_id, road_id, road_element_id, defect_type_id,
      chainage_span, observed_at, verified_at, verified_by, measured_quantity,
      measurement_unit, description
    ) values (
      'roadvision', candidate.id, candidate.road_id, candidate.road_element_id,
      candidate.defect_type_id, candidate.chainage_span, candidate.observed_at,
      clock_timestamp(), actor_id, p_measured_quantity, p_measurement_unit, p_note
    ) returning id into created_defect_id;
    insert into roadops.defect_case_events (
      defect_case_id, from_status, to_status, event_code, actor_user_id, note, request_id
    ) values (
      created_defect_id, null, 'open', 'created_from_verified_roadvision', actor_id,
      p_note, roadops.current_request_id()
    );
  end if;
  return created_defect_id;
end
$function$;

revoke all on function roadops.validate_assignment_span_within_road() from public;
revoke all on function roadops.division_for_road_zone(uuid, numrange, timestamptz) from public;
revoke all on function roadops.division_for_worker_assignment(uuid, date) from public;
revoke all on function roadops.division_for_road_point(uuid, numeric, timestamptz) from public;
revoke all on function roadops.division_for_road_element(uuid) from public;
revoke all on function roadops.division_for_worker(uuid) from public;
revoke all on function roadops.division_for_candidate(uuid) from public;
revoke all on function roadops.division_for_defect(uuid) from public;
revoke all on function roadops.validate_work_assignment_links() from public;
revoke all on function roadops.rebuild_plan_assignment_blockers(uuid) from public;

alter table roadops.road_division_assignments enable row level security;
alter table roadops.road_division_assignments force row level security;
alter table roadops.worker_division_assignments enable row level security;
alter table roadops.worker_division_assignments force row level security;
alter table roadops.failed_jobs enable row level security;
alter table roadops.failed_jobs force row level security;

create policy roadops_sync_all on roadops.road_division_assignments
for all to roadops_sync using (true) with check (true);
create policy roadops_reporting_read on roadops.road_division_assignments
for select to roadops_reporting using (true);
create policy road_division_assignments_api_read
on roadops.road_division_assignments for select to roadops_api
using (roadops.can_access_division(division_id));

create policy roadops_sync_all on roadops.worker_division_assignments
for all to roadops_sync using (true) with check (true);
create policy roadops_reporting_read on roadops.worker_division_assignments
for select to roadops_reporting using (true);
create policy worker_division_assignments_api_read
on roadops.worker_division_assignments for select to roadops_api
using (roadops.can_access_division(division_id));

create policy roadops_sync_all on roadops.failed_jobs
for all to roadops_sync using (true) with check (true);
create policy failed_jobs_api_insert on roadops.failed_jobs
for insert to roadops_api with check (true);

drop policy roads_api_read on roadops.roads;
create policy roads_api_read
on roadops.roads for select to roadops_api
using (exists (
  select 1 from roadops.road_division_assignments a
  where a.road_id = id and a.valid_from <= statement_timestamp()
    and (a.valid_until is null or a.valid_until > statement_timestamp())
    and roadops.can_access_division(a.division_id)
));
drop policy road_versions_api_read on roadops.road_versions;
create policy road_versions_api_read
on roadops.road_versions for select to roadops_api
using (exists (
  select 1 from roadops.road_division_assignments a
  where a.road_id = road_id
    and a.valid_from < coalesce(valid_until, 'infinity'::timestamptz)
    and (a.valid_until is null or a.valid_until > valid_from)
    and roadops.can_access_division(a.division_id)
));
drop policy roadvision_candidates_api_read on roadops.roadvision_candidates;
create policy roadvision_candidates_api_read
on roadops.roadvision_candidates for select to roadops_api
using (
  roadops.has_any_permission('defects.read')
  and (
    (road_id is not null and chainage_span is not null
      and roadops.can_access_division(
        roadops.division_for_road_zone(road_id, chainage_span, observed_at)
      ))
    or ((road_id is null or chainage_span is null)
      and roadops.has_any_permission('integrations.manage'))
  )
);
drop policy defect_cases_api on roadops.defect_cases;
create policy defect_cases_api
on roadops.defect_cases for all to roadops_api
using (
  roadops.can_access_division(
    roadops.division_for_road_zone(road_id, chainage_span, observed_at)
  ) and roadops.has_any_permission('defects.read')
)
with check (
  roadops.can_access_division(
    roadops.division_for_road_zone(road_id, chainage_span, observed_at)
  ) and (roadops.has_any_permission('defects.capture') or roadops.has_any_permission('defects.verify'))
);

grant select, insert, update, delete on
  roadops.road_division_assignments,
  roadops.worker_division_assignments
to roadops_sync;
grant select, insert, update, delete on roadops.failed_jobs to roadops_sync;
grant insert on roadops.failed_jobs to roadops_api;
grant usage, select on sequence roadops.failed_jobs_id_seq to roadops_api, roadops_sync;
grant select on
  roadops.road_division_assignments,
  roadops.worker_division_assignments
to roadops_api, roadops_reporting;
grant execute on function roadops.division_for_road_zone(uuid, numrange, timestamptz),
  roadops.division_for_worker_assignment(uuid, date),
  roadops.division_for_road_point(uuid, numeric, timestamptz)
to roadops_api, roadops_sync, roadops_reporting;
grant execute on function roadops.division_for_road_element(uuid),
  roadops.division_for_worker(uuid), roadops.division_for_candidate(uuid),
  roadops.division_for_defect(uuid)
to roadops_api, roadops_sync, roadops_reporting;
grant execute on function roadops.rebuild_plan_assignment_blockers(uuid) to roadops_api;
grant execute on function roadops.rebuild_plan_blockers(uuid) to roadops_api;

commit;
