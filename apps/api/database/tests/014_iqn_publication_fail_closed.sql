-- Requires fixtures/test.sql. Proves that IQN approval is global-only and is
-- bound to the authenticated actor/session/request before sync publication.
begin;

insert into roadops.app_users (
  id, email, password_hash, full_name, status, mfa_required, email_verified_at
) values (
  '95000000-0000-0000-0000-000000000001',
  'scoped-iqn-reviewer@test.invalid',
  extensions.crypt('test-only-password', extensions.gen_salt('bf', 4)),
  'Scoped IQN Reviewer', 'active', false, clock_timestamp()
);

insert into roadops.user_role_memberships (
  id, user_id, role_id, division_id, valid_from
)
select
  '95000000-0000-0000-0000-000000000002',
  '95000000-0000-0000-0000-000000000001',
  role.id,
  '91000000-0000-0000-0000-000000000001',
  '2026-01-01 00:00:00+05'
from roadops.roles role
where role.code = 'system_admin';

select roadops.complete_login(
  '94000000-0000-0000-0000-000000000001',
  repeat('c1', 32), repeat('c2', 32),
  clock_timestamp() + interval '1 hour',
  clock_timestamp() + interval '1 day'
);
select roadops.complete_login(
  '95000000-0000-0000-0000-000000000001',
  repeat('d1', 32), repeat('d2', 32),
  clock_timestamp() + interval '1 hour',
  clock_timestamp() + interval '1 day'
);

set local role roadops_sync;
insert into roadops.import_batches (
  id, import_kind, source_filename, source_sha256, parser_version,
  state, raw_row_count, completed_at
) values (
  '95000000-0000-0000-0000-000000000010', 'iqn_document',
  'IQN-02-24-security-test.docx',
  decode('443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177', 'hex'),
  'iqn02-ooxml-security-test', 'parsed', 1, clock_timestamp() - interval '1 hour'
);
insert into roadops.iqn_staged_blocks (
  import_batch_id, block_sequence, block_kind, source_index,
  structure, provenance_hash, ambiguity_flags
) values (
  '95000000-0000-0000-0000-000000000010', 1, 'table', 1,
  '{}'::jsonb, decode(repeat('cc', 32), 'hex'), '[]'::jsonb
);
insert into roadops.iqn_staged_rows (
  import_batch_id, block_sequence, table_index, row_index,
  physical_cell_count, logical_column_count, row_payload,
  provenance_hash, ambiguity_flags
) values (
  '95000000-0000-0000-0000-000000000010', 1, 1, 1,
  1, 1, '{}'::jsonb, decode(repeat('aa', 32), 'hex'), '[]'::jsonb
);
reset role;

set local role roadops_api;
select set_config(
  'roadops.actor_id', '95000000-0000-0000-0000-000000000001', true
);
select set_config(
  'roadops.session_id', (
    select session.id::text from roadops.auth_sessions session
    where session.token_hash = decode(repeat('d1', 32), 'hex')
  ), true
);
select set_config(
  'roadops.request_id', '95000000-0000-0000-0000-000000000020', true
);

do $scoped_reviewer_must_fail$
begin
  insert into roadops.iqn_import_reviews (
    id, import_batch_id, document_kind, review_manifest,
    review_manifest_hash, review_state, reviewed_by,
    reviewer_attestation, reviewer_confirmed_at, approval_expires_at,
    reviewer_session_id, approval_request_id, approved_source_sha256,
    canonical_manifest_hash
  )
  select
    '95000000-0000-0000-0000-000000000021',
    '95000000-0000-0000-0000-000000000010', 'iqn_02',
    jsonb_build_object('reviewer_attestation', jsonb_build_object(
      'attestation_id', '95000000-0000-0000-0000-000000000021',
      'canonical_manifest_sha256', repeat('dd', 32),
      'confirmation', 'IQN_CATALOG_REVIEW_APPROVED',
      'confirmed_at', timing.confirmed_at,
      'expires_at', timing.confirmed_at + interval '24 hours',
      'import_batch_id', '95000000-0000-0000-0000-000000000010',
      'reviewed_by', '95000000-0000-0000-0000-000000000001',
      'source_sha256', '443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177'
    )),
    decode(repeat('dd', 32), 'hex'), 'validated',
    '95000000-0000-0000-0000-000000000001',
    jsonb_build_object(
      'attestation_id', '95000000-0000-0000-0000-000000000021',
      'canonical_manifest_sha256', repeat('dd', 32),
      'confirmation', 'IQN_CATALOG_REVIEW_APPROVED',
      'confirmed_at', timing.confirmed_at,
      'expires_at', timing.confirmed_at + interval '24 hours',
      'import_batch_id', '95000000-0000-0000-0000-000000000010',
      'reviewed_by', '95000000-0000-0000-0000-000000000001',
      'source_sha256', '443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177'
    ),
    timing.confirmed_at, timing.confirmed_at + interval '24 hours',
    roadops.current_session_id(), roadops.current_request_id(),
    decode('443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177', 'hex'),
    decode(repeat('dd', 32), 'hex')
  from (select clock_timestamp() - interval '1 second' confirmed_at) timing;

  raise exception 'Division-scoped system.all created a global IQN approval';
