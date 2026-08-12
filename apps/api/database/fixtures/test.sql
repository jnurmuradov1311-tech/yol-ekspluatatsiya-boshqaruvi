-- ISOLATED TEST DATABASE ONLY. Deterministic IDs are part of the SQL test contract.
begin;

set local role roadops_sync;
insert into roadops.source_systems (id, code, name, system_kind, enabled) values
  ('90000000-0000-0000-0000-000000000001', 'road_repair_test', 'Road repair test source', 'road_repair', true)
on conflict (id) do nothing;
insert into roadops.road_divisions (id, source_system_id, external_id) values
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'TEST-DIV')
on conflict (id) do nothing;
insert into roadops.road_division_versions (
  id, division_id, source_version, code, name, valid_from, payload_hash
) values (
  '91000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001',
  'test-v1', 'TEST', 'Test division', '2026-01-01 00:00:00+05', decode(repeat('91', 32), 'hex')
) on conflict (id) do nothing;
insert into roadops.roads (id, source_system_id, external_id) values
  ('92000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'TEST-ROAD')
on conflict (id) do nothing;
insert into roadops.road_versions (
  id, road_id, division_id, source_version, official_code, name, length_m,
  valid_from, payload_hash
) values (
  '92000000-0000-0000-0000-000000000002', '92000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001', 'test-v1', 'T-1', 'Test road', 1000,
  '2026-01-01 00:00:00+05', decode(repeat('92', 32), 'hex')
) on conflict (id) do nothing;
insert into roadops.workers (id, source_system_id, external_id) values
  ('93000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'TEST-WORKER')
on conflict (id) do nothing;
insert into roadops.worker_versions (
  id, worker_id, division_id, source_version, personnel_number, full_name,
  employment_state, valid_from, payload_hash
) values (
  '93000000-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001', 'test-v1', 'T-EMP-1', 'Test Worker',
  'active', '2026-01-01 00:00:00+05', decode(repeat('93', 32), 'hex')
) on conflict (id) do nothing;
reset role;

insert into roadops.app_users (
  id, email, password_hash, full_name, status, mfa_required, email_verified_at
) values (
  '94000000-0000-0000-0000-000000000001', 'admin@test.invalid',
  extensions.crypt('test-only-password', extensions.gen_salt('bf', 4)),
  'Test Administrator', 'active', false, clock_timestamp()
) on conflict (id) do nothing;
insert into roadops.user_role_memberships (id, user_id, role_id, valid_from)
select '94000000-0000-0000-0000-000000000002',
       '94000000-0000-0000-0000-000000000001', r.id,
       '2026-01-01 00:00:00+05'
from roadops.roles r where r.code = 'system_admin'
  and not exists (
    select 1 from roadops.user_role_memberships m
    where m.id = '94000000-0000-0000-0000-000000000002'
  );

commit;
