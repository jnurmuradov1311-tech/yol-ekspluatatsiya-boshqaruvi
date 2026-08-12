begin;

create table roadops.import_batches (
  id uuid primary key default gen_random_uuid(),
  import_kind text not null
    check (import_kind in ('iqn_document', 'roadvision_attribute_catalog')),
  source_system_id uuid references roadops.source_systems(id) on delete restrict,
  source_filename text not null check (btrim(source_filename) <> ''),
  source_sha256 bytea not null check (octet_length(source_sha256) = 32),
  parser_version text not null check (btrim(parser_version) <> ''),
  state text not null default 'received'
    check (state in ('received', 'parsed', 'validated', 'accepted', 'rejected')),
  raw_row_count integer not null default 0 check (raw_row_count >= 0),
  expected_row_count integer check (expected_row_count is null or expected_row_count >= 0),
  accepted_row_count integer not null default 0 check (accepted_row_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  manifest jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  imported_by uuid references roadops.app_users(id),
  constraint import_batches_kind_source_ck check (
    (import_kind = 'roadvision_attribute_catalog' and source_system_id is not null)
    or import_kind = 'iqn_document'
  ),
  constraint import_batches_acceptance_ck check (
    state <> 'accepted'
    or (completed_at is not null and error_count = 0
        and accepted_row_count <= raw_row_count
        and (expected_row_count is null or expected_row_count = raw_row_count))
  ),
  unique (import_kind, source_sha256, parser_version)
);

create table roadops.import_raw_cells (
  id bigint generated always as identity primary key,
  import_batch_id uuid not null references roadops.import_batches(id) on delete restrict,
  source_container text not null check (btrim(source_container) <> ''),
  row_number integer not null check (row_number > 0),
  column_reference text not null check (btrim(column_reference) <> ''),
  raw_value text,
  normalized_value text,
  source_location jsonb not null,
  cell_hash bytea not null check (octet_length(cell_hash) = 32),
  unique (import_batch_id, source_container, row_number, column_reference)
);

create table roadops.import_issues (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references roadops.import_batches(id) on delete restrict,
  issue_code text not null check (issue_code ~ '^[A-Z][A-Z0-9_]{2,95}$'),
  issue_level text not null check (issue_level in ('error', 'warning')),
  source_location jsonb not null,
  raw_value text,
  details jsonb not null default '{}'::jsonb,
  resolution_state text not null default 'open'
    check (resolution_state in ('open', 'resolved', 'accepted_exception')),
  resolved_at timestamptz,
  resolved_by uuid references roadops.app_users(id),
  resolution_note text,
  constraint import_issues_resolution_ck check (
    (resolution_state = 'open' and resolved_at is null and resolved_by is null)
    or (resolution_state <> 'open' and resolved_at is not null and resolved_by is not null
        and coalesce(btrim(resolution_note), '') <> '')
  )
);

create index import_issues_open_batch_idx
  on roadops.import_issues (import_batch_id, issue_level, issue_code)
  where resolution_state = 'open';

create table roadops.iqn_documents (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null unique references roadops.import_batches(id) on delete restrict,
  code text not null check (btrim(code) <> ''),
  title text not null check (btrim(title) <> ''),
  revision text not null check (btrim(revision) <> ''),
  document_kind text not null check (document_kind in ('iqn_02', 'iqn_03')),
  source_sha256 bytea not null check (octet_length(source_sha256) = 32),
  effective_from date not null,
  effective_until date,
  imported_at timestamptz not null default clock_timestamp(),
  imported_by uuid references roadops.app_users(id),
  import_manifest jsonb not null default '{}'::jsonb,
  constraint iqn_documents_period_ck check (
    effective_until is null or effective_until > effective_from
  ),
  unique (code, revision),
  exclude using gist (
    code with =,
    (daterange(effective_from, coalesce(effective_until, 'infinity'::date), '[)')) with &&
  )
);

create table roadops.iqn_sections (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references roadops.iqn_documents(id) on delete restrict,
  parent_section_id uuid references roadops.iqn_sections(id) on delete restrict,
  sequence_number integer not null check (sequence_number > 0),
  raw_heading text not null check (btrim(raw_heading) <> ''),
  normalized_heading text not null check (btrim(normalized_heading) <> ''),
  source_location jsonb not null,
  unique (document_id, parent_section_id, sequence_number)
);

create table roadops.iqn_work_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references roadops.iqn_documents(id) on delete restrict,
  section_id uuid references roadops.iqn_sections(id) on delete restrict,
  parent_item_id uuid references roadops.iqn_work_items(id) on delete restrict,
  source_sequence integer not null check (source_sequence > 0),
  raw_code text,
  normalized_code text,
  raw_name text not null check (btrim(raw_name) <> ''),
  normalized_name text not null check (btrim(normalized_name) <> ''),
  item_kind text not null
    check (item_kind in ('group', 'task', 'summary', 'resource_embedded')),
  source_location jsonb not null,
  raw_expression text,
  created_at timestamptz not null default clock_timestamp(),
  unique (document_id, source_sequence)
);

