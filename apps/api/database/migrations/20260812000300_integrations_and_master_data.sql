begin;

create table roadops.source_systems (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  name text not null check (btrim(name) <> ''),
  system_kind text not null
    check (system_kind in ('road_repair', 'roadvision', 'other')),
  enabled boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create trigger source_systems_set_updated_at
before update on roadops.source_systems
for each row execute function roadops.set_updated_at();

create table roadops.integration_connections (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid not null references roadops.source_systems(id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  transport text not null check (transport in ('https', 's3', 'database', 'file_drop')),
  endpoint text,
  secret_reference text,
  enabled boolean not null default false,
  request_timeout_seconds integer not null default 30
    check (request_timeout_seconds between 1 and 300),
  max_attempts integer not null default 8 check (max_attempts between 1 and 30),
  configuration jsonb not null default '{}'::jsonb,
  last_health_check_at timestamptz,
  last_health_state text
    check (last_health_state is null or last_health_state in ('healthy', 'degraded', 'unreachable')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (source_system_id, name)
);

comment on column roadops.integration_connections.secret_reference is
  'Secret-manager path/key only. Credentials and tokens must never be stored here.';

create trigger integration_connections_set_updated_at
before update on roadops.integration_connections
for each row execute function roadops.set_updated_at();

create table roadops.sync_cursors (
  connection_id uuid not null references roadops.integration_connections(id) on delete restrict,
  stream_name text not null check (btrim(stream_name) <> ''),
  cursor_value text,
  watermark_at timestamptz,
  source_snapshot_hash bytea check (
    source_snapshot_hash is null or octet_length(source_snapshot_hash) = 32
  ),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (connection_id, stream_name)
);

create table roadops.sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references roadops.integration_connections(id) on delete restrict,
  stream_name text not null check (btrim(stream_name) <> ''),
  run_kind text not null check (run_kind in ('incremental', 'full', 'replay')),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled')),
  cursor_before text,
  cursor_after text,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  received_count bigint not null default 0 check (received_count >= 0),
  applied_count bigint not null default 0 check (applied_count >= 0),
  rejected_count bigint not null default 0 check (rejected_count >= 0),
  error_summary jsonb,
  triggered_by uuid references roadops.app_users(id),
  constraint sync_run_finish_ck check (
    (status = 'running' and finished_at is null)
    or (status <> 'running' and finished_at is not null and finished_at >= started_at)
  ),
  constraint sync_run_counts_ck check (
    applied_count + rejected_count <= received_count
  )
);

create index sync_runs_connection_started_idx
  on roadops.sync_runs (connection_id, started_at desc);

create table roadops.integration_inbox (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid not null references roadops.source_systems(id) on delete restrict,
  sync_run_id uuid references roadops.sync_runs(id) on delete set null,
  stream_name text not null check (btrim(stream_name) <> ''),
  external_event_id text not null check (btrim(external_event_id) <> ''),
  event_kind text not null check (btrim(event_kind) <> ''),
  occurred_at timestamptz,
  received_at timestamptz not null default clock_timestamp(),
  payload jsonb not null,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'processed', 'failed', 'dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default clock_timestamp(),
  locked_at timestamptz,
  locked_by text,
  processed_at timestamptz,
  last_error_code text,
  last_error_detail jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint integration_inbox_state_ck check (
    (state = 'processed' and processed_at is not null)
    or (state <> 'processed')
  ),
  unique (source_system_id, stream_name, external_event_id),
  unique (source_system_id, stream_name, payload_hash)
);

create index integration_inbox_dispatch_idx
  on roadops.integration_inbox (available_at, received_at)
  where state in ('pending', 'failed');

create trigger integration_inbox_set_updated_at
before update on roadops.integration_inbox
for each row execute function roadops.set_updated_at();

create table roadops.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null default gen_random_uuid() unique,
  destination_code text not null check (btrim(destination_code) <> ''),
  event_kind text not null check (btrim(event_kind) <> ''),
  aggregate_type text not null check (btrim(aggregate_type) <> ''),
  aggregate_id uuid not null,
  payload jsonb not null,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  state text not null default 'pending'
    check (state in ('pending', 'publishing', 'published', 'failed', 'dead_letter')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default clock_timestamp(),
  locked_at timestamptz,
  locked_by text,
  published_at timestamptz,
  last_error_code text,
  last_error_detail jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (destination_code, event_kind, aggregate_type, aggregate_id, payload_hash)
);

create index integration_outbox_dispatch_idx
  on roadops.integration_outbox (available_at, created_at)
  where state in ('pending', 'failed');

create trigger integration_outbox_set_updated_at
before update on roadops.integration_outbox
for each row execute function roadops.set_updated_at();

create table roadops.dead_letter_events (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('inbox', 'outbox')),
  original_id uuid not null,
  source_or_destination text not null,
  event_kind text not null,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  failure_code text not null,
  failure_detail jsonb not null,
  failed_at timestamptz not null default clock_timestamp(),
  replayed_at timestamptz,
  replayed_by uuid references roadops.app_users(id),
  replay_id uuid,
  unique (direction, original_id)
);

create table roadops.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  inbox_id uuid not null references roadops.integration_inbox(id) on delete restrict,
  entity_type text not null check (btrim(entity_type) <> ''),
  external_id text not null check (btrim(external_id) <> ''),
  conflict_code text not null check (btrim(conflict_code) <> ''),
  source_value jsonb,
  current_value jsonb,
  status text not null default 'open'
    check (status in ('open', 'resolved_from_source', 'ignored_as_duplicate', 'rejected')),
  detected_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  resolved_by uuid references roadops.app_users(id),
  resolution_note text,
  constraint sync_conflicts_resolution_ck check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or (status <> 'open' and resolved_at is not null and resolved_by is not null
        and coalesce(btrim(resolution_note), '') <> '')
  )
);

