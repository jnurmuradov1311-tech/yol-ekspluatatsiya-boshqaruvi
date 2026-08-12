-- Run after migrations and test fixtures.
begin;

insert into roadops.roads (id, source_system_id, external_id) values (
  '97000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001',
  'D001-TEST'
);
insert into roadops.road_versions (
  id, road_id, source_version, official_code, name, length_m,
  valid_from, payload_hash
) values (
  '97000000-0000-0000-0000-000000000002',
  '97000000-0000-0000-0000-000000000001',
  'd001-v1', 'D001', 'D001 test road', 67000,
  '2026-01-01 00:00:00+05', decode(repeat('97', 32), 'hex')
);

set local role roadops_api;

do $test$
declare
  direct_count bigint;
  invariant record;
begin
  select count(*) into direct_count
  from roadops.roads where id = '97000000-0000-0000-0000-000000000001';
  if direct_count <> 0 then
    raise exception 'Unassigned D001 unexpectedly bypassed API row-level security';
  end if;

  select * into invariant from roadops.lock_primary_road_invariant();
  if invariant.candidate_count <> 1 or invariant.exact_count <> 1 then
    raise exception 'Exact D001 invariant did not bypass row-unit RLS safely';
  end if;
end
$test$;

reset role;

insert into roadops.roads (id, source_system_id, external_id) values (
  '97000000-0000-0000-0000-000000000003',
  '90000000-0000-0000-0000-000000000001',
  'D001-CONFLICT-TEST'
);
insert into roadops.road_versions (
  id, road_id, source_version, official_code, name, length_m,
  valid_from, payload_hash
) values (
  '97000000-0000-0000-0000-000000000004',
  '97000000-0000-0000-0000-000000000003',
  'd001-conflict-v1', 'd001', 'Conflicting road', 67000.500,
  '2026-01-01 00:00:00+05', decode(repeat('98', 32), 'hex')
);

set local role roadops_api;

do $test$
declare
  invariant record;
begin
  select * into invariant from roadops.primary_road_invariant();
  if invariant.candidate_count <> 2 or invariant.exact_count <> 1 then
    raise exception 'Case or decimal-length conflict was not detected';
  end if;
end
$test$;

rollback;