comment on column roadops.iqn_work_items.raw_code is
  'Intentionally non-unique: IQN source codes repeat and may denote groups, tasks, or summaries.';
comment on column roadops.iqn_work_items.normalized_code is
  'Intentionally non-unique; identity is the surrogate id plus source provenance.';

create table roadops.iqn_work_variants (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references roadops.iqn_work_items(id) on delete restrict,
  variant_key text not null check (btrim(variant_key) <> ''),
  variant_label text,
  basis_quantity numeric(20,6) check (basis_quantity is null or basis_quantity > 0),
  basis_unit text,
  raw_expression text,
  formula_type text not null check (formula_type in (
    'linear', 'incremental', 'range', 'dual_value', 'fixed_period',
    'summary', 'manual_resolution_required'
  )),
  formula_parameters jsonb not null default '{}'::jsonb,
  interpretation_status text not null default 'unreviewed'
    check (interpretation_status in ('unreviewed', 'interpreted', 'approved', 'needs_resolution', 'rejected')),
  planning_status text not null default 'not_usable'
    check (planning_status in ('not_usable', 'automatic', 'manual', 'retired')),
  interpretation_note text,
  reviewed_at timestamptz,
  reviewed_by uuid references roadops.app_users(id),
  source_location jsonb not null,
  constraint iqn_work_variants_basis_ck check (
    (basis_quantity is null and basis_unit is null)
    or (basis_quantity is not null and coalesce(btrim(basis_unit), '') <> '')
  ),
  constraint iqn_work_variants_planning_ck check (
    planning_status <> 'automatic'
    or (interpretation_status = 'approved'
        and basis_quantity is not null
        and formula_type not in ('summary', 'manual_resolution_required'))
  ),
  constraint iqn_work_variants_review_ck check (
    interpretation_status in ('unreviewed', 'interpreted', 'needs_resolution')
    or (reviewed_at is not null and reviewed_by is not null)
  ),
  unique (work_item_id, variant_key)
);

create table roadops.iqn_resources (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references roadops.iqn_documents(id) on delete restrict,
  resource_kind text not null
    check (resource_kind in ('labor', 'equipment', 'material', 'safety')),
  raw_code text,
  normalized_code text,
  raw_name text not null check (btrim(raw_name) <> ''),
  normalized_name text not null check (btrim(normalized_name) <> ''),
  unit text not null check (btrim(unit) <> ''),
  source_location jsonb not null,
  attributes jsonb not null default '{}'::jsonb
);

create index iqn_resources_lookup_idx
  on roadops.iqn_resources (document_id, resource_kind, normalized_code);

create table roadops.iqn_norm_sets (
  id uuid primary key default gen_random_uuid(),
  work_variant_id uuid not null references roadops.iqn_work_variants(id) on delete restrict,
  norm_set_key text not null check (btrim(norm_set_key) <> ''),
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  effective_from date not null,
  effective_until date,
  raw_expression text,
  interpretation jsonb not null default '{}'::jsonb,
  source_location jsonb not null,
  approved_at timestamptz,
  approved_by uuid references roadops.app_users(id),
  created_at timestamptz not null default clock_timestamp(),
  constraint iqn_norm_sets_period_ck check (
    effective_until is null or effective_until > effective_from
  ),
  constraint iqn_norm_sets_approval_ck check (
    (status = 'draft' and approved_at is null and approved_by is null)
    or (status in ('approved', 'retired') and approved_at is not null and approved_by is not null)
  ),
  unique (work_variant_id, norm_set_key),
  exclude using gist (
    work_variant_id with =,
    (daterange(effective_from, coalesce(effective_until, 'infinity'::date), '[)')) with &&
  ) where (status = 'approved')
);

