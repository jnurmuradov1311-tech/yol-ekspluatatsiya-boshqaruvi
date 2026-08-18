-- Run after all production migrations. No fixture mutation is required.
begin;

do $test$
declare
  validator_definition text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'roadops' and table_name = 'inspection_observations'
      and column_name = 'iqn_topic_work_item_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'roadops' and table_name = 'defect_cases'
      and column_name = 'iqn_topic_work_item_id'
  ) then
    raise exception 'Manual inspection IQN topic provenance columns are missing';
  end if;

  if to_regprocedure('roadops.validate_manual_inspection_iqn_topic()') is null
     or to_regprocedure('roadops.copy_manual_inspection_iqn_topic()') is null then
    raise exception 'Manual inspection IQN topic guard functions are missing';
  end if;

  select pg_get_functiondef('roadops.validate_manual_inspection_iqn_topic()'::regprocedure)
  into validator_definition;
  if position('document.effective_from' in validator_definition) = 0
     or position('document.effective_until' in validator_definition) = 0
     or position('new.observed_at' in validator_definition) = 0 then
    raise exception 'Manual inspection topic guard does not enforce the IQN effective period at observation time';
  end if;

  if exists (
    select 1 from information_schema.routine_privileges privilege
    where privilege.routine_schema = 'roadops'
      and privilege.routine_name in (
        'validate_manual_inspection_iqn_topic',
        'copy_manual_inspection_iqn_topic'
      )
      and privilege.grantee = 'PUBLIC'
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Internal IQN topic trigger functions are executable by PUBLIC';
  end if;

  if not exists (
    select 1 from pg_trigger trigger
    join pg_class relation on relation.oid = trigger.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'roadops'
      and relation.relname = 'inspection_observations'
      and trigger.tgname = 'inspection_observations_validate_iqn_topic'
      and not trigger.tgisinternal
  ) or not exists (
    select 1 from pg_trigger trigger
    join pg_class relation on relation.oid = trigger.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'roadops'
      and relation.relname = 'defect_cases'
      and trigger.tgname = 'defect_cases_copy_iqn_topic'
      and not trigger.tgisinternal
  ) then
    raise exception 'Manual inspection IQN topic provenance triggers are missing';
  end if;
end
$test$;

rollback;
