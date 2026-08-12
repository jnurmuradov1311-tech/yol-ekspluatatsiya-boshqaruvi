begin;

create table roadops.app_users (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null unique,
  password_hash text not null check (length(password_hash) >= 20),
  full_name text not null check (btrim(full_name) <> ''),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'suspended', 'disabled')),
  mfa_required boolean not null default true,
  email_verified_at timestamptz,
  password_changed_at timestamptz not null default clock_timestamp(),
  last_login_at timestamptz,
  failed_login_count integer not null default 0 check (failed_login_count >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  created_by uuid references roadops.app_users(id),
  updated_by uuid references roadops.app_users(id),
  row_version bigint not null default 1 check (row_version > 0)
);

create trigger app_users_set_updated_at
before update on roadops.app_users
for each row execute function roadops.set_updated_at();

create table roadops.system_settings (
  setting_key text primary key
    check (setting_key in ('timezone', 'planning_horizon_days')),
  setting_value jsonb not null,
  updated_by uuid references roadops.app_users(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  constraint system_settings_value_ck check (
    (setting_key = 'timezone'
      and setting_value = to_jsonb('Asia/Tashkent'::text))
    or
    (setting_key = 'planning_horizon_days'
      and jsonb_typeof(setting_value) = 'number'
      and (setting_value #>> '{}') ~ '^[0-9]+$'
      and (setting_value #>> '{}')::integer between 1 and 90)
  )
);

insert into roadops.system_settings (setting_key, setting_value)
values
  ('timezone', to_jsonb('Asia/Tashkent'::text)),
  ('planning_horizon_days', to_jsonb(14));

create table roadops.password_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references roadops.app_users(id) on delete restrict,
  password_hash text not null check (length(password_hash) >= 20),
  changed_at timestamptz not null default clock_timestamp(),
  changed_by uuid references roadops.app_users(id),
  reason text not null check (reason in ('created', 'changed', 'reset', 'admin_reset'))
);

create index password_history_user_changed_at_idx
  on roadops.password_history (user_id, changed_at desc);

create table roadops.user_mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references roadops.app_users(id) on delete restrict,
  factor_type text not null check (factor_type in ('totp', 'webauthn')),
  label text not null check (btrim(label) <> ''),
  secret_ciphertext bytea,
  credential_id bytea,
  public_key bytea,
  last_used_counter bigint check (last_used_counter is null or last_used_counter >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'revoked')),
  verified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint user_mfa_factor_material_ck check (
    (factor_type = 'totp' and secret_ciphertext is not null
      and credential_id is null and public_key is null)
    or
    (factor_type = 'webauthn' and secret_ciphertext is null
      and credential_id is not null and public_key is not null)
  ),
  constraint user_mfa_factor_counter_ck check (
    (factor_type = 'totp') or last_used_counter is null
  ),
  constraint user_mfa_factor_state_ck check (
    (status = 'pending' and verified_at is null and revoked_at is null)
    or (status = 'verified' and verified_at is not null and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  ),
  unique (user_id, credential_id)
);

comment on column roadops.user_mfa_factors.secret_ciphertext is
  'Application-encrypted TOTP seed; the encryption key lives only in the secret manager.';

create table roadops.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references roadops.app_users(id) on delete restrict,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  csrf_token_hash bytea not null check (octet_length(csrf_token_hash) = 32),
  issued_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason text,
  rotated_from_session_id uuid references roadops.auth_sessions(id),
  ip_address inet,
  user_agent text,
  created_request_id uuid,
  constraint auth_sessions_expiry_ck check (
    expires_at > issued_at and absolute_expires_at >= expires_at
  ),
  constraint auth_sessions_revocation_ck check (
    (revoked_at is null and revocation_reason is null)
    or (revoked_at is not null and coalesce(btrim(revocation_reason), '') <> '')
  )
);

create index auth_sessions_active_user_idx
  on roadops.auth_sessions (user_id, expires_at)
  where revoked_at is null;
create index auth_sessions_expiry_idx
  on roadops.auth_sessions (expires_at)
  where revoked_at is null;

comment on column roadops.auth_sessions.token_hash is
  'SHA-256 of the opaque cookie token. The plaintext token is never persisted.';

create table roadops.login_attempts (
  id bigint generated always as identity primary key,
  email extensions.citext not null,
  user_id uuid references roadops.app_users(id) on delete set null,
  attempted_at timestamptz not null default clock_timestamp(),
  succeeded boolean not null,
  failure_code text,
  ip_address inet,
  user_agent text,
  request_id uuid,
  constraint login_attempt_result_ck check (
    (succeeded and failure_code is null)
    or (not succeeded and coalesce(btrim(failure_code), '') <> '')
  )
);

create index login_attempts_email_time_idx
  on roadops.login_attempts (email, attempted_at desc);
create index login_attempts_ip_time_idx
  on roadops.login_attempts (ip_address, attempted_at desc);

create table roadops.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  name text not null check (btrim(name) <> ''),
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create trigger roles_set_updated_at
before update on roadops.roles
for each row execute function roadops.set_updated_at();

create table roadops.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_.-]{1,95}$'),
  description text not null check (btrim(description) <> ''),
  created_at timestamptz not null default clock_timestamp()
);

