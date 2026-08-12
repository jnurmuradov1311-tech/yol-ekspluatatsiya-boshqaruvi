begin;

create table roadops.equipment_units (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  inventory_code text not null unique check (btrim(inventory_code) <> ''),
  name text not null check (btrim(name) <> ''),
  iqn_resource_id uuid references roadops.iqn_resources(id) on delete restrict,
  state text not null default 'active'
    check (state in ('active', 'maintenance', 'out_of_service', 'retired')),
  effective_from date not null default current_date,
  effective_until date,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint equipment_units_period_ck check (
    effective_until is null or effective_until > effective_from
  )
);

create trigger equipment_units_set_updated_at
before update on roadops.equipment_units
for each row execute function roadops.set_updated_at();

create table roadops.equipment_unavailability (
  id uuid primary key default gen_random_uuid(),
  equipment_unit_id uuid not null references roadops.equipment_units(id) on delete restrict,
  unavailable_window tstzrange not null,
  reason_code text not null check (btrim(reason_code) <> ''),
  note text,
  created_by uuid not null references roadops.app_users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint equipment_unavailability_window_ck check (
    not isempty(unavailable_window) and lower_inc(unavailable_window)
    and not upper_inc(unavailable_window) and lower(unavailable_window) < upper(unavailable_window)
  ),
  exclude using gist (
    equipment_unit_id with =,
    unavailable_window with &&
  )
);

