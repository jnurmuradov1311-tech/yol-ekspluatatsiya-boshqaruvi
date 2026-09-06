-- Requires fixtures/test.sql. All test identities and stock roll back.
begin;

do $calendar_and_source$
begin
  if ('2027-01-31'::date + make_interval(months => 1))::date <> '2027-02-28'::date
     or ('2028-01-31'::date + make_interval(months => 1))::date <> '2028-02-29'::date
     or ('2028-02-29'::date + make_interval(months => 12))::date <> '2029-02-28'::date then
    raise exception 'Equipment expiry is not using calendar months';
  end if;
  if not exists (select 1 from roadops.worker_equipment_norms
                 where code = 'iqn03-t3-r18' and service_months = 24
                   and allocation_scope = 'department_pool' and department_quantity = 4)
     or (select service_months from roadops.worker_equipment_norms where code = 'iqn03-t3-r4') <> 6
     or (select service_months from roadops.worker_equipment_norms where code = 'iqn03-t3-r2') <> 1 then
    raise exception 'IQN03 source transcription changed';
  end if;
  if has_table_privilege('roadops_api', 'roadops.worker_equipment_issues', 'INSERT')
     or has_table_privilege('roadops_api', 'roadops.worker_equipment_norms', 'UPDATE') then
    raise exception 'API can bypass equipment issue or normative guards';
  end if;
end
$calendar_and_source$;

set local role roadops_sync;
insert into roadops.worker_division_assignments
  (source_system_id, external_id, worker_id, division_id, source_version, valid_from, payload_hash, job_title)
values ('90000000-0000-0000-0000-000000000001', 'PPE-TEST-WORKER',
        '93000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001',
        'v1', '2026-01-01', decode(repeat('cd', 32), 'hex'), 'Yo‘l ishchisi');
insert into roadops.import_batches
  (id, import_kind, source_filename, source_sha256, parser_version, state, completed_at)
values ('96060000-0000-0000-0000-000000000001', 'iqn_document', 'IQN03-PPE-TEST.pdf',
        decode('f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e', 'hex'),
        'iqn03-layout-json-ppe-test', 'accepted', clock_timestamp());
insert into roadops.iqn_documents
  (id, import_batch_id, code, title, revision, document_kind, source_sha256, effective_from)
values ('96060000-0000-0000-0000-000000000002', '96060000-0000-0000-0000-000000000001',
        'IQN03-PPE-TEST', 'PPE source test', 'test', 'iqn_03',
        decode('f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e', 'hex'), '2026-01-01');
reset role;

insert into roadops.stock_locations (id, division_id, code, name)
values ('96060000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000001', 'PPE-TEST', 'PPE test stock');
insert into roadops.inventory_transactions
  (stock_location_id, material_id, transaction_kind, quantity_delta, occurred_at, reference_type, recorded_by)
select '96060000-0000-0000-0000-000000000003', id, 'opening', 5, clock_timestamp(), 'test',
       '94000000-0000-0000-0000-000000000001'
from roadops.materials where code = 'PPE-IQN03-T3-R4';
select roadops.complete_login('94000000-0000-0000-0000-000000000001', repeat('f1', 32), repeat('f2', 32),
                             clock_timestamp() + interval '1 hour', clock_timestamp() + interval '1 day');
select set_config('roadops.actor_id', '94000000-0000-0000-0000-000000000001', true);
select set_config('roadops.session_id', (select id::text from roadops.auth_sessions
                                        where token_hash = decode(repeat('f1', 32), 'hex')), true);
select set_config('roadops.request_id', '96060000-0000-0000-0000-000000000004', true);

set local role roadops_api;
do $source_publication_required$
begin
  perform roadops.issue_worker_equipment('93000000-0000-0000-0000-000000000001',
    '96060000-0000-0000-0000-000000000003',
    (select id from roadops.materials where code = 'PPE-IQN03-T3-R4'),
    '2026-01-31', 1, 'yol_ishchisi');
  raise exception 'Unreviewed document was accepted for employee issuance';
exception when check_violation then
  if sqlerrm <> 'EQUIPMENT_IQN03_PUBLICATION_REQUIRED' then raise; end if;
end
$source_publication_required$;
reset role;

-- Trusted test fixture for an already approved source; production API cannot
-- insert publication columns. The real validated-to-published guard runs.
with attestation as (
  select clock_timestamp() confirmed, clock_timestamp() + interval '24 hours' expires
), payload as (
  select confirmed, expires, jsonb_build_object(
    'attestation_id', '96060000-0000-0000-0000-000000000005',
    'canonical_manifest_sha256', repeat('ab', 32), 'confirmation', 'IQN_CATALOG_REVIEW_APPROVED',
    'confirmed_at', confirmed, 'expires_at', expires,
    'import_batch_id', '96060000-0000-0000-0000-000000000001',
    'reviewed_by', '94000000-0000-0000-0000-000000000001',
    'source_sha256', 'f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e'
  ) body from attestation
)
insert into roadops.iqn_import_reviews
  (id, import_batch_id, document_kind, review_manifest, review_manifest_hash, review_state,
   reviewed_by, reviewer_attestation, reviewer_confirmed_at, approval_expires_at,
   reviewer_session_id, approval_request_id, approved_source_sha256, canonical_manifest_hash)
