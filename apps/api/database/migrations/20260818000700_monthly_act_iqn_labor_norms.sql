begin;

alter table roadops.monthly_completion_act_items
  add column iqn_norm_set_id_snapshot uuid
    references roadops.iqn_norm_sets(id) on delete restrict,
  add column iqn_labor_norm_line_ids_snapshot uuid[],
  add column iqn_basis_quantity_snapshot numeric(20,6),
  add column iqn_basis_unit_snapshot text,
  add column iqn_labor_minutes_per_basis_snapshot numeric(20,3),
  add column iqn_labor_minutes_per_unit_snapshot numeric(20,6),
  add column iqn_total_labor_minutes_snapshot numeric(20,6),
  add constraint monthly_act_item_iqn_labor_snapshot_ck check (
    (
      iqn_norm_set_id_snapshot is null
      and iqn_labor_norm_line_ids_snapshot is null
      and iqn_basis_quantity_snapshot is null
      and iqn_basis_unit_snapshot is null
      and iqn_labor_minutes_per_basis_snapshot is null
      and iqn_labor_minutes_per_unit_snapshot is null
      and iqn_total_labor_minutes_snapshot is null
    )
    or (
      iqn_norm_set_id_snapshot is not null
      and iqn_labor_norm_line_ids_snapshot is not null
      and cardinality(iqn_labor_norm_line_ids_snapshot) > 0
      and iqn_basis_quantity_snapshot is not null
      and iqn_basis_quantity_snapshot > 0
      and iqn_basis_unit_snapshot is not null
      and coalesce(btrim(iqn_basis_unit_snapshot), '') <> ''
      and iqn_labor_minutes_per_basis_snapshot is not null
      and iqn_labor_minutes_per_basis_snapshot > 0
      and iqn_labor_minutes_per_unit_snapshot is not null
      and iqn_labor_minutes_per_unit_snapshot > 0
      and iqn_total_labor_minutes_snapshot is not null
      and iqn_total_labor_minutes_snapshot > 0
    )
  );

comment on column roadops.monthly_completion_act_items.iqn_norm_set_id_snapshot is
  'Approved IQN norm set selected for the work completion date; immutable after first capture.';
comment on column roadops.monthly_completion_act_items.iqn_labor_norm_line_ids_snapshot is
  'Ordered IDs of approved labor norm lines included in the frozen labor-minute total.';
comment on column roadops.monthly_completion_act_items.iqn_labor_minutes_per_unit_snapshot is
  'Frozen IQN labor minutes per one completed work unit.';
comment on column roadops.monthly_completion_act_items.iqn_total_labor_minutes_snapshot is
  'Frozen linear IQN labor minutes: completed_quantity / basis_quantity * labor minutes per basis.';

create index monthly_act_items_iqn_norm_set_snapshot_idx
  on roadops.monthly_completion_act_items (iqn_norm_set_id_snapshot)
  where iqn_norm_set_id_snapshot is not null;

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
            ) || case
              when i.iqn_norm_set_id_snapshot is null then '{}'::jsonb
              else jsonb_build_object(
                'iqn_norm_set_id', i.iqn_norm_set_id_snapshot,
                'iqn_labor_norm_line_ids', i.iqn_labor_norm_line_ids_snapshot,
                'iqn_basis_quantity', i.iqn_basis_quantity_snapshot,
                'iqn_basis_unit', i.iqn_basis_unit_snapshot,
                'iqn_labor_minutes_per_basis', i.iqn_labor_minutes_per_basis_snapshot,
                'iqn_labor_minutes_per_unit', i.iqn_labor_minutes_per_unit_snapshot,
                'iqn_total_labor_minutes', i.iqn_total_labor_minutes_snapshot
              )
            end order by i.id
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