exception
  when insufficient_privilege then null;
end
$scoped_reviewer_must_fail$;

select set_config(
  'roadops.actor_id', '94000000-0000-0000-0000-000000000001', true
);
select set_config(
  'roadops.session_id', (
    select session.id::text from roadops.auth_sessions session
    where session.token_hash = decode(repeat('c1', 32), 'hex')
  ), true
);
select set_config(
  'roadops.request_id', '95000000-0000-0000-0000-000000000030', true
);

do $extra_attestation_key_must_fail$
declare
  confirmed_at timestamptz := clock_timestamp() - interval '1 second';
  attestation jsonb := jsonb_build_object(
    'attestation_id', '95000000-0000-0000-0000-000000000032',
    'canonical_manifest_sha256', repeat('ef', 32),
    'confirmation', 'IQN_CATALOG_REVIEW_APPROVED',
    'confirmed_at', confirmed_at,
    'expires_at', confirmed_at + interval '24 hours',
    'import_batch_id', '95000000-0000-0000-0000-000000000010',
    'reviewed_by', '94000000-0000-0000-0000-000000000001',
    'source_sha256', '443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177',
    'unexpected_key', 'must be rejected'
  );
begin
  insert into roadops.iqn_import_reviews (
    id, import_batch_id, document_kind, review_manifest,
    review_manifest_hash, review_state, reviewed_by,
    reviewer_attestation, reviewer_confirmed_at, approval_expires_at,
    reviewer_session_id, approval_request_id, approved_source_sha256,
    canonical_manifest_hash
  ) values (
    '95000000-0000-0000-0000-000000000032',
    '95000000-0000-0000-0000-000000000010', 'iqn_02',
    jsonb_build_object('reviewer_attestation', attestation),
    decode(repeat('ef', 32), 'hex'), 'validated',
    '94000000-0000-0000-0000-000000000001',
    attestation, confirmed_at, confirmed_at + interval '24 hours',
    roadops.current_session_id(), roadops.current_request_id(),
    decode('443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177', 'hex'),
    decode(repeat('ef', 32), 'hex')
  );

  raise exception 'IQN reviewer attestation accepted an undeclared key';
exception
  when check_violation then null;
end
$extra_attestation_key_must_fail$;

insert into roadops.iqn_import_reviews (
  id, import_batch_id, document_kind, review_manifest,
  review_manifest_hash, review_state, reviewed_by,
  reviewer_attestation, reviewer_confirmed_at, approval_expires_at,
  reviewer_session_id, approval_request_id, approved_source_sha256,
  canonical_manifest_hash
)
select
  '95000000-0000-0000-0000-000000000031',
  '95000000-0000-0000-0000-000000000010', 'iqn_02',
  jsonb_build_object('reviewer_attestation', jsonb_build_object(
    'attestation_id', '95000000-0000-0000-0000-000000000031',
    'canonical_manifest_sha256', repeat('ee', 32),
    'confirmation', 'IQN_CATALOG_REVIEW_APPROVED',
    'confirmed_at', timing.confirmed_at,
    'expires_at', timing.confirmed_at + interval '24 hours',
    'import_batch_id', '95000000-0000-0000-0000-000000000010',
    'reviewed_by', '94000000-0000-0000-0000-000000000001',
    'source_sha256', '443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177'
  )),
  decode(repeat('ee', 32), 'hex'), 'validated',
  '94000000-0000-0000-0000-000000000001',
  jsonb_build_object(
    'attestation_id', '95000000-0000-0000-0000-000000000031',
    'canonical_manifest_sha256', repeat('ee', 32),
    'confirmation', 'IQN_CATALOG_REVIEW_APPROVED',
    'confirmed_at', timing.confirmed_at,
    'expires_at', timing.confirmed_at + interval '24 hours',
    'import_batch_id', '95000000-0000-0000-0000-000000000010',
    'reviewed_by', '94000000-0000-0000-0000-000000000001',
    'source_sha256', '443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177'
  ),
  timing.confirmed_at, timing.confirmed_at + interval '24 hours',
  roadops.current_session_id(), roadops.current_request_id(),
  decode('443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177', 'hex'),
  decode(repeat('ee', 32), 'hex')
from (select clock_timestamp() - interval '1 second' confirmed_at) timing;
reset role;

