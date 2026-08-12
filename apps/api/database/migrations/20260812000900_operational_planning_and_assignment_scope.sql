begin;

-- A road or worker may be assigned to different YTP units over time.  The
-- assignment mirrors introduced in 008 are authoritative; these legacy
-- convenience columns must not force the ingest processor to invent an owner.
alter table roadops.road_versions alter column division_id drop not null;
alter table roadops.worker_versions alter column division_id drop not null;

-- Preserve RoadVision revisions and the fields operators need when verifying
-- lane-level evidence.  The JSON evidence list remains immutable source data;
-- evidence_reference is the first item retained for backward compatibility.
alter table roadops.roadvision_candidates
  add column source_revision text not null default 'legacy',
  add column direction text,
  add column lane_label text,
  add column evidence_media_type text,
  add column evidence jsonb not null default '[]'::jsonb;
alter table roadops.roadvision_candidates
  add constraint roadvision_candidates_media_type_ck check (
    evidence_media_type is null
    or evidence_media_type in ('image/jpeg', 'image/png', 'video/mp4')
  ),
  add constraint roadvision_candidates_evidence_ck check (jsonb_typeof(evidence) = 'array');
alter table roadops.roadvision_candidates
  drop constraint if exists roadvision_candidates_source_system_id_external_candidate_id_key;
alter table roadops.roadvision_candidates
  add constraint roadvision_candidates_source_revision_uk
  unique (source_system_id, external_candidate_id, source_revision);
create unique index roadvision_candidates_one_active_revision_idx
  on roadops.roadvision_candidates (source_system_id, external_candidate_id)
  where status <> 'superseded';

alter table roadops.inspection_observations
  add column direction text,
  add column lane_label text;

alter table roadops.planning_runs
  add column planning_mode text not null default 'automatic';
alter table roadops.planning_runs
  add constraint planning_runs_mode_ck
  check (planning_mode in ('automatic', 'manual'));

alter table roadops.safety_schemes add column scheme_kind text;
alter table roadops.safety_schemes
  add constraint safety_schemes_kind_ck check (
    scheme_kind is null or scheme_kind in (
      'shoulder_work',
      'one_lane_closed',
      'half_road_closed',
      'alternating_flow',
      'full_closure_permit'
    )
  );
create unique index safety_schemes_kind_effective_uk
  on roadops.safety_schemes (division_id, scheme_kind, effective_from)
  where scheme_kind is not null;

create table roadops.manual_work_requests (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  road_id uuid not null references roadops.roads(id) on delete restrict,
  work_variant_id uuid not null references roadops.iqn_work_variants(id) on delete restrict,
  safety_scheme_id uuid not null references roadops.safety_schemes(id) on delete restrict,
  chainage_span numrange not null,
  work_quantity numeric(20,6) not null check (work_quantity > 0),
  work_unit text not null check (btrim(work_unit) <> ''),
  direction text,
  lane_label text,
  requested_date date not null,
  permit_reference text,
  note text,
  status text not null default 'draft'
    check (status in ('draft', 'evaluated', 'published', 'cancelled')),
  created_by uuid not null references roadops.app_users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint manual_work_requests_chainage_ck check (
    not isempty(chainage_span) and lower_inc(chainage_span) and not upper_inc(chainage_span)
    and lower(chainage_span) >= 0 and upper(chainage_span) > lower(chainage_span)
  ),
  constraint manual_work_requests_permit_ck check (
    permit_reference is null or btrim(permit_reference) <> ''
  )
);
create trigger manual_work_requests_set_updated_at
before update on roadops.manual_work_requests
for each row execute function roadops.set_updated_at();
create index manual_work_requests_division_date_idx
  on roadops.manual_work_requests (division_id, requested_date, status);

alter table roadops.plan_items
  add column manual_work_request_id uuid
    references roadops.manual_work_requests(id) on delete restrict,
  add column permit_reference text;
alter table roadops.plan_items drop constraint plan_items_origin_ck;
alter table roadops.plan_items
  add constraint plan_items_origin_ck check (
    num_nonnulls(defect_case_id, annual_program_item_id, manual_work_request_id) = 1
  ),
  add constraint plan_items_permit_ck check (
    permit_reference is null or btrim(permit_reference) <> ''
  );
