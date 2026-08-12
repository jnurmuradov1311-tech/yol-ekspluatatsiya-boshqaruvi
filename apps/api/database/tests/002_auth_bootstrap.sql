-- Requires fixtures/test.sql. Verifies the inherited API role can bootstrap auth
-- only through guarded SECURITY DEFINER workflows before actor context exists.
begin;
set local role roadops_api;

do $test$
declare
  found_user uuid;
  session_count integer;
  inserted_run_id uuid;
begin
  select li.user_id into found_user
  from roadops.lookup_login_identity('admin@test.invalid') li;
  if found_user <> '94000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'Pre-auth app user lookup is blocked or returned wrong user';
  end if;

  perform * from roadops.record_login_failure(
    'admin@test.invalid', 'invalid_password', '127.0.0.1', 'sql-contract-test', gen_random_uuid()
  );
  perform roadops.complete_login(
    found_user, repeat('11', 32), repeat('22', 32),
    clock_timestamp() + interval '1 hour', clock_timestamp() + interval '1 day',
    null, null, '127.0.0.1', 'sql-contract-test', gen_random_uuid()
  );
  select count(*) into session_count
  from roadops.authenticate_session(repeat('11', 32));
  if session_count <> 1 then
    raise exception 'Completed session did not authenticate';
  end if;

  perform set_config('roadops.actor_id', found_user::text, true);
  update roadops.system_settings
  set setting_value = to_jsonb(21), updated_by = found_user,
      updated_at = clock_timestamp()
  where setting_key = 'planning_horizon_days';
  if (select setting_value #>> '{}' from roadops.system_settings
      where setting_key = 'planning_horizon_days') <> '21' then
    raise exception 'Audited system setting did not persist through API RLS';
  end if;

  insert into roadops.planning_runs (
    division_id, planning_window, as_of, algorithm_version,
    input_snapshot_hash, created_by
  ) values (
    '91000000-0000-0000-0000-000000000001',
    daterange(current_date, current_date + 1, '[)'), clock_timestamp(),
    'sql-trigger-contract', decode(repeat('ab', 32), 'hex'), found_user
  ) returning id into inserted_run_id;
  if inserted_run_id is null then
    raise exception 'API draft planning run insert did not pass the state guard';
  end if;
  perform * from roadops.rebuild_plan_blockers(inserted_run_id);
  if not exists (
    select 1 from roadops.planning_blockers b
    where b.planning_run_id = inserted_run_id
      and b.blocker_code = 'PLAN_EMPTY' and b.resolved_at is null
  ) then
    raise exception 'Public blocker rebuild did not execute the guarded core workflow';
  end if;
end
$test$;

rollback;