create or replace function roadops.validate_monthly_act_iqn_labor_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  expected record;
begin
  if new.iqn_norm_set_id_snapshot is null then
    raise exception using errcode = '23514',
      message = 'MONTHLY_ACT_IQN_LABOR_NORM_SNAPSHOT_MISSING';
  end if;

  select norm_set.id norm_set_id,
         array_agg(norm_line.id order by norm_line.source_line_number, norm_line.id)
           labor_norm_line_ids,
         variant.basis_quantity, variant.basis_unit,
         sum(norm_line.minutes_per_basis)::numeric(20,3) labor_minutes_per_basis,
         round(sum(norm_line.minutes_per_basis) / variant.basis_quantity, 6)
           labor_minutes_per_unit,
         round((new.completed_quantity / variant.basis_quantity)
           * sum(norm_line.minutes_per_basis), 6) total_labor_minutes
  into expected
  from roadops.iqn_norm_sets norm_set
  join roadops.iqn_work_variants variant on variant.id = norm_set.work_variant_id
  join roadops.iqn_norm_lines norm_line on norm_line.norm_set_id = norm_set.id
  join roadops.iqn_resources resource on resource.id = norm_line.resource_id
  where norm_set.id = new.iqn_norm_set_id_snapshot
    and norm_set.work_variant_id = new.work_variant_id_snapshot
    and norm_set.status = 'approved'
    and norm_set.effective_from
      <= (new.completed_at_snapshot at time zone 'Asia/Tashkent')::date
    and (
      norm_set.effective_until is null
      or norm_set.effective_until
        > (new.completed_at_snapshot at time zone 'Asia/Tashkent')::date
    )
    and variant.basis_quantity is not null
    and btrim(variant.basis_unit) = btrim(new.work_unit)
    and variant.formula_type = 'linear'
    and resource.resource_kind = 'labor'
    and norm_line.minutes_per_basis is not null
    and not exists (
      select 1
      from roadops.iqn_norm_lines incomplete_line
      join roadops.iqn_resources incomplete_resource
        on incomplete_resource.id = incomplete_line.resource_id
      where incomplete_line.norm_set_id = norm_set.id
        and incomplete_resource.resource_kind = 'labor'
        and incomplete_line.minutes_per_basis is null
    )
  group by norm_set.id, variant.basis_quantity, variant.basis_unit
  having sum(norm_line.minutes_per_basis) > 0;

  if not found then
    raise exception using errcode = '23514',
      message = 'MONTHLY_ACT_IQN_LABOR_NORM_INVALID';
  end if;

  if new.iqn_labor_norm_line_ids_snapshot is distinct from expected.labor_norm_line_ids
     or new.iqn_basis_quantity_snapshot is distinct from expected.basis_quantity
     or new.iqn_basis_unit_snapshot is distinct from expected.basis_unit
     or new.iqn_labor_minutes_per_basis_snapshot is distinct from expected.labor_minutes_per_basis
     or new.iqn_labor_minutes_per_unit_snapshot is distinct from expected.labor_minutes_per_unit
     or new.iqn_total_labor_minutes_snapshot is distinct from expected.total_labor_minutes then
    raise exception using errcode = '23514',
      message = 'MONTHLY_ACT_IQN_LABOR_NORM_INVALID';
  end if;

  return new;
end
$function$;

create trigger monthly_act_items_iqn_labor_snapshot_validate
after insert or update of
  work_variant_id_snapshot, completed_at_snapshot, completed_quantity, work_unit,
  iqn_norm_set_id_snapshot, iqn_labor_norm_line_ids_snapshot,
  iqn_basis_quantity_snapshot, iqn_basis_unit_snapshot,
  iqn_labor_minutes_per_basis_snapshot, iqn_labor_minutes_per_unit_snapshot,
  iqn_total_labor_minutes_snapshot
on roadops.monthly_completion_act_items
for each row execute function roadops.validate_monthly_act_iqn_labor_snapshot();

create or replace function roadops.guard_monthly_act_iqn_labor_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.iqn_norm_set_id_snapshot is not null and (
       new.iqn_norm_set_id_snapshot is distinct from old.iqn_norm_set_id_snapshot
       or new.iqn_labor_norm_line_ids_snapshot is distinct from old.iqn_labor_norm_line_ids_snapshot
       or new.iqn_basis_quantity_snapshot is distinct from old.iqn_basis_quantity_snapshot
       or new.iqn_basis_unit_snapshot is distinct from old.iqn_basis_unit_snapshot
       or new.iqn_labor_minutes_per_basis_snapshot is distinct from old.iqn_labor_minutes_per_basis_snapshot
       or new.iqn_labor_minutes_per_unit_snapshot is distinct from old.iqn_labor_minutes_per_unit_snapshot
       or new.iqn_total_labor_minutes_snapshot is distinct from old.iqn_total_labor_minutes_snapshot
     ) then
    raise exception using errcode = '55000',
      message = 'Monthly act IQN labor norm snapshot is immutable';
  end if;
  return new;
