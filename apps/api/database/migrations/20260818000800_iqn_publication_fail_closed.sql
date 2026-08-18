begin;

-- Paragraph/text and table blocks are first-class IQN source records. A batch
-- must not be called completely reviewed while only its table rows have a
-- decision, so blocks use the same explicit decision lifecycle as rows.
alter table roadops.iqn_staged_blocks
  add column review_state text not null default 'pending'
    check (review_state in ('pending', 'accepted', 'rejected')),
  add column canonical_payload jsonb,
  add column review_note text,
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references roadops.app_users(id) on delete restrict,
  add constraint iqn_staged_blocks_review_ck check (
    (review_state = 'pending' and reviewed_at is null and reviewed_by is null
      and canonical_payload is null and review_note is null)
    or (review_state = 'accepted' and reviewed_at is not null and reviewed_by is not null
      and canonical_payload is not null and jsonb_typeof(canonical_payload) = 'object'
      and coalesce(btrim(review_note), '') <> '')
    or (review_state = 'rejected' and reviewed_at is not null and reviewed_by is not null
      and canonical_payload is null and coalesce(btrim(review_note), '') <> '')
  );

create index iqn_staged_blocks_review_idx
  on roadops.iqn_staged_blocks (import_batch_id, review_state, block_sequence);
create index iqn_staged_blocks_reviewed_by_idx
  on roadops.iqn_staged_blocks (reviewed_by)
  where reviewed_by is not null;
create index iqn_staged_rows_reviewed_by_idx
  on roadops.iqn_staged_rows (reviewed_by)
  where reviewed_by is not null;

-- The validated review row is the approval. It can only be created through an
-- authenticated API transaction. The later console publisher consumes that
-- exact persisted row and never accepts reviewer identity or manifest content
-- from command-line arguments.
alter table roadops.iqn_import_reviews
  add column reviewer_attestation jsonb not null
    check (jsonb_typeof(reviewer_attestation) = 'object'),
  add column reviewer_confirmed_at timestamptz not null,
  add column approval_expires_at timestamptz not null,
  add column reviewer_session_id uuid not null
    references roadops.auth_sessions(id) on delete restrict,
  add column approval_request_id uuid not null,
  add column approved_source_sha256 bytea not null
    check (octet_length(approved_source_sha256) = 32),
  add column canonical_manifest_hash bytea not null
    check (octet_length(canonical_manifest_hash) = 32),
  add column publication_channel text,
  add column publisher_db_role text;

alter table roadops.iqn_import_reviews
  drop constraint iqn_import_reviews_publish_ck;
alter table roadops.iqn_import_reviews
  add constraint iqn_import_reviews_publish_ck check ((
    reviewer_attestation ?& array[
      'attestation_id', 'canonical_manifest_sha256', 'confirmation',
      'confirmed_at', 'expires_at', 'import_batch_id', 'reviewed_by',
      'source_sha256'
    ]::text[]
    and (
      reviewer_attestation - array[
        'attestation_id', 'canonical_manifest_sha256', 'confirmation',
        'confirmed_at', 'expires_at', 'import_batch_id', 'reviewed_by',
        'source_sha256'
      ]::text[]
    ) = '{}'::jsonb
    and id::text = (reviewer_attestation ->> 'attestation_id')
    and reviewed_by::text = (reviewer_attestation ->> 'reviewed_by')
    and import_batch_id::text = (reviewer_attestation ->> 'import_batch_id')
    and encode(approved_source_sha256, 'hex') = (reviewer_attestation ->> 'source_sha256')
    and encode(canonical_manifest_hash, 'hex')
      = (reviewer_attestation ->> 'canonical_manifest_sha256')
    and review_manifest_hash = canonical_manifest_hash
    and (reviewer_attestation ->> 'confirmation') = 'IQN_CATALOG_REVIEW_APPROVED'
    and reviewer_confirmed_at = (reviewer_attestation ->> 'confirmed_at')::timestamptz
    and approval_expires_at = (reviewer_attestation ->> 'expires_at')::timestamptz
    and (review_manifest -> 'reviewer_attestation') = reviewer_attestation
    and reviewer_confirmed_at <= reviewed_at
    and approval_expires_at > reviewer_confirmed_at
    and (
      (review_state = 'validated' and published_document_id is null and published_at is null
        and publication_channel is null and publisher_db_role is null)
      or (review_state = 'published' and published_document_id is not null
        and published_at is not null and published_at <= approval_expires_at
        and publication_channel = 'roadops:iqn-publish'
        and coalesce(btrim(publisher_db_role), '') <> '')
    )
  ) is true);

