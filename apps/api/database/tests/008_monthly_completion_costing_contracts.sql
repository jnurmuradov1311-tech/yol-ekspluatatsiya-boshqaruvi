-- Run after all production migrations. No fixture data is required.
begin;

do $test$
declare
  missing_table text;
begin
  select string_agg(expected.table_name, ', ' order by expected.table_name)
  into missing_table
  from unnest(array[
    'cost_rate_versions', 'monthly_work_time_norms',
    'work_order_material_usages', 'equipment_usage_entries',
    'monthly_completion_acts', 'monthly_completion_act_items',
    'monthly_completion_act_cost_lines'
  ]) expected(table_name)
  where to_regclass('roadops.' || expected.table_name) is null;
  if missing_table is not null then
    raise exception 'Monthly costing tables missing: %', missing_table;
  end if;
end
$test$;

do $test$
declare
  unsafe_table text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
  into unsafe_table
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'roadops'
    and c.relname = any (array[
      'cost_rate_versions', 'monthly_work_time_norms',
      'work_order_material_usages', 'equipment_usage_entries',
      'monthly_completion_acts', 'monthly_completion_act_items',
      'monthly_completion_act_cost_lines'
    ])
    and (not c.relrowsecurity or not c.relforcerowsecurity);
  if unsafe_table is not null then
    raise exception 'Monthly costing tables missing ENABLE/FORCE RLS: %', unsafe_table;
  end if;
end
$test$;

do $test$
declare
  permission_code text;
begin
  select string_agg(expected.code, ', ' order by expected.code)
  into permission_code
  from unnest(array['execution.verify', 'costs.read', 'costs.manage', 'costs.approve']) expected(code)
  where not exists (select 1 from roadops.permissions p where p.code = expected.code);
  if permission_code is not null then
    raise exception 'Monthly costing permissions missing: %', permission_code;
  end if;
end
$test$;

do $test$
declare
  missing_column text;
begin
  select string_agg(expected.column_name, ', ' order by expected.column_name)
  into missing_column
  from unnest(array[
    'bonus_rate_bps', 'traffic_allowance_rate_bps',
    'travel_allowance_rate_bps', 'social_contribution_rate_bps'
  ]) expected(column_name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'roadops' and c.table_name = 'cost_rate_versions'
      and c.column_name = expected.column_name
  );
  if missing_column is not null then
    raise exception 'Approved labor rate allowance fields missing: %', missing_column;
  end if;

  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'roadops' and c.table_name = 'work_order_material_usages'
      and c.column_name = 'material_reservation_id' and c.is_nullable = 'NO'
  ) or not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'roadops' and c.table_name = 'equipment_usage_entries'
      and c.column_name = 'equipment_reservation_id' and c.is_nullable = 'NO'
  ) then
    raise exception 'Actual material/equipment usage must preserve its explicit reservation audit link';
  end if;

  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'roadops' and c.table_name = 'monthly_completion_act_items'
      and c.column_name = 'norm_reference_snapshot' and c.is_nullable = 'NO'
  ) then
    raise exception 'Monthly act item must freeze its IQN norm reference';
  end if;

  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'roadops' and c.table_name = 'monthly_completion_acts'
      and c.column_name = 'division_name_snapshot' and c.is_nullable = 'NO'
  ) or not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'roadops' and c.table_name = 'monthly_completion_act_items'
      and c.column_name = 'road_name_snapshot' and c.is_nullable = 'NO'
  ) or not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'roadops' and c.table_name = 'monthly_completion_act_cost_lines'
      and c.column_name = 'resource_detail_snapshot' and c.is_nullable = 'NO'
  ) or not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'roadops' and c.table_name = 'monthly_completion_act_items'
      and c.column_name = 'annual_planned_quantity_snapshot' and c.is_nullable = 'NO'
  ) or not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'roadops' and c.table_name = 'monthly_completion_act_items'
      and c.column_name = 'year_to_date_quantity_snapshot' and c.is_nullable = 'NO'
  ) or not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'roadops' and c.table_name = 'monthly_completion_act_items'
      and c.column_name = 'year_to_date_amount_uzs_snapshot' and c.is_nullable = 'NO'
  ) then
    raise exception 'Monthly act legal display values must be frozen with the cost snapshot';
  end if;

  select string_agg(expected.column_name, ', ' order by expected.column_name)
  into missing_column
  from unnest(array[
    'base_wage_amount_uzs', 'bonus_amount_uzs',
    'traffic_allowance_amount_uzs', 'travel_allowance_amount_uzs',
    'social_amount_uzs', 'amount_uzs'
  ]) expected(column_name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'roadops'
      and c.table_name = 'monthly_completion_act_cost_lines'
      and c.column_name = expected.column_name
  );
  if missing_column is not null then
    raise exception 'Frozen labor/social cost components missing: %', missing_column;
  end if;

  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'roadops' and c.table_name = 'monthly_completion_acts'
      and c.column_name = 'social_amount_uzs'
  ) or not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'roadops' and c.table_name = 'monthly_completion_act_items'
      and c.column_name = 'social_amount_uzs'
  ) then
    raise exception 'Act and item social contribution totals must be separate';
  end if;
