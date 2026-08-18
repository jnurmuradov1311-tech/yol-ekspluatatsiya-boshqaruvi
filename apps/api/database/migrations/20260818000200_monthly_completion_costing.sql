begin;

-- Monetary rates are deliberately separate from IQN norms. IQN remains the
-- technical quantity source; this ledger supplies approved local UZS prices.
insert into roadops.permissions (code, description) values
  ('execution.verify', 'Independently verify completed work orders'),
  ('costs.read', 'Read approved cost rates and monthly completion acts'),
  ('costs.manage', 'Prepare cost rates, actual usages, and monthly completion acts'),
  ('costs.approve', 'Independently approve cost rates, time norms, and monthly acts')
on conflict (code) do nothing;

insert into roadops.role_permissions (role_id, permission_id)
select r.id, p.id
from roadops.roles r
join roadops.permissions p on (
  (r.code in ('system_admin', 'division_manager')
    and p.code in ('execution.verify', 'costs.read', 'costs.manage', 'costs.approve'))
  or (r.code = 'dispatcher' and p.code in ('costs.read', 'costs.manage'))
  or (r.code in ('planner', 'auditor') and p.code = 'costs.read')
)
on conflict do nothing;

create table roadops.cost_rate_versions (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  rate_kind text not null check (rate_kind in ('labor', 'material', 'equipment')),
  worker_id uuid references roadops.workers(id) on delete restrict,
  material_id uuid references roadops.materials(id) on delete restrict,
  equipment_unit_id uuid references roadops.equipment_units(id) on delete restrict,
  schedule_code text,
  rate_basis text not null
    check (rate_basis in ('monthly_salary', 'material_unit', 'machine_hour')),
  pricing_unit text not null check (btrim(pricing_unit) <> ''),
  rate_amount_uzs numeric(24,6) not null check (rate_amount_uzs > 0),
  bonus_rate_bps integer not null default 0 check (bonus_rate_bps between 0 and 20000),
  traffic_allowance_rate_bps integer not null default 0
    check (traffic_allowance_rate_bps between 0 and 20000),
  travel_allowance_rate_bps integer not null default 0
    check (travel_allowance_rate_bps between 0 and 20000),
  social_contribution_rate_bps integer not null default 0
    check (social_contribution_rate_bps between 0 and 10000),
  currency char(3) not null default 'UZS' check (currency = 'UZS'),
  effective_period daterange not null,
  version_no integer not null check (version_no > 0),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  source_reference text not null check (btrim(source_reference) <> ''),
  created_by uuid not null references roadops.app_users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  approved_by uuid references roadops.app_users(id) on delete restrict,
  approved_at timestamptz,
  constraint cost_rate_versions_target_ck check (
    (rate_kind = 'labor'
      and worker_id is not null and material_id is null and equipment_unit_id is null
      and rate_basis = 'monthly_salary' and pricing_unit = 'month'
      and coalesce(btrim(schedule_code), '') <> '')
    or (rate_kind = 'material'
      and worker_id is null and material_id is not null and equipment_unit_id is null
      and rate_basis = 'material_unit' and schedule_code is null
      and bonus_rate_bps = 0 and traffic_allowance_rate_bps = 0
      and travel_allowance_rate_bps = 0 and social_contribution_rate_bps = 0)
    or (rate_kind = 'equipment'
      and worker_id is null and material_id is null and equipment_unit_id is not null
      and rate_basis = 'machine_hour' and pricing_unit = 'machine_hour'
      and schedule_code is null
      and bonus_rate_bps = 0 and traffic_allowance_rate_bps = 0
      and travel_allowance_rate_bps = 0 and social_contribution_rate_bps = 0)
  ),
  constraint cost_rate_versions_period_ck check (
    not isempty(effective_period)
    and lower_inc(effective_period) and not upper_inc(effective_period)
    and lower(effective_period) is not null and upper(effective_period) is not null
    and lower(effective_period) < upper(effective_period)
  ),
  constraint cost_rate_versions_approval_ck check (
    (status = 'draft' and approved_by is null and approved_at is null)
    or (status = 'approved' and approved_by is not null and approved_at is not null
      and approved_by <> created_by and approved_at >= created_at)
  )
);

create unique index cost_rate_versions_labor_version_uk
  on roadops.cost_rate_versions (division_id, worker_id, version_no)
  where rate_kind = 'labor';
create unique index cost_rate_versions_material_version_uk
  on roadops.cost_rate_versions (division_id, material_id, version_no)
  where rate_kind = 'material';
create unique index cost_rate_versions_equipment_version_uk
  on roadops.cost_rate_versions (division_id, equipment_unit_id, version_no)
  where rate_kind = 'equipment';
alter table roadops.cost_rate_versions add constraint cost_rate_versions_labor_period_excl
  exclude using gist (division_id with =, worker_id with =, effective_period with &&)
  where (status = 'approved' and rate_kind = 'labor');
alter table roadops.cost_rate_versions add constraint cost_rate_versions_material_period_excl
  exclude using gist (division_id with =, material_id with =, effective_period with &&)
  where (status = 'approved' and rate_kind = 'material');
alter table roadops.cost_rate_versions add constraint cost_rate_versions_equipment_period_excl
  exclude using gist (division_id with =, equipment_unit_id with =, effective_period with &&)
  where (status = 'approved' and rate_kind = 'equipment');

create table roadops.monthly_work_time_norms (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  work_month date not null,
  schedule_code text not null check (btrim(schedule_code) <> ''),
  working_days smallint not null check (working_days between 1 and 31),
  norm_minutes integer not null check (norm_minutes between 1 and 44640),
  version_no integer not null check (version_no > 0),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  source_reference text not null check (btrim(source_reference) <> ''),
  created_by uuid not null references roadops.app_users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  approved_by uuid references roadops.app_users(id) on delete restrict,
  approved_at timestamptz,
  constraint monthly_work_time_norms_month_ck check (
    work_month = date_trunc('month', work_month)::date
  ),
  constraint monthly_work_time_norms_approval_ck check (
    (status = 'draft' and approved_by is null and approved_at is null)
    or (status = 'approved' and approved_by is not null and approved_at is not null
      and approved_by <> created_by and approved_at >= created_at)
  ),
  unique (division_id, work_month, schedule_code, version_no)
);

create unique index monthly_work_time_norms_one_approved_idx
  on roadops.monthly_work_time_norms (division_id, work_month, schedule_code)
  where status = 'approved';

