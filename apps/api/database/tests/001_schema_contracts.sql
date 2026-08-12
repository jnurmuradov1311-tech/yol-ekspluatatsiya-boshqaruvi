-- Run after all production migrations. Fails fast on schema/security contract drift.
begin;

do $test$
declare
  missing_rls text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
  into missing_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'roadops' and c.relkind in ('r', 'p')
    and (not c.relrowsecurity or not c.relforcerowsecurity);
  if missing_rls is not null then
    raise exception 'Tables missing ENABLE/FORCE RLS: %', missing_rls;
  end if;
end
$test$;

do $test$
declare
  exposed text;
begin
  select string_agg(distinct grantee || ':' || table_name || ':' || privilege_type, ', ')
  into exposed
  from information_schema.role_table_grants
  where table_schema = 'roadops'
    and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role');
  if exposed is not null then
    raise exception 'RoadOps objects exposed to Data API/public roles: %', exposed;
  end if;
end
$test$;

do $test$
declare
  forbidden_columns text;
begin
  select string_agg(table_name || '.' || column_name, ', ' order by table_name, column_name)
  into forbidden_columns
  from information_schema.columns
  where table_schema = 'roadops'
    and (
      column_name in (
        'priority', 'priority_score', 'condition_index', 'condition_score',
        'pavement_index', 'confidence', 'confidence_score', 'score_0_100'
      )
      or column_name ~ '(^|_)condition_(index|score)($|_)'
    );
  if forbidden_columns is not null then
    raise exception 'Forbidden business scoring columns found: %', forbidden_columns;
  end if;
end
$test$;

do $test$
declare
  pricing_columns text;
begin
  select string_agg(table_name || '.' || column_name, ', ' order by table_name, column_name)
  into pricing_columns
  from information_schema.columns
  where table_schema = 'roadops' and table_name like 'iqn_%'
    and column_name ~ '(price|cost|currency|monetary|total_sum|unit_rate)';
  if pricing_columns is not null then
    raise exception 'IQN pricing columns are forbidden in RoadOps: %', pricing_columns;
  end if;
end
$test$;

do $test$
declare
  writable_master text;
begin
  select string_agg(table_name || ':' || privilege_type, ', ' order by table_name, privilege_type)
  into writable_master
  from information_schema.role_table_grants
  where table_schema = 'roadops' and grantee = 'roadops_api'
    and table_name = any (array[
      'road_divisions','road_division_versions','road_division_profile_versions',
      'road_division_assignments',
      'roads','road_versions','road_elements','road_element_versions','workers',
      'worker_versions','worker_division_assignments',
      'worker_qualification_versions','worker_availability'
    ])
    and privilege_type <> 'SELECT';
  if writable_master is not null then
    raise exception 'Externally synced master data is writable by API: %', writable_master;
  end if;
end
$test$;

do $test$
declare
  invalid_unique text;
begin
  select string_agg(c.conname, ', ')
  into invalid_unique
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'roadops' and t.relname = 'iqn_work_items'
    and c.contype in ('u', 'p')
    and pg_get_constraintdef(c.oid) ~ '(raw_code|normalized_code)';
  if invalid_unique is not null then
    raise exception 'IQN source codes must remain non-unique: %', invalid_unique;
  end if;
end
$test$;

do $test$
begin
  if to_regprocedure('roadops.authenticate_session(text)') is null
     or to_regprocedure('roadops.match_roadvision_candidate(uuid,uuid,uuid,uuid,numrange)') is null
     or to_regprocedure('roadops.verify_roadvision_candidate(uuid,text,numeric,text,text)') is null
     or to_regprocedure('roadops.review_inspection_observation(uuid,text,text)') is null
     or to_regprocedure('roadops.rebuild_plan_blockers(uuid)') is null
     or to_regprocedure('roadops.approve_planning_run(uuid)') is null
     or to_regprocedure('roadops.publish_planning_run(uuid)') is null then
    raise exception 'A required guarded workflow function is missing';
  end if;
end
$test$;

do $test$
begin
  if to_regprocedure('roadops.division_for_road_zone(uuid,numrange,timestamp with time zone)') is null
     or to_regprocedure('roadops.division_for_worker_assignment(uuid,date)') is null then
    raise exception 'Source assignment ownership functions are missing';
  end if;
end
$test$;