create table roadops.role_permissions (
  role_id uuid not null references roadops.roles(id) on delete restrict,
  permission_id uuid not null references roadops.permissions(id) on delete restrict,
  granted_at timestamptz not null default clock_timestamp(),
  granted_by uuid references roadops.app_users(id),
  primary key (role_id, permission_id)
);

create table roadops.user_role_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references roadops.app_users(id) on delete restrict,
  role_id uuid not null references roadops.roles(id) on delete restrict,
  division_id uuid,
  valid_from timestamptz not null default clock_timestamp(),
  valid_until timestamptz,
  granted_by uuid references roadops.app_users(id),
  revoked_by uuid references roadops.app_users(id),
  revocation_reason text,
  created_at timestamptz not null default clock_timestamp(),
  constraint user_role_membership_period_ck check (
    valid_until is null or valid_until > valid_from
  ),
  constraint user_role_membership_division_ck check (
    division_id is null
    or division_id <> '00000000-0000-0000-0000-000000000000'::uuid
  ),
  constraint user_role_membership_revocation_ck check (
    (revoked_by is null and revocation_reason is null)
    or (revoked_by is not null and valid_until is not null
        and coalesce(btrim(revocation_reason), '') <> '')
  ),
  exclude using gist (
    user_id with =,
    role_id with =,
    (coalesce(division_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    (tstzrange(valid_from, coalesce(valid_until, 'infinity'::timestamptz), '[)')) with &&
  )
);

create index user_role_memberships_active_user_idx
  on roadops.user_role_memberships (user_id, division_id, valid_from)
  where valid_until is null;

create table roadops.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope ~ '^[a-z][a-z0-9_.-]{1,95}$'),
  idempotency_key text not null check (length(idempotency_key) between 8 and 255),
  actor_user_id uuid references roadops.app_users(id) on delete restrict,
  request_hash bytea not null check (octet_length(request_hash) = 32),
  state text not null default 'processing'
    check (state in ('processing', 'completed', 'failed')),
  locked_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  response_status integer check (response_status between 100 and 599),
  response_body jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint idempotency_completion_ck check (
    (state = 'processing' and completed_at is null and response_status is null)
    or (state in ('completed', 'failed') and completed_at is not null
        and response_status is not null)
  ),
  constraint idempotency_expiry_ck check (expires_at > created_at),
  unique (scope, idempotency_key)
);

create index idempotency_keys_expiry_idx on roadops.idempotency_keys (expires_at);

create trigger idempotency_keys_set_updated_at
before update on roadops.idempotency_keys
for each row execute function roadops.set_updated_at();

insert into roadops.permissions (code, description) values
  ('system.all', 'Unrestricted administrative operation'),
  ('users.read', 'Read application users and memberships'),
  ('users.manage', 'Create and manage users, roles, and memberships'),
  ('master.read', 'Read synced roads, elements, divisions, and workers'),
  ('catalog.read', 'Read IQN and defect catalogs'),
  ('catalog.manage', 'Import and approve IQN and mapping catalogs'),
  ('defects.read', 'Read RoadVision candidates and verified defects'),
  ('defects.capture', 'Create manual inspection defects'),
  ('defects.verify', 'Match and human-verify RoadVision candidates'),
  ('planning.read', 'Read annual programs and operational plans'),
  ('planning.write', 'Build and re-evaluate draft plans'),
  ('planning.approve', 'Approve evaluated plans'),
  ('execution.read', 'Read work orders and execution records'),
  ('execution.manage', 'Dispatch and update work orders'),
  ('time.write', 'Record own work time'),
  ('resources.read', 'Read equipment, stock, and resource availability'),
  ('resources.manage', 'Manage local equipment and inventory'),
  ('integrations.read', 'Read integration health and failures'),
  ('integrations.manage', 'Configure and operate integrations'),
  ('audit.read', 'Read tamper-evident audit records'),
  ('reports.read', 'Read operational reports')
