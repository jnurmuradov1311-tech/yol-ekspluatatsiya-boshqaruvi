-- Run after migrations and test fixtures.
begin;

set local role roadops_sync;

insert into roadops.road_division_assignments (
  id, source_system_id, external_id, road_id, division_id, source_version,
  chainage_span, valid_from, payload_hash
) values (
  '95000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001', 'TEST-ROAD-ASG',
  '92000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001', 'test-v1',
  numrange(0, 1000, '[)'), '2026-01-01 00:00:00+05',
  decode(repeat('95', 32), 'hex')
);

insert into roadops.worker_division_assignments (
  id, source_system_id, external_id, worker_id, division_id, source_version,
  job_title, valid_from, payload_hash
) values (
  '95000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000001', 'TEST-WORKER-ASG',
  '93000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001', 'test-v1',
  'Road worker', '2026-01-01', decode(repeat('96', 32), 'hex')
);

-- The legacy road_versions.division_id remains A, while authoritative current
-- ownership is split between A and B.  This is the compatibility-projection
-- case that previously leaked/hidden records through whole-road ownership.
insert into roadops.road_divisions (id, source_system_id, external_id) values (
  '91000000-0000-0000-0000-000000000010',
  '90000000-0000-0000-0000-000000000001', 'TEST-DIV-B'
);
insert into roadops.road_division_versions (
  id, division_id, source_version, code, name, valid_from, payload_hash
) values (
  '91000000-0000-0000-0000-000000000011',
  '91000000-0000-0000-0000-000000000010', 'test-v1', 'TEST-B',
  'Test division B', '2026-01-01 00:00:00+05', decode(repeat('99', 32), 'hex')
);
update roadops.road_division_assignments
set valid_until = '2026-02-01 00:00:00+05'
where id = '95000000-0000-0000-0000-000000000001';
insert into roadops.road_division_assignments (
  id, source_system_id, external_id, road_id, division_id, source_version,
  chainage_span, valid_from, payload_hash
) values
  (
    '95000000-0000-0000-0000-000000000020',
    '90000000-0000-0000-0000-000000000001', 'TEST-ROAD-ASG-A-SEGMENT',
    '92000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001', 'test-v2-a',
    numrange(0, 500, '[)'), '2026-02-01 00:00:00+05', decode(repeat('9a', 32), 'hex')
  ),
  (
    '95000000-0000-0000-0000-000000000021',
    '90000000-0000-0000-0000-000000000001', 'TEST-ROAD-ASG-B-SEGMENT',
    '92000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000010', 'test-v2-b',
    numrange(500, 1000, '[)'), '2026-02-01 00:00:00+05', decode(repeat('9b', 32), 'hex')
  );

do $test$
declare
  division_id uuid;
begin
  select roadops.division_for_road_zone(
    '92000000-0000-0000-0000-000000000001', numrange(100, 200, '[)'),
    '2026-08-12 00:00:00+05'
  ) into division_id;
  if division_id is distinct from '91000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'Exact road-zone ownership did not resolve';
  end if;

  select roadops.division_for_worker_assignment(
    '93000000-0000-0000-0000-000000000001', '2026-08-12'
  ) into division_id;
  if division_id is distinct from '91000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'Worker assignment ownership did not resolve';
  end if;

  select roadops.division_for_road_zone(
    '92000000-0000-0000-0000-000000000001', numrange(400, 600, '[)'),
    '2026-08-12 00:00:00+05'
  ) into division_id;
  if division_id is not null then
    raise exception 'A zone crossing two assignment segments was not ambiguous';
  end if;

  select roadops.division_for_road_zone(
    '92000000-0000-0000-0000-000000000001', numrange(600, 700, '[)'),
    '2026-08-12 00:00:00+05'
  ) into division_id;
  if division_id is distinct from '91000000-0000-0000-0000-000000000010'::uuid then
    raise exception 'B segment ownership incorrectly followed the legacy A projection';
  end if;
end
$test$;

insert into roadops.road_elements (
  id, source_system_id, external_id
) values (
  '95000000-0000-0000-0000-000000000010',
  '90000000-0000-0000-0000-000000000001', 'TEST-POINT-ELEMENT'
);
insert into roadops.road_element_versions (
  id, road_element_id, road_id, source_version, element_type,
  chainage_point_m, valid_from, payload_hash
) values (
  '95000000-0000-0000-0000-000000000011',
  '95000000-0000-0000-0000-000000000010',
  '92000000-0000-0000-0000-000000000001', 'point-v1', 'sign',
  250, '2026-01-01 00:00:00+05', decode(repeat('98', 32), 'hex')
);

