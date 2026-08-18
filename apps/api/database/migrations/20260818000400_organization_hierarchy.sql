begin;

-- Organization rows are source-owned identities. The migration deliberately
-- inserts no Republic, region, enterprise, or division-assignment fixtures:
-- production hierarchy appears only after an approved authoritative import.
create table roadops.organization_units (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid not null references roadops.source_systems(id) on delete restrict,
  external_id text not null check (btrim(external_id) <> ''),
  organization_level text not null check (
    organization_level in ('REPUBLIC', 'REGION', 'ENTERPRISE')
  ),
  first_seen_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  unique (source_system_id, external_id)
);

-- There is one effective Republic identity in this installation. A retired
-- source identity may be superseded without deleting its history.
create unique index organization_units_one_active_republic_idx
  on roadops.organization_units (organization_level)
  where organization_level = 'REPUBLIC' and retired_at is null;

create table roadops.organization_unit_versions (
  id uuid primary key default gen_random_uuid(),
  organization_unit_id uuid not null
    references roadops.organization_units(id) on delete restrict,
  source_version text not null check (btrim(source_version) <> ''),
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  attributes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(attributes) = 'object'),
  valid_from timestamptz not null,
  valid_until timestamptz,
  source_updated_at timestamptz,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint organization_unit_versions_period_ck check (
    valid_until is null or valid_until > valid_from
  ),
  unique (organization_unit_id, source_version),
  exclude using gist (
    organization_unit_id with =,
    (tstzrange(valid_from, coalesce(valid_until, 'infinity'::timestamptz), '[)')) with &&
  )
);

create unique index organization_unit_versions_current_idx
  on roadops.organization_unit_versions (organization_unit_id)
  where valid_until is null;

create table roadops.organization_parent_assignments (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid not null references roadops.source_systems(id) on delete restrict,
  external_id text not null check (btrim(external_id) <> ''),
  child_organization_unit_id uuid not null
    references roadops.organization_units(id) on delete restrict,
  parent_organization_unit_id uuid not null
    references roadops.organization_units(id) on delete restrict,
  source_version text not null check (btrim(source_version) <> ''),
  valid_from timestamptz not null,
  valid_until timestamptz,
  source_updated_at timestamptz,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint organization_parent_not_self_ck check (
    child_organization_unit_id <> parent_organization_unit_id
  ),
  constraint organization_parent_period_ck check (
    valid_until is null or valid_until > valid_from
  ),
  unique (source_system_id, external_id, source_version),
  -- A child can have only one effective parent at any instant.
  exclude using gist (
    child_organization_unit_id with =,
    (tstzrange(valid_from, coalesce(valid_until, 'infinity'::timestamptz), '[)')) with &&
  )
);

create unique index organization_parent_assignments_external_current_idx
  on roadops.organization_parent_assignments (source_system_id, external_id)
  where valid_until is null;

create index organization_parent_assignments_parent_period_idx
  on roadops.organization_parent_assignments
  using gist (
    parent_organization_unit_id,
    tstzrange(valid_from, coalesce(valid_until, 'infinity'::timestamptz), '[)')
  );

create table roadops.division_enterprise_assignments (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid not null references roadops.source_systems(id) on delete restrict,
  external_id text not null check (btrim(external_id) <> ''),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  enterprise_organization_unit_id uuid not null
    references roadops.organization_units(id) on delete restrict,
  source_version text not null check (btrim(source_version) <> ''),
  valid_from timestamptz not null,
  valid_until timestamptz,
  source_updated_at timestamptz,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  recorded_at timestamptz not null default clock_timestamp(),
  constraint division_enterprise_period_ck check (
    valid_until is null or valid_until > valid_from
  ),
  unique (source_system_id, external_id, source_version),
  -- A road division can belong to only one effective enterprise at a time.
  exclude using gist (
    division_id with =,
    (tstzrange(valid_from, coalesce(valid_until, 'infinity'::timestamptz), '[)')) with &&
  )
);

