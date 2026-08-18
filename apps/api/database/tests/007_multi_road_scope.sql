-- Run after migrations and test fixtures.
begin;

do $test$
begin
  if to_regprocedure('roadops.primary_road_invariant()') is not null
     or to_regprocedure('roadops.lock_primary_road_invariant()') is not null then
    raise exception 'Obsolete single-road invariant helpers are still exposed';
  end if;
end
$test$;

insert into roadops.roads (id, source_system_id, external_id) values
  (
    '97000000-0000-0000-0000-000000000001',
    '90000000-0000-0000-0000-000000000001',
    'MULTI-ROAD-ONE'
  ),
  (
    '97000000-0000-0000-0000-000000000003',
    '90000000-0000-0000-0000-000000000001',
    'MULTI-ROAD-TWO'
  );

insert into roadops.road_versions (
  id, road_id, source_version, official_code, name, length_m,
  valid_from, payload_hash
) values
  (
    '97000000-0000-0000-0000-000000000002',
    '97000000-0000-0000-0000-000000000001',
    'multi-road-v1', 'A001', 'First scoped road', 12500.250,
    '2026-01-01 00:00:00+05', decode(repeat('97', 32), 'hex')
  ),
  (
    '97000000-0000-0000-0000-000000000004',
    '97000000-0000-0000-0000-000000000003',
    'multi-road-v1', 'M39', 'Second scoped road', 214750.875,
    '2026-01-01 00:00:00+05', decode(repeat('98', 32), 'hex')
  );

do $test$
declare
  road_count bigint;
begin
  select count(*) into road_count
  from roadops.road_versions
  where road_id in (
    '97000000-0000-0000-0000-000000000001',
    '97000000-0000-0000-0000-000000000003'
  );
  if road_count <> 2 then
    raise exception 'Multiple source-owned roads were not accepted together';
  end if;
end
$test$;

set local role roadops_api;

do $test$
declare
  visible_count bigint;
begin
  select count(*) into visible_count
  from roadops.roads
  where id in (
    '97000000-0000-0000-0000-000000000001',
    '97000000-0000-0000-0000-000000000003'
  );
  if visible_count <> 0 then
    raise exception 'Unassigned roads unexpectedly bypassed API row-unit RLS';
  end if;
end
$test$;

rollback;
