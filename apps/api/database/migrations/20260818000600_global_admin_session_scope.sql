begin;

-- Keep ordinary permissions usable in their assigned division while exposing
-- a second, explicit set for permissions granted by a truly global membership.
-- The browser and PHP middleware must never infer global administration from
-- an unscoped aggregate of division memberships.
create or replace function roadops.authenticate_session_scoped(p_token_hash text)
returns table (
  session_id uuid,
  user_id uuid,
  email text,
  full_name text,
  status text,
  expires_at timestamptz,
  csrf_hash text,
  permissions text[],
  road_unit_ids uuid[],
  global_permissions text[]
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    authenticated.session_id,
    authenticated.user_id,
    authenticated.email,
    authenticated.full_name,
    authenticated.status,
    authenticated.expires_at,
    authenticated.csrf_hash,
    authenticated.permissions,
    coalesce((
      select array_agg(distinct membership.division_id order by membership.division_id)
      from roadops.user_role_memberships membership
      where membership.user_id = authenticated.user_id
        and membership.division_id is not null
        and membership.valid_from <= statement_timestamp()
        and (
          membership.valid_until is null
          or membership.valid_until > statement_timestamp()
        )
    ), array[]::uuid[]),
    coalesce((
      select array_agg(distinct permission.code order by permission.code)
      from roadops.user_role_memberships membership
      join roadops.role_permissions role_permission
        on role_permission.role_id = membership.role_id
      join roadops.permissions permission
        on permission.id = role_permission.permission_id
      where membership.user_id = authenticated.user_id
        and membership.division_id is null
        and membership.valid_from <= statement_timestamp()
        and (
          membership.valid_until is null
          or membership.valid_until > statement_timestamp()
        )
    ), array[]::text[])
  from roadops.authenticate_session(p_token_hash) authenticated
$function$;

comment on function roadops.authenticate_session_scoped(text) is
  'Authenticates a hashed session token, separates global permissions, and exposes only explicitly assigned divisions for operational scope.';

-- System settings affect every division. A division-scoped system.all role is
-- intentionally insufficient for changing this global configuration.
drop policy if exists system_settings_api_update on roadops.system_settings;
create policy system_settings_api_update
on roadops.system_settings for update to roadops_api
using (roadops.has_permission('system.all', null))
with check (
  roadops.has_permission('system.all', null)
  and updated_by = roadops.current_actor_id()
);

revoke all on function roadops.authenticate_session_scoped(text) from public;
grant execute on function roadops.authenticate_session_scoped(text) to roadops_api;

commit;
