begin;

alter table roadops.monthly_completion_act_cost_lines
  add column payroll_snapshot_id uuid references roadops.payroll_snapshots(id) on delete restrict,
  add column payroll_source_allocation jsonb,
  add column payroll_extra_amount_uzs numeric(24,2) not null default 0 check (payroll_extra_amount_uzs >= 0);
create index monthly_act_cost_lines_payroll_idx
  on roadops.monthly_completion_act_cost_lines (payroll_snapshot_id)
  where payroll_snapshot_id is not null;
alter table roadops.monthly_completion_act_cost_lines
  drop constraint monthly_completion_act_cost_lines_labor_components_ck,
  add constraint monthly_completion_act_cost_lines_labor_components_ck check (
    (line_kind = 'labor' and amount_uzs = base_wage_amount_uzs + bonus_amount_uzs
      + traffic_allowance_amount_uzs + travel_allowance_amount_uzs
      + payroll_extra_amount_uzs + social_amount_uzs)
    or (line_kind <> 'labor' and base_wage_amount_uzs = 0 and bonus_amount_uzs = 0
      and traffic_allowance_amount_uzs = 0 and travel_allowance_amount_uzs = 0
      and payroll_extra_amount_uzs = 0 and social_amount_uzs = 0 and bonus_rate_bps = 0
      and traffic_allowance_rate_bps = 0 and travel_allowance_rate_bps = 0
      and social_contribution_rate_bps = 0)
  ),
  add constraint monthly_act_cost_lines_payroll_shape_ck check (
    (payroll_snapshot_id is null and payroll_source_allocation is null and payroll_extra_amount_uzs = 0)
    or (line_kind = 'labor' and payroll_snapshot_id is not null
      and jsonb_typeof(payroll_source_allocation) = 'object')
  );

-- Legacy draft norm backfill was implemented in the API but lacked column
-- grants/RLS UPDATE, so regenerating a draft could fail under roadops_api.
-- Only the previously empty, source-validated IQN snapshot can be filled.
grant update (
  iqn_norm_set_id_snapshot, iqn_labor_norm_line_ids_snapshot, iqn_basis_quantity_snapshot,
  iqn_basis_unit_snapshot, iqn_labor_minutes_per_basis_snapshot,
  iqn_labor_minutes_per_unit_snapshot, iqn_total_labor_minutes_snapshot
) on roadops.monthly_completion_act_items to roadops_api;
create policy monthly_completion_act_items_iqn_backfill on roadops.monthly_completion_act_items
  for update to roadops_api
  using (iqn_norm_set_id_snapshot is null and exists (
    select 1 from roadops.monthly_completion_acts a where a.id = act_id and a.status = 'draft'
      and roadops.has_permission('costs.manage', a.division_id)
  ))
  with check (exists (
    select 1 from roadops.monthly_completion_acts a where a.id = act_id and a.status = 'draft'
      and roadops.has_permission('costs.manage', a.division_id)
  ));

-- Serialize drafts' child changes with submission. Previously the status check
-- could read "draft" while another transaction was freezing the same act.
-- This narrow trigger uses owner rights only to lock the parent; callers have
-- no direct UPDATE grant on acts. Child RLS and the immutable-state guard still apply.
create or replace function roadops.guard_monthly_act_child_mutation()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare parent_status text;
begin
  if tg_op = 'UPDATE' and (
    (tg_table_name = 'monthly_completion_act_items' and to_jsonb(new)->'act_id' is distinct from to_jsonb(old)->'act_id')
    or (tg_table_name = 'monthly_completion_act_cost_lines' and to_jsonb(new)->'act_item_id' is distinct from to_jsonb(old)->'act_item_id')
  ) then
    raise exception using errcode = '55000', message = 'Monthly act child cannot be moved to another parent';
  end if;
  if tg_table_name = 'monthly_completion_act_items' then
    select a.status into parent_status from roadops.monthly_completion_acts a
      where a.id = coalesce(new.act_id, old.act_id) for update;
  else
    select a.status into parent_status from roadops.monthly_completion_act_items i
      join roadops.monthly_completion_acts a on a.id = i.act_id
      where i.id = coalesce(new.act_item_id, old.act_item_id) for update of a;
  end if;
  if parent_status is distinct from 'draft' then
    raise exception using errcode = '55000', message = 'Submitted monthly act items and cost lines are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $function$;

