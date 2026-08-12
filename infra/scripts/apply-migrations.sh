#!/usr/bin/env sh
set -eu

MIGRATION_DIR="${MIGRATION_DIR:-/var/www/database/migrations}"
DB_OWNER_HOST="${DB_OWNER_HOST:-${DB_HOST:-postgres}}"
DB_OWNER_PORT="${DB_OWNER_PORT:-${DB_PORT:-5432}}"
DB_OWNER_DATABASE="${DB_OWNER_DATABASE:-${DB_DATABASE:-roadops}}"
DB_OWNER_USERNAME="${DB_OWNER_USERNAME:-postgres}"
DB_OWNER_PASSWORD="${DB_OWNER_PASSWORD:?DB_OWNER_PASSWORD is required}"
DB_OWNER_SSLMODE="${DB_OWNER_SSLMODE:-prefer}"
DB_APP_USERNAME="${DB_APP_USERNAME:-roadops_php}"
DB_APP_PASSWORD="${DB_APP_PASSWORD:?DB_APP_PASSWORD is required}"
DB_SYNC_USERNAME="${DB_SYNC_USERNAME:-roadops_sync_login}"
DB_SYNC_PASSWORD="${DB_SYNC_PASSWORD:?DB_SYNC_PASSWORD is required}"
DB_REPORT_USERNAME="${DB_REPORT_USERNAME:-}"
DB_REPORT_PASSWORD="${DB_REPORT_PASSWORD:-}"

for login_name in "$DB_APP_USERNAME" "$DB_SYNC_USERNAME"; do
case "$login_name" in
  (*[!A-Za-z0-9_]*|'')
    echo "Database login names must contain only letters, digits and underscores." >&2
    exit 1
    ;;
esac
done

if [ "$DB_APP_USERNAME" = "$DB_SYNC_USERNAME" ] \
  || [ "$DB_APP_USERNAME" = "$DB_OWNER_USERNAME" ] \
  || [ "$DB_SYNC_USERNAME" = "$DB_OWNER_USERNAME" ]; then
  echo "Owner, API and sync database login names must be distinct." >&2
  exit 1
fi

if [ -n "$DB_REPORT_USERNAME" ] || [ -n "$DB_REPORT_PASSWORD" ]; then
  if [ -z "$DB_REPORT_USERNAME" ] || [ -z "$DB_REPORT_PASSWORD" ]; then
    echo "DB_REPORT_USERNAME and DB_REPORT_PASSWORD must be supplied together." >&2
    exit 1
  fi
  case "$DB_REPORT_USERNAME" in
    (*[!A-Za-z0-9_]*|'')
      echo "DB_REPORT_USERNAME must contain only letters, digits and underscores." >&2
      exit 1
      ;;
  esac
  if [ "$DB_REPORT_USERNAME" = "$DB_OWNER_USERNAME" ] \
    || [ "$DB_REPORT_USERNAME" = "$DB_APP_USERNAME" ] \
    || [ "$DB_REPORT_USERNAME" = "$DB_SYNC_USERNAME" ]; then
    echo "Reporting, owner, API and sync database login names must be distinct." >&2
    exit 1
  fi
fi

if [ ! -d "$MIGRATION_DIR" ]; then
  echo "Migration directory does not exist: $MIGRATION_DIR" >&2
  exit 1
fi

export PGPASSWORD="$DB_OWNER_PASSWORD"
export PGSSLMODE="$DB_OWNER_SSLMODE"

psql_owner() {
  psql \
    --host="$DB_OWNER_HOST" \
    --port="$DB_OWNER_PORT" \
    --username="$DB_OWNER_USERNAME" \
    --dbname="$DB_OWNER_DATABASE" \
    --set=ON_ERROR_STOP=1 \
    "$@"
}

until psql_owner --quiet --tuples-only --command='select 1' >/dev/null 2>&1; do
  echo "Waiting for PostgreSQL..." >&2
  sleep 2
done

psql_owner \
  --set=app_user="$DB_APP_USERNAME" \
  --set=app_password="$DB_APP_PASSWORD" \
  --set=sync_user="$DB_SYNC_USERNAME" \
  --set=sync_password="$DB_SYNC_PASSWORD" \
  --set=report_user="$DB_REPORT_USERNAME" \
  --set=report_password="$DB_REPORT_PASSWORD" <<'SQL'
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

select format(
  'create role %I login inherit password %L',
  :'app_user',
  :'app_password'
)
where not exists (select 1 from pg_roles where rolname = :'app_user')
\gexec

select format(
  'alter role %I with login inherit password %L',
  :'app_user',
  :'app_password'
)
\gexec

select format(
  'create role %I login inherit password %L',
  :'sync_user',
  :'sync_password'
)
where not exists (select 1 from pg_roles where rolname = :'sync_user')
\gexec

select format(
  'alter role %I with login inherit password %L',
  :'sync_user',
  :'sync_password'
)
\gexec

select format(
  'create role %I login inherit password %L',
  :'report_user',
  :'report_password'
)
where :'report_user' <> ''
  and not exists (select 1 from pg_roles where rolname = :'report_user')
\gexec

select format(
  'alter role %I with login inherit password %L',
  :'report_user',
  :'report_password'
)
where :'report_user' <> ''
\gexec

create table if not exists public.roadops_schema_migrations (
  version text primary key,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('APPLYING', 'APPLIED', 'FAILED')),
  started_at timestamptz not null default clock_timestamp(),
  applied_at timestamptz,
  failure_note text
);
SQL

for migration in "$MIGRATION_DIR"/*.sql; do
  [ -f "$migration" ] || continue
  version="$(basename "$migration")"
  checksum="$(sha256sum "$migration" | awk '{print $1}')"
  existing="$(psql_owner --quiet --tuples-only --no-align \
    --command="select checksum_sha256 || ':' || state from public.roadops_schema_migrations where version = '$version'")"

  if [ "$existing" = "$checksum:APPLIED" ]; then
    echo "Already applied: $version"
    continue
  fi

  if [ -n "$existing" ]; then
    echo "Migration requires operator review ($version, recorded=$existing, current=$checksum)." >&2
    echo "Never edit or blindly retry an applied/failed production migration; add a forward migration." >&2
    exit 1
  fi

  psql_owner --quiet \
    --command="insert into public.roadops_schema_migrations(version, checksum_sha256, state) values ('$version', '$checksum', 'APPLYING')"

  echo "Applying: $version"
  if psql_owner --file="$migration"; then
    psql_owner --quiet \
      --command="update public.roadops_schema_migrations set state = 'APPLIED', applied_at = clock_timestamp() where version = '$version'"
  else
    psql_owner --quiet \
      --command="update public.roadops_schema_migrations set state = 'FAILED', failure_note = 'psql returned non-zero; inspect database before any retry' where version = '$version'" || true
    exit 1
  fi
done

psql_owner \
  --set=app_user="$DB_APP_USERNAME" \
  --set=sync_user="$DB_SYNC_USERNAME" \
  --set=report_user="$DB_REPORT_USERNAME" <<'SQL'
select format('grant roadops_api to %I', :'app_user')
where exists (select 1 from pg_roles where rolname = 'roadops_api')
\gexec

select format('grant roadops_sync to %I', :'sync_user')
where exists (select 1 from pg_roles where rolname = 'roadops_sync')
\gexec

select format('grant roadops_reporting to %I', :'report_user')
where :'report_user' <> ''
  and exists (select 1 from pg_roles where rolname = 'roadops_reporting')
\gexec
SQL

echo "Database migrations are current."