create table roadops.iqn_norm_lines (
  id uuid primary key default gen_random_uuid(),
  norm_set_id uuid not null references roadops.iqn_norm_sets(id) on delete restrict,
  source_line_number integer not null check (source_line_number > 0),
  resource_id uuid not null references roadops.iqn_resources(id) on delete restrict,
  quantity_per_basis numeric(20,6) check (quantity_per_basis is null or quantity_per_basis > 0),
  increment_quantity numeric(20,6) check (increment_quantity is null or increment_quantity > 0),
  minutes_per_basis numeric(14,3) check (minutes_per_basis is null or minutes_per_basis > 0),
  increment_minutes numeric(14,3) check (increment_minutes is null or increment_minutes > 0),
  unit text not null check (btrim(unit) <> ''),
  raw_expression text,
  formula_parameters jsonb not null default '{}'::jsonb,
  source_location jsonb not null,
  unique (norm_set_id, source_line_number)
);

comment on table roadops.iqn_norm_lines is
  'Approved resource quantities and formula operands only; no price or monetary fields.';

create table roadops.work_variant_skill_requirements (
  id uuid primary key default gen_random_uuid(),
  work_variant_id uuid not null references roadops.iqn_work_variants(id) on delete restrict,
  qualification_code text not null check (btrim(qualification_code) <> ''),
  worker_count smallint not null check (worker_count between 1 and 100),
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  effective_from date not null,
  effective_until date,
  rationale text not null check (btrim(rationale) <> ''),
  created_by uuid not null references roadops.app_users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  approved_by uuid references roadops.app_users(id) on delete restrict,
  approved_at timestamptz,
  constraint work_variant_skill_period_ck check (
    effective_until is null or effective_until > effective_from
  ),
  constraint work_variant_skill_approval_ck check (
    (status = 'draft' and approved_by is null and approved_at is null)
    or (status in ('approved', 'retired') and approved_by is not null
        and approved_at is not null and approved_by <> created_by)
  ),
  exclude using gist (
    work_variant_id with =,
    qualification_code with =,
    (daterange(effective_from, coalesce(effective_until, 'infinity'::date), '[)')) with &&
  ) where (status = 'approved')
);

comment on table roadops.work_variant_skill_requirements is
  'Human-approved crew template. IQN labor resources express time, never worker qualification.';

create or replace function roadops.validate_iqn_norm_line()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  kind text;
  resource_document_id uuid;
  variant_document_id uuid;
begin
  select r.resource_kind, r.document_id
  into kind, resource_document_id
  from roadops.iqn_resources r where r.id = new.resource_id;

  select wi.document_id into variant_document_id
  from roadops.iqn_norm_sets ns
  join roadops.iqn_work_variants v on v.id = ns.work_variant_id
  join roadops.iqn_work_items wi on wi.id = v.work_item_id
  where ns.id = new.norm_set_id;

  if resource_document_id is distinct from variant_document_id then
    raise exception using errcode = '23514', message = 'IQN norm line resource must come from the same document';
  end if;
  if (new.minutes_per_basis is not null or new.increment_minutes is not null)
     and kind not in ('labor', 'equipment') then
    raise exception using errcode = '23514', message = 'Minutes are valid only for labor or equipment norm lines';
  end if;
  return new;
end
$function$;

create trigger iqn_norm_lines_validate
before insert or update on roadops.iqn_norm_lines
for each row execute function roadops.validate_iqn_norm_line();

create or replace function roadops.validate_iqn_norm_set_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  variant_status text;
begin
  if new.status = 'approved' and (old.status is distinct from new.status) then
    select v.planning_status into variant_status
    from roadops.iqn_work_variants v where v.id = new.work_variant_id;
    if variant_status = 'automatic' and not exists (
      select 1 from roadops.iqn_norm_lines nl
      where nl.norm_set_id = new.id and nl.quantity_per_basis is not null
    ) then
      raise exception using errcode = '23514', message = 'Automatic IQN variant requires interpreted resource norm lines';
    end if;
  end if;
  return new;
