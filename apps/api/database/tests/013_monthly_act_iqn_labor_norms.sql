-- Run after all production migrations. No fixture data is required.
begin;

do $test$
declare
  missing_column text;
  check_definition text;
begin
  select string_agg(expected.column_name, ', ' order by expected.column_name)
  into missing_column
  from unnest(array[
    'iqn_norm_set_id_snapshot', 'iqn_labor_norm_line_ids_snapshot',
    'iqn_basis_quantity_snapshot', 'iqn_basis_unit_snapshot',
    'iqn_labor_minutes_per_basis_snapshot',
    'iqn_labor_minutes_per_unit_snapshot', 'iqn_total_labor_minutes_snapshot'
  ]) expected(column_name)
  where not exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'roadops'
      and column_info.table_name = 'monthly_completion_act_items'
      and column_info.column_name = expected.column_name
  );
  if missing_column is not null then
    raise exception 'Monthly act IQN labor snapshot columns missing: %', missing_column;
  end if;

  select pg_get_constraintdef(constraint_info.oid)
  into check_definition
  from pg_constraint constraint_info
  join pg_class table_info on table_info.oid = constraint_info.conrelid
  join pg_namespace schema_info on schema_info.oid = table_info.relnamespace
  where schema_info.nspname = 'roadops'
    and table_info.relname = 'monthly_completion_act_items'
    and constraint_info.conname = 'monthly_act_item_iqn_labor_snapshot_ck';
  if check_definition is null
     or position('iqn_labor_norm_line_ids_snapshot IS NOT NULL' in check_definition) = 0
     or position('cardinality(iqn_labor_norm_line_ids_snapshot) > 0' in check_definition) = 0
     or position('iqn_total_labor_minutes_snapshot IS NOT NULL' in check_definition) = 0 then
    raise exception 'IQN labor snapshot all-or-none CHECK does not reject NULL components';
  end if;

  if not exists (
    select 1
    from pg_indexes index_info
    where index_info.schemaname = 'roadops'
      and index_info.indexname = 'monthly_act_items_iqn_norm_set_snapshot_idx'
      and index_info.indexdef like '%(iqn_norm_set_id_snapshot)%'
      and index_info.indexdef like '%WHERE%iqn_norm_set_id_snapshot IS NOT NULL%'
  ) then
    raise exception 'IQN norm-set snapshot foreign key lacks its referencing-side index';
  end if;
end
$test$;

do $test$
declare
  definition text;
begin
  if to_regprocedure('roadops.guard_monthly_act_iqn_labor_snapshot()') is null
     or to_regprocedure('roadops.validate_monthly_act_iqn_labor_snapshot()') is null
     or to_regprocedure('roadops.guard_monthly_act_verified_work_completeness()') is null
     or to_regprocedure('roadops.reject_late_verification_for_closed_act_month()') is null then
    raise exception 'Monthly act IQN/completeness guard function missing';
  end if;

  select pg_get_functiondef(
    'roadops.validate_monthly_act_iqn_labor_snapshot()'::regprocedure
  ) into definition;
  if position('norm_set.status = ''approved''' in definition) = 0
     or position('norm_set.work_variant_id = new.work_variant_id_snapshot' in definition) = 0
     or position('btrim(variant.basis_unit) = btrim(new.work_unit)' in definition) = 0
     or position('variant.formula_type = ''linear''' in definition) = 0
     or position('array_agg(norm_line.id order by norm_line.source_line_number' in definition) = 0
     or position('new.completed_quantity / variant.basis_quantity' in definition) = 0
     or position('MONTHLY_ACT_IQN_LABOR_NORM_INVALID' in definition) = 0 then
    raise exception 'Database does not recompute and validate the IQN labor snapshot';
  end if;

  select pg_get_functiondef(
    'roadops.monthly_completion_act_snapshot_hash(uuid)'::regprocedure
  ) into definition;
  if position('iqn_norm_set_id' in definition) = 0
     or position('iqn_labor_norm_line_ids' in definition) = 0
     or position('iqn_basis_quantity' in definition) = 0
     or position('iqn_basis_unit' in definition) = 0
     or position('iqn_labor_minutes_per_basis' in definition) = 0
     or position('iqn_labor_minutes_per_unit' in definition) = 0
     or position('iqn_total_labor_minutes' in definition) = 0
     or position('when i.iqn_norm_set_id_snapshot is null' in definition) = 0 then
    raise exception 'Monthly act hash does not bind every IQN labor snapshot field';
  end if;

  select pg_get_functiondef(
    'roadops.guard_monthly_act_verified_work_completeness()'::regprocedure
  ) into definition;
  if position('MONTHLY_ACT_IQN_LABOR_NORM_SNAPSHOT_MISSING' in definition) = 0
     or position('MONTHLY_ACT_VERIFIED_WORK_MISSING' in definition) = 0
     or position('planning_run.division_id = new.division_id' in definition) = 0
     or position('wo.status = ''verified''' in definition) = 0 then
    raise exception 'Submission guard can omit current verified work or IQN snapshots';
  end if;

  select pg_get_functiondef(
    'roadops.reject_late_verification_for_closed_act_month()'::regprocedure
  ) into definition;
  if position('MONTHLY_ACT_MONTH_CLOSED_FOR_LATE_VERIFICATION' in definition) = 0
     or position('submitted' in definition) = 0
     or position('approved' in definition) = 0
     or position('pg_advisory_xact_lock' in definition) = 0
     or position('20260818' in definition) = 0 then
    raise exception 'Closed act month does not reject a late VERIFIED transition';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_info
    join pg_class table_info on table_info.oid = trigger_info.tgrelid
    join pg_namespace schema_info on schema_info.oid = table_info.relnamespace
    where schema_info.nspname = 'roadops' and table_info.relname = 'work_orders'
      and trigger_info.tgname = 'work_orders_closed_month_verification_guard'
      and not trigger_info.tgisinternal
  ) then
    raise exception 'Late verification trigger missing from work_orders';
  end if;

  if (
    select count(*)
    from pg_trigger trigger_info
    join pg_class table_info on table_info.oid = trigger_info.tgrelid
    join pg_namespace schema_info on schema_info.oid = table_info.relnamespace
    where schema_info.nspname = 'roadops'
      and not trigger_info.tgisinternal
      and (
        table_info.relname = 'monthly_completion_act_items'
          and trigger_info.tgname in (
            'monthly_act_items_iqn_labor_snapshot_validate',
            'monthly_act_items_iqn_labor_snapshot_guard'
          )
        or table_info.relname = 'monthly_completion_acts'
          and trigger_info.tgname = 'monthly_completion_acts_verified_work_completeness_guard'
      )
  ) <> 3 then
    raise exception 'Monthly act IQN validation/immutability/completeness trigger missing';
  end if;
end
$test$;

rollback;