create unique index plan_items_manual_request_idx
  on roadops.plan_items (manual_work_request_id)
  where manual_work_request_id is not null and status not in ('cancelled', 'completed');

-- Approved traffic-management schemes describe dedicated safety staff and
-- reusable signs/cones/barriers.  These are kept separate from consumable IQN
-- material norms so reservations remain truthful.
create table roadops.safety_scheme_requirements (
  id uuid primary key default gen_random_uuid(),
  safety_scheme_id uuid not null references roadops.safety_schemes(id) on delete restrict,
  requirement_kind text not null check (
    requirement_kind in ('staff', 'sign', 'cone', 'barrier')
  ),
  resource_code text not null check (btrim(resource_code) <> ''),
  qualification_code text,
  required_quantity numeric(20,6) not null check (required_quantity > 0),
  unit text not null check (btrim(unit) <> ''),
  required_minutes smallint check (required_minutes between 1 and 420),
  created_at timestamptz not null default clock_timestamp(),
  constraint safety_scheme_requirements_shape_ck check (
    (requirement_kind = 'staff'
      and coalesce(btrim(qualification_code), '') <> ''
      and required_minutes is not null
      and unit = 'worker')
    or (requirement_kind <> 'staff'
      and qualification_code is null
      and required_minutes is null)
  ),
  unique (safety_scheme_id, requirement_kind, resource_code)
);

create table roadops.work_variant_safety_scheme_rules (
  id uuid primary key default gen_random_uuid(),
  work_variant_id uuid not null references roadops.iqn_work_variants(id) on delete restrict,
  safety_scheme_id uuid not null references roadops.safety_schemes(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  is_default boolean not null default false,
  effective_from date not null,
  effective_until date,
  rationale text not null check (btrim(rationale) <> ''),
  created_by uuid not null references roadops.app_users(id) on delete restrict,
  approved_at timestamptz,
  approved_by uuid references roadops.app_users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint work_variant_safety_rules_period_ck check (
    effective_until is null or effective_until > effective_from
  ),
  constraint work_variant_safety_rules_approval_ck check (
    (status = 'draft' and approved_at is null and approved_by is null)
    or (status in ('approved', 'retired') and approved_at is not null
      and approved_by is not null and approved_by <> created_by)
  ),
  constraint work_variant_safety_rules_default_ck check (
    not is_default or status = 'approved'
  ),
  exclude using gist (
    work_variant_id with =,
    safety_scheme_id with =,
    (daterange(effective_from, coalesce(effective_until, 'infinity'::date), '[)')) with &&
  ) where (status = 'approved')
);
alter table roadops.work_variant_safety_scheme_rules
  add constraint work_variant_safety_rules_default_period_excl
  exclude using gist (
    work_variant_id with =,
    (daterange(effective_from, coalesce(effective_until, 'infinity'::date), '[)')) with &&
  ) where (status = 'approved' and is_default);

create table roadops.safety_resource_inventory (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  resource_kind text not null check (resource_kind in ('sign', 'cone', 'barrier')),
  resource_code text not null check (btrim(resource_code) <> ''),
  name text not null check (btrim(name) <> ''),
  available_quantity numeric(20,6) not null check (available_quantity >= 0),
  unit text not null check (btrim(unit) <> ''),
  active boolean not null default true,
  updated_at timestamptz not null default clock_timestamp(),
  unique (division_id, resource_kind, resource_code)
);
create trigger safety_resource_inventory_set_updated_at
before update on roadops.safety_resource_inventory
for each row execute function roadops.set_updated_at();

create table roadops.safety_resource_reservations (
  id uuid primary key default gen_random_uuid(),
  plan_item_id uuid not null references roadops.plan_items(id) on delete restrict,
  requirement_id uuid not null references roadops.safety_scheme_requirements(id) on delete restrict,
  inventory_id uuid not null references roadops.safety_resource_inventory(id) on delete restrict,
  reserved_window tstzrange not null,
  quantity numeric(20,6) not null check (quantity > 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'checked_out', 'returned', 'cancelled')),
  reserved_by uuid not null references roadops.app_users(id) on delete restrict,
  reserved_at timestamptz not null default clock_timestamp(),
  constraint safety_resource_reservations_window_ck check (
    not isempty(reserved_window) and lower_inc(reserved_window) and not upper_inc(reserved_window)
    and lower(reserved_window) < upper(reserved_window)
  ),
  unique (plan_item_id, requirement_id, inventory_id, reserved_window)
);
create index safety_resource_reservations_overlap_idx
  on roadops.safety_resource_reservations using gist (inventory_id, reserved_window)
  where status in ('reserved', 'checked_out');