create function roadops.guard_payroll_posted_allocations()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare posted record; allocation jsonb; matches integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    new.division_id::text || ':' || extract(year from new.work_month)::integer::text, 20260818));
  for posted in select l.time_entry_id, l.payroll_source_allocation
    from roadops.monthly_completion_act_cost_lines l
    join roadops.monthly_completion_act_items i on i.id = l.act_item_id
    join roadops.monthly_completion_acts a on a.id = i.act_id
    join roadops.time_entries te on te.id = l.time_entry_id
    where a.division_id = new.division_id and a.status in ('submitted', 'approved')
      and date_trunc('month', te.work_date)::date = new.work_month
      and l.payroll_snapshot_id is not null
  loop
    select count(*), (jsonb_agg(source.value))->0 into matches, allocation
    from jsonb_array_elements(new.snapshot->'rows') worker(value)
    cross join lateral jsonb_array_elements(worker.value->'sourceAllocations') source(value)
    where source.value->>'timeEntryId' = posted.time_entry_id::text;
    if matches <> 1 or allocation is distinct from
      (posted.payroll_source_allocation - array['snapshotHash','policyReference','coefficient']) then
      raise exception using errcode = '23514', message = 'PAYROLL_POSTED_ALLOCATION_CHANGED';
    end if;
  end loop;
  return new;
end $function$;
create trigger payroll_snapshots_posted_allocation_guard before insert on roadops.payroll_snapshots
  for each row execute function roadops.guard_payroll_posted_allocations();

-- Validate arithmetic and source uniqueness independently of the API. Old v1
-- previews remain readable but cannot supply an act payroll allocation.
create function roadops.validate_payroll_source_allocations()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare
  worker jsonb; allocation jsonb; component record; source_ids text[] := '{}'; worker_ids text[] := '{}';
  monthly_rate numeric; norm_minutes integer; expected_base numeric;
  attendance roadops.time_entries%rowtype; entry_gross numeric;
  worker_gross numeric; worker_social numeric; worker_minutes integer;
  total_gross numeric := 0; total_cost numeric := 0;