end
$function$;

create trigger iqn_norm_sets_validate_approval
before update on roadops.iqn_norm_sets
for each row execute function roadops.validate_iqn_norm_set_approval();

revoke all on function roadops.validate_iqn_norm_line() from public;
revoke all on function roadops.validate_iqn_norm_set_approval() from public;

create table roadops.defect_types (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9_.-]{1,95}$'),
  name text not null check (btrim(name) <> ''),
  description text,
  measurement_unit text not null check (btrim(measurement_unit) <> ''),
  active_from date not null,
  active_until date,
  created_at timestamptz not null default clock_timestamp(),
  constraint defect_types_period_ck check (
    active_until is null or active_until > active_from
  ),
  unique (code, active_from),
  exclude using gist (
    code with =,
    (daterange(active_from, coalesce(active_until, 'infinity'::date), '[)')) with &&
  )
);

-- Manual field capture may begin before an expert maps the observation to an
-- approved defect catalog entry. These unit-specific placeholders preserve the
-- measured natural unit and intentionally have no automatic IQN crosswalk.
insert into roadops.defect_types (code, name, description, measurement_unit, active_from)
values
  ('manual.unclassified.m', 'Tasniflanmagan qo‘lda ko‘rik (m)', 'Ekspert tasnifi kutilmoqda.', 'm', date '2026-01-01'),
  ('manual.unclassified.m2', 'Tasniflanmagan qo‘lda ko‘rik (m²)', 'Ekspert tasnifi kutilmoqda.', 'm2', date '2026-01-01'),
  ('manual.unclassified.m3', 'Tasniflanmagan qo‘lda ko‘rik (m³)', 'Ekspert tasnifi kutilmoqda.', 'm3', date '2026-01-01'),
  ('manual.unclassified.unit', 'Tasniflanmagan qo‘lda ko‘rik (dona)', 'Ekspert tasnifi kutilmoqda.', 'unit', date '2026-01-01'),
  ('manual.unclassified.km', 'Tasniflanmagan qo‘lda ko‘rik (km)', 'Ekspert tasnifi kutilmoqda.', 'km', date '2026-01-01');

create table roadops.roadvision_attribute_staging (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references roadops.import_batches(id) on delete restrict,
  source_row_number integer not null check (source_row_number > 0),
  external_code text,
  external_name text,
  proposed_record_kind text check (proposed_record_kind is null or proposed_record_kind in (
    'defect_candidate', 'asset_observation', 'safety_observation', 'ignore'
  )),
  proposed_defect_type_code text,
  raw_row jsonb not null,
  row_hash bytea not null check (octet_length(row_hash) = 32),
  validation_state text not null default 'pending'
    check (validation_state in ('pending', 'valid', 'invalid', 'accepted')),
  validation_errors jsonb not null default '[]'::jsonb,
  unique (import_batch_id, source_row_number)
);

create table roadops.roadvision_attribute_catalog (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references roadops.import_batches(id) on delete restrict,
  staging_row_id uuid references roadops.roadvision_attribute_staging(id) on delete restrict,
  source_system_id uuid not null references roadops.source_systems(id) on delete restrict,
  catalog_revision text not null check (btrim(catalog_revision) <> ''),
  external_code text not null check (btrim(external_code) <> ''),
  external_name text not null check (btrim(external_name) <> ''),
  record_kind text not null check (record_kind in (
    'defect_candidate', 'asset_observation', 'safety_observation', 'ignore'
  )),
  defect_type_id uuid references roadops.defect_types(id) on delete restrict,
  active_from date not null,
  active_until date,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  imported_at timestamptz not null default clock_timestamp(),
  constraint roadvision_attribute_classification_ck check (
    (record_kind = 'defect_candidate' and defect_type_id is not null)
    or (record_kind <> 'defect_candidate' and defect_type_id is null)
  ),
  constraint roadvision_attribute_period_ck check (
    active_until is null or active_until > active_from
  ),
  unique (source_system_id, catalog_revision, external_code),
  exclude using gist (
    source_system_id with =,
    external_code with =,
    (daterange(active_from, coalesce(active_until, 'infinity'::date), '[)')) with &&
  )
);