end
$test$;

do $test$
declare
  overlap_constraints integer;
begin
  select count(*) into overlap_constraints
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'roadops' and t.relname = 'cost_rate_versions'
    and c.contype = 'x';
  if overlap_constraints <> 3 then
    raise exception 'Labor/material/equipment approved rate periods need three exclusion constraints';
  end if;
  if not exists (
    select 1 from pg_indexes i
    where i.schemaname = 'roadops'
      and i.indexname = 'monthly_work_time_norms_one_approved_idx'
      and i.indexdef ilike '%where (status = ''approved''%'
  ) then
    raise exception 'Monthly work-time norm lacks one-approved-version invariant';
  end if;
end
$test$;

do $test$
declare
  missing_unique text;
begin
  select string_agg(expected.index_name, ', ' order by expected.index_name)
  into missing_unique
  from unnest(array[
    'time_entries_daily_aggregate_uk',
    'monthly_act_cost_lines_time_source_uk',
    'monthly_act_cost_lines_material_source_uk',
    'monthly_act_cost_lines_equipment_source_uk'
  ]) expected(index_name)
  where not exists (
    select 1 from pg_indexes i
    where i.schemaname = 'roadops' and i.indexname = expected.index_name
      and i.indexdef ilike 'create unique index%'
  );
  if missing_unique is not null then
    raise exception 'Actual cost source can be counted twice; missing unique indexes: %', missing_unique;
  end if;
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'roadops' and t.relname = 'monthly_completion_act_items'
      and c.contype = 'u' and pg_get_constraintdef(c.oid) = 'UNIQUE (work_order_id)'
  ) then
    raise exception 'A work order can be included in more than one monthly act';
  end if;
end
$test$;

do $test$
declare
  signature text;
  definition text;
  function_name text;
