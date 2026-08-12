begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists btree_gist with schema extensions;

create schema if not exists roadops;
comment on schema roadops is
  'Private RoadOps domain schema. Never expose through Supabase Data API.';

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'roadops_api') then
    create role roadops_api nologin inherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'roadops_sync') then
    create role roadops_sync nologin inherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'roadops_reporting') then
    create role roadops_reporting nologin inherit;
  end if;
end
$roles$;

alter role roadops_api inherit;
alter role roadops_sync inherit;
alter role roadops_reporting inherit;

revoke all on schema roadops from public;
do $optional_supabase_roles$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on schema roadops from %I', role_name);
    end if;
  end loop;
end
$optional_supabase_roles$;

create or replace function roadops.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  new.updated_at := clock_timestamp();
  return new;
end
$function$;

create or replace function roadops.forbid_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception using
    errcode = '55000',
    message = format('%I.%I is append-only', tg_table_schema, tg_table_name);
end
$function$;

create or replace function roadops.assert_sync_writer()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if not pg_has_role(current_user, 'roadops_sync', 'member') then
    raise exception using
      errcode = '42501',
      message = format('%I.%I may only be changed by roadops_sync',
                       tg_table_schema, tg_table_name);
  end if;
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = format('%I.%I uses effective-dated retirement; DELETE is forbidden',
                       tg_table_schema, tg_table_name);
  end if;
  return new;
end
$function$;

create or replace function roadops.current_actor_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $function$
  select nullif(current_setting('roadops.actor_id', true), '')::uuid
$function$;

create or replace function roadops.current_session_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $function$
  select nullif(current_setting('roadops.session_id', true), '')::uuid
$function$;

create or replace function roadops.current_request_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $function$
  select nullif(current_setting('roadops.request_id', true), '')::uuid
$function$;

revoke all on function roadops.set_updated_at() from public;
revoke all on function roadops.forbid_mutation() from public;
revoke all on function roadops.assert_sync_writer() from public;
revoke all on function roadops.current_actor_id() from public;
revoke all on function roadops.current_session_id() from public;
revoke all on function roadops.current_request_id() from public;

commit;