create table roadops.road_divisions (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid not null references roadops.source_systems(id) on delete restrict,
  external_id text not null check (btrim(external_id) <> ''),
  first_seen_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  unique (source_system_id, external_id)
);

create table roadops.road_division_versions (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  source_version text not null check (btrim(source_version) <> ''),
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  valid_from timestamptz not null,
  valid_until timestamptz,
  source_updated_at timestamptz,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint road_division_versions_period_ck check (
    valid_until is null or valid_until > valid_from
  ),
  unique (division_id, source_version),
  exclude using gist (
    division_id with =,
    (tstzrange(valid_from, coalesce(valid_until, 'infinity'::timestamptz), '[)')) with &&
  )
);

create unique index road_division_versions_current_idx
  on roadops.road_division_versions (division_id)
  where valid_until is null;
create unique index road_division_versions_current_code_idx
  on roadops.road_division_versions (code)
  where valid_until is null;

create table roadops.road_division_profile_versions (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  source_version text not null check (btrim(source_version) <> ''),
  region_code text,
  address text,
  phone text,
  email extensions.citext,
  manager_external_id text,
  profile_data jsonb not null default '{}'::jsonb,
  valid_from timestamptz not null,
  valid_until timestamptz,
  source_updated_at timestamptz,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint road_division_profile_versions_period_ck check (
    valid_until is null or valid_until > valid_from
  ),
  unique (division_id, source_version),
  exclude using gist (
    division_id with =,
    (tstzrange(valid_from, coalesce(valid_until, 'infinity'::timestamptz), '[)')) with &&
  )
);

create unique index road_division_profile_versions_current_idx
  on roadops.road_division_profile_versions (division_id)
  where valid_until is null;

alter table roadops.user_role_memberships
  add constraint user_role_memberships_division_fk
  foreign key (division_id) references roadops.road_divisions(id) on delete restrict;

create table roadops.roads (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid not null references roadops.source_systems(id) on delete restrict,
  external_id text not null check (btrim(external_id) <> ''),
  first_seen_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  unique (source_system_id, external_id)
);

create table roadops.road_versions (
  id uuid primary key default gen_random_uuid(),
  road_id uuid not null references roadops.roads(id) on delete restrict,
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  source_version text not null check (btrim(source_version) <> ''),
  official_code text not null check (btrim(official_code) <> ''),
  name text not null check (btrim(name) <> ''),
  road_class text,
  length_m numeric(14,3) not null check (length_m > 0),
  attributes jsonb not null default '{}'::jsonb,
  valid_from timestamptz not null,
  valid_until timestamptz,
  source_updated_at timestamptz,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint road_versions_period_ck check (
    valid_until is null or valid_until > valid_from
  ),
  unique (road_id, source_version),
  exclude using gist (
    road_id with =,
    (tstzrange(valid_from, coalesce(valid_until, 'infinity'::timestamptz), '[)')) with &&
  )
);

create unique index road_versions_current_idx
  on roadops.road_versions (road_id)
  where valid_until is null;
create unique index road_versions_current_official_code_idx
  on roadops.road_versions (official_code)
  where valid_until is null;
create index road_versions_current_division_idx
  on roadops.road_versions (division_id, road_id)
  where valid_until is null;

create table roadops.road_elements (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid not null references roadops.source_systems(id) on delete restrict,
  external_id text not null check (btrim(external_id) <> ''),
  first_seen_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  unique (source_system_id, external_id)
);

create table roadops.road_element_versions (
  id uuid primary key default gen_random_uuid(),
  road_element_id uuid not null references roadops.road_elements(id) on delete restrict,
  road_id uuid not null references roadops.roads(id) on delete restrict,
  source_version text not null check (btrim(source_version) <> ''),
  element_type text not null check (btrim(element_type) <> ''),
  name text,
  chainage_span numrange not null,
  attributes jsonb not null default '{}'::jsonb,
  valid_from timestamptz not null,
  valid_until timestamptz,
  source_updated_at timestamptz,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint road_element_versions_chainage_ck check (
    not isempty(chainage_span)
    and lower_inc(chainage_span)
    and not upper_inc(chainage_span)
    and lower(chainage_span) >= 0
    and upper(chainage_span) > lower(chainage_span)
  ),
  constraint road_element_versions_period_ck check (
    valid_until is null or valid_until > valid_from
  ),
  unique (road_element_id, source_version),
  exclude using gist (
    road_element_id with =,
    (tstzrange(valid_from, coalesce(valid_until, 'infinity'::timestamptz), '[)')) with &&
  )
);