create table roadops.work_order_material_usages (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references roadops.work_orders(id) on delete restrict,
  material_reservation_id uuid not null unique
    references roadops.material_reservations(id) on delete restrict,
  inventory_transaction_id uuid not null unique
    references roadops.inventory_transactions(id) on delete restrict,
  stock_location_id uuid not null references roadops.stock_locations(id) on delete restrict,
  material_id uuid not null references roadops.materials(id) on delete restrict,
  quantity numeric(20,6) not null check (quantity > 0),
  unit text not null check (btrim(unit) <> ''),
  used_at timestamptz not null,
  status text not null default 'recorded' check (status in ('recorded', 'approved')),
  recorded_by uuid not null references roadops.app_users(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  approved_by uuid references roadops.app_users(id) on delete restrict,
  approved_at timestamptz,
  request_id uuid,
  constraint work_order_material_usages_approval_ck check (
    (status = 'recorded' and approved_by is null and approved_at is null)
    or (status = 'approved' and approved_by is not null and approved_at is not null
      and approved_by <> recorded_by and approved_at >= recorded_at)
  )
);

create index work_order_material_usages_order_idx
  on roadops.work_order_material_usages (work_order_id, used_at, id);

create table roadops.equipment_usage_entries (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references roadops.work_orders(id) on delete restrict,
  equipment_reservation_id uuid not null unique
    references roadops.equipment_reservations(id) on delete restrict,
  equipment_unit_id uuid not null references roadops.equipment_units(id) on delete restrict,
  usage_date date not null,
  actual_machine_minutes integer not null check (actual_machine_minutes between 1 and 1440),
  started_at timestamptz,
  ended_at timestamptz,
  note text,
  status text not null default 'recorded' check (status in ('recorded', 'approved')),
  recorded_by uuid not null references roadops.app_users(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  approved_by uuid references roadops.app_users(id) on delete restrict,
  approved_at timestamptz,
  request_id uuid,
  constraint equipment_usage_entries_window_ck check (
    (started_at is null and ended_at is null)
    or (started_at is not null and ended_at is not null and ended_at > started_at
      and usage_date = (started_at at time zone 'Asia/Tashkent')::date
      and usage_date = ((ended_at - interval '1 microsecond') at time zone 'Asia/Tashkent')::date
      and extract(epoch from (ended_at - started_at)) = actual_machine_minutes * 60)
  ),
  constraint equipment_usage_entries_approval_ck check (
    (status = 'recorded' and approved_by is null and approved_at is null)
    or (status = 'approved' and approved_by is not null and approved_at is not null
      and approved_by <> recorded_by and approved_at >= recorded_at)
  )
);

create index equipment_usage_entries_order_idx
  on roadops.equipment_usage_entries (work_order_id, usage_date, id);
create unique index time_entries_daily_aggregate_uk
  on roadops.time_entries (work_order_id, worker_id, work_date)
  where started_at is null;
create unique index equipment_usage_entries_window_uk
  on roadops.equipment_usage_entries (
    work_order_id, equipment_unit_id, usage_date, started_at
  ) where started_at is not null;
create unique index equipment_usage_entries_daily_aggregate_uk
  on roadops.equipment_usage_entries (work_order_id, equipment_unit_id, usage_date)
  where started_at is null;
alter table roadops.equipment_usage_entries
  add constraint equipment_usage_entries_no_overlap_excl
  exclude using gist (
    equipment_unit_id with =,
    tstzrange(started_at, ended_at, '[)') with &&
  ) where (started_at is not null);

create table roadops.monthly_completion_acts (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  division_name_snapshot text not null check (btrim(division_name_snapshot) <> ''),
  act_number text not null check (btrim(act_number) <> ''),
  act_month date not null,
  currency char(3) not null default 'UZS' check (currency = 'UZS'),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved')),
  labor_amount_uzs numeric(24,2) not null default 0 check (labor_amount_uzs >= 0),
  social_amount_uzs numeric(24,2) not null default 0 check (social_amount_uzs >= 0),
  material_amount_uzs numeric(24,2) not null default 0 check (material_amount_uzs >= 0),
  equipment_amount_uzs numeric(24,2) not null default 0 check (equipment_amount_uzs >= 0),
  total_amount_uzs numeric(24,2) not null default 0 check (total_amount_uzs >= 0),
  snapshot_hash bytea,
  created_by uuid not null references roadops.app_users(id) on delete restrict,
  created_by_name_snapshot text not null check (btrim(created_by_name_snapshot) <> ''),
  created_at timestamptz not null default clock_timestamp(),
  submitted_by uuid references roadops.app_users(id) on delete restrict,
  submitted_by_name_snapshot text,
  submitted_at timestamptz,
  approved_by uuid references roadops.app_users(id) on delete restrict,
  approved_by_name_snapshot text,
  approved_at timestamptz,
  row_version bigint not null default 1 check (row_version > 0),
  constraint monthly_completion_acts_month_ck check (
    act_month = date_trunc('month', act_month)::date
  ),
  constraint monthly_completion_acts_total_ck check (
    total_amount_uzs = labor_amount_uzs + social_amount_uzs
      + material_amount_uzs + equipment_amount_uzs
  ),
  constraint monthly_completion_acts_hash_ck check (
    snapshot_hash is null or octet_length(snapshot_hash) = 32
  ),
  constraint monthly_completion_acts_state_ck check (
    (status = 'draft' and submitted_by is null and submitted_by_name_snapshot is null
      and submitted_at is null and approved_by is null and approved_by_name_snapshot is null
      and approved_at is null and snapshot_hash is null)
    or (status = 'submitted' and submitted_by is not null and submitted_at is not null
      and btrim(submitted_by_name_snapshot) <> ''
      and approved_by is null and approved_by_name_snapshot is null
      and approved_at is null and snapshot_hash is not null
      and submitted_at >= created_at)
    or (status = 'approved' and submitted_by is not null and submitted_at is not null
      and approved_by is not null and approved_at is not null and snapshot_hash is not null
      and btrim(submitted_by_name_snapshot) <> '' and btrim(approved_by_name_snapshot) <> ''
      and approved_by <> created_by and approved_by <> submitted_by
      and submitted_at >= created_at and approved_at >= submitted_at)
  ),
  unique (division_id, act_number),
  unique (division_id, act_month)
);

create or replace function roadops.prepare_monthly_completion_act()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  select dv.name into new.division_name_snapshot
  from roadops.road_division_versions dv
  where dv.division_id = new.division_id and dv.valid_until is null;
  select u.full_name into new.created_by_name_snapshot
  from roadops.app_users u where u.id = new.created_by;
  if coalesce(btrim(new.division_name_snapshot), '') = ''
     or coalesce(btrim(new.created_by_name_snapshot), '') = '' then
    raise exception using errcode = '23514',
      message = 'Monthly act requires current division and preparer display snapshots';
  end if;
  return new;
end
$function$;

create trigger monthly_completion_acts_prepare
before insert on roadops.monthly_completion_acts
for each row execute function roadops.prepare_monthly_completion_act();

create table roadops.monthly_completion_act_items (
  id uuid primary key default gen_random_uuid(),
  act_id uuid not null references roadops.monthly_completion_acts(id) on delete restrict,
  work_order_id uuid not null unique references roadops.work_orders(id) on delete restrict,
  completion_record_id uuid not null unique
    references roadops.work_completion_records(id) on delete restrict,
  order_number_snapshot text not null check (btrim(order_number_snapshot) <> ''),
  road_code_snapshot text not null check (btrim(road_code_snapshot) <> ''),
  road_name_snapshot text not null check (btrim(road_name_snapshot) <> ''),
  road_id_snapshot uuid not null,
  work_variant_id_snapshot uuid not null,
  annual_program_item_id_snapshot uuid,
  work_code_snapshot text not null check (btrim(work_code_snapshot) <> ''),
  work_name_snapshot text not null check (btrim(work_name_snapshot) <> ''),
  norm_reference_snapshot text not null check (btrim(norm_reference_snapshot) <> ''),
  completed_at_snapshot timestamptz not null,
  completed_quantity numeric(20,6) not null check (completed_quantity > 0),
  work_unit text not null check (btrim(work_unit) <> ''),
  annual_planned_quantity_snapshot numeric(20,6) not null default 0
    check (annual_planned_quantity_snapshot >= 0),
  year_to_date_quantity_snapshot numeric(20,6) not null default 0
    check (year_to_date_quantity_snapshot >= 0),
  year_to_date_amount_uzs_snapshot numeric(24,2) not null default 0
    check (year_to_date_amount_uzs_snapshot >= 0),
  labor_amount_uzs numeric(24,2) not null default 0 check (labor_amount_uzs >= 0),
  social_amount_uzs numeric(24,2) not null default 0 check (social_amount_uzs >= 0),
  material_amount_uzs numeric(24,2) not null default 0 check (material_amount_uzs >= 0),
  equipment_amount_uzs numeric(24,2) not null default 0 check (equipment_amount_uzs >= 0),
  total_amount_uzs numeric(24,2) not null default 0 check (total_amount_uzs >= 0),
  created_at timestamptz not null default clock_timestamp(),
  constraint monthly_completion_act_items_total_ck check (
    total_amount_uzs = labor_amount_uzs + social_amount_uzs
      + material_amount_uzs + equipment_amount_uzs
  )
);

create index monthly_completion_act_items_act_idx
  on roadops.monthly_completion_act_items (act_id, completed_at_snapshot, id);

create table roadops.monthly_completion_act_cost_lines (
  id uuid primary key default gen_random_uuid(),
  act_item_id uuid not null references roadops.monthly_completion_act_items(id) on delete restrict,
  line_kind text not null check (line_kind in ('labor', 'material', 'equipment')),
  time_entry_id uuid references roadops.time_entries(id) on delete restrict,
  material_usage_id uuid references roadops.work_order_material_usages(id) on delete restrict,
  equipment_usage_entry_id uuid references roadops.equipment_usage_entries(id) on delete restrict,
  cost_rate_version_id uuid not null references roadops.cost_rate_versions(id) on delete restrict,
  monthly_work_time_norm_id uuid references roadops.monthly_work_time_norms(id) on delete restrict,
  resource_code_snapshot text not null check (btrim(resource_code_snapshot) <> ''),
  resource_name_snapshot text not null check (btrim(resource_name_snapshot) <> ''),
  resource_detail_snapshot text not null default '',
  source_quantity numeric(20,6) not null check (source_quantity > 0),
  source_unit text not null check (btrim(source_unit) <> ''),
  rate_basis_snapshot text not null
    check (rate_basis_snapshot in ('monthly_salary', 'material_unit', 'machine_hour')),
  rate_amount_uzs numeric(24,6) not null check (rate_amount_uzs > 0),
  bonus_rate_bps integer not null default 0 check (bonus_rate_bps between 0 and 20000),
  traffic_allowance_rate_bps integer not null default 0
    check (traffic_allowance_rate_bps between 0 and 20000),
  travel_allowance_rate_bps integer not null default 0
    check (travel_allowance_rate_bps between 0 and 20000),
  social_contribution_rate_bps integer not null default 0
    check (social_contribution_rate_bps between 0 and 10000),
  rate_denominator_quantity numeric(20,6) not null check (rate_denominator_quantity > 0),
  unit_rate_uzs numeric(24,6) not null check (unit_rate_uzs > 0),
  base_wage_amount_uzs numeric(24,2) not null default 0 check (base_wage_amount_uzs >= 0),
  bonus_amount_uzs numeric(24,2) not null default 0 check (bonus_amount_uzs >= 0),
  traffic_allowance_amount_uzs numeric(24,2) not null default 0
    check (traffic_allowance_amount_uzs >= 0),
  travel_allowance_amount_uzs numeric(24,2) not null default 0
    check (travel_allowance_amount_uzs >= 0),
  social_amount_uzs numeric(24,2) not null default 0 check (social_amount_uzs >= 0),
  amount_uzs numeric(24,2) not null check (amount_uzs > 0),
  currency char(3) not null default 'UZS' check (currency = 'UZS'),
  created_at timestamptz not null default clock_timestamp(),
  constraint monthly_completion_act_cost_lines_source_ck check (
    (line_kind = 'labor' and time_entry_id is not null
      and material_usage_id is null and equipment_usage_entry_id is null
      and monthly_work_time_norm_id is not null)
    or (line_kind = 'material' and time_entry_id is null
      and material_usage_id is not null and equipment_usage_entry_id is null
      and monthly_work_time_norm_id is null)
    or (line_kind = 'equipment' and time_entry_id is null
      and material_usage_id is null and equipment_usage_entry_id is not null
      and monthly_work_time_norm_id is null)
  ),
  constraint monthly_completion_act_cost_lines_labor_components_ck check (
    (line_kind = 'labor' and amount_uzs = base_wage_amount_uzs + bonus_amount_uzs
      + traffic_allowance_amount_uzs + travel_allowance_amount_uzs + social_amount_uzs)
    or (line_kind <> 'labor' and base_wage_amount_uzs = 0 and bonus_amount_uzs = 0
      and traffic_allowance_amount_uzs = 0 and travel_allowance_amount_uzs = 0
      and social_amount_uzs = 0 and bonus_rate_bps = 0
      and traffic_allowance_rate_bps = 0 and travel_allowance_rate_bps = 0
      and social_contribution_rate_bps = 0)
  )
);

create unique index monthly_act_cost_lines_time_source_uk
  on roadops.monthly_completion_act_cost_lines (time_entry_id)
  where time_entry_id is not null;
create unique index monthly_act_cost_lines_material_source_uk
  on roadops.monthly_completion_act_cost_lines (material_usage_id)
  where material_usage_id is not null;
create unique index monthly_act_cost_lines_equipment_source_uk
  on roadops.monthly_completion_act_cost_lines (equipment_usage_entry_id)
  where equipment_usage_entry_id is not null;
create index monthly_act_cost_lines_item_idx
  on roadops.monthly_completion_act_cost_lines (act_item_id, line_kind, id);

create or replace function roadops.validate_cost_rate_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  material_unit text;
  equipment_division_id uuid;
begin
  if new.rate_kind = 'labor' then
    if not exists (
      select 1
      from roadops.worker_division_assignments a
      where a.worker_id = new.worker_id and a.division_id = new.division_id
        and a.valid_from <= lower(new.effective_period)
        and (a.valid_until is null or a.valid_until >= upper(new.effective_period))
    ) then
      raise exception using errcode = '23514',
        message = 'Labor rate period must be covered by the worker division assignment';
    end if;
  elsif new.rate_kind = 'material' then
    select m.unit into material_unit from roadops.materials m where m.id = new.material_id;
    if material_unit is null or new.pricing_unit <> material_unit then
      raise exception using errcode = '23514',
        message = 'Material rate pricing unit must match the material master unit';
    end if;
  elsif new.rate_kind = 'equipment' then
    select e.division_id into equipment_division_id
    from roadops.equipment_units e where e.id = new.equipment_unit_id;
    if equipment_division_id is distinct from new.division_id then
      raise exception using errcode = '23514',
        message = 'Equipment rate must belong to the equipment division';
    end if;
  end if;
  return new;
end
$function$;

create trigger cost_rate_versions_validate
before insert or update on roadops.cost_rate_versions
for each row execute function roadops.validate_cost_rate_version();

create or replace function roadops.guard_approved_costing_record()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  previous_status text := to_jsonb(old) ->> 'status';
begin
  if previous_status = 'approved' then
    raise exception using errcode = '55000',
      message = 'Approved costing records are immutable';
  end if;
  if tg_op = 'UPDATE' then
    if tg_table_name in ('cost_rate_versions', 'monthly_work_time_norms')
       and (to_jsonb(old) ->> 'created_by') is distinct from (to_jsonb(new) ->> 'created_by') then
      raise exception using errcode = '23514', message = 'Cost record creator is immutable';
    elsif tg_table_name in ('work_order_material_usages', 'equipment_usage_entries')
       and (to_jsonb(old) ->> 'recorded_by') is distinct from (to_jsonb(new) ->> 'recorded_by') then
      raise exception using errcode = '23514', message = 'Usage recorder is immutable';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

create trigger cost_rate_versions_immutable_after_approval
before update or delete on roadops.cost_rate_versions
for each row execute function roadops.guard_approved_costing_record();
create trigger monthly_work_time_norms_immutable_after_approval
before update or delete on roadops.monthly_work_time_norms
for each row execute function roadops.guard_approved_costing_record();
create trigger work_order_material_usages_immutable_after_approval
before update or delete on roadops.work_order_material_usages
for each row execute function roadops.guard_approved_costing_record();
create trigger equipment_usage_entries_immutable_after_approval
before update or delete on roadops.equipment_usage_entries
for each row execute function roadops.guard_approved_costing_record();

create or replace function roadops.validate_work_order_material_usage()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  order_row roadops.work_orders%rowtype;
  transaction_row roadops.inventory_transactions%rowtype;
  reservation_row roadops.material_reservations%rowtype;
  material_unit text;
  order_division_id uuid;
  location_division_id uuid;
begin
  select wo.* into order_row from roadops.work_orders wo where wo.id = new.work_order_id;
  select tx.* into transaction_row
  from roadops.inventory_transactions tx where tx.id = new.inventory_transaction_id;
  select mr.* into reservation_row
  from roadops.material_reservations mr where mr.id = new.material_reservation_id;
  select m.unit into material_unit from roadops.materials m where m.id = new.material_id;
  select s.division_id into location_division_id
  from roadops.stock_locations s where s.id = new.stock_location_id;
  order_division_id := roadops.division_for_work_order(new.work_order_id);

  if order_row.id is null or order_row.status in ('issued', 'accepted', 'cancelled')
     or order_row.started_at is null or new.used_at < order_row.started_at
     or (order_row.completed_at is not null and new.used_at > order_row.completed_at) then
    raise exception using errcode = '23514',
      message = 'Material usage must fall within an active work order timeline';
  end if;
  if location_division_id is distinct from order_division_id then
    raise exception using errcode = '23514',
      message = 'Material issue stock location must belong to the work order division';
  end if;
  if reservation_row.id is null
     or reservation_row.plan_item_id is distinct from order_row.plan_item_id
     or reservation_row.stock_location_id is distinct from new.stock_location_id
     or reservation_row.material_id is distinct from new.material_id
     or new.quantity > reservation_row.quantity
     or reservation_row.status not in ('reserved', 'issued') then
    raise exception using errcode = '23514',
      message = 'Material usage must reference an available reservation and not exceed its quantity';
  end if;
  if material_unit is null or new.unit <> material_unit then
    raise exception using errcode = '23514',
      message = 'Material usage unit must match the material master unit';
  end if;
  if transaction_row.id is null
     or transaction_row.transaction_kind <> 'issue'
     or transaction_row.stock_location_id is distinct from new.stock_location_id
     or transaction_row.material_id is distinct from new.material_id
     or transaction_row.quantity_delta is distinct from -new.quantity
     or transaction_row.occurred_at is distinct from new.used_at
     or transaction_row.reference_type <> 'work_order_material_usage'
     or transaction_row.reference_id is distinct from new.id
     or transaction_row.recorded_by is distinct from new.recorded_by then
    raise exception using errcode = '23514',
      message = 'Material usage must exactly match one inventory issue transaction';
  end if;
  return new;
end
$function$;

create trigger work_order_material_usages_validate
before insert or update on roadops.work_order_material_usages
for each row execute function roadops.validate_work_order_material_usage();

create or replace function roadops.validate_equipment_usage_entry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  order_row roadops.work_orders%rowtype;
  reservation_row roadops.equipment_reservations%rowtype;
  equipment_division_id uuid;
  order_division_id uuid;
begin
  select wo.* into order_row from roadops.work_orders wo where wo.id = new.work_order_id;
  select er.* into reservation_row
  from roadops.equipment_reservations er where er.id = new.equipment_reservation_id;
  select e.division_id into equipment_division_id
  from roadops.equipment_units e where e.id = new.equipment_unit_id;
  order_division_id := roadops.division_for_work_order(new.work_order_id);

  if order_row.id is null or order_row.status in ('issued', 'accepted', 'cancelled')
     or order_row.started_at is null
     or new.usage_date < (order_row.started_at at time zone 'Asia/Tashkent')::date
     or (order_row.completed_at is not null
       and new.usage_date > (order_row.completed_at at time zone 'Asia/Tashkent')::date)
     or (new.started_at is not null and new.started_at < order_row.started_at)
     or (new.ended_at is not null and order_row.completed_at is not null
       and new.ended_at > order_row.completed_at) then
    raise exception using errcode = '23514',
      message = 'Equipment usage must fall within an active work order timeline';
  end if;
  if equipment_division_id is distinct from order_division_id then
    raise exception using errcode = '23514',
      message = 'Equipment usage must belong to the work order division';
  end if;
  if reservation_row.id is null
     or reservation_row.plan_item_id is distinct from order_row.plan_item_id
     or reservation_row.equipment_unit_id is distinct from new.equipment_unit_id
     or (
       reservation_row.status not in ('reserved', 'checked_out')
       and not (
         tg_op = 'UPDATE' and reservation_row.status = 'returned'
         and old.equipment_reservation_id = new.equipment_reservation_id
         and old.work_order_id = new.work_order_id
       )
     )
     or new.actual_machine_minutes > floor(
       extract(epoch from (upper(reservation_row.reserved_window) - lower(reservation_row.reserved_window))) / 60
     )::integer
     or not (
       new.usage_date <@ daterange(
         (lower(reservation_row.reserved_window) at time zone 'Asia/Tashkent')::date,
         ((upper(reservation_row.reserved_window) at time zone 'Asia/Tashkent')::date + 1),
         '[)'
       )
     ) then
    raise exception using errcode = '23514',
      message = 'Equipment usage must exactly reference an available reservation for the work order';
  end if;
  return new;
end
$function$;

create trigger equipment_usage_entries_validate
before insert or update on roadops.equipment_usage_entries
for each row execute function roadops.validate_equipment_usage_entry();

create or replace function roadops.sync_plan_item_execution_status(
  p_work_order_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  order_row roadops.work_orders%rowtype;
  division_id uuid;
begin
  if p_status not in ('in_progress', 'completed') then
    raise exception using errcode = '22023', message = 'Unsupported plan execution status';
  end if;
  select wo.* into order_row
  from roadops.work_orders wo where wo.id = p_work_order_id for update;
  if not found or order_row.status <> p_status then
    raise exception using errcode = '55000',
      message = 'Work order must reach the matching status before its plan item';
  end if;
  division_id := roadops.division_for_work_order(p_work_order_id);
  if roadops.current_actor_id() is null
     or not roadops.has_permission('execution.manage', division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot transition this plan item';
  end if;
  update roadops.plan_items
  set status = p_status
  where id = order_row.plan_item_id
    and status in ('scheduled', 'in_progress', p_status);
  if not found then
    raise exception using errcode = '55000', message = 'Plan item execution status transition rejected';
  end if;
end
$function$;

create or replace function roadops.finalize_material_reservation_for_usage(p_usage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  usage_row roadops.work_order_material_usages%rowtype;
  reservation_status text;
  division_id uuid;
begin
  select u.* into usage_row
  from roadops.work_order_material_usages u where u.id = p_usage_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Material usage not found';
  end if;
  division_id := roadops.division_for_work_order(usage_row.work_order_id);
  if roadops.current_actor_id() is null
     or roadops.current_actor_id() <> usage_row.recorded_by
     or not roadops.has_permission('execution.manage', division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot consume this material reservation';
  end if;
  select mr.status into reservation_status
  from roadops.material_reservations mr
  where mr.id = usage_row.material_reservation_id for update;
  if reservation_status not in ('reserved', 'issued') then
    raise exception using errcode = '55000', message = 'Material reservation is not consumable';
  end if;
  update roadops.material_reservations set status = 'issued'
  where id = usage_row.material_reservation_id;
end
$function$;

create or replace function roadops.finalize_equipment_reservation_for_usage(p_usage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  usage_row roadops.equipment_usage_entries%rowtype;
  reservation_status text;
  division_id uuid;
begin
  select u.* into usage_row
  from roadops.equipment_usage_entries u where u.id = p_usage_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Equipment usage not found';
  end if;
  division_id := roadops.division_for_work_order(usage_row.work_order_id);
  if roadops.current_actor_id() is null
     or roadops.current_actor_id() <> usage_row.recorded_by
     or not roadops.has_permission('execution.manage', division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot consume this equipment reservation';
  end if;
  select er.status into reservation_status
  from roadops.equipment_reservations er
  where er.id = usage_row.equipment_reservation_id for update;
  if reservation_status not in ('reserved', 'checked_out', 'returned') then
    raise exception using errcode = '55000', message = 'Equipment reservation is not consumable';
  end if;
  update roadops.equipment_reservations set status = 'returned'
  where id = usage_row.equipment_reservation_id;
end
$function$;

create or replace function roadops.reschedule_work_order(
  p_work_order_id uuid,
  p_scheduled_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  order_row roadops.work_orders%rowtype;
  plan_row roadops.plan_items%rowtype;
  actor_id uuid := roadops.current_actor_id();
  division_id uuid;
  previous_date date;
  day_delta integer;
begin
  select wo.* into order_row
  from roadops.work_orders wo where wo.id = p_work_order_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Work order not found';
  end if;
  select pi.* into plan_row
  from roadops.plan_items pi where pi.id = order_row.plan_item_id for update;
  division_id := roadops.division_for_work_order(p_work_order_id);
  if actor_id is null or not roadops.has_permission('execution.manage', division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot reschedule this work order';
  end if;
  if order_row.status not in ('issued', 'accepted', 'paused') or order_row.started_at is not null then
    raise exception using errcode = '55000', message = 'Only a not-started work order can be rescheduled';
  end if;
  if p_scheduled_date < (pg_catalog.statement_timestamp() at time zone 'Asia/Tashkent')::date then
    raise exception using errcode = '22007', message = 'Work order cannot be rescheduled into the past';
  end if;
  previous_date := (lower(plan_row.scheduled_window) at time zone 'Asia/Tashkent')::date;
  day_delta := p_scheduled_date - previous_date;
  if day_delta = 0 then
    return;
  end if;

  perform 1 from roadops.work_assignments a
  where a.plan_item_id = plan_row.id and a.status not in ('completed', 'cancelled')
  order by a.id for update;
  perform 1 from roadops.safety_staff_assignments a
  where a.plan_item_id = plan_row.id and a.status not in ('completed', 'cancelled')
  order by a.id for update;
  perform 1 from roadops.equipment_reservations r
  where r.plan_item_id = plan_row.id and r.status in ('reserved', 'checked_out')
  order by r.id for update;
  perform 1 from roadops.safety_resource_reservations r
  where r.plan_item_id = plan_row.id and r.status in ('reserved', 'checked_out')
  order by r.id for update;

  update roadops.plan_items
  set scheduled_window = tstzrange(
        lower(scheduled_window) + day_delta * interval '1 day',
        upper(scheduled_window) + day_delta * interval '1 day', '[)'
      ),
      row_version = row_version + 1
  where id = plan_row.id;
  update roadops.work_assignments
  set work_date = work_date + day_delta,
      scheduled_window = tstzrange(
        lower(scheduled_window) + day_delta * interval '1 day',
        upper(scheduled_window) + day_delta * interval '1 day', '[)'
      )
  where plan_item_id = plan_row.id and status not in ('completed', 'cancelled');
  update roadops.safety_staff_assignments
  set work_date = work_date + day_delta,
      scheduled_window = tstzrange(
        lower(scheduled_window) + day_delta * interval '1 day',
        upper(scheduled_window) + day_delta * interval '1 day', '[)'
      )
  where plan_item_id = plan_row.id and status not in ('completed', 'cancelled');
  update roadops.equipment_reservations
  set reserved_window = tstzrange(
        lower(reserved_window) + day_delta * interval '1 day',
        upper(reserved_window) + day_delta * interval '1 day', '[)'
      )
  where plan_item_id = plan_row.id and status in ('reserved', 'checked_out');
  update roadops.safety_resource_reservations
  set reserved_window = tstzrange(
        lower(reserved_window) + day_delta * interval '1 day',
        upper(reserved_window) + day_delta * interval '1 day', '[)'
      )
  where plan_item_id = plan_row.id and status in ('reserved', 'checked_out');
  update roadops.work_orders
  set row_version = row_version + 1, updated_at = clock_timestamp()
  where id = p_work_order_id;
  insert into roadops.work_order_events (
    work_order_id, from_status, to_status, event_code, actor_user_id,
    note, details, request_id
  ) values (
    p_work_order_id, order_row.status, order_row.status, 'WORK_RESCHEDULED', actor_id,
    'Ish sanasi va faol resurs bandlovlari bir xil kun farqiga ko‘chirildi',
    jsonb_build_object(
      'previousScheduledDate', previous_date,
      'scheduledDate', p_scheduled_date,
      'dayDelta', day_delta
    ),
    roadops.current_request_id()
  );
end
$function$;

create or replace function roadops.prepare_monthly_completion_act_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  act_row roadops.monthly_completion_acts%rowtype;
  source_row record;
begin
  select a.* into act_row from roadops.monthly_completion_acts a where a.id = new.act_id;
  if act_row.id is null or act_row.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Monthly act must be draft';
  end if;

  select wo.order_number, wo.status, wo.completed_at, wo.issued_by, wo.verified_by,
         roadops.division_for_work_order(wo.id) as division_id,
         pi.road_id, pi.work_variant_id, pi.annual_program_item_id,
         coalesce(api.planned_quantity, 0) annual_planned_quantity,
         cr.id as completion_record_id, cr.completed_quantity, cr.work_unit,
         cr.recorded_by as completion_recorded_by, cr.verified_by as completion_verified_by,
         cr.verified_at as completion_verified_at,
         coalesce(nullif(btrim(rv.official_code), ''), r.external_id) as road_code,
         rv.name as road_name,
         coalesce(nullif(btrim(wi.normalized_code), ''), nullif(btrim(wi.raw_code), ''),
           wv.variant_key) as work_code,
         coalesce(nullif(btrim(wv.variant_label), ''), wi.normalized_name, wi.raw_name) as work_name,
         concat_ws(' · ', doc.code, nullif(btrim(wi.raw_code), ''),
           coalesce(nullif(btrim(wv.variant_label), ''), wi.normalized_name, wi.raw_name))
           as norm_reference
  into source_row
  from roadops.work_orders wo
  join roadops.work_completion_records cr on cr.work_order_id = wo.id
  join roadops.plan_items pi on pi.id = wo.plan_item_id
  left join roadops.annual_program_items api on api.id = pi.annual_program_item_id
  join roadops.roads r on r.id = pi.road_id
  join roadops.road_versions rv on rv.road_id = r.id
    and rv.valid_from <= wo.completed_at
    and (rv.valid_until is null or rv.valid_until > wo.completed_at)
  join roadops.iqn_work_variants wv on wv.id = pi.work_variant_id
  join roadops.iqn_work_items wi on wi.id = wv.work_item_id
  join roadops.iqn_documents doc on doc.id = wi.document_id
  where wo.id = new.work_order_id;

  if source_row is null or source_row.status <> 'verified'
     or source_row.completed_at is null or source_row.completion_verified_at is null
     or source_row.verified_by is null or source_row.verified_by = source_row.issued_by
     or source_row.completion_verified_by is null
     or source_row.completion_verified_by = source_row.completion_recorded_by then
    raise exception using errcode = '23514',
      message = 'Only independently verified completed work can enter a monthly act';
  end if;
  if source_row.division_id is distinct from act_row.division_id then
    raise exception using errcode = '23514',
      message = 'Work order and monthly act divisions must match';
  end if;
  if (source_row.completed_at at time zone 'Asia/Tashkent')::date < act_row.act_month
     or (source_row.completed_at at time zone 'Asia/Tashkent')::date
       >= (act_row.act_month + interval '1 month')::date then
    raise exception using errcode = '23514',
      message = 'Work completion date must fall inside the act month';
  end if;

  new.completion_record_id := source_row.completion_record_id;
  new.order_number_snapshot := source_row.order_number;
  new.road_code_snapshot := source_row.road_code;
  new.road_name_snapshot := source_row.road_name;
  new.road_id_snapshot := source_row.road_id;
  new.work_variant_id_snapshot := source_row.work_variant_id;
  new.annual_program_item_id_snapshot := source_row.annual_program_item_id;
  new.work_code_snapshot := source_row.work_code;
  new.work_name_snapshot := source_row.work_name;
  new.norm_reference_snapshot := source_row.norm_reference;
  new.completed_at_snapshot := source_row.completed_at;
  new.completed_quantity := source_row.completed_quantity;
  new.work_unit := source_row.work_unit;
  new.annual_planned_quantity_snapshot := source_row.annual_planned_quantity;
  new.year_to_date_quantity_snapshot := 0;
  new.year_to_date_amount_uzs_snapshot := 0;
  new.labor_amount_uzs := 0;
  new.social_amount_uzs := 0;
  new.material_amount_uzs := 0;
  new.equipment_amount_uzs := 0;
  new.total_amount_uzs := 0;
  return new;
end
$function$;

create trigger monthly_completion_act_items_prepare
before insert on roadops.monthly_completion_act_items
for each row execute function roadops.prepare_monthly_completion_act_item();

create or replace function roadops.prepare_monthly_completion_act_cost_line()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  item_row record;
  rate_row roadops.cost_rate_versions%rowtype;
  norm_row roadops.monthly_work_time_norms%rowtype;
  source_row record;
  source_date date;
begin
  select i.work_order_id, a.division_id, a.act_month, a.status as act_status
  into item_row
  from roadops.monthly_completion_act_items i
  join roadops.monthly_completion_acts a on a.id = i.act_id
  where i.id = new.act_item_id;
  if item_row is null or item_row.act_status <> 'draft' then
    raise exception using errcode = '55000', message = 'Monthly act must be draft';
  end if;

  select r.* into rate_row from roadops.cost_rate_versions r
  where r.id = new.cost_rate_version_id;
  if rate_row.id is null or rate_row.status <> 'approved'
     or rate_row.division_id is distinct from item_row.division_id
     or rate_row.rate_kind <> new.line_kind then
    raise exception using errcode = '23514',
      message = 'Cost line requires an approved matching division rate';
  end if;

  if new.line_kind = 'labor' then
    select te.work_order_id, te.worker_id, te.work_date, te.actual_minutes,
           te.approved_at, te.approved_by, w.external_id,
           wv.personnel_number, wv.full_name, coalesce(wv.position_name, '') position_name
    into source_row
    from roadops.time_entries te
    join roadops.workers w on w.id = te.worker_id
    join roadops.worker_versions wv on wv.worker_id = te.worker_id
      and wv.valid_from <= (te.work_date::timestamp at time zone 'Asia/Tashkent')
      and (wv.valid_until is null
        or wv.valid_until > (te.work_date::timestamp at time zone 'Asia/Tashkent'))
    where te.id = new.time_entry_id;
    source_date := source_row.work_date;
    select n.* into norm_row from roadops.monthly_work_time_norms n
    where n.id = new.monthly_work_time_norm_id;
    if source_row is null or source_row.work_order_id is distinct from item_row.work_order_id
       or source_row.approved_at is null or source_row.approved_by is null
       or rate_row.worker_id is distinct from source_row.worker_id
       or norm_row.id is null or norm_row.status <> 'approved'
       or norm_row.division_id is distinct from item_row.division_id
       or norm_row.work_month <> date_trunc('month', source_date)::date
       or norm_row.schedule_code <> rate_row.schedule_code then
      raise exception using errcode = '23514',
        message = 'Labor cost source, salary rate, and monthly work norm do not match';
    end if;
    new.resource_code_snapshot := coalesce(
      nullif(btrim(source_row.personnel_number), ''), source_row.external_id
    );
    new.resource_name_snapshot := source_row.full_name;
    new.resource_detail_snapshot := source_row.position_name;
    new.source_quantity := source_row.actual_minutes;
    new.source_unit := 'person_minute';
    new.rate_denominator_quantity := norm_row.norm_minutes;
  elsif new.line_kind = 'material' then
    select u.work_order_id, u.material_id, u.quantity, u.unit, u.used_at, u.status,
           m.code, m.name
    into source_row
    from roadops.work_order_material_usages u
    join roadops.materials m on m.id = u.material_id
    where u.id = new.material_usage_id;
    source_date := (source_row.used_at at time zone 'Asia/Tashkent')::date;
    if source_row is null or source_row.work_order_id is distinct from item_row.work_order_id
       or source_row.status <> 'approved'
       or rate_row.material_id is distinct from source_row.material_id
       or rate_row.pricing_unit <> source_row.unit then
      raise exception using errcode = '23514',
        message = 'Material cost source and approved unit rate do not match';
    end if;
    new.resource_code_snapshot := source_row.code;
    new.resource_name_snapshot := source_row.name;
    new.source_quantity := source_row.quantity;
    new.source_unit := source_row.unit;
    new.rate_denominator_quantity := 1;
  elsif new.line_kind = 'equipment' then
    select u.work_order_id, u.equipment_unit_id, u.usage_date,
           u.actual_machine_minutes, u.status, e.inventory_code, e.name
    into source_row
    from roadops.equipment_usage_entries u
    join roadops.equipment_units e on e.id = u.equipment_unit_id
    where u.id = new.equipment_usage_entry_id;
    source_date := source_row.usage_date;
    if source_row is null or source_row.work_order_id is distinct from item_row.work_order_id
       or source_row.status <> 'approved'
       or rate_row.equipment_unit_id is distinct from source_row.equipment_unit_id then
      raise exception using errcode = '23514',
        message = 'Equipment cost source and approved machine-hour rate do not match';
    end if;
    new.resource_code_snapshot := source_row.inventory_code;
    new.resource_name_snapshot := source_row.name;
    new.source_quantity := source_row.actual_machine_minutes;
    new.source_unit := 'machine_minute';
    new.rate_denominator_quantity := 60;
  end if;

  if not (rate_row.effective_period @> source_date) then
    raise exception using errcode = '23514',
      message = 'Approved cost rate is not effective on the usage date';
  end if;
  new.rate_basis_snapshot := rate_row.rate_basis;
  new.rate_amount_uzs := rate_row.rate_amount_uzs;
  new.bonus_rate_bps := rate_row.bonus_rate_bps;
  new.traffic_allowance_rate_bps := rate_row.traffic_allowance_rate_bps;
  new.travel_allowance_rate_bps := rate_row.travel_allowance_rate_bps;
  new.social_contribution_rate_bps := rate_row.social_contribution_rate_bps;
  new.unit_rate_uzs := round(rate_row.rate_amount_uzs / new.rate_denominator_quantity, 6);
  if new.line_kind = 'labor' then
    new.base_wage_amount_uzs := round(
      new.source_quantity * rate_row.rate_amount_uzs / new.rate_denominator_quantity,
      2
    );
    new.bonus_amount_uzs := round(
      new.base_wage_amount_uzs * rate_row.bonus_rate_bps / 10000,
      2
    );
    new.traffic_allowance_amount_uzs := round(
      new.base_wage_amount_uzs * rate_row.traffic_allowance_rate_bps / 10000,
      2
    );
    new.travel_allowance_amount_uzs := round(
      new.base_wage_amount_uzs * rate_row.travel_allowance_rate_bps / 10000,
      2
    );
    new.social_amount_uzs := round(
      (new.base_wage_amount_uzs + new.bonus_amount_uzs
        + new.traffic_allowance_amount_uzs + new.travel_allowance_amount_uzs)
        * rate_row.social_contribution_rate_bps / 10000,
      2
    );
    new.amount_uzs := new.base_wage_amount_uzs + new.bonus_amount_uzs
      + new.traffic_allowance_amount_uzs + new.travel_allowance_amount_uzs
      + new.social_amount_uzs;
  else
    new.base_wage_amount_uzs := 0;
    new.bonus_amount_uzs := 0;
    new.traffic_allowance_amount_uzs := 0;
    new.travel_allowance_amount_uzs := 0;
    new.social_amount_uzs := 0;
    new.amount_uzs := round(
      new.source_quantity * rate_row.rate_amount_uzs / new.rate_denominator_quantity,
      2
    );
  end if;
  new.currency := 'UZS';
  if new.amount_uzs <= 0 then
    raise exception using errcode = '22003',
      message = 'Cost line amount rounds to zero UZS';
  end if;
  return new;
end
$function$;

create trigger monthly_completion_act_cost_lines_prepare
before insert on roadops.monthly_completion_act_cost_lines
for each row execute function roadops.prepare_monthly_completion_act_cost_line();

create or replace function roadops.guard_monthly_act_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.status = 'approved' then
    raise exception using errcode = '55000', message = 'Approved monthly act is immutable';
  end if;
  if old.status = 'submitted' then
    if tg_op = 'DELETE' or new.status <> 'approved'
       or new.division_id is distinct from old.division_id
       or new.division_name_snapshot is distinct from old.division_name_snapshot
       or new.act_number is distinct from old.act_number
       or new.act_month is distinct from old.act_month
       or new.currency is distinct from old.currency
       or new.labor_amount_uzs is distinct from old.labor_amount_uzs
       or new.social_amount_uzs is distinct from old.social_amount_uzs
       or new.material_amount_uzs is distinct from old.material_amount_uzs
       or new.equipment_amount_uzs is distinct from old.equipment_amount_uzs
       or new.total_amount_uzs is distinct from old.total_amount_uzs
       or new.snapshot_hash is distinct from old.snapshot_hash
       or new.created_by is distinct from old.created_by
       or new.created_by_name_snapshot is distinct from old.created_by_name_snapshot
       or new.created_at is distinct from old.created_at
       or new.submitted_by is distinct from old.submitted_by
       or new.submitted_by_name_snapshot is distinct from old.submitted_by_name_snapshot
       or new.submitted_at is distinct from old.submitted_at then
      raise exception using errcode = '55000', message = 'Submitted monthly act snapshot is immutable';
    end if;
  elsif tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then
    raise exception using errcode = '23514', message = 'Monthly act creator is immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

create trigger monthly_completion_acts_guard
before update or delete on roadops.monthly_completion_acts
for each row execute function roadops.guard_monthly_act_mutation();

create or replace function roadops.guard_monthly_act_child_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  parent_status text;
begin
  if tg_table_name = 'monthly_completion_act_items' then
    select a.status into parent_status
    from roadops.monthly_completion_acts a
    where a.id = coalesce(new.act_id, old.act_id);
  else
    select a.status into parent_status
    from roadops.monthly_completion_act_items i
    join roadops.monthly_completion_acts a on a.id = i.act_id
    where i.id = coalesce(new.act_item_id, old.act_item_id);
  end if;
  if parent_status is distinct from 'draft' then
    raise exception using errcode = '55000',
      message = 'Submitted monthly act items and cost lines are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

create trigger monthly_completion_act_items_guard
before insert or update or delete on roadops.monthly_completion_act_items
for each row execute function roadops.guard_monthly_act_child_mutation();
create trigger monthly_completion_act_cost_lines_guard
before insert or update or delete on roadops.monthly_completion_act_cost_lines
for each row execute function roadops.guard_monthly_act_child_mutation();

create or replace function roadops.refresh_monthly_completion_act_totals(p_act_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  act_row roadops.monthly_completion_acts%rowtype;
  actor_id uuid := roadops.current_actor_id();
begin
  select a.* into act_row
  from roadops.monthly_completion_acts a where a.id = p_act_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Monthly completion act not found';
  end if;
  if act_row.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Only draft monthly act totals can be refreshed';
  end if;
  if actor_id is null or not roadops.has_permission('costs.manage', act_row.division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot refresh this division monthly act';
  end if;

  update roadops.monthly_completion_act_items i
  set labor_amount_uzs = coalesce((
        select sum(l.amount_uzs - l.social_amount_uzs)
        from roadops.monthly_completion_act_cost_lines l
        where l.act_item_id = i.id and l.line_kind = 'labor'
      ), 0),
      social_amount_uzs = coalesce((
        select sum(l.social_amount_uzs)
        from roadops.monthly_completion_act_cost_lines l
        where l.act_item_id = i.id and l.line_kind = 'labor'
      ), 0),
      material_amount_uzs = coalesce((
        select sum(l.amount_uzs)
        from roadops.monthly_completion_act_cost_lines l
        where l.act_item_id = i.id and l.line_kind = 'material'
      ), 0),
      equipment_amount_uzs = coalesce((
        select sum(l.amount_uzs)
        from roadops.monthly_completion_act_cost_lines l
        where l.act_item_id = i.id and l.line_kind = 'equipment'
      ), 0),
      total_amount_uzs = coalesce((
        select sum(l.amount_uzs)
        from roadops.monthly_completion_act_cost_lines l
        where l.act_item_id = i.id
      ), 0)
  where i.act_id = p_act_id;

  update roadops.monthly_completion_acts a
  set labor_amount_uzs = totals.labor_amount,
      social_amount_uzs = totals.social_amount,
      material_amount_uzs = totals.material_amount,
      equipment_amount_uzs = totals.equipment_amount,
      total_amount_uzs = totals.labor_amount + totals.social_amount
        + totals.material_amount + totals.equipment_amount
  from (
    select coalesce(sum(i.labor_amount_uzs), 0)::numeric(24,2) labor_amount,
           coalesce(sum(i.social_amount_uzs), 0)::numeric(24,2) social_amount,
           coalesce(sum(i.material_amount_uzs), 0)::numeric(24,2) material_amount,
           coalesce(sum(i.equipment_amount_uzs), 0)::numeric(24,2) equipment_amount
    from roadops.monthly_completion_act_items i where i.act_id = p_act_id
  ) totals
  where a.id = p_act_id;

  update roadops.monthly_completion_act_items current_item
  set year_to_date_quantity_snapshot = coalesce((
        select sum(prior.completed_quantity)
        from roadops.monthly_completion_act_items prior
        join roadops.monthly_completion_acts prior_act on prior_act.id = prior.act_id
        where date_part('year', prior_act.act_month) = date_part('year', current_act.act_month)
          and prior_act.act_month <= current_act.act_month
          and (prior_act.status = 'approved' or prior_act.id = current_act.id)
          and (
            (current_item.annual_program_item_id_snapshot is not null
              and prior.annual_program_item_id_snapshot = current_item.annual_program_item_id_snapshot)
            or (current_item.annual_program_item_id_snapshot is null
              and prior.annual_program_item_id_snapshot is null
              and prior.road_id_snapshot = current_item.road_id_snapshot
              and prior.work_variant_id_snapshot = current_item.work_variant_id_snapshot)
          )
      ), 0),
      year_to_date_amount_uzs_snapshot = coalesce((
        select sum(prior.total_amount_uzs)
        from roadops.monthly_completion_act_items prior
        join roadops.monthly_completion_acts prior_act on prior_act.id = prior.act_id
        where date_part('year', prior_act.act_month) = date_part('year', current_act.act_month)
          and prior_act.act_month <= current_act.act_month
          and (prior_act.status = 'approved' or prior_act.id = current_act.id)
          and (
            (current_item.annual_program_item_id_snapshot is not null
              and prior.annual_program_item_id_snapshot = current_item.annual_program_item_id_snapshot)
            or (current_item.annual_program_item_id_snapshot is null
              and prior.annual_program_item_id_snapshot is null
              and prior.road_id_snapshot = current_item.road_id_snapshot
              and prior.work_variant_id_snapshot = current_item.work_variant_id_snapshot)
          )
      ), 0)
  from roadops.monthly_completion_acts current_act
  where current_item.act_id = p_act_id and current_act.id = p_act_id;
end
$function$;

create or replace function roadops.monthly_completion_act_snapshot_hash(p_act_id uuid)
returns bytea
language sql
stable
security definer
set search_path = ''
as $function$
  select extensions.digest(
    convert_to(
      jsonb_build_object(
        'act', jsonb_build_object(
          'id', a.id,
          'division_id', a.division_id,
          'division_name', a.division_name_snapshot,
          'act_number', a.act_number,
          'act_month', a.act_month,
          'currency', a.currency,
          'labor_amount_uzs', a.labor_amount_uzs,
          'social_amount_uzs', a.social_amount_uzs,
          'material_amount_uzs', a.material_amount_uzs,
          'equipment_amount_uzs', a.equipment_amount_uzs,
          'total_amount_uzs', a.total_amount_uzs,
          'created_by_name', a.created_by_name_snapshot
        ),
        'items', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', i.id,
              'work_order_id', i.work_order_id,
              'completion_record_id', i.completion_record_id,
              'order_number', i.order_number_snapshot,
              'road_code', i.road_code_snapshot,
              'road_name', i.road_name_snapshot,
              'road_id', i.road_id_snapshot,
              'work_variant_id', i.work_variant_id_snapshot,
              'annual_program_item_id', i.annual_program_item_id_snapshot,
              'work_code', i.work_code_snapshot,
              'work_name', i.work_name_snapshot,
              'norm_reference', i.norm_reference_snapshot,
              'completed_at', i.completed_at_snapshot,
              'completed_quantity', i.completed_quantity,
              'work_unit', i.work_unit,
              'annual_planned_quantity', i.annual_planned_quantity_snapshot,
              'year_to_date_quantity', i.year_to_date_quantity_snapshot,
              'year_to_date_amount_uzs', i.year_to_date_amount_uzs_snapshot,
              'labor_amount_uzs', i.labor_amount_uzs,
              'social_amount_uzs', i.social_amount_uzs,
              'material_amount_uzs', i.material_amount_uzs,
              'equipment_amount_uzs', i.equipment_amount_uzs,
              'total_amount_uzs', i.total_amount_uzs,
              'cost_lines', coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', l.id,
                    'line_kind', l.line_kind,
                    'time_entry_id', l.time_entry_id,
                    'material_usage_id', l.material_usage_id,
                    'equipment_usage_entry_id', l.equipment_usage_entry_id,
                    'cost_rate_version_id', l.cost_rate_version_id,
                    'monthly_work_time_norm_id', l.monthly_work_time_norm_id,
                    'resource_code', l.resource_code_snapshot,
                    'resource_name', l.resource_name_snapshot,
                    'resource_detail', l.resource_detail_snapshot,
                    'source_quantity', l.source_quantity,
                    'source_unit', l.source_unit,
                    'rate_basis', l.rate_basis_snapshot,
                    'rate_amount_uzs', l.rate_amount_uzs,
                    'bonus_rate_bps', l.bonus_rate_bps,
                    'traffic_allowance_rate_bps', l.traffic_allowance_rate_bps,
                    'travel_allowance_rate_bps', l.travel_allowance_rate_bps,
                    'social_contribution_rate_bps', l.social_contribution_rate_bps,
                    'rate_denominator_quantity', l.rate_denominator_quantity,
                    'unit_rate_uzs', l.unit_rate_uzs,
                    'base_wage_amount_uzs', l.base_wage_amount_uzs,
                    'bonus_amount_uzs', l.bonus_amount_uzs,
                    'traffic_allowance_amount_uzs', l.traffic_allowance_amount_uzs,
                    'travel_allowance_amount_uzs', l.travel_allowance_amount_uzs,
                    'social_amount_uzs', l.social_amount_uzs,
                    'amount_uzs', l.amount_uzs,
                    'currency', l.currency
                  ) order by l.id
                )
                from roadops.monthly_completion_act_cost_lines l
                where l.act_item_id = i.id
              ), '[]'::jsonb)
            ) order by i.id
          )
          from roadops.monthly_completion_act_items i
          where i.act_id = a.id
        ), '[]'::jsonb)
      )::text,
      'UTF8'
    ),
    'sha256'
  )
  from roadops.monthly_completion_acts a
  where a.id = p_act_id
$function$;

create or replace function roadops.approve_cost_rate_version(p_rate_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  rate_row roadops.cost_rate_versions%rowtype;
  actor_id uuid := roadops.current_actor_id();
begin
  select r.* into rate_row from roadops.cost_rate_versions r where r.id = p_rate_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Cost rate version not found';
  end if;
  if rate_row.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Only draft cost rate can be approved';
  end if;
  if actor_id is null or not roadops.has_permission('costs.approve', rate_row.division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot approve this division cost rate';
  end if;
  if actor_id = rate_row.created_by then
    raise exception using errcode = '42501', message = 'Cost rate creator cannot approve the same rate';
  end if;
  update roadops.cost_rate_versions
  set status = 'approved', approved_by = actor_id, approved_at = clock_timestamp()
  where id = p_rate_id;
end
$function$;

create or replace function roadops.approve_monthly_work_time_norm(p_norm_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  norm_row roadops.monthly_work_time_norms%rowtype;
  actor_id uuid := roadops.current_actor_id();
begin
  select n.* into norm_row from roadops.monthly_work_time_norms n where n.id = p_norm_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Monthly work-time norm not found';
  end if;
  if norm_row.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Only draft work-time norm can be approved';
  end if;
  if actor_id is null or not roadops.has_permission('costs.approve', norm_row.division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot approve this division work-time norm';
  end if;
  if actor_id = norm_row.created_by then
    raise exception using errcode = '42501', message = 'Work-time norm creator cannot approve the same norm';
  end if;
  update roadops.monthly_work_time_norms
  set status = 'approved', approved_by = actor_id, approved_at = clock_timestamp()
  where id = p_norm_id;
end
$function$;

create or replace function roadops.approve_work_order_material_usage(p_usage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  usage_row roadops.work_order_material_usages%rowtype;
  division_id uuid;
  actor_id uuid := roadops.current_actor_id();
begin
  select u.* into usage_row
  from roadops.work_order_material_usages u where u.id = p_usage_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Material usage not found';
  end if;
  division_id := roadops.division_for_work_order(usage_row.work_order_id);
  if usage_row.status <> 'recorded' then
    raise exception using errcode = '55000', message = 'Only recorded material usage can be approved';
  end if;
  if actor_id is null or not roadops.has_permission('execution.verify', division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot verify this material usage';
  end if;
  if actor_id = usage_row.recorded_by then
    raise exception using errcode = '42501', message = 'Material usage recorder cannot approve the same usage';
  end if;
  update roadops.work_order_material_usages
  set status = 'approved', approved_by = actor_id, approved_at = clock_timestamp()
  where id = p_usage_id;
end
$function$;

create or replace function roadops.approve_equipment_usage_entry(p_usage_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  usage_row roadops.equipment_usage_entries%rowtype;
  division_id uuid;
  actor_id uuid := roadops.current_actor_id();
begin
  select u.* into usage_row
  from roadops.equipment_usage_entries u where u.id = p_usage_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Equipment usage entry not found';
  end if;
  division_id := roadops.division_for_work_order(usage_row.work_order_id);
  if usage_row.status <> 'recorded' then
    raise exception using errcode = '55000', message = 'Only recorded equipment usage can be approved';
  end if;
  if actor_id is null or not roadops.has_permission('execution.verify', division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot verify this equipment usage';
  end if;
  if actor_id = usage_row.recorded_by then
    raise exception using errcode = '42501', message = 'Equipment usage recorder cannot approve the same usage';
  end if;
  update roadops.equipment_usage_entries
  set status = 'approved', approved_by = actor_id, approved_at = clock_timestamp()
  where id = p_usage_id;
end
$function$;

create or replace function roadops.guard_independent_completion_verification()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor_id uuid := roadops.current_actor_id();
  division_id uuid;
  order_id uuid;
  author_id uuid;
begin
  if tg_table_name = 'work_orders' then
    if new.status <> 'verified' or old.status = 'verified' then
      return new;
    end if;
    order_id := new.id;
    author_id := new.issued_by;
    if old.status <> 'completed' or new.verified_at is null
       or new.verified_by is distinct from actor_id then
      raise exception using errcode = '23514',
        message = 'Work order verification must be an authenticated completed-to-verified transition';
    end if;
    if not exists (
      select 1 from roadops.work_completion_records cr
      where cr.work_order_id = new.id and cr.verified_at is not null
        and cr.verified_by = actor_id and cr.recorded_by <> actor_id
    ) then
      raise exception using errcode = '23514',
        message = 'Work completion record must be independently verified first';
    end if;
  else
    if new.verified_at is null or old.verified_at is not null then
      return new;
    end if;
    order_id := new.work_order_id;
    author_id := new.recorded_by;
    if new.verified_by is distinct from actor_id then
      raise exception using errcode = '23514',
        message = 'Completion verifier must be the authenticated actor';
    end if;
    if not exists (
      select 1 from roadops.work_orders wo
      where wo.id = new.work_order_id and wo.status = 'completed'
    ) then
      raise exception using errcode = '23514',
        message = 'Only a completed work order record can be verified';
    end if;
  end if;
  division_id := roadops.division_for_work_order(order_id);
  if actor_id is null or actor_id = author_id
     or not roadops.has_permission('execution.verify', division_id) then
    raise exception using errcode = '42501',
      message = 'Completion must be verified by an independent authorized actor';
  end if;
  return new;
end
$function$;

create trigger work_orders_independent_verification
before update of status, verified_at, verified_by on roadops.work_orders
for each row execute function roadops.guard_independent_completion_verification();
create trigger work_completion_records_independent_verification
before update of verified_at, verified_by on roadops.work_completion_records
for each row execute function roadops.guard_independent_completion_verification();

create or replace function roadops.guard_verified_work_order()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.status = 'verified' then
    raise exception using errcode = '55000', message = 'Verified work order is immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

create trigger work_orders_immutable_after_verification
before update or delete on roadops.work_orders
for each row execute function roadops.guard_verified_work_order();

create or replace function roadops.guard_time_entry_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor_id uuid := roadops.current_actor_id();
  division_id uuid;
begin
  if old.approved_at is not null then
    raise exception using errcode = '55000', message = 'Approved time entry is immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.recorded_by is distinct from old.recorded_by then
    raise exception using errcode = '23514', message = 'Time entry recorder is immutable';
  end if;
  if new.approved_at is not null or new.approved_by is not null then
    division_id := roadops.division_for_work_order(new.work_order_id);
    if new.approved_at is null or new.approved_by is distinct from actor_id
       or actor_id is null or actor_id = new.recorded_by
       or not roadops.has_permission('execution.verify', division_id) then
      raise exception using errcode = '42501',
        message = 'Time entry must be approved by an independent authorized actor';
    end if;
  end if;
  return new;
end
$function$;

create trigger time_entries_independent_approval
before update or delete on roadops.time_entries
for each row execute function roadops.guard_time_entry_approval();

create or replace function roadops.guard_verified_completion_record()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.verified_at is not null then
    raise exception using errcode = '55000', message = 'Verified completion record is immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$function$;

create trigger work_completion_records_immutable_after_verification
before update or delete on roadops.work_completion_records
for each row execute function roadops.guard_verified_completion_record();

create or replace function roadops.approve_time_entry(p_time_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  entry_row roadops.time_entries%rowtype;
  actor_id uuid := roadops.current_actor_id();
  division_id uuid;
begin
  select te.* into entry_row from roadops.time_entries te where te.id = p_time_entry_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Time entry not found';
  end if;
  division_id := roadops.division_for_work_order(entry_row.work_order_id);
  if entry_row.approved_at is not null or entry_row.approved_by is not null then
    raise exception using errcode = '55000', message = 'Time entry is already approved';
  end if;
  if actor_id is null or actor_id = entry_row.recorded_by
     or not roadops.has_permission('execution.verify', division_id) then
    raise exception using errcode = '42501',
      message = 'Time entry requires an independent authorized approver';
  end if;
  update roadops.time_entries
  set approved_by = actor_id, approved_at = clock_timestamp()
  where id = p_time_entry_id;
end
$function$;

create or replace function roadops.verify_work_order_completion(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  order_row roadops.work_orders%rowtype;
  plan_row roadops.plan_items%rowtype;
  completion_row roadops.work_completion_records%rowtype;
  defect_row roadops.defect_cases%rowtype;
  actor_id uuid := roadops.current_actor_id();
  division_id uuid;
  verification_time timestamptz := clock_timestamp();
begin
  select wo.* into order_row from roadops.work_orders wo where wo.id = p_order_id for update;
  select pi.* into plan_row
  from roadops.plan_items pi where pi.id = order_row.plan_item_id for update;
  select cr.* into completion_row
  from roadops.work_completion_records cr where cr.work_order_id = p_order_id for update;
  if order_row.id is null or completion_row.id is null then
    raise exception using errcode = 'P0002', message = 'Completed work order or completion record not found';
  end if;
  division_id := roadops.division_for_work_order(p_order_id);
  if order_row.status <> 'completed' or order_row.completed_at is null then
    raise exception using errcode = '55000', message = 'Only completed work order can be verified';
  end if;
  if completion_row.verified_at is not null or order_row.verified_at is not null then
    raise exception using errcode = '55000', message = 'Work completion is already verified';
  end if;
  if plan_row.id is null
     or completion_row.work_unit is distinct from plan_row.work_unit
     or completion_row.completed_quantity > plan_row.work_quantity then
    raise exception using errcode = '23514',
      message = 'Completed quantity and unit must stay within the planned work quantity';
  end if;
  if exists (
    select 1
    from roadops.material_reservations reservation
    where reservation.plan_item_id = plan_row.id
      and reservation.status in ('reserved', 'issued')
      and (
        select count(*)
        from roadops.work_order_material_usages usage
        where usage.material_reservation_id = reservation.id
          and usage.work_order_id = p_order_id
      ) <> 1
  ) then
    raise exception using errcode = '23514',
      message = 'Every active material reservation must be recorded exactly once';
  end if;
  if exists (
    select 1
    from roadops.equipment_reservations reservation
    where reservation.plan_item_id = plan_row.id
      and reservation.status in ('reserved', 'checked_out', 'returned')
      and (
        select count(*)
        from roadops.equipment_usage_entries usage
        where usage.equipment_reservation_id = reservation.id
          and usage.work_order_id = p_order_id
      ) <> 1
  ) then
    raise exception using errcode = '23514',
      message = 'Every active equipment reservation must be recorded exactly once';
  end if;
  if actor_id is null or not roadops.has_permission('execution.verify', division_id)
     or actor_id = order_row.issued_by or actor_id = completion_row.recorded_by then
    raise exception using errcode = '42501',
      message = 'Work completion requires an independent authorized verifier';
  end if;
  if exists (
    select 1
    from roadops.time_entries entry
    where entry.work_order_id = p_order_id
      and (entry.approved_at is null or entry.approved_by is null)
  ) or exists (
    select 1
    from roadops.work_order_material_usages usage
    where usage.work_order_id = p_order_id and usage.status <> 'approved'
  ) or exists (
    select 1
    from roadops.equipment_usage_entries usage
    where usage.work_order_id = p_order_id and usage.status <> 'approved'
  ) then
    raise exception using errcode = '23514',
      message = 'Every actual labor and resource usage must be independently approved before verification';
  end if;

  update roadops.work_completion_records
  set verified_by = actor_id, verified_at = verification_time
  where id = completion_row.id;
  update roadops.work_orders
  set status = 'verified', verified_by = actor_id, verified_at = verification_time,
      row_version = row_version + 1
  where id = p_order_id;

  select dc.* into defect_row
  from roadops.plan_items pi
  join roadops.defect_cases dc
    on dc.id::text = coalesce(
      pi.defect_case_id::text,
      nullif(pi.formula_inputs #>> '{manualInput,sourceDefectId}', '')
    )
  where pi.id = plan_row.id
  for update of dc;
  if defect_row.id is not null and defect_row.status = 'cancelled' then
    raise exception using errcode = '55000',
      message = 'Cancelled source defect cannot be resolved by work verification';
  elsif defect_row.id is not null
        and defect_row.status in ('open', 'planned', 'in_progress') then
    update roadops.defect_cases
    set status = 'resolved', resolved_at = verification_time,
        row_version = row_version + 1
    where id = defect_row.id;
    insert into roadops.defect_case_events (
      defect_case_id, from_status, to_status, event_code,
      actor_user_id, occurred_at, details, request_id
    ) values (
      defect_row.id, defect_row.status, 'resolved', 'resolved_by_verified_work',
      actor_id, verification_time,
      jsonb_build_object(
        'work_order_id', p_order_id,
        'completion_record_id', completion_row.id,
        'plan_item_id', plan_row.id
      ),
      roadops.current_request_id()
    );
  end if;
  insert into roadops.work_order_events (
    work_order_id, from_status, to_status, event_code,
    actor_user_id, occurred_at, note, details, request_id
  ) values (
    p_order_id, 'completed', 'verified', 'WORK_COMPLETION_VERIFIED',
    actor_id, verification_time,
    nullif(pg_catalog.current_setting('roadops.verification_note', true), ''),
    jsonb_build_object('completion_record_id', completion_row.id),
    roadops.current_request_id()
  );
end
$function$;

create or replace function roadops.submit_monthly_completion_act(p_act_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  act_row roadops.monthly_completion_acts%rowtype;
  actor_id uuid := roadops.current_actor_id();
  labor_total numeric(24,2);
  social_total numeric(24,2);
  material_total numeric(24,2);
  equipment_total numeric(24,2);
  frozen_hash bytea;
begin
  select a.* into act_row from roadops.monthly_completion_acts a where a.id = p_act_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Monthly completion act not found';
  end if;
  if act_row.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Only draft monthly act can be submitted';
  end if;
  if actor_id is null or not roadops.has_permission('costs.manage', act_row.division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot submit this division monthly act';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    act_row.division_id::text || ':'
      || pg_catalog.date_part('year', act_row.act_month)::integer::text,
    20260818
  ));
  if exists (
    select 1
    from roadops.monthly_completion_acts earlier
    where earlier.division_id = act_row.division_id
      and pg_catalog.date_part('year', earlier.act_month)
        = pg_catalog.date_part('year', act_row.act_month)
      and earlier.act_month < act_row.act_month
      and earlier.status <> 'approved'
  ) then
    raise exception using errcode = '55000',
      message = 'Earlier monthly acts must be approved before this month can be submitted';
  end if;
  if exists (
    select 1
    from roadops.monthly_completion_acts later
    where later.division_id = act_row.division_id
      and pg_catalog.date_part('year', later.act_month)
        = pg_catalog.date_part('year', act_row.act_month)
      and later.act_month > act_row.act_month
      and later.status in ('submitted', 'approved')
  ) then
    raise exception using errcode = '55000',
      message = 'An earlier monthly act cannot be backfilled after a later snapshot was frozen';
  end if;
  if not exists (
    select 1 from roadops.monthly_completion_act_items i where i.act_id = p_act_id
  ) then
    raise exception using errcode = '23514', message = 'Monthly act requires at least one work item';
  end if;
  if exists (
    select 1
    from roadops.monthly_completion_act_items i
    join roadops.work_orders wo on wo.id = i.work_order_id
    join roadops.work_completion_records cr on cr.id = i.completion_record_id
    where i.act_id = p_act_id
      and (wo.status <> 'verified' or wo.verified_at is null or wo.verified_by is null
        or wo.verified_by = wo.issued_by
        or cr.verified_at is null or cr.verified_by is null
        or cr.verified_by = cr.recorded_by)
  ) then
    raise exception using errcode = '23514',
      message = 'Every monthly act item must remain independently verified';
  end if;
  if exists (
    select 1
    from roadops.monthly_completion_act_items i
    join roadops.time_entries te on te.work_order_id = i.work_order_id
    left join roadops.monthly_completion_act_cost_lines l on l.time_entry_id = te.id
    where i.act_id = p_act_id
      and (te.approved_at is null or te.approved_by is null or l.id is null)
  ) or exists (
    select 1
    from roadops.monthly_completion_act_items i
    join roadops.work_order_material_usages u on u.work_order_id = i.work_order_id
    left join roadops.monthly_completion_act_cost_lines l on l.material_usage_id = u.id
    where i.act_id = p_act_id and (u.status <> 'approved' or l.id is null)
  ) or exists (
    select 1
    from roadops.monthly_completion_act_items i
    join roadops.equipment_usage_entries u on u.work_order_id = i.work_order_id
    left join roadops.monthly_completion_act_cost_lines l on l.equipment_usage_entry_id = u.id
    where i.act_id = p_act_id and (u.status <> 'approved' or l.id is null)
  ) then
    raise exception using errcode = '23514',
      message = 'All actual labor, material, and equipment usage must be approved and costed exactly once';
  end if;
  if exists (
    select 1
    from roadops.monthly_completion_act_items i
    where i.act_id = p_act_id
      and not exists (
        select 1 from roadops.monthly_completion_act_cost_lines l where l.act_item_id = i.id
      )
  ) then
    raise exception using errcode = '23514',
      message = 'Every monthly act work item requires at least one frozen cost line';
  end if;

  -- Rebuild draft totals and annual/YTD snapshots immediately before hashing,
  -- so even a long-lived or appended draft cannot submit stale display values.
  perform roadops.refresh_monthly_completion_act_totals(p_act_id);

  update roadops.monthly_completion_act_items i
  set labor_amount_uzs = totals.labor_amount,
      social_amount_uzs = totals.social_amount,
      material_amount_uzs = totals.material_amount,
      equipment_amount_uzs = totals.equipment_amount,
      total_amount_uzs = totals.labor_amount + totals.social_amount
        + totals.material_amount + totals.equipment_amount
  from (
    select l.act_item_id,
           coalesce(sum(l.amount_uzs - l.social_amount_uzs)
             filter (where l.line_kind = 'labor'), 0)::numeric(24,2)
             as labor_amount,
           coalesce(sum(l.social_amount_uzs)
             filter (where l.line_kind = 'labor'), 0)::numeric(24,2)
             as social_amount,
           coalesce(sum(l.amount_uzs) filter (where l.line_kind = 'material'), 0)::numeric(24,2)
             as material_amount,
           coalesce(sum(l.amount_uzs) filter (where l.line_kind = 'equipment'), 0)::numeric(24,2)
             as equipment_amount
    from roadops.monthly_completion_act_cost_lines l
    join roadops.monthly_completion_act_items included on included.id = l.act_item_id
    where included.act_id = p_act_id
    group by l.act_item_id
  ) totals
  where i.id = totals.act_item_id;

  select coalesce(sum(i.labor_amount_uzs), 0),
         coalesce(sum(i.social_amount_uzs), 0),
         coalesce(sum(i.material_amount_uzs), 0),
         coalesce(sum(i.equipment_amount_uzs), 0)
  into labor_total, social_total, material_total, equipment_total
  from roadops.monthly_completion_act_items i
  where i.act_id = p_act_id;
  if labor_total + social_total + material_total + equipment_total <= 0 then
    raise exception using errcode = '23514', message = 'Monthly act total must be positive';
  end if;

  -- Totals become part of the canonical hash. The status changes only after
  -- the complete snapshot has been derived and hashed in the same transaction.
  update roadops.monthly_completion_acts
  set labor_amount_uzs = labor_total,
      social_amount_uzs = social_total,
      material_amount_uzs = material_total,
      equipment_amount_uzs = equipment_total,
      total_amount_uzs = labor_total + social_total + material_total + equipment_total
  where id = p_act_id;
  frozen_hash := roadops.monthly_completion_act_snapshot_hash(p_act_id);
  if frozen_hash is null or octet_length(frozen_hash) <> 32 then
    raise exception using errcode = '55000', message = 'Monthly act snapshot hash could not be created';
  end if;
  update roadops.monthly_completion_acts
  set status = 'submitted', submitted_by = actor_id, submitted_at = clock_timestamp(),
      submitted_by_name_snapshot = (
        select u.full_name from roadops.app_users u where u.id = actor_id
      ),
      snapshot_hash = frozen_hash, row_version = row_version + 1
  where id = p_act_id;
end
$function$;

create or replace function roadops.approve_monthly_completion_act(p_act_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  act_row roadops.monthly_completion_acts%rowtype;
  actor_id uuid := roadops.current_actor_id();
begin
  select a.* into act_row from roadops.monthly_completion_acts a where a.id = p_act_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Monthly completion act not found';
  end if;
  if act_row.status <> 'submitted' then
    raise exception using errcode = '55000', message = 'Only submitted monthly act can be approved';
  end if;
  if actor_id is null or not roadops.has_permission('costs.approve', act_row.division_id) then
    raise exception using errcode = '42501', message = 'Actor cannot approve this division monthly act';
  end if;
  if actor_id = act_row.created_by or actor_id = act_row.submitted_by then
    raise exception using errcode = '42501',
      message = 'Monthly act creator or submitter cannot approve the same act';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    act_row.division_id::text || ':'
      || pg_catalog.date_part('year', act_row.act_month)::integer::text,
    20260818
  ));
  if exists (
    select 1
    from roadops.monthly_completion_acts earlier
    where earlier.division_id = act_row.division_id
      and pg_catalog.date_part('year', earlier.act_month)
        = pg_catalog.date_part('year', act_row.act_month)
      and earlier.act_month < act_row.act_month
      and earlier.status <> 'approved'
  ) then
    raise exception using errcode = '55000',
      message = 'Earlier monthly acts must be approved before this month can be approved';
  end if;
  if exists (
    select 1
    from roadops.monthly_completion_acts later
    where later.division_id = act_row.division_id
      and pg_catalog.date_part('year', later.act_month)
        = pg_catalog.date_part('year', act_row.act_month)
      and later.act_month > act_row.act_month
      and later.status in ('submitted', 'approved')
  ) then
    raise exception using errcode = '55000',
      message = 'Monthly acts cannot be approved behind an already frozen later month';
  end if;
  if roadops.monthly_completion_act_snapshot_hash(p_act_id) is distinct from act_row.snapshot_hash then
    raise exception using errcode = '55000', message = 'Monthly act frozen snapshot hash does not match';
  end if;
  update roadops.monthly_completion_acts
  set status = 'approved', approved_by = actor_id, approved_at = clock_timestamp(),
      approved_by_name_snapshot = (
        select u.full_name from roadops.app_users u where u.id = actor_id
      ),
      row_version = row_version + 1
  where id = p_act_id;
end
$function$;

create or replace function roadops.division_for_monthly_completion_act(p_act_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select a.division_id from roadops.monthly_completion_acts a where a.id = p_act_id
$function$;

create or replace function roadops.division_for_monthly_completion_act_item(p_item_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select a.division_id
  from roadops.monthly_completion_act_items i
  join roadops.monthly_completion_acts a on a.id = i.act_id
  where i.id = p_item_id
$function$;

alter table roadops.cost_rate_versions enable row level security;
alter table roadops.cost_rate_versions force row level security;
alter table roadops.monthly_work_time_norms enable row level security;
alter table roadops.monthly_work_time_norms force row level security;
alter table roadops.work_order_material_usages enable row level security;
alter table roadops.work_order_material_usages force row level security;
alter table roadops.equipment_usage_entries enable row level security;
alter table roadops.equipment_usage_entries force row level security;
alter table roadops.monthly_completion_acts enable row level security;
alter table roadops.monthly_completion_acts force row level security;
alter table roadops.monthly_completion_act_items enable row level security;
alter table roadops.monthly_completion_act_items force row level security;
alter table roadops.monthly_completion_act_cost_lines enable row level security;
alter table roadops.monthly_completion_act_cost_lines force row level security;

-- This narrow policy lets an execution manager create the inventory issue that
-- exactly backs a work_order_material_usage, without warehouse mutation rights.
create policy inventory_transactions_execution_issue on roadops.inventory_transactions
for insert to roadops_api
with check (
  transaction_kind = 'issue'
  and reference_type = 'work_order_material_usage'
  and recorded_by = roadops.current_actor_id()
  and roadops.has_permission(
    'execution.manage', roadops.division_for_stock_location(stock_location_id)
  )
);

create policy cost_rate_versions_api_read on roadops.cost_rate_versions
for select to roadops_api
using (
  roadops.can_access_division(division_id)
  and (roadops.has_permission('costs.read', division_id)
    or roadops.has_permission('costs.manage', division_id)
    or roadops.has_permission('costs.approve', division_id))
);
create policy cost_rate_versions_api_create on roadops.cost_rate_versions
for insert to roadops_api
with check (
  roadops.has_permission('costs.manage', division_id)
  and created_by = roadops.current_actor_id()
);
create policy cost_rate_versions_api_change on roadops.cost_rate_versions
for update to roadops_api
using (roadops.has_permission('costs.manage', division_id))
with check (
  roadops.has_permission('costs.manage', division_id)
  and created_by = roadops.current_actor_id()
);
create policy cost_rate_versions_api_delete on roadops.cost_rate_versions
for delete to roadops_api
using (roadops.has_permission('costs.manage', division_id));

create policy monthly_work_time_norms_api_read on roadops.monthly_work_time_norms
for select to roadops_api
using (
  roadops.can_access_division(division_id)
  and (roadops.has_permission('costs.read', division_id)
    or roadops.has_permission('costs.manage', division_id)
    or roadops.has_permission('costs.approve', division_id))
);
create policy monthly_work_time_norms_api_create on roadops.monthly_work_time_norms
for insert to roadops_api
with check (
  roadops.has_permission('costs.manage', division_id)
  and created_by = roadops.current_actor_id()
);
create policy monthly_work_time_norms_api_change on roadops.monthly_work_time_norms
for update to roadops_api
using (roadops.has_permission('costs.manage', division_id))
with check (
  roadops.has_permission('costs.manage', division_id)
  and created_by = roadops.current_actor_id()
);
create policy monthly_work_time_norms_api_delete on roadops.monthly_work_time_norms
for delete to roadops_api
using (roadops.has_permission('costs.manage', division_id));

create policy work_order_material_usages_api_read on roadops.work_order_material_usages
for select to roadops_api
using (
  roadops.can_access_division(roadops.division_for_work_order(work_order_id))
  and (roadops.has_permission('execution.read', roadops.division_for_work_order(work_order_id))
    or roadops.has_permission('costs.read', roadops.division_for_work_order(work_order_id)))
);
create policy work_order_material_usages_api_create on roadops.work_order_material_usages
for insert to roadops_api
with check (
  roadops.has_permission('execution.manage', roadops.division_for_work_order(work_order_id))
  and recorded_by = roadops.current_actor_id()
);
create policy equipment_usage_entries_api_read on roadops.equipment_usage_entries
for select to roadops_api
using (
  roadops.can_access_division(roadops.division_for_work_order(work_order_id))
  and (roadops.has_permission('execution.read', roadops.division_for_work_order(work_order_id))
    or roadops.has_permission('costs.read', roadops.division_for_work_order(work_order_id)))
);
create policy equipment_usage_entries_api_create on roadops.equipment_usage_entries
for insert to roadops_api
with check (
  roadops.has_permission('execution.manage', roadops.division_for_work_order(work_order_id))
  and recorded_by = roadops.current_actor_id()
);
create policy monthly_completion_acts_api_read on roadops.monthly_completion_acts
for select to roadops_api
using (
  roadops.can_access_division(division_id)
  and (roadops.has_permission('costs.read', division_id)
    or roadops.has_permission('costs.manage', division_id)
    or roadops.has_permission('costs.approve', division_id))
);
create policy monthly_completion_acts_api_create on roadops.monthly_completion_acts
for insert to roadops_api
with check (
  roadops.has_permission('costs.manage', division_id)
  and created_by = roadops.current_actor_id()
);
create policy monthly_completion_acts_api_delete on roadops.monthly_completion_acts
for delete to roadops_api
using (roadops.has_permission('costs.manage', division_id) and status = 'draft');

create policy monthly_completion_act_items_api_read on roadops.monthly_completion_act_items
for select to roadops_api
using (
  roadops.can_access_division(roadops.division_for_monthly_completion_act(act_id))
  and (roadops.has_permission('costs.read', roadops.division_for_monthly_completion_act(act_id))
    or roadops.has_permission('costs.manage', roadops.division_for_monthly_completion_act(act_id))
    or roadops.has_permission('costs.approve', roadops.division_for_monthly_completion_act(act_id)))
);
create policy monthly_completion_act_items_api_create on roadops.monthly_completion_act_items
for insert to roadops_api
with check (
  roadops.has_permission('costs.manage', roadops.division_for_monthly_completion_act(act_id))
);
create policy monthly_completion_act_items_api_delete on roadops.monthly_completion_act_items
for delete to roadops_api
using (
  roadops.has_permission('costs.manage', roadops.division_for_monthly_completion_act(act_id))
);

create policy monthly_completion_act_cost_lines_api_read
on roadops.monthly_completion_act_cost_lines
for select to roadops_api
using (
  roadops.can_access_division(roadops.division_for_monthly_completion_act_item(act_item_id))
  and (roadops.has_permission('costs.read', roadops.division_for_monthly_completion_act_item(act_item_id))
    or roadops.has_permission('costs.manage', roadops.division_for_monthly_completion_act_item(act_item_id))
    or roadops.has_permission('costs.approve', roadops.division_for_monthly_completion_act_item(act_item_id)))
);
create policy monthly_completion_act_cost_lines_api_create
on roadops.monthly_completion_act_cost_lines
for insert to roadops_api
with check (
  roadops.has_permission('costs.manage', roadops.division_for_monthly_completion_act_item(act_item_id))
);
create policy monthly_completion_act_cost_lines_api_delete
on roadops.monthly_completion_act_cost_lines
for delete to roadops_api
using (
  roadops.has_permission('costs.manage', roadops.division_for_monthly_completion_act_item(act_item_id))
);

do $reporting_policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'cost_rate_versions', 'monthly_work_time_norms',
    'work_order_material_usages', 'equipment_usage_entries',
    'monthly_completion_acts', 'monthly_completion_act_items',
    'monthly_completion_act_cost_lines'
  ] loop
    execute format(
      'create policy monthly_costing_reporting_read on roadops.%I '
      'for select to roadops_reporting using (true)', table_name
    );
  end loop;
end
$reporting_policies$;

grant select on roadops.cost_rate_versions, roadops.monthly_work_time_norms,
  roadops.work_order_material_usages, roadops.equipment_usage_entries,
  roadops.monthly_completion_acts, roadops.monthly_completion_act_items,
  roadops.monthly_completion_act_cost_lines to roadops_api, roadops_reporting;
grant insert on roadops.cost_rate_versions, roadops.monthly_work_time_norms,
  roadops.work_order_material_usages, roadops.equipment_usage_entries,
  roadops.monthly_completion_acts, roadops.monthly_completion_act_items,
  roadops.monthly_completion_act_cost_lines to roadops_api;
grant update (
  schedule_code, pricing_unit, rate_amount_uzs, effective_period,
  bonus_rate_bps, traffic_allowance_rate_bps, travel_allowance_rate_bps,
  social_contribution_rate_bps, version_no, source_reference
) on roadops.cost_rate_versions to roadops_api;
grant update (
  working_days, norm_minutes, version_no, source_reference
) on roadops.monthly_work_time_norms to roadops_api;
grant delete on roadops.cost_rate_versions, roadops.monthly_work_time_norms,
  roadops.monthly_completion_acts, roadops.monthly_completion_act_items,
  roadops.monthly_completion_act_cost_lines to roadops_api;

grant execute on function roadops.approve_cost_rate_version(uuid),
  roadops.approve_monthly_work_time_norm(uuid),
  roadops.approve_work_order_material_usage(uuid),
  roadops.approve_equipment_usage_entry(uuid),
  roadops.approve_time_entry(uuid),
  roadops.verify_work_order_completion(uuid),
  roadops.refresh_monthly_completion_act_totals(uuid),
  roadops.submit_monthly_completion_act(uuid),
  roadops.approve_monthly_completion_act(uuid),
  roadops.sync_plan_item_execution_status(uuid, text),
  roadops.finalize_material_reservation_for_usage(uuid),
  roadops.finalize_equipment_reservation_for_usage(uuid),
  roadops.reschedule_work_order(uuid, date) to roadops_api;
grant execute on function roadops.division_for_monthly_completion_act(uuid),
  roadops.division_for_monthly_completion_act_item(uuid) to roadops_api;

do $costing_audit_triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'cost_rate_versions', 'monthly_work_time_norms',
    'work_order_material_usages', 'equipment_usage_entries',
    'monthly_completion_acts', 'monthly_completion_act_items',
    'monthly_completion_act_cost_lines'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on roadops.%I '
      'for each row execute function roadops.capture_row_audit(%L)',
      table_name || '_audit', table_name, table_name
    );
  end loop;
end
$costing_audit_triggers$;

revoke all on function roadops.validate_cost_rate_version() from public;
revoke all on function roadops.guard_approved_costing_record() from public;
revoke all on function roadops.validate_work_order_material_usage() from public;
revoke all on function roadops.validate_equipment_usage_entry() from public;
revoke all on function roadops.sync_plan_item_execution_status(uuid, text) from public;
revoke all on function roadops.finalize_material_reservation_for_usage(uuid) from public;
revoke all on function roadops.finalize_equipment_reservation_for_usage(uuid) from public;
revoke all on function roadops.reschedule_work_order(uuid, date) from public;
revoke all on function roadops.prepare_monthly_completion_act() from public;
revoke all on function roadops.prepare_monthly_completion_act_item() from public;
revoke all on function roadops.prepare_monthly_completion_act_cost_line() from public;
revoke all on function roadops.guard_monthly_act_mutation() from public;
revoke all on function roadops.guard_monthly_act_child_mutation() from public;
revoke all on function roadops.refresh_monthly_completion_act_totals(uuid) from public;
revoke all on function roadops.monthly_completion_act_snapshot_hash(uuid) from public;
revoke all on function roadops.approve_cost_rate_version(uuid) from public;
revoke all on function roadops.approve_monthly_work_time_norm(uuid) from public;
revoke all on function roadops.approve_work_order_material_usage(uuid) from public;
revoke all on function roadops.approve_equipment_usage_entry(uuid) from public;
revoke all on function roadops.guard_independent_completion_verification() from public;
revoke all on function roadops.guard_verified_work_order() from public;
revoke all on function roadops.guard_time_entry_approval() from public;
revoke all on function roadops.guard_verified_completion_record() from public;
revoke all on function roadops.approve_time_entry(uuid) from public;
revoke all on function roadops.verify_work_order_completion(uuid) from public;
revoke all on function roadops.submit_monthly_completion_act(uuid) from public;
revoke all on function roadops.approve_monthly_completion_act(uuid) from public;
revoke all on function roadops.division_for_monthly_completion_act(uuid) from public;
revoke all on function roadops.division_for_monthly_completion_act_item(uuid) from public;

commit;