do $test$
declare
  division_id uuid;
begin
  select roadops.division_for_road_element(
    '95000000-0000-0000-0000-000000000010'
  ) into division_id;
  if division_id is distinct from '91000000-0000-0000-0000-000000000001'::uuid then
    raise exception 'Point road element ownership did not resolve';
  end if;
end
$test$;

do $test$
begin
  begin
    insert into roadops.road_division_assignments (
      source_system_id, external_id, road_id, division_id, source_version,
      chainage_span, valid_from, payload_hash
    ) values (
      '90000000-0000-0000-0000-000000000001', 'TEST-ROAD-ASG-OVERLAP',
      '92000000-0000-0000-0000-000000000001',
      '91000000-0000-0000-0000-000000000001', 'test-v1',
      numrange(500, 900, '[)'), '2026-02-01 00:00:00+05',
      decode(repeat('97', 32), 'hex')
    );
    raise exception 'Overlapping road assignment was accepted';
  exception when exclusion_violation then
    null;
  end;
end
$test$;

insert into roadops.roadvision_batches (
  id, source_system_id, external_batch_id, manifest_hash, state
) values (
  '95000000-0000-0000-0000-000000000030',
  '90000000-0000-0000-0000-000000000001', 'TEST-RV-BATCH',
  decode(repeat('9c', 32), 'hex'), 'imported'
);
insert into roadops.roadvision_candidates (
  id, source_system_id, batch_id, external_candidate_id, source_revision,
  observed_at, payload_hash, road_id, chainage_span, status
) values
  (
    '95000000-0000-0000-0000-000000000031',
    '90000000-0000-0000-0000-000000000001',
    '95000000-0000-0000-0000-000000000030', 'TEST-RV-A', '1',
    '2026-08-12 10:00:00+05', decode(repeat('9d', 32), 'hex'),
    '92000000-0000-0000-0000-000000000001', numrange(100, 110, '[)'), 'unmatched'
  ),
  (
    '95000000-0000-0000-0000-000000000032',
    '90000000-0000-0000-0000-000000000001',
    '95000000-0000-0000-0000-000000000030', 'TEST-RV-B', '1',
    '2026-08-12 10:00:00+05', decode(repeat('9e', 32), 'hex'),
    '92000000-0000-0000-0000-000000000001', numrange(600, 610, '[)'), 'unmatched'
  );

reset role;
insert into roadops.app_users (
  id, email, password_hash, full_name, status, mfa_required, email_verified_at
) values (
  '94000000-0000-0000-0000-000000000010', 'division-b@test.invalid',
  extensions.crypt('test-only-password', extensions.gen_salt('bf', 4)),
  'Division B Inspector', 'active', false, clock_timestamp()
);
insert into roadops.user_role_memberships (
  id, user_id, role_id, division_id, valid_from
)
select '94000000-0000-0000-0000-000000000011',
       '94000000-0000-0000-0000-000000000010', r.id,
       '91000000-0000-0000-0000-000000000010',
       '2026-01-01 00:00:00+05'
from roadops.roles r where r.code = 'inspector';

set local role roadops_api;
select set_config(
  'roadops.actor_id', '94000000-0000-0000-0000-000000000010', true
);

do $test$
declare
  visible_count integer;
begin
  select count(*) into visible_count from roadops.roads
  where id = '92000000-0000-0000-0000-000000000001';
  if visible_count <> 1 then
    raise exception 'B-scoped actor cannot see a road with a current B segment';
  end if;

  select count(*) into visible_count from roadops.road_versions
  where road_id = '92000000-0000-0000-0000-000000000001';
  if visible_count <> 1 then
    raise exception 'B-scoped actor was hidden by legacy road_versions.division_id=A';
  end if;

  select count(*) into visible_count from roadops.road_division_assignments
  where road_id = '92000000-0000-0000-0000-000000000001';
  if visible_count <> 1 then
    raise exception 'Assignment RLS leaked A segments or hid the B segment';
  end if;

  select count(*) into visible_count from roadops.roadvision_candidates;
  if visible_count <> 1 or not exists (
    select 1 from roadops.roadvision_candidates
    where external_candidate_id = 'TEST-RV-B'
  ) then
    raise exception 'RoadVision RLS did not use observed exact-zone ownership';
  end if;

  select count(*) into visible_count from roadops.road_elements
  where id = '95000000-0000-0000-0000-000000000010';
  if visible_count <> 0 then
    raise exception 'Point road element in A leaked to the B-scoped actor';
  end if;
end
$test$;

rollback;
