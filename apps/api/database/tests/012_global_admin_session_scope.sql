-- Requires fixtures/test.sql. Proves division-scoped system.all is not exposed
-- as a global browser/API permission. The transaction is rolled back.
begin;

insert into roadops.app_users (
  id, email, password_hash, full_name, status, mfa_required, email_verified_at
) values (
  '94000000-0000-0000-0000-000000000030',
  'scoped-system-admin@test.invalid',
  extensions.crypt('test-only-password', extensions.gen_salt('bf', 4)),
  'Scoped System Administrator', 'active', false, clock_timestamp()
);

insert into roadops.user_role_memberships (
  id, user_id, role_id, division_id, valid_from
)
select
  '94000000-0000-0000-0000-000000000031',
  '94000000-0000-0000-0000-000000000030',
  role.id,
  '91000000-0000-0000-0000-000000000001',
  '2026-01-01 00:00:00+05'
from roadops.roles role
where role.code = 'system_admin';

select roadops.complete_login(
  '94000000-0000-0000-0000-000000000001',
  repeat('aa', 32), repeat('ab', 32),
  clock_timestamp() + interval '1 hour',
  clock_timestamp() + interval '1 day'
);

select roadops.complete_login(
  '94000000-0000-0000-0000-000000000030',
  repeat('ba', 32), repeat('bb', 32),
  clock_timestamp() + interval '1 hour',
  clock_timestamp() + interval '1 day'
);

set local role roadops_api;

do $test$
declare
  global_session record;
  scoped_session record;
begin
  if not has_function_privilege(
    'roadops_api', 'roadops.authenticate_session_scoped(text)', 'EXECUTE'
  ) then
    raise exception 'API role cannot execute scoped session authentication';
  end if;

  select * into global_session
  from roadops.authenticate_session_scoped(repeat('aa', 32));
  if global_session.session_id is null
     or not ('system.all' = any(global_session.global_permissions)) then
    raise exception 'Global system administrator lost its global permission';
  end if;
  if cardinality(global_session.road_unit_ids) <> 0 then
    raise exception 'Global-only administrator leaked into operational division scope';
  end if;

  select * into scoped_session
  from roadops.authenticate_session_scoped(repeat('ba', 32));
  if scoped_session.session_id is null
     or not ('system.all' = any(scoped_session.permissions)) then
    raise exception 'Division-scoped system administrator lost its local wildcard';
  end if;
  if 'system.all' = any(scoped_session.global_permissions) then
    raise exception 'Division-scoped system.all leaked into global permissions';
  end if;
  if scoped_session.road_unit_ids <> array[
    '91000000-0000-0000-0000-000000000001'::uuid
  ] then
    raise exception 'Division-scoped administrator lost its explicit operational scope';
  end if;
  if exists (
    select 1
    from pg_policies
    where schemaname = 'roadops'
      and tablename = 'system_settings'
      and policyname = 'system_settings_api_update'
      and (coalesce(qual, '') like '%has_any_permission%'
        or coalesce(with_check, '') like '%has_any_permission%')
  ) then
    raise exception 'Global settings policy still accepts a division-scoped wildcard';
  end if;
end
$test$;

rollback;
