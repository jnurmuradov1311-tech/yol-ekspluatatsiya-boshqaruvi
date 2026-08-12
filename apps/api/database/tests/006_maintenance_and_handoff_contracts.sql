-- Run after migrations and test fixtures. The transaction is rolled back.
begin;

do $test$
declare
  definition text;
begin
  if has_function_privilege('roadops_api', 'roadops.cleanup_expired_idempotency_keys(integer)', 'EXECUTE')
     or not has_function_privilege('roadops_sync', 'roadops.cleanup_expired_idempotency_keys(integer)', 'EXECUTE') then
    raise exception 'Idempotency cleanup authority is not restricted to roadops_sync';
  end if;

  select pg_get_functiondef('roadops.cleanup_expired_idempotency_keys(integer)'::regprocedure)
    into definition;
  if position('for update skip locked' in lower(definition)) = 0
     or position('p_limit > 10000' in definition) = 0
     or position('expires_at <= clock_timestamp()' in definition) = 0 then
    raise exception 'Idempotency cleanup is not bounded, expired-only and concurrency-safe';
  end if;

  select pg_get_functiondef('roadops.rebuild_plan_core_blockers(uuid)'::regprocedure)
    into definition;
  if position($needle$lower(item.scheduled_window) at time zone 'Asia/Tashkent'$needle$ in definition) = 0
     or position($needle$has_permission('planning.approve', run_row.division_id)$needle$ in definition) = 0 then
    raise exception 'Planning blocker rebuild does not use work date or independent approver authority';
  end if;
end
$test$;

insert into roadops.idempotency_keys (
  id, scope, idempotency_key, actor_user_id, request_hash,
  created_at, locked_at, expires_at
) values
  (
    '96000000-0000-0000-0000-000000000001', 'test.cleanup', 'expired-key-0001',
    '94000000-0000-0000-0000-000000000001', decode(repeat('a1', 32), 'hex'),
    clock_timestamp() - interval '3 days', clock_timestamp() - interval '3 days',
    clock_timestamp() - interval '2 days'
  ),
  (
    '96000000-0000-0000-0000-000000000002', 'test.cleanup', 'expired-key-0002',
    '94000000-0000-0000-0000-000000000001', decode(repeat('a2', 32), 'hex'),
    clock_timestamp() - interval '2 days', clock_timestamp() - interval '2 days',
    clock_timestamp() - interval '1 day'
  ),
  (
    '96000000-0000-0000-0000-000000000003', 'test.cleanup', 'live-key-00000001',
    '94000000-0000-0000-0000-000000000001', decode(repeat('a3', 32), 'hex'),
    clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '1 day'
  );

set local role roadops_sync;

do $test$
declare
  deleted_count integer;
begin
  select roadops.cleanup_expired_idempotency_keys(1) into deleted_count;
  if deleted_count <> 1 then
    raise exception 'Bounded cleanup did not delete exactly one row';
  end if;
end
$test$;

reset role;

do $test$
declare
  surviving_count integer;
begin
  if exists (
    select 1 from roadops.idempotency_keys
    where id = '96000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'Cleanup did not delete the oldest expired row';
  end if;
  select count(*) into surviving_count
  from roadops.idempotency_keys
  where id in (
    '96000000-0000-0000-0000-000000000002',
    '96000000-0000-0000-0000-000000000003'
  );
  if surviving_count <> 2 then
    raise exception 'Cleanup deleted beyond its limit or removed a live row';
  end if;
end
$test$;

rollback;
