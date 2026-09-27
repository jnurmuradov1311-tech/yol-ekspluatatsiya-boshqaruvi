-- Private documents/videos belong to an IQN work variant and a road division.
-- No source instructions are invented or seeded: authorized staff attach theirs.
begin;

create table roadops.work_guides (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  work_variant_id uuid not null references roadops.iqn_work_variants(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  kind text not null check (kind in ('DOCUMENT', 'VIDEO')),
  source_type text not null check (source_type in ('FILE', 'LINK')),
  external_url text,
  storage_path text unique,
  file_name text,
  content_type text,
  byte_size bigint,
  sha256 text,
  created_by uuid not null default roadops.current_actor_id() references roadops.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  request_key text not null check (char_length(request_key) between 8 and 128),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  deleted_at timestamptz,
  deleted_by uuid references roadops.app_users(id),
  unique (created_by, request_key),
  check ((deleted_at is null) = (deleted_by is null)),
  check (
    (source_type = 'LINK' and external_url is not null and external_url ~* '^https://' and char_length(external_url) <= 2048
      and storage_path is null and file_name is null and content_type is null and byte_size is null and sha256 is null)
    or (source_type = 'FILE' and external_url is null
      and storage_path is not null and content_type is not null and byte_size is not null and sha256 is not null
      and storage_path ~ '^work-guides/[0-9a-f-]{36}\.(pdf|jpg|png|webp|mp4)$'
      and file_name is not null and sha256 ~ '^[a-f0-9]{64}$'
      and ((kind = 'VIDEO' and content_type = 'video/mp4' and byte_size between 1 and 104857600)
        or (kind = 'DOCUMENT' and content_type in ('application/pdf','image/jpeg','image/png','image/webp')
          and byte_size between 1 and 20971520)))
  )
);
create index work_guides_variant_division_idx on roadops.work_guides (division_id, work_variant_id, created_at desc)
  where deleted_at is null;
alter table roadops.work_guides enable row level security;
alter table roadops.work_guides force row level security;

create policy work_guides_read on roadops.work_guides for select to roadops_api
using (roadops.has_permission('planning.read', division_id)
  or roadops.has_permission('execution.read', division_id)
  or roadops.has_permission('catalog.manage', division_id));
create policy work_guides_insert on roadops.work_guides for insert to roadops_api
with check (created_by = roadops.current_actor_id() and deleted_at is null and deleted_by is null
  and (roadops.has_permission('planning.write', division_id) or roadops.has_permission('catalog.manage', division_id)));
create policy work_guides_retire on roadops.work_guides for update to roadops_api
using (roadops.has_permission('planning.write', division_id) or roadops.has_permission('catalog.manage', division_id))
with check (deleted_at is not null and deleted_by = roadops.current_actor_id()
  and (roadops.has_permission('planning.write', division_id) or roadops.has_permission('catalog.manage', division_id)));

grant select, insert on roadops.work_guides to roadops_api;
grant update (deleted_at, deleted_by) on roadops.work_guides to roadops_api;
create trigger work_guides_audit after insert or update or delete on roadops.work_guides
for each row execute function roadops.capture_row_audit('work_guides');

comment on table roadops.work_guides is
  'Private work instructions and videos; archived metadata and bytes retained for traceability. Authenticated API content only.';
commit;
