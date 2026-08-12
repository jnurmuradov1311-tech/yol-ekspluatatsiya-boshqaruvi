begin;

-- Lossless staging is deliberately separate from approved IQN domain entities.
-- These rows preserve the source structure and remain non-operational until an
-- explicit, authenticated review manifest is validated and published.
create table roadops.iqn_staged_blocks (
  id bigint generated always as identity primary key,
  import_batch_id uuid not null references roadops.import_batches(id) on delete restrict,
  block_sequence integer not null check (block_sequence > 0),
  block_kind text not null check (block_kind in ('paragraph', 'table')),
  source_index integer not null check (source_index > 0),
  raw_text text,
  normalized_text text,
  structure jsonb not null default '{}'::jsonb check (jsonb_typeof(structure) = 'object'),
  provenance_hash bytea not null check (octet_length(provenance_hash) = 32),
  ambiguity_flags jsonb not null default '[]'::jsonb
    check (jsonb_typeof(ambiguity_flags) = 'array'),
  constraint iqn_staged_blocks_text_ck check (
    block_kind = 'paragraph' or (raw_text is null and normalized_text is null)
  ),
  unique (import_batch_id, block_sequence),
  unique (import_batch_id, provenance_hash)
);

create table roadops.iqn_staged_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references roadops.import_batches(id) on delete restrict,
  block_sequence integer not null check (block_sequence > 0),
  table_index integer not null check (table_index > 0),
  row_index integer not null check (row_index > 0),
  physical_cell_count integer not null check (physical_cell_count >= 0),
  logical_column_count integer not null check (logical_column_count >= 0),
  row_payload jsonb not null check (jsonb_typeof(row_payload) = 'object'),
  provenance_hash bytea not null check (octet_length(provenance_hash) = 32),
  ambiguity_flags jsonb not null default '[]'::jsonb
    check (jsonb_typeof(ambiguity_flags) = 'array'),
  review_state text not null default 'pending'
    check (review_state in ('pending', 'accepted', 'rejected')),
  canonical_payload jsonb,
  review_note text,
  reviewed_at timestamptz,
  reviewed_by uuid references roadops.app_users(id) on delete restrict,
  constraint iqn_staged_rows_review_ck check (
    (review_state = 'pending' and reviewed_at is null and reviewed_by is null
      and canonical_payload is null and review_note is null)
    or (review_state = 'accepted' and reviewed_at is not null and reviewed_by is not null
      and canonical_payload is not null and jsonb_typeof(canonical_payload) = 'object'
      and coalesce(btrim(review_note), '') <> '')
    or (review_state = 'rejected' and reviewed_at is not null and reviewed_by is not null
      and canonical_payload is null and coalesce(btrim(review_note), '') <> '')
  ),
  unique (import_batch_id, table_index, row_index),
  unique (import_batch_id, provenance_hash),
  foreign key (import_batch_id, block_sequence)
    references roadops.iqn_staged_blocks(import_batch_id, block_sequence) on delete restrict
);

create index iqn_staged_rows_review_idx
  on roadops.iqn_staged_rows (import_batch_id, review_state, table_index, row_index);

create table roadops.iqn_import_reviews (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null unique references roadops.import_batches(id) on delete restrict,
  document_kind text not null check (document_kind in ('iqn_02', 'iqn_03')),
  review_manifest jsonb not null check (jsonb_typeof(review_manifest) = 'object'),
  review_manifest_hash bytea not null check (octet_length(review_manifest_hash) = 32),
  review_state text not null check (review_state in ('validated', 'published')),
  reviewed_by uuid not null references roadops.app_users(id) on delete restrict,
  reviewed_at timestamptz not null default clock_timestamp(),
  published_document_id uuid unique references roadops.iqn_documents(id) on delete restrict,
  published_at timestamptz,
  constraint iqn_import_reviews_publish_ck check (
    (review_state = 'validated' and published_document_id is null and published_at is null)
    or (review_state = 'published' and published_document_id is not null and published_at is not null)
  )
);

alter table roadops.roadvision_attribute_staging
  add column review_note text,
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references roadops.app_users(id) on delete restrict;

alter table roadops.roadvision_attribute_staging
  add constraint roadvision_attribute_staging_review_ck check (
    (validation_state in ('pending', 'valid', 'invalid')
      and reviewed_at is null and reviewed_by is null)
    or (validation_state = 'accepted' and reviewed_at is not null and reviewed_by is not null
      and proposed_record_kind is not null and coalesce(btrim(review_note), '') <> '')
  ) not valid;

alter table roadops.iqn_staged_blocks enable row level security;
alter table roadops.iqn_staged_blocks force row level security;
alter table roadops.iqn_staged_rows enable row level security;
alter table roadops.iqn_staged_rows force row level security;
alter table roadops.iqn_import_reviews enable row level security;
alter table roadops.iqn_import_reviews force row level security;

create policy roadops_sync_all on roadops.iqn_staged_blocks
for all to roadops_sync using (true) with check (true);
create policy roadops_reporting_read on roadops.iqn_staged_blocks
for select to roadops_reporting using (true);
create policy roadops_sync_all on roadops.iqn_staged_rows
for all to roadops_sync using (true) with check (true);
create policy roadops_reporting_read on roadops.iqn_staged_rows
for select to roadops_reporting using (true);
create policy roadops_sync_all on roadops.iqn_import_reviews
for all to roadops_sync using (true) with check (true);
create policy roadops_reporting_read on roadops.iqn_import_reviews
for select to roadops_reporting using (true);

grant select, insert, update, delete on
  roadops.iqn_staged_blocks,
  roadops.iqn_staged_rows,
  roadops.iqn_import_reviews
to roadops_sync;
grant usage, select on sequence roadops.iqn_staged_blocks_id_seq to roadops_sync;
grant select on
  roadops.iqn_staged_blocks,
  roadops.iqn_staged_rows,
  roadops.iqn_import_reviews
to roadops_reporting;

-- Console publishers use the constrained sync role. They need only enough
-- identity/catalog visibility to prove that a named reviewer and defect type
-- are active; credential and other user fields remain inaccessible.
grant select (id, status) on roadops.app_users to roadops_sync;
grant select (id, code, active_from, active_until)
  on roadops.defect_types to roadops_sync;
create policy app_users_sync_reviewer_read
on roadops.app_users for select to roadops_sync
using (status = 'active');
create policy defect_types_sync_catalog_read
on roadops.defect_types for select to roadops_sync
using (true);

commit;