create unique index division_enterprise_assignments_external_current_idx
  on roadops.division_enterprise_assignments (source_system_id, external_id)
  where valid_until is null;

create index division_enterprise_assignments_enterprise_period_idx
  on roadops.division_enterprise_assignments
  using gist (
    enterprise_organization_unit_id,
    tstzrange(valid_from, coalesce(valid_until, 'infinity'::timestamptz), '[)')
  );

create or replace function roadops.validate_organization_unit_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and (
    new.source_system_id is distinct from old.source_system_id
    or new.external_id is distinct from old.external_id
    or new.organization_level is distinct from old.organization_level
    or new.first_seen_at is distinct from old.first_seen_at
  ) then
    raise exception using
      errcode = '23514',
      message = 'Organization source identity and level are immutable';
  end if;

  return new;
end
$function$;

create or replace function roadops.validate_organization_unit_version_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.organization_unit_id is distinct from old.organization_unit_id
     or new.source_version is distinct from old.source_version
     or new.code is distinct from old.code
     or new.name is distinct from old.name
     or new.attributes is distinct from old.attributes
     or new.valid_from is distinct from old.valid_from
     or new.source_updated_at is distinct from old.source_updated_at
     or new.payload_hash is distinct from old.payload_hash
     or new.recorded_at is distinct from old.recorded_at
     or (old.valid_until is not null and new.valid_until is distinct from old.valid_until) then
    raise exception using
      errcode = '23514',
      message = 'Organization version history is immutable except for first closure';
  end if;

  return new;
end
$function$;

create or replace function roadops.validate_organization_parent_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  child_level text;
  parent_level text;
  child_source uuid;
  parent_source uuid;
  child_retired_at timestamptz;
  parent_retired_at timestamptz;
  assignment_period tstzrange;
