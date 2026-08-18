begin;

-- The official national network length is an administrative planning baseline,
-- not a division setting. Keep it in the audited settings table while making
-- the row invisible to ordinary road-unit actors.
alter table roadops.system_settings
  drop constraint system_settings_setting_key_check;
alter table roadops.system_settings
  add constraint system_settings_setting_key_check check (
    setting_key in (
      'timezone',
      'planning_horizon_days',
      'national_road_network_length_km'
    )
  );

alter table roadops.system_settings
  drop constraint system_settings_value_ck;
alter table roadops.system_settings
  add constraint system_settings_value_ck check (
    (setting_key = 'timezone'
      and setting_value = to_jsonb('Asia/Tashkent'::text))
    or
    (setting_key = 'planning_horizon_days'
      and jsonb_typeof(setting_value) = 'number'
      and (setting_value #>> '{}') ~ '^[0-9]+$'
      and (setting_value #>> '{}')::integer between 1 and 90)
    or
    (setting_key = 'national_road_network_length_km'
      and jsonb_typeof(setting_value) = 'number'
      and (setting_value #>> '{}') ~ '^[0-9]+$'
      and (setting_value #>> '{}')::integer = 42371)
  );

insert into roadops.system_settings (setting_key, setting_value)
values ('national_road_network_length_km', to_jsonb(42371));

comment on column roadops.system_settings.setting_key is
  'Application settings; national_road_network_length_km is visible only to a global system administrator.';

drop policy system_settings_api_read on roadops.system_settings;
create policy system_settings_api_read
on roadops.system_settings for select to roadops_api
using (
  roadops.current_actor_id() is not null
  and (
    (
      setting_key = 'national_road_network_length_km'
      and roadops.has_permission('system.all', null)
    )
    or
    (
      setting_key <> 'national_road_network_length_km'
      and (
        roadops.has_any_permission('master.read')
        or roadops.has_any_permission('system.all')
      )
    )
  )
);

drop policy system_settings_api_update on roadops.system_settings;
create policy system_settings_api_update
on roadops.system_settings for update to roadops_api
using (
  (
    setting_key = 'national_road_network_length_km'
    and roadops.has_permission('system.all', null)
  )
  or (
    setting_key <> 'national_road_network_length_km'
    and roadops.has_any_permission('system.all')
  )
)
with check (
  updated_by = roadops.current_actor_id()
  and (
    (
      setting_key = 'national_road_network_length_km'
      and roadops.has_permission('system.all', null)
    )
    or (
      setting_key <> 'national_road_network_length_km'
      and roadops.has_any_permission('system.all')
    )
  )
);

-- This elevated function returns aggregate counts only. The explicit global
-- membership check prevents a division-scoped role from using system.all to
-- discover the national baseline or out-of-scope master records.
create or replace function roadops.admin_network_summary()
returns table (
  official_network_length_km integer,
  synchronized_road_length_km numeric,
  synchronized_road_count bigint,
  synchronized_division_count bigint,
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
  with effective_roads as (
    select version.road_id, version.length_m
    from roadops.road_versions version
    join roadops.roads road on road.id = version.road_id
    where version.valid_from <= statement_timestamp()
      and (version.valid_until is null or version.valid_until > statement_timestamp())
      and (road.retired_at is null or road.retired_at > statement_timestamp())
  ),
  effective_divisions as (
    select version.division_id
    from roadops.road_division_versions version
    join roadops.road_divisions division on division.id = version.division_id
    where version.valid_from <= statement_timestamp()
      and (version.valid_until is null or version.valid_until > statement_timestamp())
      and (division.retired_at is null or division.retired_at > statement_timestamp())
  )
  select
    (setting.setting_value #>> '{}')::integer,
    (
      select trim_scale(coalesce(sum(road.length_m), 0::numeric) / 1000)
      from effective_roads road
    ),
    (select count(*) from effective_roads),
    (select count(*) from effective_divisions),
    statement_timestamp()
  from roadops.system_settings setting
  where setting.setting_key = 'national_road_network_length_km';
end
$function$;

comment on function roadops.admin_network_summary() is
  'Global administrator-only official baseline and live synchronized road/division aggregates; no entity details are returned.';

revoke all on function roadops.admin_network_summary() from public;
grant execute on function roadops.admin_network_summary() to roadops_api;

commit;