create unique index iqn_import_reviews_attestation_uk
  on roadops.iqn_import_reviews ((reviewer_attestation ->> 'attestation_id'));
create index iqn_import_reviews_reviewer_session_idx
  on roadops.iqn_import_reviews (reviewer_session_id);
create index iqn_import_reviews_reviewed_by_idx
  on roadops.iqn_import_reviews (reviewed_by);

-- The sync credential is a publisher, never an approver. Remove the broad
-- mutation rights from the original staging migration and grant only the five
-- columns needed to consume a validated approval.
revoke insert, delete, update on roadops.iqn_import_reviews from roadops_sync;
grant update (
  review_state, published_document_id, published_at,
  publication_channel, publisher_db_role
) on roadops.iqn_import_reviews to roadops_sync;

create or replace function roadops.guard_iqn_review_publication()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.review_state <> 'validated' or new.review_state <> 'published' then
    raise exception using
      errcode = '55000',
      message = 'IQN approval permits exactly one validated-to-published transition';
  end if;
  if (
    to_jsonb(new) - array[
      'review_state', 'published_document_id', 'published_at',
      'publication_channel', 'publisher_db_role'
    ]::text[]
  ) is distinct from (
    to_jsonb(old) - array[
      'review_state', 'published_document_id', 'published_at',
      'publication_channel', 'publisher_db_role'
    ]::text[]
  ) then
    raise exception using
      errcode = '55000',
      message = 'IQN approval identity, source, manifest, session, and request are immutable';
  end if;
  if old.published_document_id is not null or old.published_at is not null
     or old.publication_channel is not null or old.publisher_db_role is not null
     or new.published_document_id is null or new.published_at is null
     or new.publication_channel is distinct from 'roadops:iqn-publish'
     or new.publisher_db_role is distinct from session_user::text
     or new.published_at > clock_timestamp() + interval '5 seconds'
     or new.published_at < clock_timestamp() - interval '5 minutes'
     or new.published_at > old.approval_expires_at then
    raise exception using
      errcode = '55000',
      message = 'IQN publication provenance or approval timing is invalid';
  end if;
  if not exists (
    select 1
    from roadops.iqn_documents document
    where document.id = new.published_document_id
      and document.import_batch_id = old.import_batch_id
      and document.document_kind = old.document_kind
      and document.source_sha256 = old.approved_source_sha256
  ) then
    raise exception using
      errcode = '55000',
      message = 'Published IQN document does not match the approved batch and source';
  end if;

  return new;
end
$function$;

create trigger iqn_import_reviews_publish_guard
before update on roadops.iqn_import_reviews
for each row execute function roadops.guard_iqn_review_publication();

revoke all on function roadops.guard_iqn_review_publication() from public;

-- Only a truly global catalog expert can read staged evidence and create the
-- validated approval. Division-scoped catalog.manage/system.all grants do not
-- satisfy has_permission(..., null). Publication columns are deliberately not
-- insertable by the API role.
grant select (import_batch_id, block_sequence, provenance_hash, ambiguity_flags)
  on roadops.iqn_staged_blocks to roadops_api;
grant select (import_batch_id, table_index, row_index, provenance_hash, ambiguity_flags)
  on roadops.iqn_staged_rows to roadops_api;
grant insert (
  id, import_batch_id, document_kind, review_manifest, review_manifest_hash,
  review_state, reviewed_by, reviewer_attestation, reviewer_confirmed_at,
  approval_expires_at, reviewer_session_id, approval_request_id,
  approved_source_sha256, canonical_manifest_hash
) on roadops.iqn_import_reviews to roadops_api;

create policy iqn_staged_blocks_api_global_review
on roadops.iqn_staged_blocks for select to roadops_api
using (roadops.has_permission('catalog.manage', null));

create policy iqn_staged_rows_api_global_review
on roadops.iqn_staged_rows for select to roadops_api
using (roadops.has_permission('catalog.manage', null));