do $approval_contract$
begin
  if not exists (
    select 1 from roadops.iqn_import_reviews review
    join roadops.auth_sessions session on session.id = review.reviewer_session_id
    where review.id = '95000000-0000-0000-0000-000000000031'
      and review.review_state = 'validated'
      and review.reviewed_by = '94000000-0000-0000-0000-000000000001'
      and session.user_id = review.reviewed_by
      and review.approval_request_id = '95000000-0000-0000-0000-000000000030'
      and encode(review.approved_source_sha256, 'hex')
        = '443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177'
      and review.review_manifest_hash = review.canonical_manifest_hash
  ) then
    raise exception 'Authenticated IQN approval provenance was not persisted';
  end if;

  if has_column_privilege(
    'roadops_api', 'roadops.iqn_import_reviews', 'publisher_db_role', 'INSERT'
  ) then
    raise exception 'API role can forge the IQN publisher database principal';
  end if;

  if has_table_privilege(
    'roadops_sync', 'roadops.iqn_import_reviews', 'INSERT'
  ) or has_table_privilege(
    'roadops_sync', 'roadops.iqn_import_reviews', 'DELETE'
  ) then
    raise exception 'Sync role can create or delete authenticated IQN approvals';
  end if;
  if has_column_privilege(
    'roadops_sync', 'roadops.iqn_import_reviews', 'reviewed_by', 'UPDATE'
  ) or has_column_privilege(
    'roadops_sync', 'roadops.iqn_import_reviews', 'reviewer_attestation', 'UPDATE'
  ) or has_column_privilege(
    'roadops_sync', 'roadops.iqn_import_reviews', 'review_manifest', 'UPDATE'
  ) or has_column_privilege(
    'roadops_sync', 'roadops.iqn_import_reviews', 'canonical_manifest_hash', 'UPDATE'
  ) then
    raise exception 'Sync role can rewrite IQN approval identity or hashes';
  end if;
  if not has_column_privilege(
    'roadops_sync', 'roadops.iqn_import_reviews', 'review_state', 'UPDATE'
  ) or not has_column_privilege(
    'roadops_sync', 'roadops.iqn_import_reviews', 'publisher_db_role', 'UPDATE'
  ) then
    raise exception 'Sync role lost the narrow IQN publication transition grant';
  end if;

  if not exists (
    select 1 from pg_trigger trigger_row
    where trigger_row.tgrelid = 'roadops.iqn_import_reviews'::regclass
      and trigger_row.tgname = 'iqn_import_reviews_audit'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'IQN approval lifecycle is missing its audit trigger';
  end if;
  if not exists (
    select 1 from pg_trigger trigger_row
    where trigger_row.tgrelid = 'roadops.iqn_import_reviews'::regclass
      and trigger_row.tgname = 'iqn_import_reviews_publish_guard'
      and not trigger_row.tgisinternal
  ) then
    raise exception 'IQN approval lifecycle is missing its single-use publication guard';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'roadops'
      and indexname = 'iqn_staged_blocks_reviewed_by_idx'
  ) or not exists (
    select 1 from pg_indexes
    where schemaname = 'roadops'
      and indexname = 'iqn_staged_rows_reviewed_by_idx'
  ) or not exists (
    select 1 from pg_indexes
    where schemaname = 'roadops'
      and indexname = 'iqn_import_reviews_reviewer_session_idx'
  ) or not exists (
    select 1 from pg_indexes
    where schemaname = 'roadops'
      and indexname = 'iqn_import_reviews_reviewed_by_idx'
  ) then
    raise exception 'IQN review foreign-key lookup indexes are incomplete';
  end if;
end
$approval_contract$;

set local role roadops_sync;
insert into roadops.iqn_documents (
  id, import_batch_id, code, title, revision, document_kind,
  source_sha256, effective_from, imported_by, import_manifest
) values (
  '95000000-0000-0000-0000-000000000040',
  '95000000-0000-0000-0000-000000000010',
  'IQN-SECURITY-CONTRACT', 'IQN security contract', 'test', 'iqn_02',
  decode('443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177', 'hex'),
  '2026-01-01', '94000000-0000-0000-0000-000000000001', '{}'::jsonb
);
update roadops.iqn_import_reviews
set review_state = 'published',
    published_document_id = '95000000-0000-0000-0000-000000000040',
    published_at = clock_timestamp(),
    publication_channel = 'roadops:iqn-publish',
    publisher_db_role = session_user::text
where id = '95000000-0000-0000-0000-000000000031';

do $published_approval_is_immutable$
begin
  update roadops.iqn_import_reviews
  set review_state = 'validated', published_document_id = null,
      published_at = null, publication_channel = null, publisher_db_role = null
  where id = '95000000-0000-0000-0000-000000000031';

  raise exception 'Published IQN approval was reverted to validated';
exception
  when sqlstate '55000' then null;
end
$published_approval_is_immutable$;
reset role;

do $published_contract$
begin
  if not exists (
    select 1 from roadops.iqn_import_reviews
    where id = '95000000-0000-0000-0000-000000000031'
      and review_state = 'published'
      and published_document_id = '95000000-0000-0000-0000-000000000040'
      and publication_channel = 'roadops:iqn-publish'
      and publisher_db_role = session_user::text
  ) then
    raise exception 'Sync publisher did not consume the persisted IQN approval';
  end if;

  if (
    select count(*) from roadops.audit_events
    where entity_type = 'iqn_import_reviews'
      and entity_id = '95000000-0000-0000-0000-000000000031'
  ) < 2 then
    raise exception 'IQN approval/publication transitions are not both audited';
  end if;
end
$published_contract$;

rollback;
