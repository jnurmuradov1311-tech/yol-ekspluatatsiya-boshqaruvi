-- LOCAL DEVELOPMENT ONLY. Never apply to a shared, staging, or production database.
begin;

set local role roadops_sync;

insert into roadops.source_systems (id, code, name, system_kind, enabled) values
  ('10000000-0000-0000-0000-000000000001', 'road_repair_dev', 'Yo‘l ta’mirlash punkti (development)', 'road_repair', true),
  ('10000000-0000-0000-0000-000000000002', 'roadvision_dev', 'RoadVision AI (development)', 'roadvision', true)
on conflict (id) do nothing;

insert into roadops.road_divisions (id, source_system_id, external_id) values
  ('11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'DEV-DIV-001')
on conflict (id) do nothing;
insert into roadops.road_division_versions (
  id, division_id, source_version, code, name, valid_from, payload_hash
) values (
  '11000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001',
  'dev-v1', 'DEV-01', 'Development road division', '2026-01-01 00:00:00+05',
  decode(repeat('11', 32), 'hex')
) on conflict (id) do nothing;
insert into roadops.road_division_profile_versions (
  id, division_id, source_version, region_code, address, profile_data,
  valid_from, payload_hash
) values (
  '11000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000001',
  'dev-v1', 'DEV', 'Development only', '{"fixture":true}',
  '2026-01-01 00:00:00+05', decode(repeat('12', 32), 'hex')
) on conflict (id) do nothing;

insert into roadops.roads (id, source_system_id, external_id) values
  ('12000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'DEV-ROAD-001')
on conflict (id) do nothing;
insert into roadops.road_versions (
  id, road_id, division_id, source_version, official_code, name, road_class,
  length_m, valid_from, payload_hash
) values (
  '12000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001', 'dev-v1', 'DEV-R1',
  'Development road', 'local', 10000, '2026-01-01 00:00:00+05',
  decode(repeat('13', 32), 'hex')
) on conflict (id) do nothing;

insert into roadops.road_division_assignments (
  id, source_system_id, external_id, road_id, division_id, source_version,
  chainage_span, valid_from, payload_hash
) values (
  '12000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001', 'DEV-ROAD-ASG-001',
  '12000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001', 'dev-v1',
  numrange(0, 10000, '[)'), '2026-01-01 00:00:00+05',
  decode(repeat('17', 32), 'hex')
) on conflict (id) do nothing;

insert into roadops.road_elements (id, source_system_id, external_id) values
  ('13000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'DEV-ELEMENT-001')
on conflict (id) do nothing;
insert into roadops.road_element_versions (
  id, road_element_id, road_id, source_version, element_type, name,
  chainage_span, valid_from, payload_hash
) values (
  '13000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000001',
  '12000000-0000-0000-0000-000000000001', 'dev-v1', 'carriageway',
  'Development carriageway', numrange(0, 10000, '[)'),
  '2026-01-01 00:00:00+05', decode(repeat('14', 32), 'hex')
) on conflict (id) do nothing;

insert into roadops.workers (id, source_system_id, external_id) values
  ('14000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'DEV-WORKER-001')
on conflict (id) do nothing;
insert into roadops.worker_versions (
  id, worker_id, division_id, source_version, personnel_number, full_name,
  position_name, employment_state, valid_from, payload_hash
) values (
  '14000000-0000-0000-0000-000000000002', '14000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001', 'dev-v1', 'DEV-EMP-001',
  'Development Worker', 'Road worker', 'active', '2026-01-01 00:00:00+05',
  decode(repeat('15', 32), 'hex')
) on conflict (id) do nothing;
insert into roadops.worker_division_assignments (
  id, source_system_id, external_id, worker_id, division_id, source_version,
  job_title, valid_from, payload_hash
) values (
  '14000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000001', 'DEV-WORKER-ASG-001',
  '14000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000001', 'dev-v1',
  'Road worker', '2026-01-01', decode(repeat('18', 32), 'hex')
) on conflict (id) do nothing;
insert into roadops.worker_qualification_versions (
  id, worker_id, source_version, qualification_code, qualification_name,
  valid_from, payload_hash
) values (
  '14000000-0000-0000-0000-000000000003', '14000000-0000-0000-0000-000000000001',
  'dev-v1', 'road_worker', 'Road worker', '2026-01-01 00:00:00+05',
  decode(repeat('16', 32), 'hex')
) on conflict (id) do nothing;

reset role;

insert into roadops.app_users (
  id, email, password_hash, full_name, status, mfa_required, email_verified_at, worker_id
) values
  (
    '15000000-0000-0000-0000-000000000001', 'admin@roadops.local',
    extensions.crypt('RoadOps-Dev-Only-Change-Me!', extensions.gen_salt('bf', 12)),
    'Development Administrator', 'active', false, clock_timestamp(), null
  ),
  (
    '15000000-0000-0000-0000-000000000002', 'inspector@roadops.local',
    extensions.crypt('RoadOps-Dev-Only-Change-Me!', extensions.gen_salt('bf', 12)),
    'Development Inspector', 'active', false, clock_timestamp(), null
  ),
  (
    '15000000-0000-0000-0000-000000000003', 'worker@roadops.local',
    extensions.crypt('RoadOps-Dev-Only-Change-Me!', extensions.gen_salt('bf', 12)),
    'Development Worker', 'active', false, clock_timestamp(),
    '14000000-0000-0000-0000-000000000001'
  )
on conflict (id) do nothing;

insert into roadops.user_role_memberships (id, user_id, role_id, division_id, valid_from)
select '15100000-0000-0000-0000-000000000001',
       '15000000-0000-0000-0000-000000000001', r.id, null,
       '2026-01-01 00:00:00+05'
from roadops.roles r where r.code = 'system_admin'
  and not exists (
    select 1 from roadops.user_role_memberships m
    where m.id = '15100000-0000-0000-0000-000000000001'
  );
insert into roadops.user_role_memberships (id, user_id, role_id, division_id, valid_from)
select '15100000-0000-0000-0000-000000000002',
       '15000000-0000-0000-0000-000000000002', r.id,
       '11000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00+05'
from roadops.roles r where r.code = 'inspector'
  and not exists (
    select 1 from roadops.user_role_memberships m
    where m.id = '15100000-0000-0000-0000-000000000002'
  );
insert into roadops.user_role_memberships (id, user_id, role_id, division_id, valid_from)
select '15100000-0000-0000-0000-000000000003',
       '15000000-0000-0000-0000-000000000003', r.id,
       '11000000-0000-0000-0000-000000000001', '2026-01-01 00:00:00+05'
from roadops.roles r where r.code = 'worker'
  and not exists (
    select 1 from roadops.user_role_memberships m
    where m.id = '15100000-0000-0000-0000-000000000003'
  );

insert into roadops.defect_types (
  id, code, name, measurement_unit, active_from
) values (
  '16000000-0000-0000-0000-000000000001', 'surface.pothole',
  'Development pothole', 'm2', '2026-01-01'
) on conflict (id) do nothing;

set local role roadops_sync;

insert into roadops.import_batches (
  id, import_kind, source_filename, source_sha256, parser_version, state,
  raw_row_count, accepted_row_count, completed_at
) values (
  '17000000-0000-0000-0000-000000000001', 'iqn_document', 'development-iqn-fixture',
  decode(repeat('21', 32), 'hex'), 'fixture-v1', 'accepted', 4, 4, clock_timestamp()
) on conflict (id) do nothing;
insert into roadops.iqn_documents (
  id, import_batch_id, code, title, revision, document_kind, source_sha256,
  effective_from, imported_by
) values (
  '17000000-0000-0000-0000-000000000002', '17000000-0000-0000-0000-000000000001',
  'DEV-IQN-02', 'Development IQN fixture', 'dev-v1', 'iqn_02',
  decode(repeat('21', 32), 'hex'), '2026-01-01',
  '15000000-0000-0000-0000-000000000001'
) on conflict (id) do nothing;
insert into roadops.iqn_sections (
  id, document_id, sequence_number, raw_heading, normalized_heading, source_location
) values (
  '17000000-0000-0000-0000-000000000003', '17000000-0000-0000-0000-000000000002',
  1, 'Development section', 'Development section', '{"fixture":true}'
) on conflict (id) do nothing;
insert into roadops.iqn_work_items (
  id, document_id, section_id, source_sequence, raw_code, normalized_code,
  raw_name, normalized_name, item_kind, source_location
) values (
  '17000000-0000-0000-0000-000000000004', '17000000-0000-0000-0000-000000000002',
  '17000000-0000-0000-0000-000000000003', 1, 'DEV.1', 'DEV.1',
  'Pothole repair fixture', 'Pothole repair fixture', 'task', '{"fixture":true}'
) on conflict (id) do nothing;
insert into roadops.iqn_work_variants (
  id, work_item_id, variant_key, basis_quantity, basis_unit, raw_expression,
  formula_type, interpretation_status, planning_status, reviewed_at, reviewed_by,
  source_location
) values (
  '17000000-0000-0000-0000-000000000005', '17000000-0000-0000-0000-000000000004',
  'base', 1, 'm2', '1 m2 uchun', 'linear', 'approved', 'automatic',
  clock_timestamp(), '15000000-0000-0000-0000-000000000001', '{"fixture":true}'
) on conflict (id) do nothing;
insert into roadops.iqn_resources (
  id, document_id, resource_kind, raw_code, normalized_code, raw_name,
  normalized_name, unit, source_location
) values (
  '17000000-0000-0000-0000-000000000006', '17000000-0000-0000-0000-000000000002',
  'labor', 'road_worker', 'road_worker', 'Road worker', 'Road worker',
  'person_hour', '{"fixture":true}'
) on conflict (id) do nothing;
insert into roadops.iqn_norm_sets (
  id, work_variant_id, norm_set_key, status, effective_from, source_location,
  approved_at, approved_by
) values (
  '17000000-0000-0000-0000-000000000007', '17000000-0000-0000-0000-000000000005',
  'dev-v1', 'approved', '2026-01-01', '{"fixture":true}', clock_timestamp(),
  '15000000-0000-0000-0000-000000000001'
) on conflict (id) do nothing;
insert into roadops.iqn_norm_lines (
  id, norm_set_id, source_line_number, resource_id, quantity_per_basis,
  minutes_per_basis, unit, source_location
) values (
  '17000000-0000-0000-0000-000000000008', '17000000-0000-0000-0000-000000000007',
  1, '17000000-0000-0000-0000-000000000006', 0.5, 30,
  'person_hour', '{"fixture":true}'
) on conflict (id) do nothing;

reset role;

insert into roadops.defect_work_variant_crosswalks (
  id, defect_type_id, work_variant_id, measured_to_basis_factor, status,
  effective_from, rationale, created_by, approved_at, approved_by
) values (
  '18000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001',
  '17000000-0000-0000-0000-000000000005', 1, 'approved', '2026-01-01',
  'Development fixture mapping', '15000000-0000-0000-0000-000000000001',
  clock_timestamp(), '15000000-0000-0000-0000-000000000002'
) on conflict (id) do nothing;

commit;