create table roadops.materials (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  unit text not null check (btrim(unit) <> ''),
  iqn_resource_id uuid references roadops.iqn_resources(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create trigger materials_set_updated_at
before update on roadops.materials
for each row execute function roadops.set_updated_at();

create table roadops.stock_locations (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (division_id, code)
);

create trigger stock_locations_set_updated_at
before update on roadops.stock_locations
for each row execute function roadops.set_updated_at();

create table roadops.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  stock_location_id uuid not null references roadops.stock_locations(id) on delete restrict,
  material_id uuid not null references roadops.materials(id) on delete restrict,
  transaction_kind text not null
    check (transaction_kind in ('opening', 'receipt', 'issue', 'adjustment', 'transfer_in', 'transfer_out', 'return')),
  quantity_delta numeric(20,6) not null check (quantity_delta <> 0),
  occurred_at timestamptz not null,
  reference_type text not null check (btrim(reference_type) <> ''),
  reference_id uuid,
  note text,
  recorded_by uuid not null references roadops.app_users(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  request_id uuid,
  constraint inventory_transaction_direction_ck check (
    (transaction_kind in ('opening', 'receipt', 'transfer_in', 'return') and quantity_delta > 0)
    or (transaction_kind in ('issue', 'transfer_out') and quantity_delta < 0)
    or transaction_kind = 'adjustment'
  )
);

create index inventory_transactions_balance_idx
  on roadops.inventory_transactions (stock_location_id, material_id, occurred_at, id);

create view roadops.current_stock_balances
with (security_invoker = true)
as
select
  stock_location_id,
  material_id,
  sum(quantity_delta)::numeric(20,6) as on_hand_quantity
from roadops.inventory_transactions
group by stock_location_id, material_id;

create table roadops.safety_schemes (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  instructions jsonb not null,
  effective_from date not null,
  effective_until date,
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  approved_at timestamptz,
  approved_by uuid references roadops.app_users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint safety_schemes_period_ck check (
    effective_until is null or effective_until > effective_from
  ),
  constraint safety_schemes_approval_ck check (
    (status = 'draft' and approved_at is null and approved_by is null)
    or (status in ('approved', 'retired') and approved_at is not null and approved_by is not null)
  ),
  unique (division_id, code, effective_from),
  exclude using gist (
    division_id with =,
    code with =,
    (daterange(effective_from, coalesce(effective_until, 'infinity'::date), '[)')) with &&
  ) where (status = 'approved')
);

create trigger safety_schemes_set_updated_at
before update on roadops.safety_schemes
for each row execute function roadops.set_updated_at();

create table roadops.annual_programs (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  program_year smallint not null check (program_year between 2000 and 2200),
  iqn_document_id uuid not null references roadops.iqn_documents(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'reviewed', 'approved', 'closed', 'cancelled')),
  source_reference text,
  created_by uuid not null references roadops.app_users(id) on delete restrict,
  reviewed_by uuid references roadops.app_users(id) on delete restrict,
  reviewed_at timestamptz,
  approved_by uuid references roadops.app_users(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint annual_program_review_ck check (
    (status = 'draft' and reviewed_by is null and reviewed_at is null and approved_by is null and approved_at is null)
    or (status = 'reviewed' and reviewed_by is not null and reviewed_at is not null and approved_by is null and approved_at is null)
    or (status in ('approved', 'closed') and reviewed_by is not null and reviewed_at is not null
        and approved_by is not null and approved_at is not null)
    or status = 'cancelled'
  ),
  unique (division_id, program_year)
);

create trigger annual_programs_set_updated_at
before update on roadops.annual_programs
for each row execute function roadops.set_updated_at();

create table roadops.annual_program_items (
  id uuid primary key default gen_random_uuid(),
  annual_program_id uuid not null references roadops.annual_programs(id) on delete restrict,
  road_id uuid not null references roadops.roads(id) on delete restrict,
  work_variant_id uuid not null references roadops.iqn_work_variants(id) on delete restrict,
  planned_quantity numeric(20,6) not null check (planned_quantity > 0),
  work_unit text not null check (btrim(work_unit) <> ''),
  planned_period daterange not null,
  note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint annual_program_item_period_ck check (
    not isempty(planned_period) and lower_inc(planned_period)
    and not upper_inc(planned_period)
  ),
  unique (annual_program_id, road_id, work_variant_id, planned_period)
);

create trigger annual_program_items_set_updated_at
before update on roadops.annual_program_items
for each row execute function roadops.set_updated_at();

create table roadops.planning_runs (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  annual_program_id uuid references roadops.annual_programs(id) on delete restrict,
  replaces_run_id uuid references roadops.planning_runs(id) on delete restrict,
  planning_window daterange not null,
  as_of timestamptz not null,
  algorithm_version text not null check (btrim(algorithm_version) <> ''),
  input_snapshot_hash bytea not null check (octet_length(input_snapshot_hash) = 32),
  status text not null default 'draft'
    check (status in ('draft', 'evaluated', 'approved', 'published', 'cancelled', 'superseded')),
  created_by uuid not null references roadops.app_users(id) on delete restrict,
  evaluated_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references roadops.app_users(id) on delete restrict,
  published_at timestamptz,
  published_by uuid references roadops.app_users(id) on delete restrict,
  cancellation_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1 check (row_version > 0),
  constraint planning_runs_window_ck check (
    not isempty(planning_window) and lower_inc(planning_window)
    and not upper_inc(planning_window)
  ),
  constraint planning_runs_state_ck check (
    (status = 'draft' and evaluated_at is null and approved_at is null and published_at is null)
    or (status = 'evaluated' and evaluated_at is not null and approved_at is null and published_at is null)
    or (status = 'approved' and evaluated_at is not null and approved_at is not null
        and approved_by is not null and published_at is null)
    or (status = 'published' and evaluated_at is not null and approved_at is not null
        and approved_by is not null and published_at is not null and published_by is not null)
    or (status in ('cancelled', 'superseded'))
  )
);

create index planning_runs_division_window_idx
  on roadops.planning_runs using gist (division_id, planning_window);

create trigger planning_runs_set_updated_at
before update on roadops.planning_runs
for each row execute function roadops.set_updated_at();

create table roadops.planning_run_inputs (
  id uuid primary key default gen_random_uuid(),
  planning_run_id uuid not null references roadops.planning_runs(id) on delete restrict,
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id uuid not null,
  source_version text,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  captured_at timestamptz not null,
  unique (planning_run_id, entity_type, entity_id)
);

create table roadops.plan_items (
  id uuid primary key default gen_random_uuid(),
  planning_run_id uuid not null references roadops.planning_runs(id) on delete restrict,
  defect_case_id uuid references roadops.defect_cases(id) on delete restrict,
  annual_program_item_id uuid references roadops.annual_program_items(id) on delete restrict,
  road_id uuid not null references roadops.roads(id) on delete restrict,
  work_variant_id uuid references roadops.iqn_work_variants(id) on delete restrict,
  chainage_span numrange not null,
  work_quantity numeric(20,6),
  work_unit text,
  formula_inputs jsonb not null default '{}'::jsonb,
  scheduled_window tstzrange,
  safety_scheme_id uuid references roadops.safety_schemes(id) on delete restrict,
  status text not null default 'candidate'
    check (status in ('candidate', 'blocked', 'ready', 'approved', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  planner_note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1 check (row_version > 0),
  constraint plan_items_origin_ck check (
    num_nonnulls(defect_case_id, annual_program_item_id) = 1
  ),
  constraint plan_items_chainage_ck check (
    not isempty(chainage_span) and lower_inc(chainage_span)
    and not upper_inc(chainage_span) and lower(chainage_span) >= 0
    and upper(chainage_span) > lower(chainage_span)
  ),
  constraint plan_items_quantity_ck check (
    (work_quantity is null and work_unit is null)
    or (work_quantity > 0 and coalesce(btrim(work_unit), '') <> '')
  ),
  constraint plan_items_schedule_ck check (
    scheduled_window is null
    or (not isempty(scheduled_window) and lower_inc(scheduled_window)
        and not upper_inc(scheduled_window) and lower(scheduled_window) < upper(scheduled_window))
  ),
  exclude using gist (
    road_id with =,
    chainage_span with &&,
    scheduled_window with &&
  ) where (status in ('approved', 'scheduled', 'in_progress'))
  deferrable initially immediate
);

create index plan_items_run_status_idx
  on roadops.plan_items (planning_run_id, status);
create index plan_items_defect_idx
  on roadops.plan_items (defect_case_id) where defect_case_id is not null;

create trigger plan_items_set_updated_at
before update on roadops.plan_items
for each row execute function roadops.set_updated_at();

create table roadops.planning_blockers (
  id uuid primary key default gen_random_uuid(),
  planning_run_id uuid not null references roadops.planning_runs(id) on delete restrict,
  plan_item_id uuid references roadops.plan_items(id) on delete restrict,
  blocker_code text not null check (blocker_code ~ '^[A-Z][A-Z0-9_]{2,95}$'),
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  deterministic_signature bytea not null check (octet_length(deterministic_signature) = 32),
  source text not null default 'engine' check (source in ('engine', 'validation')),
  detected_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  unique (planning_run_id, deterministic_signature),
  constraint planning_blockers_resolution_ck check (
    resolved_at is null or resolved_at >= detected_at
  )
);

create index planning_blockers_open_run_idx
  on roadops.planning_blockers (planning_run_id, blocker_code, plan_item_id)
  where resolved_at is null;

create table roadops.plan_resource_requirements (
  id uuid primary key default gen_random_uuid(),
  plan_item_id uuid not null references roadops.plan_items(id) on delete restrict,
  norm_line_id uuid not null references roadops.iqn_norm_lines(id) on delete restrict,
  resource_kind text not null
    check (resource_kind in ('labor', 'equipment', 'material', 'safety')),
  resource_code text not null check (btrim(resource_code) <> ''),
  required_quantity numeric(20,6) not null check (required_quantity > 0),
  unit text not null check (btrim(unit) <> ''),
  required_minutes integer check (required_minutes is null or required_minutes > 0),
  calculation jsonb not null,
  calculated_at timestamptz not null,
  unique (plan_item_id, norm_line_id)
);

create table roadops.work_assignments (
  id uuid primary key default gen_random_uuid(),
  plan_item_id uuid not null references roadops.plan_items(id) on delete restrict,
  labor_requirement_id uuid not null references roadops.plan_resource_requirements(id) on delete restrict,
  skill_requirement_id uuid not null references roadops.work_variant_skill_requirements(id) on delete restrict,
  worker_id uuid not null references roadops.workers(id) on delete restrict,
  work_date date not null,
  scheduled_window tstzrange not null,
  planned_minutes smallint not null check (planned_minutes between 1 and 420),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'accepted', 'in_progress', 'completed', 'cancelled')),
  assigned_by uuid not null references roadops.app_users(id) on delete restrict,
  assigned_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint work_assignments_window_ck check (
    not isempty(scheduled_window) and lower_inc(scheduled_window)
    and not upper_inc(scheduled_window) and lower(scheduled_window) < upper(scheduled_window)
    and work_date = (lower(scheduled_window) at time zone 'Asia/Tashkent')::date
    and work_date = ((upper(scheduled_window) - interval '1 microsecond') at time zone 'Asia/Tashkent')::date
  ),
  unique (plan_item_id, worker_id, scheduled_window)
);

create index work_assignments_worker_day_idx
  on roadops.work_assignments (worker_id, work_date)
  where status <> 'cancelled';

create trigger work_assignments_set_updated_at
before update on roadops.work_assignments
for each row execute function roadops.set_updated_at();

create table roadops.equipment_reservations (
  id uuid primary key default gen_random_uuid(),
  plan_item_id uuid not null references roadops.plan_items(id) on delete restrict,
  equipment_requirement_id uuid not null references roadops.plan_resource_requirements(id) on delete restrict,
  equipment_unit_id uuid not null references roadops.equipment_units(id) on delete restrict,
  reserved_window tstzrange not null,
  allocated_quantity numeric(20,6) not null check (allocated_quantity > 0),
  unit text not null check (btrim(unit) <> ''),
  status text not null default 'reserved'
    check (status in ('reserved', 'checked_out', 'returned', 'cancelled')),
  reserved_by uuid not null references roadops.app_users(id) on delete restrict,
  reserved_at timestamptz not null default clock_timestamp(),
  constraint equipment_reservations_window_ck check (
    not isempty(reserved_window) and lower_inc(reserved_window)
    and not upper_inc(reserved_window) and lower(reserved_window) < upper(reserved_window)
  ),
  exclude using gist (
    equipment_unit_id with =,
    reserved_window with &&
  ) where (status in ('reserved', 'checked_out'))
  deferrable initially immediate
);

create table roadops.material_reservations (
  id uuid primary key default gen_random_uuid(),
  plan_item_id uuid not null references roadops.plan_items(id) on delete restrict,
  material_requirement_id uuid not null references roadops.plan_resource_requirements(id) on delete restrict,
  stock_location_id uuid not null references roadops.stock_locations(id) on delete restrict,
  material_id uuid not null references roadops.materials(id) on delete restrict,
  quantity numeric(20,6) not null check (quantity > 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'issued', 'released', 'cancelled')),
  reserved_by uuid not null references roadops.app_users(id) on delete restrict,
  reserved_at timestamptz not null default clock_timestamp(),
  unique (plan_item_id, stock_location_id, material_id)
);

create table roadops.work_orders (
  id uuid primary key default gen_random_uuid(),
  plan_item_id uuid not null unique references roadops.plan_items(id) on delete restrict,
  order_number text not null unique check (btrim(order_number) <> ''),
  status text not null default 'issued'
    check (status in ('issued', 'accepted', 'in_progress', 'paused', 'completed', 'verified', 'cancelled')),
  issued_by uuid not null references roadops.app_users(id) on delete restrict,
  issued_at timestamptz not null default clock_timestamp(),
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references roadops.app_users(id) on delete restrict,
  cancellation_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1 check (row_version > 0),
  constraint work_orders_timeline_ck check (
    (accepted_at is null or accepted_at >= issued_at)
    and (started_at is null or (accepted_at is not null and started_at >= accepted_at))
    and (completed_at is null or (started_at is not null and completed_at >= started_at))
    and (verified_at is null or (completed_at is not null and verified_at >= completed_at))
  ),
  constraint work_orders_verification_ck check (
    (status = 'verified' and verified_at is not null and verified_by is not null)
    or status <> 'verified'
  ),
  constraint work_orders_cancel_ck check (
    status <> 'cancelled' or coalesce(btrim(cancellation_reason), '') <> ''
  )
);

create trigger work_orders_set_updated_at
before update on roadops.work_orders
for each row execute function roadops.set_updated_at();

create table roadops.work_order_events (
  id bigint generated always as identity primary key,
  work_order_id uuid not null references roadops.work_orders(id) on delete restrict,
  from_status text,
  to_status text not null,
  event_code text not null check (btrim(event_code) <> ''),
  actor_user_id uuid not null references roadops.app_users(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp(),
  note text,
  details jsonb not null default '{}'::jsonb,
  request_id uuid
);

create index work_order_events_order_idx
  on roadops.work_order_events (work_order_id, occurred_at, id);

create table roadops.time_entries (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references roadops.work_orders(id) on delete restrict,
  worker_id uuid not null references roadops.workers(id) on delete restrict,
  work_date date not null,
  actual_minutes smallint not null check (actual_minutes between 1 and 420),
  started_at timestamptz,
  ended_at timestamptz,
  note text,
  recorded_by uuid not null references roadops.app_users(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  approved_at timestamptz,
  approved_by uuid references roadops.app_users(id) on delete restrict,
  request_id uuid,
  constraint time_entries_window_ck check (
    (started_at is null and ended_at is null)
    or (started_at is not null and ended_at is not null and ended_at > started_at
        and work_date = (started_at at time zone 'Asia/Tashkent')::date
        and work_date = ((ended_at - interval '1 microsecond') at time zone 'Asia/Tashkent')::date)
  ),
  unique (work_order_id, worker_id, work_date, started_at)
);

create index time_entries_worker_day_idx
  on roadops.time_entries (worker_id, work_date);

create table roadops.work_completion_records (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null unique references roadops.work_orders(id) on delete restrict,
  completed_quantity numeric(20,6) not null check (completed_quantity > 0),
  work_unit text not null check (btrim(work_unit) <> ''),
  evidence jsonb not null default '[]'::jsonb,
  completion_note text,
  recorded_by uuid not null references roadops.app_users(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  verified_by uuid references roadops.app_users(id) on delete restrict,
  verified_at timestamptz,
  constraint work_completion_verification_ck check (
    (verified_by is null and verified_at is null)
    or (verified_by is not null and verified_at is not null and verified_at >= recorded_at)
  )
);

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
  if not exists (
    select 1 from roadops.worker_versions wv
    where wv.worker_id = new.worker_id and wv.division_id = item_division_id
      and wv.employment_state = 'active'
      and wv.valid_from <= lower(new.scheduled_window)
      and (wv.valid_until is null or wv.valid_until > lower(new.scheduled_window))
  ) or not exists (
    select 1 from roadops.worker_qualification_versions q
    where q.worker_id = new.worker_id and q.qualification_code = template_code
      and q.valid_from <= lower(new.scheduled_window)
      and (q.valid_until is null or q.valid_until > lower(new.scheduled_window))
  ) then
    raise exception using errcode = '23514', message = 'Worker does not satisfy the approved skill template';
  end if;
  return new;
end
$function$;

create trigger work_assignments_validate_links
before insert or update on roadops.work_assignments
for each row execute function roadops.validate_work_assignment_links();

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
  select coalesce(sum(a.planned_minutes), 0)::integer
  into assigned_minutes
  from roadops.work_assignments a
  where a.worker_id = checked_worker_id
    and a.work_date = checked_work_date
    and a.status <> 'cancelled';

  select wa.available_minutes
  into available_minutes
  from roadops.worker_availability wa
  where wa.worker_id = checked_worker_id
    and wa.work_date = checked_work_date
  order by wa.source_updated_at desc nulls last, wa.recorded_at desc
  limit 1;

  available_minutes := least(420, coalesce(available_minutes, 420));
  if assigned_minutes > available_minutes then
    raise exception using
      errcode = '23514',
      message = format(
        'Worker daily assignment is %s minutes; allowed maximum is %s minutes',
        assigned_minutes, available_minutes
      );
  end if;
end
$function$;

create or replace function roadops.enforce_worker_day_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform roadops.check_worker_day_capacity(old.worker_id, old.work_date);
  end if;
  if tg_op in ('INSERT', 'UPDATE')
     and (tg_op = 'INSERT' or (new.worker_id, new.work_date) is distinct from (old.worker_id, old.work_date)) then
    perform roadops.check_worker_day_capacity(new.worker_id, new.work_date);
  elsif tg_op = 'INSERT' then
    perform roadops.check_worker_day_capacity(new.worker_id, new.work_date);
  end if;
  return null;
end
$function$;

create constraint trigger work_assignments_daily_capacity
after insert or update or delete on roadops.work_assignments
deferrable initially deferred
for each row execute function roadops.enforce_worker_day_capacity();

create or replace function roadops.check_actual_day_capacity(
  checked_worker_id uuid,
  checked_work_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  recorded_minutes integer;
begin
  select coalesce(sum(t.actual_minutes), 0)::integer
  into recorded_minutes
  from roadops.time_entries t
  where t.worker_id = checked_worker_id and t.work_date = checked_work_date;
  if recorded_minutes > 420 then
    raise exception using
      errcode = '23514',
      message = format('Worker daily actual time is %s minutes; maximum is 420 minutes', recorded_minutes);
  end if;
end
$function$;

create or replace function roadops.enforce_actual_day_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform roadops.check_actual_day_capacity(old.worker_id, old.work_date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform roadops.check_actual_day_capacity(new.worker_id, new.work_date);
  end if;
  return null;
end
$function$;

create constraint trigger time_entries_daily_capacity
after insert or update or delete on roadops.time_entries
deferrable initially deferred
for each row execute function roadops.enforce_actual_day_capacity();

create or replace function roadops.validate_equipment_reservation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from roadops.plan_resource_requirements pr
    join roadops.iqn_norm_lines nl on nl.id = pr.norm_line_id
    join roadops.equipment_units e on e.id = new.equipment_unit_id
    join roadops.plan_items pi on pi.id = new.plan_item_id
    join roadops.planning_runs run on run.id = pi.planning_run_id
    where pr.id = new.equipment_requirement_id
      and pr.plan_item_id = new.plan_item_id
      and pr.resource_kind = 'equipment'
      and pr.unit = new.unit
      and e.iqn_resource_id = nl.resource_id
      and e.division_id = run.division_id
      and e.state = 'active'
  ) then
    raise exception using errcode = '23514', message = 'Equipment does not match the IQN equipment norm line';
  end if;
  if new.status in ('reserved', 'checked_out') and exists (
    select 1
    from roadops.equipment_unavailability u
    where u.equipment_unit_id = new.equipment_unit_id
      and u.unavailable_window && new.reserved_window
  ) then
    raise exception using errcode = '23P01', message = 'Equipment is unavailable in the requested window';
  end if;
  return new;
end
$function$;

create trigger equipment_reservations_validate
before insert or update on roadops.equipment_reservations
for each row execute function roadops.validate_equipment_reservation();

create or replace function roadops.validate_material_reservation_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if not exists (
    select 1
    from roadops.plan_resource_requirements pr
    join roadops.iqn_norm_lines nl on nl.id = pr.norm_line_id
    join roadops.materials m on m.id = new.material_id
    join roadops.stock_locations sl on sl.id = new.stock_location_id
    join roadops.planning_runs run on run.division_id = sl.division_id
    join roadops.plan_items pi on pi.planning_run_id = run.id and pi.id = new.plan_item_id
    where pr.id = new.material_requirement_id
      and pr.plan_item_id = new.plan_item_id
      and pr.resource_kind = 'material'
      and m.iqn_resource_id = nl.resource_id
      and m.active and sl.active
  ) then
    raise exception using errcode = '23514', message = 'Material or stock location does not match the IQN material norm line';
  end if;
  return new;
end
$function$;

create trigger material_reservations_validate_links
before insert or update on roadops.material_reservations
for each row execute function roadops.validate_material_reservation_link();

create or replace function roadops.check_material_reservation(
  checked_location_id uuid,
  checked_material_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  on_hand numeric(20,6);
  reserved numeric(20,6);
begin
  select coalesce(sum(t.quantity_delta), 0) into on_hand
  from roadops.inventory_transactions t
  where t.stock_location_id = checked_location_id
    and t.material_id = checked_material_id;

  select coalesce(sum(r.quantity), 0) into reserved
  from roadops.material_reservations r
  where r.stock_location_id = checked_location_id
    and r.material_id = checked_material_id
    and r.status = 'reserved';

  if reserved > on_hand then
    raise exception using errcode = '23514', message = 'Material reservations exceed on-hand stock';
  end if;
end
$function$;

create or replace function roadops.enforce_material_reservation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform roadops.check_material_reservation(old.stock_location_id, old.material_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform roadops.check_material_reservation(new.stock_location_id, new.material_id);
  end if;
  return null;
end
$function$;

create constraint trigger material_reservations_stock_guard
after insert or update or delete on roadops.material_reservations
deferrable initially deferred
for each row execute function roadops.enforce_material_reservation();

create trigger inventory_transactions_append_only
before update or delete on roadops.inventory_transactions
for each row execute function roadops.forbid_mutation();
create trigger inventory_transactions_no_truncate
before truncate on roadops.inventory_transactions
for each statement execute function roadops.forbid_mutation();

create trigger work_order_events_append_only
before update or delete on roadops.work_order_events
for each row execute function roadops.forbid_mutation();
create trigger work_order_events_no_truncate
before truncate on roadops.work_order_events
for each statement execute function roadops.forbid_mutation();

revoke all on function roadops.check_worker_day_capacity(uuid, date) from public;
revoke all on function roadops.validate_work_assignment_links() from public;
revoke all on function roadops.enforce_worker_day_capacity() from public;
revoke all on function roadops.check_actual_day_capacity(uuid, date) from public;
revoke all on function roadops.enforce_actual_day_capacity() from public;
revoke all on function roadops.validate_equipment_reservation() from public;
revoke all on function roadops.validate_material_reservation_link() from public;
revoke all on function roadops.check_material_reservation(uuid, uuid) from public;
revoke all on function roadops.enforce_material_reservation() from public;

commit;