end
$function$;

create trigger monthly_act_items_iqn_labor_snapshot_guard
before update on roadops.monthly_completion_act_items
for each row execute function roadops.guard_monthly_act_iqn_labor_snapshot();

create or replace function roadops.guard_monthly_act_verified_work_completeness()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.status is distinct from new.status and new.status in ('submitted', 'approved') then
    if exists (
      select 1
      from roadops.monthly_completion_act_items item
      where item.act_id = new.id
        and (
          item.iqn_norm_set_id_snapshot is null
          or item.iqn_labor_norm_line_ids_snapshot is null
          or item.iqn_basis_quantity_snapshot is null
          or item.iqn_basis_unit_snapshot is null
          or item.iqn_labor_minutes_per_basis_snapshot is null
          or item.iqn_labor_minutes_per_unit_snapshot is null
          or item.iqn_total_labor_minutes_snapshot is null
        )
    ) then
      raise exception using errcode = '23514',
        message = 'MONTHLY_ACT_IQN_LABOR_NORM_SNAPSHOT_MISSING';
    end if;

    if exists (
      select 1
      from roadops.work_orders wo
      join roadops.plan_items plan_item on plan_item.id = wo.plan_item_id
      join roadops.planning_runs planning_run on planning_run.id = plan_item.planning_run_id
      join roadops.work_completion_records completion on completion.work_order_id = wo.id
      where planning_run.division_id = new.division_id
        and wo.status = 'verified'
        and wo.completed_at is not null
        and completion.verified_at is not null
        and completion.verified_by is not null
        and (wo.completed_at at time zone 'Asia/Tashkent')::date >= new.act_month
        and (wo.completed_at at time zone 'Asia/Tashkent')::date
          < (new.act_month + interval '1 month')::date
        and not exists (
          select 1
          from roadops.monthly_completion_act_items included
          where included.act_id = new.id and included.work_order_id = wo.id
        )
    ) then
      raise exception using errcode = '23514',
        message = 'MONTHLY_ACT_VERIFIED_WORK_MISSING';
    end if;
  end if;
  return new;
end
$function$;

create trigger monthly_completion_acts_verified_work_completeness_guard
before update of status on roadops.monthly_completion_acts
for each row execute function roadops.guard_monthly_act_verified_work_completeness();

create or replace function roadops.reject_late_verification_for_closed_act_month()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  work_division_id uuid;
  completion_date date;
begin
  if old.status is distinct from 'verified' and new.status = 'verified' then
    work_division_id := roadops.division_for_work_order(new.id);
    completion_date := (new.completed_at at time zone 'Asia/Tashkent')::date;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      work_division_id::text || ':'
        || pg_catalog.date_part('year', completion_date)::integer::text,
      20260818
    ));
    if exists (
      select 1
      from roadops.monthly_completion_acts act
      where act.division_id = work_division_id
        and act.act_month = pg_catalog.date_trunc('month', completion_date)::date
        and act.status in ('submitted', 'approved')
    ) then
      raise exception using errcode = '55000',
        message = 'MONTHLY_ACT_MONTH_CLOSED_FOR_LATE_VERIFICATION';
    end if;
  end if;
  return new;
end
$function$;

create trigger work_orders_closed_month_verification_guard
before update of status on roadops.work_orders
for each row execute function roadops.reject_late_verification_for_closed_act_month();

revoke all on function roadops.guard_monthly_act_iqn_labor_snapshot() from public;
revoke all on function roadops.validate_monthly_act_iqn_labor_snapshot() from public;
revoke all on function roadops.guard_monthly_act_verified_work_completeness() from public;
revoke all on function roadops.reject_late_verification_for_closed_act_month() from public;

commit;
