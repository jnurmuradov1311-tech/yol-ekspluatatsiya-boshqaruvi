-- Run after migrations and fixtures/test.sql. The transaction is rolled back.
begin;

do $test$
begin
  if not has_function_privilege(
    'roadops_api', 'roadops.admin_network_summary()', 'EXECUTE'
  ) then
    raise exception 'API role cannot execute the guarded admin network aggregate';
  end if;
  if has_function_privilege(
    'roadops_sync', 'roadops.admin_network_summary()', 'EXECUTE'
  ) then
    raise exception 'Sync role unexpectedly received the admin network aggregate';
  end if;
end
$test$;

set local role roadops_api;
select set_config(
  'roadops.actor_id', '94000000-0000-0000-0000-000000000001', true
);

do $test$
declare
  summary record;
begin
  select * into summary from roadops.admin_network_summary();
  if summary.official_network_length_km <> 42371 then
    raise exception 'Official national road-network baseline is not 42,371 km';
  end if;
  if summary.synchronized_road_length_km <> 1::numeric
     or summary.synchronized_road_count <> 1
     or summary.synchronized_division_count <> 1 then
    raise exception 'Admin network summary did not aggregate live synchronized masters';
  end if;
end
$test$;

reset role;

insert into roadops.app_users (
  id, email, password_hash, full_name, status, mfa_required, email_verified_at
) values (
  '94000000-0000-0000-0000-000000000020', 'division-network-test@test.invalid',
  extensions.crypt('test-only-password', extensions.gen_salt('bf', 4)),
  'Division Network Test User', 'active', false, clock_timestamp()
);
insert into roadops.user_role_memberships (
  id, user_id, role_id, division_id, valid_from
)
select '94000000-0000-0000-0000-000000000021',
       '94000000-0000-0000-0000-000000000020', role.id,
       '91000000-0000-0000-0000-000000000001',
       '2026-01-01 00:00:00+05'
from roadops.roles role
where role.code = 'division_manager';

set local role roadops_api;
select set_config(
  'roadops.actor_id', '94000000-0000-0000-0000-000000000020', true
);

do $test$
declare
  visible_count integer;
begin
  select count(*) into visible_count
  from roadops.system_settings
  where setting_key = 'national_road_network_length_km';
  if visible_count <> 0 then
    raise exception 'National road-network baseline leaked through settings RLS';
  end if;

  if not exists (
    select 1 from roadops.system_settings where setting_key = 'timezone'
  ) then
    raise exception 'Ordinary operational settings became hidden from division actors';
  end if;

  begin
    perform * from roadops.admin_network_summary();
    raise exception 'Division actor unexpectedly executed the national aggregate';
  exception when insufficient_privilege then
    null;
  end;
end
$test$;

rollback;