begin
  if tg_op = 'UPDATE' and (
    new.source_system_id is distinct from old.source_system_id
    or new.external_id is distinct from old.external_id
    or new.child_organization_unit_id is distinct from old.child_organization_unit_id
    or new.parent_organization_unit_id is distinct from old.parent_organization_unit_id
    or new.source_version is distinct from old.source_version
    or new.valid_from is distinct from old.valid_from
    or new.source_updated_at is distinct from old.source_updated_at
    or new.payload_hash is distinct from old.payload_hash
    or new.recorded_at is distinct from old.recorded_at
    or (old.valid_until is not null and new.valid_until is distinct from old.valid_until)
  ) then
    raise exception using
      errcode = '23514',
      message = 'Organization assignment history is immutable except for first closure';
  end if;

  select organization_level, source_system_id, retired_at
    into child_level, child_source, child_retired_at
  from roadops.organization_units
  where id = new.child_organization_unit_id;
  select organization_level, source_system_id, retired_at
    into parent_level, parent_source, parent_retired_at
  from roadops.organization_units
  where id = new.parent_organization_unit_id;

  if child_level is null or parent_level is null then
    raise exception using errcode = '23503', message = 'Organization identity is missing';
  end if;
  if child_source <> parent_source then
    raise exception using
      errcode = '23514',
      message = 'Organization parent and child must come from the same authoritative source';
  end if;
  if new.source_system_id <> child_source then
    raise exception using
      errcode = '23514',
      message = 'Organization assignment provenance must match its authoritative source';
  end if;
  if (child_retired_at is not null and child_retired_at <= new.valid_from)
     or (parent_retired_at is not null and parent_retired_at <= new.valid_from) then
    raise exception using
      errcode = '23514',
      message = 'A retired organization cannot participate in a new effective assignment';
  end if;
  if not (
    (child_level = 'REGION' and parent_level = 'REPUBLIC')
    or (child_level = 'ENTERPRISE' and parent_level = 'REGION')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Organization hierarchy must be ENTERPRISE -> REGION -> REPUBLIC';
  end if;

  if not exists (
    select 1
    from roadops.organization_unit_versions version
    where version.organization_unit_id = new.child_organization_unit_id
      and version.valid_from <= new.valid_from
      and (version.valid_until is null or version.valid_until > new.valid_from)
  ) or not exists (
    select 1
    from roadops.organization_unit_versions version
    where version.organization_unit_id = new.parent_organization_unit_id
      and version.valid_from <= new.valid_from
      and (version.valid_until is null or version.valid_until > new.valid_from)
  ) then
    raise exception using
      errcode = '23514',
      message = 'Parent and child require source-versioned names effective at assignment start';
  end if;

  assignment_period := tstzrange(
    new.valid_from,
    coalesce(new.valid_until, 'infinity'::timestamptz),
    '[)'
  );

  -- Enterprise assignments may not outlive or precede their Region's own
  -- Republic assignment. This makes every accepted chain complete.
  if child_level = 'ENTERPRISE' and not exists (
    select 1
    from roadops.organization_parent_assignments region_parent
    join roadops.organization_units republic
      on republic.id = region_parent.parent_organization_unit_id
     and republic.organization_level = 'REPUBLIC'
    where region_parent.child_organization_unit_id = new.parent_organization_unit_id
      and assignment_period <@ tstzrange(
        region_parent.valid_from,
        coalesce(region_parent.valid_until, 'infinity'::timestamptz),
        '[)'
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Enterprise assignment requires a covering Region -> Republic assignment';
  end if;

  -- The strict level chain already makes cycles impossible; retain an explicit
  -- recursive guard so a future level extension cannot silently weaken it.
  if exists (
    with recursive ancestors(organization_unit_id) as (
      select new.parent_organization_unit_id
      union
      select assignment.parent_organization_unit_id
      from roadops.organization_parent_assignments assignment
      join ancestors
        on ancestors.organization_unit_id = assignment.child_organization_unit_id
      where assignment.id <> new.id
        and tstzrange(
          assignment.valid_from,
          coalesce(assignment.valid_until, 'infinity'::timestamptz),
          '[)'
        ) && assignment_period
    )
    select 1
    from ancestors
    where organization_unit_id = new.child_organization_unit_id
  ) then
    raise exception using errcode = '23514', message = 'Organization cycle is forbidden';
  end if;

  -- Closing or moving a parent edge cannot strand a dependent child edge.
  if tg_op = 'UPDATE' and child_level = 'REGION' and exists (
    select 1
    from roadops.organization_parent_assignments dependent
    where dependent.parent_organization_unit_id = new.child_organization_unit_id
      and dependent.id <> new.id
      and not (
        tstzrange(
          dependent.valid_from,
          coalesce(dependent.valid_until, 'infinity'::timestamptz),
          '[)'
        ) <@ assignment_period
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Region assignment must cover every dependent Enterprise assignment';
  end if;
  if tg_op = 'UPDATE' and child_level = 'ENTERPRISE' and exists (
    select 1
    from roadops.division_enterprise_assignments dependent
    where dependent.enterprise_organization_unit_id = new.child_organization_unit_id
      and not (
        tstzrange(
          dependent.valid_from,
          coalesce(dependent.valid_until, 'infinity'::timestamptz),
          '[)'
        ) <@ assignment_period
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Enterprise assignment must cover every dependent road division assignment';
  end if;

  return new;
end
$function$;

create or replace function roadops.validate_division_enterprise_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  division_source uuid;
  division_retired_at timestamptz;
  enterprise_source uuid;
  enterprise_level text;
  enterprise_retired_at timestamptz;
  assignment_period tstzrange;
begin
  if tg_op = 'UPDATE' and (
    new.source_system_id is distinct from old.source_system_id
    or new.external_id is distinct from old.external_id
    or new.division_id is distinct from old.division_id
    or new.enterprise_organization_unit_id is distinct from old.enterprise_organization_unit_id
    or new.source_version is distinct from old.source_version
    or new.valid_from is distinct from old.valid_from
    or new.source_updated_at is distinct from old.source_updated_at
    or new.payload_hash is distinct from old.payload_hash
    or new.recorded_at is distinct from old.recorded_at
    or (old.valid_until is not null and new.valid_until is distinct from old.valid_until)
  ) then
    raise exception using
      errcode = '23514',
      message = 'Division assignment history is immutable except for first closure';
  end if;

  select source_system_id, retired_at
    into division_source, division_retired_at
  from roadops.road_divisions
  where id = new.division_id;
  select source_system_id, organization_level, retired_at
    into enterprise_source, enterprise_level, enterprise_retired_at
  from roadops.organization_units
  where id = new.enterprise_organization_unit_id;

  if division_source is null or enterprise_source is null then
    raise exception using errcode = '23503', message = 'Division or enterprise identity is missing';
  end if;
  if enterprise_level <> 'ENTERPRISE' then
    raise exception using
      errcode = '23514',
      message = 'A road division may be assigned only to an Enterprise';
  end if;
  if division_source <> enterprise_source then
    raise exception using
      errcode = '23514',
      message = 'Division and Enterprise must come from the same authoritative source';
  end if;
  if new.source_system_id <> division_source then
    raise exception using
      errcode = '23514',
      message = 'Division assignment provenance must match its authoritative source';
  end if;
  if (division_retired_at is not null and division_retired_at <= new.valid_from)
     or (enterprise_retired_at is not null and enterprise_retired_at <= new.valid_from) then
    raise exception using
      errcode = '23514',
      message = 'A retired Division or Enterprise cannot receive a new assignment';
  end if;
  if not exists (
    select 1
    from roadops.road_division_versions version
    where version.division_id = new.division_id
      and version.valid_from <= new.valid_from
      and (version.valid_until is null or version.valid_until > new.valid_from)
  ) or not exists (
    select 1
    from roadops.organization_unit_versions version
    where version.organization_unit_id = new.enterprise_organization_unit_id
      and version.valid_from <= new.valid_from
      and (version.valid_until is null or version.valid_until > new.valid_from)
  ) then
    raise exception using
      errcode = '23514',
      message = 'Division and Enterprise require source versions effective at assignment start';
  end if;

  assignment_period := tstzrange(
    new.valid_from,
    coalesce(new.valid_until, 'infinity'::timestamptz),
    '[)'
  );

  if not exists (
    select 1
    from roadops.organization_parent_assignments enterprise_parent
    join roadops.organization_units region
      on region.id = enterprise_parent.parent_organization_unit_id
     and region.organization_level = 'REGION'
    join roadops.organization_parent_assignments region_parent
      on region_parent.child_organization_unit_id = region.id
    join roadops.organization_units republic
      on republic.id = region_parent.parent_organization_unit_id
     and republic.organization_level = 'REPUBLIC'
    where enterprise_parent.child_organization_unit_id = new.enterprise_organization_unit_id
      and assignment_period <@ tstzrange(
        enterprise_parent.valid_from,
        coalesce(enterprise_parent.valid_until, 'infinity'::timestamptz),
        '[)'
      )
      and assignment_period <@ tstzrange(
        region_parent.valid_from,
        coalesce(region_parent.valid_until, 'infinity'::timestamptz),
        '[)'
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Division assignment requires a complete Enterprise -> Region -> Republic chain';
  end if;

  return new;
end
$function$;

create trigger organization_units_validate_identity
before update on roadops.organization_units
for each row execute function roadops.validate_organization_unit_identity();

create trigger organization_unit_versions_history_guard
before update on roadops.organization_unit_versions
for each row execute function roadops.validate_organization_unit_version_history();

create trigger organization_parent_assignments_validate
before insert or update
on roadops.organization_parent_assignments
for each row execute function roadops.validate_organization_parent_assignment();

create trigger division_enterprise_assignments_validate
before insert or update
on roadops.division_enterprise_assignments
for each row execute function roadops.validate_division_enterprise_assignment();

do $source_write_guards$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organization_units',
    'organization_unit_versions',
    'organization_parent_assignments',
    'division_enterprise_assignments'
  ] loop
    execute format(
      'create trigger %I before insert or update or delete on roadops.%I '
      'for each row execute function roadops.assert_sync_writer()',
      table_name || '_sync_write_guard', table_name
    );
  end loop;
end
$source_write_guards$;

revoke all on function roadops.validate_organization_unit_identity() from public;
revoke all on function roadops.validate_organization_unit_version_history() from public;
revoke all on function roadops.validate_organization_parent_assignment() from public;
revoke all on function roadops.validate_division_enterprise_assignment() from public;

alter table roadops.organization_units enable row level security;
alter table roadops.organization_units force row level security;
alter table roadops.organization_unit_versions enable row level security;
alter table roadops.organization_unit_versions force row level security;
alter table roadops.organization_parent_assignments enable row level security;
alter table roadops.organization_parent_assignments force row level security;
alter table roadops.division_enterprise_assignments enable row level security;
alter table roadops.division_enterprise_assignments force row level security;

create policy organization_units_sync_all
on roadops.organization_units for all to roadops_sync
using (true) with check (true);
create policy organization_unit_versions_sync_all
on roadops.organization_unit_versions for all to roadops_sync
using (true) with check (true);
create policy organization_parent_assignments_sync_all
on roadops.organization_parent_assignments for all to roadops_sync
using (true) with check (true);
create policy division_enterprise_assignments_sync_all
on roadops.division_enterprise_assignments for all to roadops_sync
using (true) with check (true);

create policy organization_units_reporting_read
on roadops.organization_units for select to roadops_reporting using (true);
create policy organization_unit_versions_reporting_read
on roadops.organization_unit_versions for select to roadops_reporting using (true);
create policy organization_parent_assignments_reporting_read
on roadops.organization_parent_assignments for select to roadops_reporting using (true);
create policy division_enterprise_assignments_reporting_read
on roadops.division_enterprise_assignments for select to roadops_reporting using (true);

-- Direct API table visibility is global-admin only. Division memberships,
-- including a division-scoped system.all grant, cannot inspect the hierarchy.
create policy organization_units_admin_read
on roadops.organization_units for select to roadops_api
using (roadops.has_permission('system.all', null));
create policy organization_unit_versions_admin_read
on roadops.organization_unit_versions for select to roadops_api
using (roadops.has_permission('system.all', null));
create policy organization_parent_assignments_admin_read
on roadops.organization_parent_assignments for select to roadops_api
using (roadops.has_permission('system.all', null));
create policy division_enterprise_assignments_admin_read
on roadops.division_enterprise_assignments for select to roadops_api
using (roadops.has_permission('system.all', null));

grant select, insert, update, delete on
  roadops.organization_units,
  roadops.organization_unit_versions,
  roadops.organization_parent_assignments,
  roadops.division_enterprise_assignments
to roadops_sync;
grant select on
  roadops.organization_units,
  roadops.organization_unit_versions,
  roadops.organization_parent_assignments,
  roadops.division_enterprise_assignments
to roadops_reporting, roadops_api;

-- Fixed four-level administrative tree. Nodes come exclusively from current,
-- non-retired synchronized identities and versions. The official 42 371 km
-- baseline is a setting, not a fabricated organization row.
create or replace function roadops.admin_organization_hierarchy()
returns table (
  official_network_length_km integer,
  synchronized_republic_count bigint,
  synchronized_region_count bigint,
  synchronized_enterprise_count bigint,
  synchronized_division_count bigint,
  unlinked_node_count bigint,
  hierarchy_complete boolean,
  hierarchy_tree jsonb,
  unlinked_nodes jsonb,
  as_of timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not roadops.has_permission('system.all', null) then
    raise exception using
      errcode = '42501',
      message = 'Global system administrator permission is required';
  end if;

  return query
  with active_organization_identities as materialized (
    select organization.id, organization.external_id, organization.organization_level
    from roadops.organization_units organization
    where organization.retired_at is null
      or organization.retired_at > statement_timestamp()
  ),
  effective_organizations as materialized (
    select
      organization.id,
      organization.external_id,
      organization.organization_level,
      version.code,
      version.name
    from active_organization_identities organization
    join lateral (
      select candidate.code, candidate.name
      from roadops.organization_unit_versions candidate
      where candidate.organization_unit_id = organization.id
        and candidate.valid_from <= statement_timestamp()
        and (candidate.valid_until is null
          or candidate.valid_until > statement_timestamp())
      order by candidate.valid_from desc
      limit 1
    ) version on true
  ),
  effective_parents as materialized (
    select assignment.child_organization_unit_id,
           assignment.parent_organization_unit_id
    from roadops.organization_parent_assignments assignment
    where assignment.valid_from <= statement_timestamp()
      and (assignment.valid_until is null
        or assignment.valid_until > statement_timestamp())
  ),
  active_division_identities as materialized (
    select division.id, division.external_id
    from roadops.road_divisions division
    where division.retired_at is null
      or division.retired_at > statement_timestamp()
  ),
  effective_divisions as materialized (
    select division.id, division.external_id, version.code, version.name
    from active_division_identities division
    join lateral (
      select candidate.code, candidate.name
      from roadops.road_division_versions candidate
      where candidate.division_id = division.id
        and candidate.valid_from <= statement_timestamp()
        and (candidate.valid_until is null
          or candidate.valid_until > statement_timestamp())
      order by candidate.valid_from desc
      limit 1
    ) version on true
  ),
  effective_division_parents as materialized (
    select assignment.division_id,
           assignment.enterprise_organization_unit_id
    from roadops.division_enterprise_assignments assignment
    where assignment.valid_from <= statement_timestamp()
      and (assignment.valid_until is null
        or assignment.valid_until > statement_timestamp())
  ),
  connected_regions as materialized (
    select region.id, parent.parent_organization_unit_id as republic_id
    from effective_organizations region
    join effective_parents parent
      on parent.child_organization_unit_id = region.id
    join effective_organizations republic
      on republic.id = parent.parent_organization_unit_id
     and republic.organization_level = 'REPUBLIC'
    where region.organization_level = 'REGION'
  ),
  connected_enterprises as materialized (
    select enterprise.id, parent.parent_organization_unit_id as region_id
    from effective_organizations enterprise
    join effective_parents parent
      on parent.child_organization_unit_id = enterprise.id
    join connected_regions region on region.id = parent.parent_organization_unit_id
    where enterprise.organization_level = 'ENTERPRISE'
  ),
  connected_divisions as materialized (
    select division.id, parent.enterprise_organization_unit_id as enterprise_id
    from effective_divisions division
    join effective_division_parents parent on parent.division_id = division.id
    join connected_enterprises enterprise
      on enterprise.id = parent.enterprise_organization_unit_id
  ),
  unlinked as materialized (
    select organization.id, organization.external_id,
           coalesce(nullif(organization.external_id, ''), 'VERSION-MISSING') as code,
           'Amaldagi tashkilot nomi mavjud emas'::text as name,
           organization.organization_level as node_level,
           'ORGANIZATION_VERSION_MISSING_OR_INEFFECTIVE'::text as reason
    from active_organization_identities organization
    where not exists (
      select 1 from effective_organizations effective where effective.id = organization.id
    )
    union all
    select organization.id, organization.external_id, organization.code,
           organization.name, organization.organization_level as node_level,
           case organization.organization_level
             when 'REGION' then 'REPUBLIC_PARENT_MISSING_OR_INEFFECTIVE'
             when 'ENTERPRISE' then 'REGION_CHAIN_MISSING_OR_INEFFECTIVE'
           end as reason
    from effective_organizations organization
    where (organization.organization_level = 'REGION'
        and not exists (select 1 from connected_regions connected where connected.id = organization.id))
       or (organization.organization_level = 'ENTERPRISE'
        and not exists (select 1 from connected_enterprises connected where connected.id = organization.id))
    union all
    select division.id, division.external_id, division.code, division.name,
           'DIVISION', 'ENTERPRISE_CHAIN_MISSING_OR_INEFFECTIVE'
    from effective_divisions division
    where not exists (
      select 1 from connected_divisions connected where connected.id = division.id
    )
    union all
    select division.id, division.external_id,
           coalesce(nullif(division.external_id, ''), 'VERSION-MISSING') as code,
           'Amaldagi yo‘l bo‘limi nomi mavjud emas'::text as name,
           'DIVISION'::text as node_level,
           'DIVISION_VERSION_MISSING_OR_INEFFECTIVE'::text as reason
    from active_division_identities division
    where not exists (
      select 1 from effective_divisions effective where effective.id = division.id
    )
  )
  select
    (setting.setting_value #>> '{}')::integer,
    (select count(*) from effective_organizations where organization_level = 'REPUBLIC'),
    (select count(*) from effective_organizations where organization_level = 'REGION'),
    (select count(*) from effective_organizations where organization_level = 'ENTERPRISE'),
    (select count(*) from effective_divisions),
    (select count(*) from unlinked),
    (
      (select count(*) from effective_organizations where organization_level = 'REPUBLIC') = 1
      and not exists (select 1 from unlinked)
    ),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', republic.id,
          'externalId', republic.external_id,
          'code', republic.code,
          'name', republic.name,
          'level', 'REPUBLIC',
          'officialNetworkLengthKm', (setting.setting_value #>> '{}')::integer,
          'children', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', region.id,
                'externalId', region.external_id,
                'code', region.code,
                'name', region.name,
                'level', 'REGION',
                'children', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', enterprise.id,
                      'externalId', enterprise.external_id,
                      'code', enterprise.code,
                      'name', enterprise.name,
                      'level', 'ENTERPRISE',
                      'children', coalesce((
                        select jsonb_agg(
                          jsonb_build_object(
                            'id', division.id,
                            'externalId', division.external_id,
                            'code', division.code,
                            'name', division.name,
                            'level', 'DIVISION',
                            'children', '[]'::jsonb
                          ) order by division.code, division.name, division.id
                        )
                        from effective_divisions division
                        join connected_divisions division_link
                          on division_link.id = division.id
                         and division_link.enterprise_id = enterprise.id
                      ), '[]'::jsonb)
                    ) order by enterprise.code, enterprise.name, enterprise.id
                  )
                  from effective_organizations enterprise
                  join connected_enterprises enterprise_link
                    on enterprise_link.id = enterprise.id
                   and enterprise_link.region_id = region.id
                ), '[]'::jsonb)
              ) order by region.code, region.name, region.id
            )
            from effective_organizations region
            join connected_regions region_link
              on region_link.id = region.id
             and region_link.republic_id = republic.id
          ), '[]'::jsonb)
        ) order by republic.code, republic.name, republic.id
      )
      from effective_organizations republic
      where republic.organization_level = 'REPUBLIC'
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', unlinked.id,
          'externalId', unlinked.external_id,
          'code', unlinked.code,
          'name', unlinked.name,
          'level', unlinked.node_level,
          'reason', unlinked.reason
        ) order by unlinked.node_level, unlinked.code, unlinked.name, unlinked.id
      )
      from unlinked
    ), '[]'::jsonb),
    statement_timestamp()
  from roadops.system_settings setting
  where setting.setting_key = 'national_road_network_length_km';
end
$function$;

comment on function roadops.admin_organization_hierarchy() is
  'Global administrator-only authoritative Republic -> Region -> Enterprise -> Division tree. Returns no fabricated organization rows.';

revoke all on function roadops.admin_organization_hierarchy() from public;
revoke all on function roadops.admin_organization_hierarchy() from roadops_sync;
revoke all on function roadops.admin_organization_hierarchy() from roadops_reporting;
grant execute on function roadops.admin_organization_hierarchy() to roadops_api;

commit;