begin
  foreach signature in array array[
    'roadops.approve_cost_rate_version(uuid)',
    'roadops.approve_monthly_work_time_norm(uuid)',
    'roadops.approve_work_order_material_usage(uuid)',
    'roadops.approve_equipment_usage_entry(uuid)',
    'roadops.sync_plan_item_execution_status(uuid,text)',
    'roadops.finalize_material_reservation_for_usage(uuid)',
    'roadops.finalize_equipment_reservation_for_usage(uuid)',
    'roadops.reschedule_work_order(uuid,date)',
    'roadops.approve_time_entry(uuid)',
    'roadops.verify_work_order_completion(uuid)',
    'roadops.refresh_monthly_completion_act_totals(uuid)',
    'roadops.submit_monthly_completion_act(uuid)',
    'roadops.approve_monthly_completion_act(uuid)'
  ] loop
    if to_regprocedure(signature) is null then
      raise exception 'Guarded monthly costing workflow missing: %', signature;
    end if;
    function_name := split_part(split_part(signature, '.', 2), '(', 1);
    if not has_function_privilege('roadops_api', signature, 'EXECUTE')
       or exists (
         select 1 from information_schema.routine_privileges rp
         where rp.routine_schema = 'roadops' and rp.routine_name = function_name
           and rp.grantee = 'PUBLIC' and rp.privilege_type = 'EXECUTE'
       ) then
      raise exception 'Unsafe workflow function privilege: %', signature;
    end if;
  end loop;

  select pg_get_functiondef('roadops.approve_monthly_completion_act(uuid)'::regprocedure)
  into definition;
  if definition not like '%actor_id = act_row.created_by%'
     or definition not like '%actor_id = act_row.submitted_by%'
     or definition not like '%monthly_completion_act_snapshot_hash%'
     or definition not like '%costs.approve%'
     or position('Earlier monthly acts must be approved before this month can be approved' in definition) = 0
     or position('already frozen later month' in definition) = 0
     or position('pg_advisory_xact_lock' in definition) = 0 then
    raise exception 'Monthly act approval is not independent and snapshot-guarded';
  end if;

  select pg_get_functiondef('roadops.verify_work_order_completion(uuid)'::regprocedure)
  into definition;
  if definition not like '%execution.verify%'
     or definition not like '%actor_id = order_row.issued_by%'
     or definition not like '%actor_id = completion_row.recorded_by%' then
    raise exception 'Work completion verification is not independently authorized';
  end if;
  if position('completed_quantity > plan_row.work_quantity' in definition) = 0
     or position('Every active material reservation must be recorded exactly once' in definition) = 0
     or position('Every active equipment reservation must be recorded exactly once' in definition) = 0
     or position('Every actual labor and resource usage must be independently approved before verification' in definition) = 0
     or position('resolved_by_verified_work' in definition) = 0
     or position('{manualInput,sourceDefectId}' in definition) = 0 then
    raise exception 'Work verification does not enforce complete resources, planned quantity, and defect resolution';
  end if;

  select pg_get_functiondef('roadops.approve_time_entry(uuid)'::regprocedure)
  into definition;
  if definition not like '%execution.verify%'
     or definition not like '%actor_id = entry_row.recorded_by%' then
    raise exception 'Labor time approval is not independently authorized';
  end if;

  select pg_get_functiondef('roadops.submit_monthly_completion_act(uuid)'::regprocedure)
  into definition;
  if definition not like '%te.approved_at is null%'
     or definition not like '%u.status <> ''approved''%'
     or definition not like '%snapshot_hash%'
     or definition not like '%refresh_monthly_completion_act_totals%'
     or definition not like '%social_amount_uzs%'
     or position('Earlier monthly acts must be approved before this month can be submitted' in definition) = 0
     or position('cannot be backfilled after a later snapshot was frozen' in definition) = 0
     or position('pg_advisory_xact_lock' in definition) = 0 then
    raise exception 'Monthly act submission can omit unapproved sources or social cost';
  end if;

  select pg_get_functiondef('roadops.validate_equipment_usage_entry()'::regprocedure)
  into definition;
  if definition not like '%tg_op = ''UPDATE''%'
     or definition not like '%reservation_row.status = ''returned''%'
     or definition not like '%old.equipment_reservation_id = new.equipment_reservation_id%'
     or definition not like '%new.actual_machine_minutes > floor(%' then
    raise exception 'Returned equipment reservation cannot be safely approved or machine time is uncapped';
  end if;

  select pg_get_functiondef('roadops.validate_work_order_material_usage()'::regprocedure)
  into definition;
  if definition not like '%new.quantity > reservation_row.quantity%'
     or definition like '%reservation_row.quantity is distinct from new.quantity%' then
    raise exception 'Actual material usage must be positive, partial-capable and capped by its one-shot reservation';
  end if;

  select pg_get_functiondef('roadops.reschedule_work_order(uuid,date)'::regprocedure)
  into definition;
  if definition not like '%execution.manage%'
     or definition not like '%order_row.started_at is not null%'
     or definition not like '%update roadops.work_assignments%'
     or definition not like '%update roadops.safety_staff_assignments%'
     or definition not like '%update roadops.equipment_reservations%'
     or definition not like '%update roadops.safety_resource_reservations%'
     or definition not like '%WORK_RESCHEDULED%' then
    raise exception 'Work-order reschedule is not an atomic guarded whole-resource shift';
  end if;
end
$test$;

do $test$
begin
  if has_column_privilege('roadops_api', 'roadops.cost_rate_versions', 'status', 'UPDATE')
     or has_column_privilege('roadops_api', 'roadops.monthly_work_time_norms', 'status', 'UPDATE')
     or has_column_privilege('roadops_api', 'roadops.monthly_completion_acts', 'status', 'UPDATE')
     or has_column_privilege('roadops_api', 'roadops.work_order_material_usages', 'status', 'UPDATE')
     or has_column_privilege('roadops_api', 'roadops.equipment_usage_entries', 'status', 'UPDATE') then
    raise exception 'API can bypass guarded approval by directly updating a status column';
  end if;
  if not has_column_privilege(
    'roadops_api', 'roadops.cost_rate_versions', 'rate_amount_uzs', 'UPDATE'
  ) then
    raise exception 'API cannot correct a draft cost rate';
  end if;
end
$test$;

do $test$
declare
  currency_check text;
begin
  select string_agg(t.relname, ', ' order by t.relname)
  into currency_check
  from pg_class t
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'roadops'
    and t.relname = any (array[
      'cost_rate_versions', 'monthly_completion_acts',
      'monthly_completion_act_cost_lines'
    ])
    and not exists (
      select 1 from pg_constraint c
      where c.conrelid = t.oid and c.contype = 'c'
        and pg_get_constraintdef(c.oid) like '%currency = ''UZS''%'
    );
  if currency_check is not null then
    raise exception 'Non-UZS currency is possible in: %', currency_check;
  end if;
end
$test$;

rollback;
