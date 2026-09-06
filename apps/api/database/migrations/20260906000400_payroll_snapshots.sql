begin;

-- These append-only records are calculation previews, not payroll approval or
-- bank payment instructions. All inputs, dated attendance and rate references
-- are retained so a calculation can be reviewed and reproduced later.
create table roadops.payroll_snapshots (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references roadops.road_divisions(id) on delete restrict,
  work_month date not null check (work_month = date_trunc('month', work_month)::date),
  policy_reference text not null check (btrim(policy_reference) <> ''),
  snapshot jsonb not null,
  snapshot_hash bytea generated always as (extensions.digest(snapshot::text, 'sha256')) stored,
  created_by uuid not null references roadops.app_users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  constraint payroll_snapshots_shape_ck check (coalesce((
    jsonb_typeof(snapshot) = 'object'
    and snapshot ?& array['id','divisionId','period','policyReference','currency','state','paymentInitiated','rows','totals']
    and snapshot->>'id' = id::text
    and snapshot->>'divisionId' = division_id::text
    and snapshot->>'period' = to_char(work_month, 'YYYY-MM')
    and snapshot->>'policyReference' = policy_reference
    and snapshot->>'state' = 'PREVIEW'
    and snapshot->>'currency' = 'UZS'
    and snapshot->'paymentInitiated' = 'false'::jsonb
    and jsonb_typeof(snapshot->'rows') = 'array'
    and jsonb_array_length(snapshot->'rows') > 0
    and jsonb_typeof(snapshot->'totals') = 'object'
  ), false))
);

create index payroll_snapshots_period_idx
  on roadops.payroll_snapshots (division_id, work_month, created_at desc, id desc);
create index payroll_snapshots_creator_idx on roadops.payroll_snapshots (created_by);

alter table roadops.payroll_snapshots enable row level security;
alter table roadops.payroll_snapshots force row level security;
create policy payroll_snapshots_read on roadops.payroll_snapshots
  for select to roadops_api
  using (roadops.has_permission('costs.read', division_id));
create policy payroll_snapshots_create on roadops.payroll_snapshots
  for insert to roadops_api
  with check (
    roadops.has_permission('costs.manage', division_id)
    and created_by = roadops.current_actor_id()
  );
grant select, insert on roadops.payroll_snapshots to roadops_api;

create trigger payroll_snapshots_append_only
before update or delete on roadops.payroll_snapshots
for each row execute function roadops.forbid_mutation();
create trigger payroll_snapshots_no_truncate
before truncate on roadops.payroll_snapshots
for each statement execute function roadops.forbid_mutation();
create trigger payroll_snapshots_audit
after insert on roadops.payroll_snapshots
for each row execute function roadops.capture_row_audit('payroll_snapshots');

comment on table roadops.payroll_snapshots is
  'Immutable payroll calculation previews from approved dated attendance and rate sources; no payroll approval or money movement.';

commit;