on conflict (code) do nothing;

insert into roadops.roles (code, name, description, is_system) values
  ('system_admin', 'Tizim administratori', 'Full system administration', true),
  ('division_manager', 'Yo‘l bo‘limi rahbari', 'Division operations and approval', true),
  ('planner', 'Rejalashtiruvchi', 'Draft planning and resource scheduling', true),
  ('inspector', 'Inspektor', 'Defect capture and human verification', true),
  ('dispatcher', 'Dispetcher', 'Work dispatch and execution monitoring', true),
  ('worker', 'Ishchi', 'Assigned work and own time entry', true),
  ('auditor', 'Auditor', 'Read-only operational and audit access', true),
  ('integration_operator', 'Integratsiya operatori', 'Integration monitoring and replay', true)
on conflict (code) do nothing;

insert into roadops.role_permissions (role_id, permission_id)
select r.id, p.id
from roadops.roles r
cross join roadops.permissions p
where r.code = 'system_admin'
on conflict do nothing;

insert into roadops.role_permissions (role_id, permission_id)
select r.id, p.id
from roadops.roles r
join roadops.permissions p on p.code = any (case r.code
  when 'division_manager' then array[
    'users.read','master.read','catalog.read','defects.read','defects.verify',
    'planning.read','planning.write','planning.approve','execution.read',
    'execution.manage','resources.read','reports.read']
  when 'planner' then array[
    'master.read','catalog.read','defects.read','planning.read','planning.write',
    'execution.read','resources.read','reports.read']
  when 'inspector' then array[
    'master.read','catalog.read','defects.read','defects.capture','defects.verify',
    'execution.read']
  when 'dispatcher' then array[
    'master.read','catalog.read','defects.read','planning.read','execution.read',
    'execution.manage','resources.read','reports.read']
  when 'worker' then array['master.read','execution.read','time.write']
  when 'auditor' then array[
    'master.read','catalog.read','defects.read','planning.read','execution.read',
    'resources.read','integrations.read','audit.read','reports.read']
  when 'integration_operator' then array[
    'master.read','catalog.read','integrations.read','integrations.manage']
  else array[]::text[]
end)
on conflict do nothing;

create or replace function roadops.has_permission(
  permission_code text,
  requested_division_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from roadops.app_users u
    join roadops.user_role_memberships m on m.user_id = u.id
    join roadops.role_permissions rp on rp.role_id = m.role_id
    join roadops.permissions p on p.id = rp.permission_id
    where u.id = roadops.current_actor_id()
      and u.status = 'active'
      and m.valid_from <= statement_timestamp()
      and (m.valid_until is null or m.valid_until > statement_timestamp())
      and (p.code = permission_code or p.code = 'system.all')
      and (m.division_id is null or m.division_id = requested_division_id)
  )
$function$;

create or replace function roadops.can_access_division(requested_division_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from roadops.app_users u
    join roadops.user_role_memberships m on m.user_id = u.id
    where u.id = roadops.current_actor_id()
      and u.status = 'active'
      and m.valid_from <= statement_timestamp()
      and (m.valid_until is null or m.valid_until > statement_timestamp())
      and (m.division_id is null or m.division_id = requested_division_id)
  )
$function$;

create or replace function roadops.has_any_permission(permission_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from roadops.app_users u
    join roadops.user_role_memberships m on m.user_id = u.id
    join roadops.role_permissions rp on rp.role_id = m.role_id
    join roadops.permissions p on p.id = rp.permission_id
    where u.id = roadops.current_actor_id()
      and u.status = 'active'
      and m.valid_from <= statement_timestamp()
      and (m.valid_until is null or m.valid_until > statement_timestamp())
      and (p.code = permission_code or p.code = 'system.all')
  )
$function$;

revoke all on function roadops.has_permission(text, uuid) from public;
revoke all on function roadops.can_access_division(uuid) from public;
revoke all on function roadops.has_any_permission(text) from public;

commit;