create table roadops.defect_work_variant_crosswalks (
  id uuid primary key default gen_random_uuid(),
  defect_type_id uuid not null references roadops.defect_types(id) on delete restrict,
  work_variant_id uuid not null references roadops.iqn_work_variants(id) on delete restrict,
  measured_to_basis_factor numeric(20,6) not null default 1 check (measured_to_basis_factor > 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  effective_from date not null,
  effective_until date,
  rationale text not null check (btrim(rationale) <> ''),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references roadops.app_users(id),
  approved_at timestamptz,
  approved_by uuid references roadops.app_users(id),
  constraint defect_variant_crosswalk_period_ck check (
    effective_until is null or effective_until > effective_from
  ),
  constraint defect_variant_crosswalk_approval_ck check (
    (status = 'draft' and approved_at is null and approved_by is null)
    or (status in ('approved', 'retired') and approved_at is not null
        and approved_by is not null and approved_by <> created_by)
  ),
  exclude using gist (
    defect_type_id with =,
    work_variant_id with =,
    (daterange(effective_from, coalesce(effective_until, 'infinity'::date), '[)')) with &&
  ) where (status = 'approved')
);

create table roadops.roadvision_batches (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid not null references roadops.source_systems(id) on delete restrict,
  external_batch_id text not null check (btrim(external_batch_id) <> ''),
  inbox_id uuid references roadops.integration_inbox(id) on delete restrict,
  captured_from timestamptz,
  captured_until timestamptz,
  received_at timestamptz not null default clock_timestamp(),
  manifest_hash bytea not null check (octet_length(manifest_hash) = 32),
  state text not null default 'received'
    check (state in ('received', 'validated', 'partially_imported', 'imported', 'rejected')),
  validation_result jsonb,
  constraint roadvision_batch_capture_ck check (
    captured_until is null or captured_from is null or captured_until >= captured_from
  ),
  unique (source_system_id, external_batch_id)
);

create table roadops.roadvision_candidates (
  id uuid primary key default gen_random_uuid(),
  source_system_id uuid not null references roadops.source_systems(id) on delete restrict,
  batch_id uuid not null references roadops.roadvision_batches(id) on delete restrict,
  external_candidate_id text not null check (btrim(external_candidate_id) <> ''),
  attribute_catalog_id uuid references roadops.roadvision_attribute_catalog(id) on delete restrict,
  observed_at timestamptz not null,
  latitude numeric(10,7) check (latitude between -90 and 90),
  longitude numeric(10,7) check (longitude between -180 and 180),
  evidence_reference text,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  road_id uuid references roadops.roads(id) on delete restrict,
  road_element_id uuid references roadops.road_elements(id) on delete restrict,
  defect_type_id uuid references roadops.defect_types(id) on delete restrict,
  chainage_span numrange,
  status text not null default 'received'
    check (status in ('received', 'unmatched', 'awaiting_verification', 'confirmed', 'rejected', 'superseded')),
  ingested_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint roadvision_candidate_coordinates_ck check (
    (latitude is null and longitude is null)
    or (latitude is not null and longitude is not null)
  ),
  constraint roadvision_candidate_chainage_ck check (
    chainage_span is null
    or (not isempty(chainage_span) and lower_inc(chainage_span)
        and not upper_inc(chainage_span) and lower(chainage_span) >= 0
        and upper(chainage_span) > lower(chainage_span))
  ),
  constraint roadvision_candidate_matching_ck check (
    status in ('received', 'unmatched', 'rejected')
    or (road_id is not null and defect_type_id is not null and chainage_span is not null)
  ),
  unique (source_system_id, external_candidate_id)
);

create index roadvision_candidates_review_idx
  on roadops.roadvision_candidates (status, observed_at)
  where status in ('received', 'unmatched', 'awaiting_verification');
create index roadvision_candidates_road_idx
  on roadops.roadvision_candidates using gist (road_id, chainage_span)
  where road_id is not null and chainage_span is not null;

create trigger roadvision_candidates_set_updated_at
before update on roadops.roadvision_candidates
for each row execute function roadops.set_updated_at();

create table roadops.roadvision_candidate_verifications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references roadops.roadvision_candidates(id) on delete restrict,
  decision text not null check (decision in ('confirmed', 'rejected')),
  verified_by uuid not null references roadops.app_users(id) on delete restrict,
  verified_at timestamptz not null default clock_timestamp(),
  measured_quantity numeric(20,6) check (measured_quantity is null or measured_quantity > 0),
  measurement_unit text,
  note text,
  request_id uuid,
  constraint roadvision_verification_measurement_ck check (
    (measured_quantity is null and measurement_unit is null)
    or (measured_quantity is not null and coalesce(btrim(measurement_unit), '') <> '')
  ),
  constraint roadvision_verification_rejection_ck check (
    decision = 'confirmed' or coalesce(btrim(note), '') <> ''
  )
);