create table roadops.safety_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  plan_item_id uuid not null references roadops.plan_items(id) on delete restrict,
  requirement_id uuid not null references roadops.safety_scheme_requirements(id) on delete restrict,
  worker_id uuid not null references roadops.workers(id) on delete restrict,
  work_date date not null,
  scheduled_window tstzrange not null,
  planned_minutes smallint not null check (planned_minutes between 1 and 420),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'accepted', 'in_progress', 'completed', 'cancelled')),
  assigned_by uuid not null references roadops.app_users(id) on delete restrict,
  assigned_at timestamptz not null default clock_timestamp(),
  constraint safety_staff_assignments_window_ck check (
    not isempty(scheduled_window) and lower_inc(scheduled_window) and not upper_inc(scheduled_window)
    and lower(scheduled_window) < upper(scheduled_window)
    and work_date = (lower(scheduled_window) at time zone 'Asia/Tashkent')::date
    and work_date = ((upper(scheduled_window) - interval '1 microsecond') at time zone 'Asia/Tashkent')::date
  ),
  unique (plan_item_id, requirement_id, worker_id, scheduled_window)
);
create index safety_staff_assignments_worker_day_idx
  on roadops.safety_staff_assignments (worker_id, work_date)
  where status <> 'cancelled';

create or replace function roadops.division_for_road(
  p_road_id uuid,
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
  having count(distinct a.division_id) = 1
$function$;

create or replace function roadops.division_for_road_element(p_element_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when ev.chainage_span is not null then
      roadops.division_for_road_zone(ev.road_id, ev.chainage_span, statement_timestamp())
    else
      roadops.division_for_road_point(ev.road_id, ev.chainage_point_m, statement_timestamp())
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
  select case when c.road_id is null or c.chainage_span is null then null
              else roadops.division_for_road_zone(c.road_id, c.chainage_span, c.observed_at) end
  from roadops.roadvision_candidates c where c.id = p_candidate_id
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

drop policy roads_api_read on roadops.roads;
create policy roads_api_read on roadops.roads for select to roadops_api
using (exists (
  select 1 from roadops.road_division_assignments a
  where a.road_id = roads.id and a.valid_from <= statement_timestamp()
    and (a.valid_until is null or a.valid_until > statement_timestamp())
    and roadops.can_access_division(a.division_id)
));
drop policy road_versions_api_read on roadops.road_versions;
create policy road_versions_api_read on roadops.road_versions for select to roadops_api
using (exists (
  select 1 from roadops.road_division_assignments a
  where a.road_id = road_versions.road_id
    and a.valid_from <= statement_timestamp()
    and (a.valid_until is null or a.valid_until > statement_timestamp())
    and roadops.can_access_division(a.division_id)
));
drop policy worker_versions_api_read on roadops.worker_versions;
create policy worker_versions_api_read on roadops.worker_versions for select to roadops_api
using (roadops.can_access_division(roadops.division_for_worker(worker_id)));

create or replace function roadops.check_worker_day_capacity(
  checked_worker_id uuid,
  checked_work_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  assigned_minutes integer;
  available_minutes integer;
begin
  select coalesce(sum(minutes), 0)::integer into assigned_minutes
  from (
    select a.planned_minutes::integer minutes
    from roadops.work_assignments a
    where a.worker_id = checked_worker_id and a.work_date = checked_work_date
      and a.status <> 'cancelled'
    union all
    select a.planned_minutes::integer
    from roadops.safety_staff_assignments a
    where a.worker_id = checked_worker_id and a.work_date = checked_work_date
      and a.status <> 'cancelled'
  ) assigned;

  select case when wa.availability_code = 'available'
              then wa.available_minutes else 0 end into available_minutes
  from roadops.worker_availability wa
  where wa.worker_id = checked_worker_id and wa.work_date = checked_work_date
    and wa.retired_at is null
  order by wa.source_updated_at desc nulls last, wa.recorded_at desc
  limit 1;
  -- Missing YTP availability is unknown, not an implicit seven-hour shift.
  available_minutes := least(420, coalesce(available_minutes, 0));
  if assigned_minutes > available_minutes then
    raise exception using errcode = '23514', message = format(
      'Worker daily assignment is %s minutes; allowed maximum is %s minutes',
      assigned_minutes, available_minutes
    );
  end if;
end
$function$;

create constraint trigger safety_staff_assignments_daily_capacity
after insert or update or delete on roadops.safety_staff_assignments
deferrable initially deferred
for each row execute function roadops.enforce_worker_day_capacity();

create or replace function roadops.validate_safety_staff_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  requirement record;
  division_id uuid;
begin
  select sr.*, ss.division_id into requirement
  from roadops.safety_scheme_requirements sr
  join roadops.safety_schemes ss on ss.id = sr.safety_scheme_id
  where sr.id = new.requirement_id;
  select pr.division_id into division_id
  from roadops.plan_items pi
  join roadops.planning_runs pr on pr.id = pi.planning_run_id
  where pi.id = new.plan_item_id and pi.safety_scheme_id = requirement.safety_scheme_id;
  if requirement.requirement_kind is distinct from 'staff'
     or division_id is distinct from requirement.division_id
     or not exists (
       select 1 from roadops.worker_qualification_versions q
       where q.worker_id = new.worker_id
         and q.qualification_code = requirement.qualification_code
         and q.valid_from <= lower(new.scheduled_window)
         and (q.valid_until is null or q.valid_until > lower(new.scheduled_window))
     )
     or roadops.division_for_worker_assignment(new.worker_id, new.work_date)
        is distinct from division_id then
    raise exception using errcode = '23514',
      message = 'Safety worker does not match the approved scheme, qualification, or YTP assignment';
  end if;
  return new;
end
$function$;
create trigger safety_staff_assignments_validate
before insert or update on roadops.safety_staff_assignments
for each row execute function roadops.validate_safety_staff_assignment();

create or replace function roadops.validate_safety_resource_reservation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from roadops.safety_scheme_requirements sr
    join roadops.safety_schemes ss on ss.id = sr.safety_scheme_id
    join roadops.safety_resource_inventory inventory on inventory.id = new.inventory_id
    join roadops.plan_items pi on pi.id = new.plan_item_id
    join roadops.planning_runs run on run.id = pi.planning_run_id
    where sr.id = new.requirement_id
      and sr.requirement_kind <> 'staff'
      and pi.safety_scheme_id = sr.safety_scheme_id
      and inventory.division_id = run.division_id
      and inventory.resource_kind = sr.requirement_kind
      and inventory.resource_code = sr.resource_code
      and inventory.unit = sr.unit
      and inventory.active
      and ss.division_id = run.division_id
  ) then
    raise exception using errcode = '23514',
      message = 'Safety inventory does not match the plan scheme requirement';
  end if;
  return new;
end
$function$;
create trigger safety_resource_reservations_validate
before insert or update on roadops.safety_resource_reservations
for each row execute function roadops.validate_safety_resource_reservation();

create or replace function roadops.check_safety_resource_reservation(p_inventory_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  inventory_quantity numeric;
  reservation record;
  overlapping_quantity numeric;
begin
  select i.available_quantity into inventory_quantity
  from roadops.safety_resource_inventory i where i.id = p_inventory_id;
  for reservation in
    select distinct r.reserved_window
    from roadops.safety_resource_reservations r
    where r.inventory_id = p_inventory_id and r.status in ('reserved', 'checked_out')
  loop
    select coalesce(sum(r.quantity), 0) into overlapping_quantity
    from roadops.safety_resource_reservations r
    where r.inventory_id = p_inventory_id and r.status in ('reserved', 'checked_out')
      and r.reserved_window && reservation.reserved_window;
    if overlapping_quantity > inventory_quantity then
      raise exception using errcode = '23514',
        message = 'Safety resource reservations exceed available inventory';
    end if;
  end loop;
end
$function$;

create or replace function roadops.enforce_safety_resource_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform roadops.check_safety_resource_reservation(old.inventory_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform roadops.check_safety_resource_reservation(new.inventory_id);
  end if;
  return null;
end
$function$;
create constraint trigger safety_resource_reservations_capacity
after insert or update or delete on roadops.safety_resource_reservations
deferrable initially deferred
for each row execute function roadops.enforce_safety_resource_capacity();

create or replace function roadops.rebuild_plan_safety_blockers(p_run_id uuid)
returns table (blocker_code text, blocker_count bigint)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  item record;
  requirement record;
  assigned_workers integer;
  assigned_minutes integer;
  reserved_quantity numeric;
begin
  if not exists (
    select 1 from roadops.planning_runs pr
    where pr.id = p_run_id and roadops.has_permission('planning.write', pr.division_id)
  ) then
    raise exception using errcode = '42501', message = 'Actor cannot evaluate safety resources for this plan';
  end if;
  update roadops.planning_blockers b set resolved_at = clock_timestamp()
  where b.planning_run_id = p_run_id and b.source = 'engine' and b.resolved_at is null
    and b.blocker_code in (
      'FULL_CLOSURE_PERMIT_REQUIRED', 'SAFETY_STAFF_SHORTAGE',
      'SAFETY_EQUIPMENT_SHORTAGE', 'SAFETY_SCHEME_TYPE_UNSUPPORTED'
    );

  for item in
    select pi.*, ss.scheme_kind
    from roadops.plan_items pi
    left join roadops.safety_schemes ss on ss.id = pi.safety_scheme_id
    where pi.planning_run_id = p_run_id and pi.status <> 'cancelled'
  loop
    if item.scheme_kind is null then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'SAFETY_SCHEME_TYPE_UNSUPPORTED', 'plan_item', item.id, '{}'::jsonb
      );
    end if;
    if item.scheme_kind = 'full_closure_permit'
       and coalesce(btrim(item.permit_reference), '') = '' then
      perform roadops.put_plan_blocker(
        p_run_id, item.id, 'FULL_CLOSURE_PERMIT_REQUIRED', 'plan_item', item.id,
        jsonb_build_object('scheme_kind', item.scheme_kind)
      );
    end if;

    for requirement in
      select sr.* from roadops.safety_scheme_requirements sr
      where sr.safety_scheme_id = item.safety_scheme_id
      order by sr.requirement_kind, sr.resource_code
    loop
      if requirement.requirement_kind = 'staff' then
        select count(distinct a.worker_id), coalesce(sum(a.planned_minutes), 0)
          into assigned_workers, assigned_minutes
        from roadops.safety_staff_assignments a
        where a.plan_item_id = item.id and a.requirement_id = requirement.id
          and a.status <> 'cancelled';
        if assigned_workers < requirement.required_quantity
           or assigned_minutes < requirement.required_minutes * requirement.required_quantity then
          perform roadops.put_plan_blocker(
            p_run_id, item.id, 'SAFETY_STAFF_SHORTAGE',
            'safety_scheme_requirement', requirement.id,
            jsonb_build_object(
              'resource_code', requirement.resource_code,
              'required_workers', requirement.required_quantity,
              'assigned_workers', assigned_workers,
              'required_minutes', requirement.required_minutes * requirement.required_quantity,
              'assigned_minutes', assigned_minutes
            )
          );
        end if;
      else
        select coalesce(sum(r.quantity), 0) into reserved_quantity
        from roadops.safety_resource_reservations r
        where r.plan_item_id = item.id and r.requirement_id = requirement.id
          and r.status in ('reserved', 'checked_out');
        if reserved_quantity < requirement.required_quantity then
          perform roadops.put_plan_blocker(
            p_run_id, item.id, 'SAFETY_EQUIPMENT_SHORTAGE',
            'safety_scheme_requirement', requirement.id,
            jsonb_build_object(
              'resource_kind', requirement.requirement_kind,
              'resource_code', requirement.resource_code,
              'required_quantity', requirement.required_quantity,
              'reserved_quantity', reserved_quantity,
              'unit', requirement.unit
            )
          );
        end if;
      end if;
    end loop;
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

alter table roadops.manual_work_requests enable row level security;
alter table roadops.manual_work_requests force row level security;
alter table roadops.safety_scheme_requirements enable row level security;
alter table roadops.safety_scheme_requirements force row level security;
alter table roadops.work_variant_safety_scheme_rules enable row level security;
alter table roadops.work_variant_safety_scheme_rules force row level security;
alter table roadops.safety_resource_inventory enable row level security;
alter table roadops.safety_resource_inventory force row level security;
alter table roadops.safety_resource_reservations enable row level security;
alter table roadops.safety_resource_reservations force row level security;
alter table roadops.safety_staff_assignments enable row level security;
alter table roadops.safety_staff_assignments force row level security;

create policy manual_work_requests_api on roadops.manual_work_requests
for all to roadops_api
using (
  roadops.can_access_division(division_id)
  and (roadops.has_any_permission('planning.read') or roadops.has_any_permission('planning.write'))
)
with check (roadops.can_access_division(division_id) and roadops.has_permission('planning.write', division_id));
create policy manual_work_requests_reporting on roadops.manual_work_requests
for select to roadops_reporting using (true);

create policy safety_scheme_requirements_api on roadops.safety_scheme_requirements
for select to roadops_api using (exists (
  select 1 from roadops.safety_schemes ss
  where ss.id = safety_scheme_id and roadops.can_access_division(ss.division_id)
));
create policy work_variant_safety_rules_api on roadops.work_variant_safety_scheme_rules
for select to roadops_api using (exists (
  select 1 from roadops.safety_schemes ss
  where ss.id = safety_scheme_id and roadops.can_access_division(ss.division_id)
));
create policy safety_resource_inventory_api_read on roadops.safety_resource_inventory
for select to roadops_api
using (roadops.can_access_division(division_id) and roadops.has_any_permission('resources.read'));
create policy safety_resource_inventory_api_manage on roadops.safety_resource_inventory
for all to roadops_api
using (roadops.can_access_division(division_id) and roadops.has_permission('resources.manage', division_id))
with check (roadops.can_access_division(division_id) and roadops.has_permission('resources.manage', division_id));
create policy safety_resource_reservations_api on roadops.safety_resource_reservations
for all to roadops_api
using (roadops.can_access_division(roadops.division_for_plan_item(plan_item_id)))
with check (
  roadops.has_permission('planning.write', roadops.division_for_plan_item(plan_item_id))
  or roadops.has_permission('resources.manage', roadops.division_for_plan_item(plan_item_id))
);
create policy safety_staff_assignments_api on roadops.safety_staff_assignments
for all to roadops_api
using (roadops.can_access_division(roadops.division_for_plan_item(plan_item_id)))
with check (
  roadops.has_permission('planning.write', roadops.division_for_plan_item(plan_item_id))
  or roadops.has_permission('execution.manage', roadops.division_for_plan_item(plan_item_id))
);

create policy operational_reporting_read on roadops.safety_scheme_requirements
for select to roadops_reporting using (true);
create policy operational_reporting_read on roadops.work_variant_safety_scheme_rules
for select to roadops_reporting using (true);
create policy operational_reporting_read on roadops.safety_resource_inventory
for select to roadops_reporting using (true);
create policy operational_reporting_read on roadops.safety_resource_reservations
for select to roadops_reporting using (true);
create policy operational_reporting_read on roadops.safety_staff_assignments
for select to roadops_reporting using (true);

grant select, insert, update on roadops.manual_work_requests to roadops_api;
grant select on roadops.safety_scheme_requirements to roadops_api;
grant select on roadops.work_variant_safety_scheme_rules to roadops_api;
grant select, insert, update on roadops.safety_resource_inventory,
  roadops.safety_resource_reservations, roadops.safety_staff_assignments to roadops_api;
grant select on roadops.manual_work_requests, roadops.safety_scheme_requirements,
  roadops.work_variant_safety_scheme_rules,
  roadops.safety_resource_inventory, roadops.safety_resource_reservations,
  roadops.safety_staff_assignments to roadops_reporting;
grant execute on function roadops.rebuild_plan_safety_blockers(uuid) to roadops_api;

grant update (planning_mode) on roadops.planning_runs to roadops_api;
grant update (manual_work_request_id, permit_reference) on roadops.plan_items to roadops_api;

revoke all on function roadops.validate_safety_staff_assignment() from public;
revoke all on function roadops.validate_safety_resource_reservation() from public;
revoke all on function roadops.check_safety_resource_reservation(uuid) from public;
revoke all on function roadops.enforce_safety_resource_capacity() from public;
revoke all on function roadops.rebuild_plan_safety_blockers(uuid) from public;

commit;