create unique index road_element_versions_current_idx
  on roadops.road_element_versions (road_element_id)
  where valid_until is null;
create index road_element_versions_current_road_idx
  on roadops.road_element_versions using gist (road_id, chainage_span)
  where valid_until is null;

create table roadops.workers (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid not null references roadops.source_systems(id) on delete restrict,
  external_id text not null check (btrim(external_id) <> ''),
  first_seen_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  unique (source_system_id, external_id)
);

create table roadops.worker_versions (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references roadops.workers(id) on delete restrict,
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  source_version text not null check (btrim(source_version) <> ''),
  personnel_number text not null check (btrim(personnel_number) <> ''),
  full_name text not null check (btrim(full_name) <> ''),
  position_name text,
  employment_state text not null
    check (employment_state in ('active', 'leave', 'suspended', 'ended')),
  valid_from timestamptz not null,
  valid_until timestamptz,
  source_updated_at timestamptz,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint worker_versions_period_ck check (
    valid_until is null or valid_until > valid_from
  ),
  unique (worker_id, source_version),
  exclude using gist (
    worker_id with =,
    (tstzrange(valid_from, coalesce(valid_until, 'infinity'::timestamptz), '[)')) with &&
  )
);

alter table roadops.app_users
  add column worker_id uuid unique references roadops.workers(id) on delete restrict;

create unique index worker_versions_current_idx
  on roadops.worker_versions (worker_id)
  where valid_until is null;
create unique index worker_versions_current_personnel_idx
  on roadops.worker_versions (personnel_number)
  where valid_until is null;
create index worker_versions_current_division_idx
  on roadops.worker_versions (division_id, worker_id)
  where valid_until is null;

create table roadops.worker_qualification_versions (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references roadops.workers(id) on delete restrict,
  source_version text not null check (btrim(source_version) <> ''),
  qualification_code text not null check (btrim(qualification_code) <> ''),
  qualification_name text not null check (btrim(qualification_name) <> ''),
  certificate_reference text,
  valid_from timestamptz not null,
  valid_until timestamptz,
  source_updated_at timestamptz,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint worker_qualification_versions_period_ck check (
    valid_until is null or valid_until > valid_from
  ),
  exclude using gist (
    worker_id with =,
    qualification_code with =,
    (tstzrange(valid_from, coalesce(valid_until, 'infinity'::timestamptz), '[)')) with &&
  )
);

create index worker_qualification_versions_current_idx
  on roadops.worker_qualification_versions (worker_id, qualification_code)
  where valid_until is null;

create table roadops.worker_availability (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references roadops.workers(id) on delete restrict,
  work_date date not null,
  available_minutes smallint not null check (available_minutes between 0 and 420),
  availability_code text not null
    check (availability_code in ('available', 'leave', 'sick', 'training', 'not_scheduled')),
  source_version text not null check (btrim(source_version) <> ''),
  source_updated_at timestamptz,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  recorded_at timestamptz not null default clock_timestamp(),
  unique (worker_id, work_date, source_version)
);

create unique index worker_availability_latest_idx
  on roadops.worker_availability (worker_id, work_date, source_updated_at desc nulls last, recorded_at desc);

create or replace function roadops.validate_span_within_road()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  road_length numeric;
  effective_at timestamptz;
begin
  effective_at := coalesce(new.valid_from, statement_timestamp());
  select rv.length_m into road_length
  from roadops.road_versions rv
  where rv.road_id = new.road_id
    and rv.valid_from <= effective_at
    and (rv.valid_until is null or rv.valid_until > effective_at)
  order by rv.valid_from desc
  limit 1;

  if road_length is null then
    raise exception using errcode = '23514', message = 'No effective road version for chainage validation';
  end if;
  if lower(new.chainage_span) < 0 or upper(new.chainage_span) > road_length then
    raise exception using errcode = '23514', message = 'Chainage span exceeds effective road length';
  end if;
  return new;
end
$function$;

create trigger road_element_versions_validate_span
before insert or update of road_id, chainage_span, valid_from
on roadops.road_element_versions
for each row execute function roadops.validate_span_within_road();

revoke all on function roadops.validate_span_within_road() from public;

do $guard_triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'road_divisions','road_division_versions','road_division_profile_versions',
    'roads','road_versions','road_elements','road_element_versions',
    'workers','worker_versions','worker_qualification_versions','worker_availability'
  ] loop
    execute format(
      'create trigger %I before insert or update or delete on roadops.%I '
      'for each row execute function roadops.assert_sync_writer()',
      table_name || '_sync_write_guard', table_name
    );
  end loop;
end
$guard_triggers$;

commit;
