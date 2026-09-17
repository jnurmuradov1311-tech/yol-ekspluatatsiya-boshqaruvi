begin;
do $test$
declare definition text;
begin
  if to_regprocedure('roadops.prepare_monthly_act_payroll_allocation()') is null
     or to_regprocedure('roadops.validate_payroll_source_allocations()') is null then
    raise exception 'Payroll source allocation validation is missing';
  end if;
  select pg_get_functiondef('roadops.monthly_completion_act_snapshot_hash(uuid)'::regprocedure) into definition;
  if position('monthly_completion_act_snapshot_hash_before_payroll' in definition) = 0
     or position('payrollAllocations' in definition) = 0
     or position('payroll_source_allocation' in definition) = 0 then
    raise exception 'New hash must preserve historical basis and bind immutable payroll allocations';
  end if;
  select pg_get_functiondef('roadops.guard_monthly_act_child_mutation()'::regprocedure) into definition;
  if position('for update' in lower(definition)) = 0 then
    raise exception 'Cost children must serialize with parent submission';
  end if;
  select pg_get_functiondef('roadops.guard_payroll_posted_allocations()'::regprocedure) into definition;
  if position('PAYROLL_POSTED_ALLOCATION_CHANGED' in definition) = 0
     or position('pg_advisory_xact_lock' in definition) = 0 then
    raise exception 'Posted sources must remain stable during supplemental payroll';
  end if;
  select pg_get_constraintdef(oid) into definition from pg_constraint
    where conrelid = 'roadops.monthly_completion_act_cost_lines'::regclass
      and conname = 'monthly_completion_act_cost_lines_labor_components_ck';
  if position('payroll_extra_amount_uzs' in definition) = 0 then
    raise exception 'Act totals omit extra payroll components';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'roadops'
    and indexname = 'monthly_act_cost_lines_time_source_uk' and indexdef like '%UNIQUE%') then
    raise exception 'An attendance source could be paid into two acts';
  end if;
  if has_function_privilege('public', 'roadops.monthly_completion_act_snapshot_hash_before_payroll(uuid)', 'EXECUTE')
    or has_function_privilege('public', 'roadops.monthly_completion_act_snapshot_hash(uuid)', 'EXECUTE') then
    raise exception 'Private financial snapshot functions are public';
  end if;
end
$test$;
rollback;