insert into roadops.idempotency_keys (
  id, scope, idempotency_key, request_hash, created_at, expires_at
) values
  (
    '96000000-0000-0000-0000-000000000001', 'cleanup.contract',
    'expired-old-contract-key', decode(repeat('a1', 32), 'hex'),
    clock_timestamp() - interval '3 hours', clock_timestamp() - interval '2 hours'
  ),
  (
    '96000000-0000-0000-0000-000000000002', 'cleanup.contract',
    'expired-new-contract-key', decode(repeat('a2', 32), 'hex'),
    clock_timestamp() - interval '2 hours', clock_timestamp() - interval '1 hour'
  ),
  (
    '96000000-0000-0000-0000-000000000003', 'cleanup.contract',
    'unexpired-contract-key', decode(repeat('a3', 32), 'hex'),
    clock_timestamp(), clock_timestamp() + interval '1 hour'
  );

set local role roadops_sync;
do $test$
declare
  deleted_count integer;
begin
  select roadops.cleanup_expired_idempotency_keys(1) into deleted_count;
  if deleted_count <> 1 then
    raise exception 'Idempotency cleanup did not honor its batch limit';
  end if;
end
$test$;
reset role;

do $test$
begin
  if exists (
    select 1 from roadops.idempotency_keys
    where id = '96000000-0000-0000-0000-000000000001'
  ) or not exists (
    select 1 from roadops.idempotency_keys
    where id = '96000000-0000-0000-0000-000000000002'
  ) or not exists (
    select 1 from roadops.idempotency_keys
    where id = '96000000-0000-0000-0000-000000000003'
  ) then
    raise exception 'Idempotency cleanup was not oldest-first, expired-only, and bounded';
  end if;
end
$test$;

do $test$
declare
  function_body text;
begin
  select pg_get_functiondef('roadops.rebuild_plan_assignment_blockers(uuid)'::regprocedure)
    into function_body;
  if function_body not like '%ROAD_ASSIGNMENT_MISSING%'
     or function_body not like '%ROAD_ASSIGNMENT_AMBIGUOUS%'
     or function_body not like '%ROAD_ASSIGNMENT_DIVISION_MISMATCH%'
     or function_body not like '%road_division_assignments%' then
    raise exception 'Authoritative road-assignment planning blockers are incomplete';
  end if;

  select pg_get_functiondef('roadops.rebuild_plan_blockers(uuid)'::regprocedure)
    into function_body;
  if function_body not like '%rebuild_plan_core_blockers%'
     or function_body not like '%rebuild_plan_assignment_blockers%' then
    raise exception 'Public blocker rebuild can bypass authoritative road assignments';
  end if;

  select pg_get_functiondef(
    'roadops.match_roadvision_candidate(uuid,uuid,uuid,uuid,numrange)'::regprocedure
  ) into function_body;
  if function_body not like '%division_for_road_zone%' then
    raise exception 'RoadVision match workflow does not use exact YTP zone ownership';
  end if;

  select pg_get_functiondef(
    'roadops.verify_roadvision_candidate(uuid,text,numeric,text,text)'::regprocedure
  ) into function_body;
  if function_body not like '%division_for_road_zone%' then
    raise exception 'RoadVision verify workflow does not use exact YTP zone ownership';
  end if;
end
$test$;

do $test$
declare
  function_body text;
begin
  if to_regprocedure('roadops.cleanup_expired_idempotency_keys(integer)') is null then
    raise exception 'Bounded idempotency cleanup workflow is missing';
  end if;
  select pg_get_functiondef(
    'roadops.cleanup_expired_idempotency_keys(integer)'::regprocedure
  ) into function_body;
  if lower(function_body) not like '%expires_at <= clock_timestamp()%'
     or lower(function_body) not like '%for update skip locked%'
     or lower(function_body) not like '%limit p_limit%' then
    raise exception 'Idempotency cleanup workflow is not expired-only and bounded';
  end if;
  if has_function_privilege(
    'roadops_api', 'roadops.cleanup_expired_idempotency_keys(integer)', 'EXECUTE'
  ) or not has_function_privilege(
    'roadops_sync', 'roadops.cleanup_expired_idempotency_keys(integer)', 'EXECUTE'
  ) then
    raise exception 'Idempotency cleanup workflow grants are unsafe';
  end if;
end
$test$;

do $test$
declare
  function_body text;
begin
  select pg_get_functiondef(p.oid) into function_body
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'roadops' and p.proname = 'check_worker_day_capacity';
  if function_body is null or function_body not like '%least(420,%' then
    raise exception 'Worker 420-minute daily cap is missing';
  end if;
end
$test$;

do $test$
begin
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'roadops' and c.relname = 'audit_events'
      and t.tgname = 'audit_events_append_only' and not t.tgisinternal
  ) or not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'roadops' and c.relname = 'inventory_transactions'
      and t.tgname = 'inventory_transactions_append_only' and not t.tgisinternal
  ) then
    raise exception 'Append-only protection trigger is missing';
  end if;
end
$test$;

rollback;
