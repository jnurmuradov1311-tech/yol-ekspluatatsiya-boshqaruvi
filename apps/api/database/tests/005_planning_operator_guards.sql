-- Run after migrations and test fixtures. Metadata-only; transaction rolls back.
begin;

do $test$
declare
  constraint_definition text;
  policy_command text;
  policy_using text;
  policy_check text;
begin
  if not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'roadops'
      and c.table_name = 'work_variant_skill_requirements'
      and c.column_name = 'requirement_kind'
      and c.is_nullable = 'NO'
      and c.column_default = '''worker''::text'
  ) then
    raise exception 'Equipment operator requirement kind is not fail-closed and non-null';
  end if;

  select pg_get_constraintdef(c.oid) into constraint_definition
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'roadops' and t.relname = 'planning_blockers'
    and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%allocator%';
  if constraint_definition is null then
    raise exception 'Allocator blocker provenance is not constrained';
  end if;

  if to_regprocedure('roadops.add_equipment_operator_blockers(uuid)') is null
     or to_regprocedure('roadops.put_allocator_blocker(uuid,uuid,text,text,uuid,jsonb)') is null
     or to_regprocedure('roadops.resolve_allocator_blocker(uuid,uuid,text,uuid)') is null then
    raise exception 'Planning equipment guard functions are missing';
  end if;

  select p.cmd, p.qual, p.with_check
    into policy_command, policy_using, policy_check
  from pg_policies p
  where p.schemaname = 'roadops' and p.tablename = 'safety_resource_inventory'
    and p.policyname = 'safety_resource_inventory_api_manage';
  if policy_command is distinct from 'ALL'
     or position('resources.manage' in coalesce(policy_using, '')) = 0
     or position('resources.manage' in coalesce(policy_check, '')) = 0
     or position('system.all' in coalesce(policy_check, '')) > 0 then
    raise exception 'Safety inventory write policy is not restricted to resources.manage';
  end if;

  select p.with_check into policy_check
  from pg_policies p
  where p.schemaname = 'roadops' and p.tablename = 'safety_resource_reservations'
    and p.policyname = 'safety_resource_reservations_api';
  if position('planning.write' in coalesce(policy_check, '')) = 0
     or position('resources.manage' in coalesce(policy_check, '')) = 0 then
    raise exception 'Safety reservation writes do not require planning.write or resources.manage';
  end if;

  select p.with_check into policy_check
  from pg_policies p
  where p.schemaname = 'roadops' and p.tablename = 'safety_staff_assignments'
    and p.policyname = 'safety_staff_assignments_api';
  if position('planning.write' in coalesce(policy_check, '')) = 0
     or position('execution.manage' in coalesce(policy_check, '')) = 0 then
    raise exception 'Safety staff writes do not require planning.write or execution.manage';
  end if;

  select p.qual into policy_using
  from pg_policies p
  where p.schemaname = 'roadops' and p.tablename = 'manual_work_requests'
    and p.policyname = 'manual_work_requests_api';
  if position('planning.read' in coalesce(policy_using, '')) = 0
     or position('planning.write' in coalesce(policy_using, '')) = 0 then
    raise exception 'Manual planning requests are readable without a planning permission';
  end if;
end
$test$;

rollback;