begin
  if new.snapshot->>'calculationVersion' is distinct from 'payroll-source-allocation-v2' then return new; end if;
  for worker in select value from jsonb_array_elements(new.snapshot->'rows') loop
    if worker->>'workerId' = any(worker_ids) then
      raise exception using errcode = '23514', message = 'PAYROLL_WORKER_DUPLICATED';
    end if;
    worker_ids := array_append(worker_ids, worker->>'workerId');
    if jsonb_typeof(worker->'sourceAllocations') is distinct from 'array'
       or jsonb_array_length(worker->'sourceAllocations') = 0 then
      raise exception using errcode = '23514', message = 'PAYROLL_SOURCE_ALLOCATION_INVALID';
    end if;
    worker_gross := 0; worker_social := 0; worker_minutes := 0;
    for allocation in select value from jsonb_array_elements(worker->'sourceAllocations') loop
      if allocation->>'timeEntryId' = any(source_ids) then
        raise exception using errcode = '23514', message = 'PAYROLL_SOURCE_DUPLICATED';
      end if;
      source_ids := array_append(source_ids, allocation->>'timeEntryId');
      select te.* into attendance from roadops.time_entries te
        join roadops.work_orders wo on wo.id = te.work_order_id
        where te.id = (allocation->>'timeEntryId')::uuid and wo.status = 'verified'
          and te.approved_at is not null and te.approved_by is not null;
      if attendance.id is null or attendance.worker_id::text is distinct from worker->>'workerId'
        or attendance.work_order_id::text is distinct from allocation->>'workOrderId'
        or attendance.work_date::text is distinct from allocation->>'workDate'
        or attendance.actual_minutes is distinct from (allocation->>'actualMinutes')::integer
        or date_trunc('month', attendance.work_date)::date is distinct from new.work_month
        or roadops.division_for_work_order(attendance.work_order_id) is distinct from new.division_id then
        raise exception using errcode = '23514', message = 'PAYROLL_SOURCE_ALLOCATION_INVALID';
      end if;
      if not exists (select 1 from roadops.cost_rate_versions r
        join roadops.monthly_work_time_norms n on n.id = (allocation->>'normId')::uuid
        where r.id = (allocation->>'rateId')::uuid and r.status = 'approved' and r.rate_kind = 'labor'
          and r.worker_id = attendance.worker_id and r.division_id = new.division_id
          and r.effective_period @> attendance.work_date and n.status = 'approved'
          and n.division_id = r.division_id and n.schedule_code = r.schedule_code and n.work_month = new.work_month) then
        raise exception using errcode = '23514', message = 'PAYROLL_SOURCE_RATE_INVALID';
      end if;
      select r.rate_amount_uzs, n.norm_minutes into monthly_rate, norm_minutes
        from roadops.cost_rate_versions r cross join roadops.monthly_work_time_norms n
        where r.id = (allocation->>'rateId')::uuid and n.id = (allocation->>'normId')::uuid;
      expected_base := round(monthly_rate * (worker->>'coefficient')::numeric * attendance.actual_minutes / norm_minutes, 2);
      if (worker->>'coefficient')::numeric not between 0.01 and 10
        or expected_base is distinct from (allocation->'components'->>'baseWageAmountUzs')::numeric then
        raise exception using errcode = '23514', message = 'PAYROLL_SOURCE_BASE_MISMATCH';
      end if;
      entry_gross := 0;
      if jsonb_typeof(allocation->'components') is distinct from 'object'
        or not ((allocation->'components') ?& array['baseWageAmountUzs','bonusAmountUzs',
          'trafficAllowanceAmountUzs','travelAllowanceAmountUzs','seniorityAmountUzs','additionalAmountUzs',
          'mealAmountUzs','holidayAmountUzs','oneTimeAmountUzs','terminationAmountUzs',
          'sickLeaveAmountUzs','leaveAmountUzs','materialAidAmountUzs']) then
        raise exception using errcode = '23514', message = 'PAYROLL_SOURCE_ALLOCATION_INVALID';
      end if;
      for component in select * from jsonb_each_text(allocation->'components') loop
        if component.value is null or component.value !~ '^[0-9]+(\.[0-9]{1,2})?$'
          or component.key <> all(array['baseWageAmountUzs','bonusAmountUzs','trafficAllowanceAmountUzs',
            'travelAllowanceAmountUzs','seniorityAmountUzs','additionalAmountUzs','mealAmountUzs',
            'holidayAmountUzs','oneTimeAmountUzs','terminationAmountUzs','sickLeaveAmountUzs',
            'leaveAmountUzs','materialAidAmountUzs'])
          or component.value::numeric < 0
          or component.value::numeric <> round(component.value::numeric, 2) then
          raise exception using errcode = '23514', message = 'PAYROLL_SOURCE_ALLOCATION_INVALID';
        end if;
        entry_gross := entry_gross + component.value::numeric;
      end loop;
      if coalesce(allocation->>'employerSocialAmountUzs', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
        or coalesce(allocation->>'grossAmountUzs', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
        or coalesce(allocation->>'employerCostAmountUzs', '') !~ '^[0-9]+(\.[0-9]{1,2})?$'
        or entry_gross is distinct from (allocation->>'grossAmountUzs')::numeric
        or (allocation->>'employerSocialAmountUzs')::numeric < 0
        or entry_gross + (allocation->>'employerSocialAmountUzs')::numeric
          is distinct from (allocation->>'employerCostAmountUzs')::numeric then
        raise exception using errcode = '23514', message = 'PAYROLL_SOURCE_TOTAL_MISMATCH';
      end if;
      worker_gross := worker_gross + entry_gross;
      worker_social := worker_social + (allocation->>'employerSocialAmountUzs')::numeric;
      worker_minutes := worker_minutes + attendance.actual_minutes;
    end loop;
    for component in select parts.key, sum(parts.value::numeric) amount from jsonb_array_elements(worker->'sourceAllocations') a,
      lateral jsonb_each_text(a->'components') parts group by parts.key
    loop
      if component.amount is distinct from (worker->>component.key)::numeric then
        raise exception using errcode = '23514', message = 'PAYROLL_COMPONENT_TOTAL_MISMATCH';
      end if;
    end loop;
    if worker_gross is distinct from (worker->>'grossAmountUzs')::numeric
      or worker_social is distinct from (worker->>'employerSocialAmountUzs')::numeric
      or worker_gross + worker_social is distinct from (worker->>'employerCostAmountUzs')::numeric
      or worker_minutes is distinct from (worker->>'actualMinutes')::integer then
      raise exception using errcode = '23514', message = 'PAYROLL_SOURCE_TOTAL_MISMATCH';
    end if;
    total_gross := total_gross + worker_gross;
    total_cost := total_cost + worker_gross + worker_social;
  end loop;
  if total_gross is distinct from (new.snapshot->'totals'->>'grossAmountUzs')::numeric
    or total_cost is distinct from (new.snapshot->'totals'->>'employerCostAmountUzs')::numeric then
    raise exception using errcode = '23514', message = 'PAYROLL_SOURCE_TOTAL_MISMATCH';
  end if;
  if exists (select 1 from roadops.time_entries te join roadops.work_orders wo on wo.id = te.work_order_id
      where wo.status = 'verified' and te.approved_at is not null and te.approved_by is not null
        and roadops.division_for_work_order(wo.id) = new.division_id
        and date_trunc('month', te.work_date)::date = new.work_month and not(te.id::text = any(source_ids))) then
    raise exception using errcode = '23514', message = 'PAYROLL_SNAPSHOT_STALE';
  end if;
  return new;
end $function$;
create trigger payroll_snapshots_source_allocation_validate before insert on roadops.payroll_snapshots
  for each row execute function roadops.validate_payroll_source_allocations();

create function roadops.prepare_monthly_act_payroll_allocation()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare
  payroll roadops.payroll_snapshots%rowtype;
  attendance roadops.time_entries%rowtype;
  division uuid;
  source_allocation jsonb;
  worker_row jsonb;
  parts jsonb;
  extra numeric;
begin
  if new.line_kind <> 'labor' then
    new.payroll_snapshot_id := null; new.payroll_source_allocation := null;
    new.payroll_extra_amount_uzs := 0;
    return new;
  end if;
  select * into attendance from roadops.time_entries where id = new.time_entry_id;
  division := roadops.division_for_work_order(attendance.work_order_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    division::text || ':' || extract(year from attendance.work_date)::integer::text, 20260818));
  select p.* into payroll from roadops.payroll_snapshots p
    where p.division_id = division and p.work_month = date_trunc('month', attendance.work_date)::date
    order by p.created_at desc, p.id desc limit 1;
  if payroll.id is null or payroll.snapshot->>'calculationVersion' is distinct from 'payroll-source-allocation-v2' then
    raise exception using errcode = '23514', message = 'PAYROLL_SNAPSHOT_REQUIRED';
  end if;
  select worker.value, allocation.value into worker_row, source_allocation
    from jsonb_array_elements(payroll.snapshot->'rows') worker(value)
    cross join lateral jsonb_array_elements(worker.value->'sourceAllocations') allocation(value)
    where worker.value->>'workerId' = attendance.worker_id::text
      and allocation.value->>'timeEntryId' = attendance.id::text;
  if source_allocation is null
    or source_allocation->>'workOrderId' is distinct from attendance.work_order_id::text
    or source_allocation->>'workDate' is distinct from attendance.work_date::text
    or (source_allocation->>'actualMinutes')::integer is distinct from attendance.actual_minutes
    or source_allocation->>'rateId' is distinct from new.cost_rate_version_id::text
    or source_allocation->>'normId' is distinct from new.monthly_work_time_norm_id::text then
    raise exception using errcode = '23514', message = 'PAYROLL_SNAPSHOT_STALE';
  end if;
  parts := source_allocation->'components';
  select sum(value::numeric) into extra from jsonb_each_text(parts)
    where key not in ('baseWageAmountUzs','bonusAmountUzs','trafficAllowanceAmountUzs','travelAllowanceAmountUzs');
  new.payroll_snapshot_id := payroll.id;
  new.payroll_source_allocation := source_allocation || jsonb_build_object(
    'snapshotHash', encode(payroll.snapshot_hash, 'hex'),
    'policyReference', payroll.policy_reference,
    'coefficient', worker_row->>'coefficient'
  );
  new.base_wage_amount_uzs := (parts->>'baseWageAmountUzs')::numeric;
  new.bonus_amount_uzs := (parts->>'bonusAmountUzs')::numeric;
  new.traffic_allowance_amount_uzs := (parts->>'trafficAllowanceAmountUzs')::numeric;
  new.travel_allowance_amount_uzs := (parts->>'travelAllowanceAmountUzs')::numeric;
  new.payroll_extra_amount_uzs := coalesce(extra, 0);
  new.social_amount_uzs := (source_allocation->>'employerSocialAmountUzs')::numeric;
  new.amount_uzs := (source_allocation->>'employerCostAmountUzs')::numeric;
  new.bonus_rate_bps := coalesce((worker_row->'adjustments'->>'bonusRateBps')::integer, new.bonus_rate_bps);
  new.traffic_allowance_rate_bps := coalesce((worker_row->'adjustments'->>'trafficAllowanceRateBps')::integer, new.traffic_allowance_rate_bps);
  new.travel_allowance_rate_bps := coalesce((worker_row->'adjustments'->>'travelAllowanceRateBps')::integer, new.travel_allowance_rate_bps);
  new.social_contribution_rate_bps := coalesce((worker_row->'adjustments'->>'socialContributionRateBps')::integer, new.social_contribution_rate_bps);
  return new;
end $function$;
-- PostgreSQL executes same-event triggers alphabetically: derive the approved
-- tariff baseline first, then bind the reviewed payroll allocation.
create trigger monthly_completion_act_cost_lines_zz_payroll
  before insert on roadops.monthly_completion_act_cost_lines
  for each row execute function roadops.prepare_monthly_act_payroll_allocation();

-- Retain the previous hash algorithm for historical acts. New acts additionally
-- bind their payroll identity, immutable snapshot hash, and every allocation.
alter function roadops.monthly_completion_act_snapshot_hash(uuid)
  rename to monthly_completion_act_snapshot_hash_before_payroll;
create function roadops.monthly_completion_act_snapshot_hash(p_act_id uuid)
returns bytea language sql stable security definer set search_path = '' as $function$
  select case when exists (
    select 1 from roadops.monthly_completion_act_cost_lines l
    join roadops.monthly_completion_act_items i on i.id = l.act_item_id
    where i.act_id = p_act_id and l.payroll_snapshot_id is not null
  ) then extensions.digest(convert_to(jsonb_build_object(
    'priorHash', encode(roadops.monthly_completion_act_snapshot_hash_before_payroll(p_act_id),'hex'),
    'payrollAllocations', (select jsonb_agg(jsonb_build_object(
      'id', l.id, 'payrollSnapshotId', l.payroll_snapshot_id,
      'sourceAllocation', l.payroll_source_allocation, 'extraAmountUzs', l.payroll_extra_amount_uzs
    ) order by l.id) from roadops.monthly_completion_act_cost_lines l
    join roadops.monthly_completion_act_items i on i.id = l.act_item_id where i.act_id = p_act_id)
  )::text, 'UTF8'), 'sha256')
  else roadops.monthly_completion_act_snapshot_hash_before_payroll(p_act_id) end
$function$;

create function roadops.guard_monthly_act_payroll_freshness()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare payroll record;
begin
  if old.status = 'draft' and new.status = 'submitted' then
    if exists (select 1 from roadops.monthly_completion_act_items i
      join roadops.monthly_completion_act_cost_lines l on l.act_item_id = i.id
      where i.act_id = new.id and l.line_kind = 'labor' and l.payroll_snapshot_id is null) then
      raise exception using errcode = '23514', message = 'PAYROLL_SNAPSHOT_REQUIRED';
    end if;
    for payroll in select distinct p.id, p.division_id, p.work_month
      from roadops.monthly_completion_act_items i
      join roadops.monthly_completion_act_cost_lines l on l.act_item_id = i.id
      join roadops.payroll_snapshots p on p.id = l.payroll_snapshot_id where i.act_id = new.id
      order by p.work_month, p.id
    loop
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        payroll.division_id::text || ':' || extract(year from payroll.work_month)::integer::text, 20260818));
      if payroll.id is distinct from (select p.id from roadops.payroll_snapshots p
          where p.division_id = payroll.division_id and p.work_month = payroll.work_month
          order by p.created_at desc, p.id desc limit 1)
        or exists (select 1 from roadops.time_entries te
          join roadops.work_orders wo on wo.id = te.work_order_id
          where wo.status = 'verified' and te.approved_at is not null
            and roadops.division_for_work_order(wo.id) = payroll.division_id
            and date_trunc('month', te.work_date)::date = payroll.work_month
            and not exists (select 1 from roadops.payroll_snapshots p,
              jsonb_array_elements(p.snapshot->'rows') w,
              jsonb_array_elements(w->'sourceAllocations') allocation
              where p.id = payroll.id and allocation->>'timeEntryId' = te.id::text)) then
        raise exception using errcode = '23514', message = 'PAYROLL_SNAPSHOT_STALE';
      end if;
    end loop;
  end if;
  return new;
end $function$;
create trigger monthly_completion_acts_payroll_freshness
  before update of status on roadops.monthly_completion_acts
  for each row execute function roadops.guard_monthly_act_payroll_freshness();

revoke all on function roadops.guard_payroll_posted_allocations(), roadops.validate_payroll_source_allocations(),
  roadops.prepare_monthly_act_payroll_allocation(), roadops.guard_monthly_act_payroll_freshness(),
  roadops.monthly_completion_act_snapshot_hash_before_payroll(uuid),
  roadops.monthly_completion_act_snapshot_hash(uuid) from public;
commit;