create table roadops.roadvision_candidate_events (
  id bigint generated always as identity primary key,
  candidate_id uuid not null references roadops.roadvision_candidates(id) on delete restrict,
  from_status text,
  to_status text not null,
  event_code text not null check (btrim(event_code) <> ''),
  actor_user_id uuid references roadops.app_users(id),
  occurred_at timestamptz not null default clock_timestamp(),
  details jsonb not null default '{}'::jsonb,
  request_id uuid
);

create index roadvision_candidate_events_candidate_idx
  on roadops.roadvision_candidate_events (candidate_id, occurred_at, id);

create table roadops.inspections (
  id uuid primary key default gen_random_uuid(),
  inspection_number text not null unique check (btrim(inspection_number) <> ''),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  road_id uuid not null references roadops.roads(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'returned', 'approved')),
  inspection_started_at timestamptz not null,
  inspection_completed_at timestamptz,
  inspector_user_id uuid not null references roadops.app_users(id) on delete restrict,
  submitted_at timestamptz,
  returned_at timestamptz,
  returned_by uuid references roadops.app_users(id) on delete restrict,
  return_note text,
  approved_at timestamptz,
  approved_by uuid references roadops.app_users(id) on delete restrict,
  source_reference text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1 check (row_version > 0),
  constraint inspections_timeline_ck check (
    inspection_completed_at is null or inspection_completed_at >= inspection_started_at
  ),
  constraint inspections_state_ck check (
    (status = 'draft' and submitted_at is null and returned_at is null and approved_at is null)
    or (status = 'submitted' and submitted_at is not null and approved_at is null)
    or (status = 'returned' and submitted_at is not null and returned_at is not null
        and returned_by is not null and coalesce(btrim(return_note), '') <> '' and approved_at is null)
    or (status = 'approved' and submitted_at is not null and approved_at is not null
        and approved_by is not null)
  )
);

create trigger inspections_set_updated_at
before update on roadops.inspections
for each row execute function roadops.set_updated_at();