select '96060000-0000-0000-0000-000000000005', '96060000-0000-0000-0000-000000000001',
       'iqn_03', jsonb_build_object('reviewer_attestation', body), decode(repeat('ab', 32), 'hex'),
       'validated', '94000000-0000-0000-0000-000000000001', body, confirmed, expires,
       roadops.current_session_id(), roadops.current_request_id(),
       decode('f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e', 'hex'),
       decode(repeat('ab', 32), 'hex') from payload;
set local role roadops_sync;
update roadops.iqn_import_reviews set review_state = 'published',
  published_document_id = '96060000-0000-0000-0000-000000000002', published_at = clock_timestamp(),
  publication_channel = 'roadops:iqn-publish', publisher_db_role = session_user::text
where id = '96060000-0000-0000-0000-000000000005';
reset role;

set local role roadops_api;
do $issue_guardrails$
declare picked_material_id uuid; issued_id uuid;
begin
  select id into picked_material_id from roadops.materials where code = 'PPE-IQN03-T3-R4';
  begin
    perform roadops.issue_worker_equipment('93000000-0000-0000-0000-000000000001',
      '96060000-0000-0000-0000-000000000003', picked_material_id, '2026-01-31', 6, 'yol_ishchisi');
    raise exception 'Equipment issue overdrew stock';
  exception when check_violation then
    if sqlerrm <> 'EQUIPMENT_STOCK_INSUFFICIENT' then raise; end if;
  end;
  begin
    perform roadops.issue_worker_equipment('93000000-0000-0000-0000-000000000001',
      '96060000-0000-0000-0000-000000000003', picked_material_id, '2026-01-31', 1, 'ytb_boshligi');
    raise exception 'Equipment was issued using an eligible but falsified worker occupation';
  exception when check_violation then
    if sqlerrm <> 'EQUIPMENT_OCCUPATION_MISMATCH' then raise; end if;
  end;
  issued_id := roadops.issue_worker_equipment('93000000-0000-0000-0000-000000000001',
    '96060000-0000-0000-0000-000000000003', picked_material_id, '2026-01-31', 1, 'yol_ishchisi');
  if not exists (select 1 from roadops.worker_equipment_issues i
                 where i.id = issued_id and i.expires_on = '2026-07-31'
                   and i.service_months = 6 and i.issued_by = roadops.current_actor_id()) then
    raise exception 'Equipment card did not persist the exact source-derived expiry';
  end if;
  if (select on_hand_quantity from roadops.current_stock_balances b
      where b.stock_location_id = '96060000-0000-0000-0000-000000000003'
        and b.material_id = picked_material_id) <> 4 then
    raise exception 'Employee issue did not decrement warehouse stock atomically';
  end if;
end
$issue_guardrails$;
reset role;

do $audit_and_immutability$
begin
  if not exists (select 1 from roadops.audit_events where entity_type = 'worker_equipment_issues') then
    raise exception 'Employee issue has no audit record';
  end if;
  begin
    update roadops.worker_equipment_issues set service_months = 99;
    raise exception 'Employee issue source snapshot was mutable';
  exception when sqlstate '55000' then null;
  end;
  begin
    insert into roadops.inventory_transactions
      (stock_location_id, material_id, transaction_kind, quantity_delta, occurred_at, reference_type, recorded_by)
    select '96060000-0000-0000-0000-000000000003', id, 'issue', -5, clock_timestamp(), 'test-overdraft',
           '94000000-0000-0000-0000-000000000001' from roadops.materials where code = 'PPE-IQN03-T3-R4';
    set constraints all immediate;
    raise exception 'Direct inventory write bypassed stock availability';
  exception when check_violation then null;
  end;
end
$audit_and_immutability$;

select set_config('roadops.actor_id', '', true);
set local role roadops_api;
do $permission_required$
begin
  perform roadops.issue_worker_equipment('93000000-0000-0000-0000-000000000001',
    '96060000-0000-0000-0000-000000000003', '96060000-0000-0000-0000-000000000099',
    '2026-01-31', 1, 'yol_ishchisi');
  raise exception 'Equipment issue allowed an unauthenticated actor';
exception when insufficient_privilege then null;
end
$permission_required$;
reset role;
rollback;
