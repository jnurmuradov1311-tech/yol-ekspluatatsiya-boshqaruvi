# RoadOps database

This directory is the authoritative PostgreSQL schema for the PHP RoadOps API.
All business tables live in the private `roadops` schema; `public`, `anon`,
`authenticated`, and `service_role` receive no access to it. The browser never
connects to these tables directly. Laravel connects through a dedicated database
login that inherits `roadops_api`. Before authentication it can use only the
restricted auth bootstrap path. After authentication it sets the actor with
`SET LOCAL roadops.actor_id = '<uuid>'` inside every request transaction.

## Layout

- `migrations/` — production DDL, applied in filename order.
- `fixtures/development.sql` — explicit local-development data only.
- `fixtures/test.sql` — deterministic isolated-test data only.
- `tests/` — SQL contract/invariant checks. They do not create production data.

Fixtures are never part of the production migration chain. Production receives
roads, road lengths, road elements, divisions, division profiles, workers,
qualifications, and availability only through the Yo‘l ta’mirlash punkti sync
adapter. RoadVision records remain candidates until a human verifier confirms
or rejects them.

## Apply

Create migration files with `supabase migration new <name>` when adding future
changes. The initial baseline is intentionally checked in as ordered SQL files.
For a new local Supabase stack:

```bash
supabase db reset
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f apps/api/database/tests/001_schema_contracts.sql
```

`003_initial_bootstrap_clean_database.sql` must be run on a clean migrated
database before fixtures. `002_auth_bootstrap.sql`,
`004_source_assignment_contracts.sql`,
`005_planning_operator_guards.sql`,
`006_maintenance_and_handoff_contracts.sql`,
`007_multi_road_scope.sql`,
`008_monthly_completion_costing_contracts.sql`, and
`009_admin_network_summary_contracts.sql` instead require `fixtures/test.sql`.
`010_manual_inspection_iqn_topics_contracts.sql` validates the forward schema
without inserting fixture data. `011_organization_hierarchy_contracts.sql`
requires `fixtures/test.sql` and creates only transaction-local organization
records before rolling them back. `012_global_admin_session_scope.sql` verifies
that a division-scoped `system.all` grant remains local and cannot open Republic
administration data. `013_monthly_act_iqn_labor_norms.sql` validates immutable,
linear-only IQN labor snapshots, complete-month submission, and the closed-month
late verification guard without fixture data.
`014_iqn_publication_fail_closed.sql` verifies that IQN approval is
global-only, actor/session/request-bound, checksum-locked, and consumed through
the audited review lifecycle.
Every test wraps itself in a transaction and rolls back.

For a plain PostgreSQL 15+ database, apply every file in `migrations/` in lexical
order using a migration runner with `ON_ERROR_STOP=1`. The migration executor
must be allowed to create extensions, schemas, and group roles. Application
login roles are provisioned outside migrations and should be granted exactly
one group role, for example:

```sql
create role roadops_php login inherit password '<secret-from-secret-manager>';
grant roadops_api to roadops_php;
```

Do not use `postgres` or a Supabase service key in the web process. Do not add
`roadops` to Supabase Data API exposed schemas. If direct PostgREST access is
ever introduced, it requires a separate reviewed API schema rather than exposing
these internal tables.

## Request transaction contract

The inherited role is available immediately, so login/session lookup can happen
before actor context exists. After verifying the hashed opaque session cookie,
Laravel starts a transaction and sets request context before any domain query:

```sql
select set_config('roadops.actor_id', :user_id, true);
select set_config('roadops.session_id', :session_id, true);
select set_config('roadops.request_id', :request_id, true);
```

The sync worker uses a dedicated login that inherits only `roadops_sync` (or
explicitly executes `SET LOCAL ROLE roadops_sync`). External master tables also
have a write-guard trigger, so accidental writes from the API fail even if a
future grant is too broad.

## Planning invariants

- There are no business priority, condition-index, confidence, or 0–100 score
  columns.
- A RoadVision candidate cannot become an operational defect without a human
  verification record.
- Planning blockers use stable codes and deterministic signatures.
- Approval fails while a blocking row exists.
- Active worker assignments are capped at 420 minutes per worker per local day;
  a lower synced availability value wins.
- Approved/scheduled work cannot overlap on the same road chainage and time.
- IQN resources store technical quantities only. Approved local UZS prices are
  versioned separately, then frozen together with verified actual labor,
  material and machine use in a monthly completion act.
- Organization identity is source-owned and effective-dated. Only
  `REPUBLIC -> REGION -> ENTERPRISE -> DIVISION` chains are accepted; overlapping
  parent/enterprise assignments, cycles, cross-source links and incomplete
  assignment chains fail closed. Production migrations create no organization
  or assignment rows.

## Rollback and forward fixes

The baseline migrations are append-only. In a shared or production database,
never edit an already-applied migration and never drop operational history to
roll back. Add a new forward migration. Restore data only from a verified backup
or point-in-time recovery.