create table roadops.inspection_observations (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references roadops.inspections(id) on delete restrict,
  road_element_id uuid references roadops.road_elements(id) on delete restrict,
  defect_type_id uuid not null references roadops.defect_types(id) on delete restrict,
  chainage_span numrange not null,
  observed_at timestamptz not null,
  measured_quantity numeric(20,6) not null check (measured_quantity > 0),
  measurement_unit text not null check (btrim(measurement_unit) <> ''),
  description text,
  evidence jsonb not null default '[]'::jsonb,
  source_hash bytea not null check (octet_length(source_hash) = 32),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid references roadops.app_users(id) on delete restrict,
  review_note text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint inspection_observations_chainage_ck check (
    not isempty(chainage_span) and lower_inc(chainage_span)
    and not upper_inc(chainage_span) and lower(chainage_span) >= 0
    and upper(chainage_span) > lower(chainage_span)
  ),
  constraint inspection_observations_review_ck check (
    (review_status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (review_status in ('approved', 'rejected') and reviewed_at is not null
        and reviewed_by is not null)
  ),
  constraint inspection_observations_rejection_ck check (
    review_status <> 'rejected' or coalesce(btrim(review_note), '') <> ''
  ),
  unique (inspection_id, source_hash)
);

create trigger inspection_observations_set_updated_at
before update on roadops.inspection_observations
for each row execute function roadops.set_updated_at();

create table roadops.inspection_events (
  id bigint generated always as identity primary key,
  inspection_id uuid not null references roadops.inspections(id) on delete restrict,
  observation_id uuid references roadops.inspection_observations(id) on delete restrict,
  from_status text,
  to_status text not null,
  event_code text not null check (btrim(event_code) <> ''),
  actor_user_id uuid not null references roadops.app_users(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp(),
  note text,
  details jsonb not null default '{}'::jsonb,
  request_id uuid
);

create index inspection_events_inspection_idx
  on roadops.inspection_events (inspection_id, occurred_at, id);

create table roadops.defect_cases (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('roadvision', 'manual_inspection')),
  roadvision_candidate_id uuid unique references roadops.roadvision_candidates(id) on delete restrict,
  inspection_observation_id uuid unique references roadops.inspection_observations(id) on delete restrict,
  road_id uuid not null references roadops.roads(id) on delete restrict,
  road_element_id uuid references roadops.road_elements(id) on delete restrict,
  defect_type_id uuid not null references roadops.defect_types(id) on delete restrict,
  chainage_span numrange not null,
  observed_at timestamptz not null,
  verified_at timestamptz not null,
  verified_by uuid not null references roadops.app_users(id) on delete restrict,
  measured_quantity numeric(20,6) not null check (measured_quantity > 0),
  measurement_unit text not null check (btrim(measurement_unit) <> ''),
  description text,
  status text not null default 'open'
    check (status in ('open', 'planned', 'in_progress', 'resolved', 'closed', 'cancelled')),
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  row_version bigint not null default 1 check (row_version > 0),
  constraint defect_cases_source_ck check (
    (source_kind = 'roadvision' and roadvision_candidate_id is not null
      and inspection_observation_id is null)
    or (source_kind = 'manual_inspection' and roadvision_candidate_id is null
      and inspection_observation_id is not null)
  ),
  constraint defect_cases_chainage_ck check (
    not isempty(chainage_span) and lower_inc(chainage_span)
    and not upper_inc(chainage_span) and lower(chainage_span) >= 0
    and upper(chainage_span) > lower(chainage_span)
  ),
  constraint defect_cases_resolution_ck check (
    (status in ('open', 'planned', 'in_progress', 'cancelled') and closed_at is null)
    or (status = 'resolved' and resolved_at is not null and closed_at is null)
    or (status = 'closed' and resolved_at is not null and closed_at is not null
        and closed_at >= resolved_at)
  )
);

create index defect_cases_open_road_idx
  on roadops.defect_cases using gist (road_id, chainage_span)
  where status in ('open', 'planned', 'in_progress');

create trigger defect_cases_set_updated_at
before update on roadops.defect_cases
for each row execute function roadops.set_updated_at();

create table roadops.defect_case_events (
  id bigint generated always as identity primary key,
  defect_case_id uuid not null references roadops.defect_cases(id) on delete restrict,
  from_status text,
  to_status text not null,
  event_code text not null check (btrim(event_code) <> ''),
  actor_user_id uuid not null references roadops.app_users(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp(),
  note text,
  details jsonb not null default '{}'::jsonb,
  request_id uuid
);

create index defect_case_events_case_idx
  on roadops.defect_case_events (defect_case_id, occurred_at, id);

create or replace function roadops.validate_observation_span()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  road_length numeric;
  effective_at timestamptz;
begin
  if new.road_id is null or new.chainage_span is null then
    return new;
  end if;
  effective_at := coalesce(new.observed_at, statement_timestamp());
  select rv.length_m into road_length
  from roadops.road_versions rv
  where rv.road_id = new.road_id
    and rv.valid_from <= effective_at
    and (rv.valid_until is null or rv.valid_until > effective_at)
  order by rv.valid_from desc
  limit 1;
  if road_length is null then
    raise exception using errcode = '23514', message = 'No effective road version for observation';
  end if;
  if lower(new.chainage_span) < 0 or upper(new.chainage_span) > road_length then
    raise exception using errcode = '23514', message = 'Observation chainage exceeds effective road length';
  end if;
  return new;
end
$function$;

create trigger roadvision_candidates_validate_span
before insert or update of road_id, chainage_span, observed_at
on roadops.roadvision_candidates
for each row execute function roadops.validate_observation_span();

create trigger defect_cases_validate_span
before insert or update of road_id, chainage_span, observed_at
on roadops.defect_cases
for each row execute function roadops.validate_observation_span();

create or replace function roadops.validate_inspection_observation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  inspection_road_id uuid;
  road_length numeric;
begin
  select i.road_id into inspection_road_id
  from roadops.inspections i where i.id = new.inspection_id;
  select rv.length_m into road_length
  from roadops.road_versions rv
  where rv.road_id = inspection_road_id
    and rv.valid_from <= new.observed_at
    and (rv.valid_until is null or rv.valid_until > new.observed_at)
  order by rv.valid_from desc limit 1;
  if road_length is null or lower(new.chainage_span) < 0
     or upper(new.chainage_span) > road_length then
    raise exception using errcode = '23514', message = 'Inspection observation chainage exceeds effective road length';
  end if;
  if new.road_element_id is not null and not exists (
    select 1 from roadops.road_element_versions ev
    where ev.road_element_id = new.road_element_id and ev.road_id = inspection_road_id
      and ev.valid_from <= new.observed_at
      and (ev.valid_until is null or ev.valid_until > new.observed_at)
  ) then
    raise exception using errcode = '23514', message = 'Inspection road element belongs to another road';
  end if;
  return new;
end
$function$;

create trigger inspection_observations_validate
before insert or update of inspection_id, road_element_id, chainage_span, observed_at
on roadops.inspection_observations
for each row execute function roadops.validate_inspection_observation();

create or replace function roadops.guard_candidate_final_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.status in ('confirmed', 'rejected', 'superseded')
     and (new.road_id, new.road_element_id, new.defect_type_id, new.chainage_span)
         is distinct from
         (old.road_id, old.road_element_id, old.defect_type_id, old.chainage_span) then
    raise exception using errcode = '55000', message = 'Final RoadVision mapping is immutable';
  end if;

  if new.status in ('confirmed', 'rejected') and new.status is distinct from old.status
     and not exists (
       select 1 from roadops.roadvision_candidate_verifications v
       where v.candidate_id = new.id and v.decision = new.status
     ) then
    raise exception using errcode = '23514', message = 'Human verification is required for final RoadVision state';
  end if;
  return new;
end
$function$;

create trigger roadvision_candidates_guard_final_state
before update on roadops.roadvision_candidates
for each row execute function roadops.guard_candidate_final_state();

do $catalog_guards$
declare
  table_name text;
begin
  foreach table_name in array array[
    'import_batches','import_raw_cells','iqn_documents','iqn_sections',
    'iqn_resources','iqn_work_items','iqn_norm_lines',
    'roadvision_attribute_staging','roadvision_attribute_catalog'
  ] loop
    execute format(
      'create trigger %I before insert or update or delete on roadops.%I '
      'for each row execute function roadops.assert_sync_writer()',
      table_name || '_sync_write_guard', table_name
    );
  end loop;
end
$catalog_guards$;

create trigger roadvision_candidate_verifications_append_only
before update or delete on roadops.roadvision_candidate_verifications
for each row execute function roadops.forbid_mutation();
create trigger roadvision_candidate_verifications_no_truncate
before truncate on roadops.roadvision_candidate_verifications
for each statement execute function roadops.forbid_mutation();

create trigger roadvision_candidate_events_append_only
before update or delete on roadops.roadvision_candidate_events
for each row execute function roadops.forbid_mutation();
create trigger roadvision_candidate_events_no_truncate
before truncate on roadops.roadvision_candidate_events
for each statement execute function roadops.forbid_mutation();

create trigger defect_case_events_append_only
before update or delete on roadops.defect_case_events
for each row execute function roadops.forbid_mutation();
create trigger defect_case_events_no_truncate
before truncate on roadops.defect_case_events
for each statement execute function roadops.forbid_mutation();

create trigger inspection_events_append_only
before update or delete on roadops.inspection_events
for each row execute function roadops.forbid_mutation();
create trigger inspection_events_no_truncate
before truncate on roadops.inspection_events
for each statement execute function roadops.forbid_mutation();

revoke all on function roadops.validate_observation_span() from public;
revoke all on function roadops.validate_inspection_observation() from public;
revoke all on function roadops.guard_candidate_final_state() from public;

commit;