create policy iqn_import_reviews_api_global_approve
on roadops.iqn_import_reviews for insert to roadops_api
with check (
  roadops.has_permission('catalog.manage', null)
  and roadops.current_actor_id() is not null
  and roadops.current_session_id() is not null
  and roadops.current_request_id() is not null
  and reviewed_by = roadops.current_actor_id()
  and reviewer_session_id = roadops.current_session_id()
  and approval_request_id = roadops.current_request_id()
  and exists (
    select 1
    from roadops.auth_sessions authenticated_session
    join roadops.app_users authenticated_reviewer
      on authenticated_reviewer.id = authenticated_session.user_id
    where authenticated_session.id = reviewer_session_id
      and authenticated_session.user_id = reviewed_by
      and authenticated_session.revoked_at is null
      and authenticated_session.expires_at > clock_timestamp()
      and authenticated_session.absolute_expires_at > clock_timestamp()
      and authenticated_reviewer.status = 'active'
  )
  and review_state = 'validated'
  and published_document_id is null
  and published_at is null
  and publication_channel is null
  and publisher_db_role is null
  and approval_expires_at = reviewer_confirmed_at + interval '24 hours'
  and reviewer_confirmed_at <= clock_timestamp()
  and reviewer_confirmed_at > clock_timestamp() - interval '5 minutes'
  and id::text = (reviewer_attestation ->> 'attestation_id')
  and reviewed_by::text = (reviewer_attestation ->> 'reviewed_by')
  and import_batch_id::text = (reviewer_attestation ->> 'import_batch_id')
  and encode(approved_source_sha256, 'hex') = (reviewer_attestation ->> 'source_sha256')
  and encode(canonical_manifest_hash, 'hex')
    = (reviewer_attestation ->> 'canonical_manifest_sha256')
  and (reviewer_attestation ->> 'confirmation') = 'IQN_CATALOG_REVIEW_APPROVED'
  and reviewer_confirmed_at = (reviewer_attestation ->> 'confirmed_at')::timestamptz
  and approval_expires_at = (reviewer_attestation ->> 'expires_at')::timestamptz
  and exists (
    select 1
    from roadops.import_batches batch
    where batch.id = iqn_import_reviews.import_batch_id
      and batch.import_kind = 'iqn_document'
      and batch.state in ('parsed', 'validated')
      and batch.completed_at is not null
      and batch.source_sha256 = iqn_import_reviews.approved_source_sha256
      and (
        (iqn_import_reviews.document_kind = 'iqn_02'
          and batch.parser_version like 'iqn02-ooxml-%'
          and batch.source_sha256 = decode(
            '443c90d65d7c1ab1f08e0365360e3547295ca6a967d57ef51df6e6af04dc8177',
            'hex'
          ))
        or (iqn_import_reviews.document_kind = 'iqn_03'
          and batch.parser_version like 'iqn03-layout-json-%'
          and batch.source_sha256 = decode(
            'f2c40f1d7365139ece6618be4f767dba546aab7685439d9f524e1a2cb3ae3b1e',
            'hex'
          ))
      )
  )
  and exists (
    select 1 from roadops.iqn_staged_blocks block
    where block.import_batch_id = iqn_import_reviews.import_batch_id
  )
  and exists (
    select 1 from roadops.iqn_staged_rows row_source
    where row_source.import_batch_id = iqn_import_reviews.import_batch_id
  )
  and not exists (
    select 1 from roadops.import_issues issue
    where issue.import_batch_id = iqn_import_reviews.import_batch_id
      and issue.issue_level = 'error'
      and issue.resolution_state = 'open'
  )
);

-- The sync publisher may prove only global catalog authority and validity; it
-- receives no credential, MFA, e-mail, or unrelated user-profile columns.
grant select (user_id, role_id, division_id, valid_from, valid_until)
  on roadops.user_role_memberships to roadops_sync;
grant select (role_id, permission_id)
  on roadops.role_permissions to roadops_sync;
grant select (id, code)
  on roadops.permissions to roadops_sync;

-- IQN review tables were created after the original audit-trigger loop. Bind
-- approval and publication transitions into the same tamper-evident chain.
create trigger iqn_import_reviews_audit
after insert or update or delete on roadops.iqn_import_reviews
for each row execute function roadops.capture_row_audit('iqn_import_reviews');

comment on column roadops.iqn_import_reviews.reviewer_attestation is
  'Server-created hash binding of the authenticated expert, exact batch/source, and canonical review manifest.';
comment on column roadops.iqn_import_reviews.reviewer_session_id is
  'Authenticated application session that created the validated IQN approval.';
comment on column roadops.iqn_import_reviews.publisher_db_role is
  'Database session principal that consumed the persisted approval; distinct from reviewed_by.';

commit;
