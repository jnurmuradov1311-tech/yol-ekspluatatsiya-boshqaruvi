# PHP API production deployment

The Laravel API, integration worker and scheduler require a PHP 8.3 OCI-capable
container platform. They are **not** deployed as Vercel Functions. The web UI can
be on Vercel and uses a same-origin Next.js rewrite to this API.

## Required platform shape

- two or more API replicas behind managed TLS and health checks;
- independently scalable queue workers, with graceful shutdown longer than the
  110-second job timeout;
- exactly one active scheduler process, or a platform cron that invokes
  `php artisan schedule:run` once per minute;
- managed Redis with authentication, encryption and persistence appropriate for
  queues; configure Laravel failed-job persistence and alert on failures;
- Supabase/PostgreSQL with PITR/backups enabled and the private `roadops` schema
  excluded from the Data API;
- a dedicated `roadops_php` `INHERIT` login that is a member only of
  `roadops_api`. Laravel opens and reuses pooled PDO connections before request
  middleware runs, so inherited membership is the explicit runtime model; RLS,
  column grants and guarded `SECURITY DEFINER` workflows enforce the boundary.
  Never grant this login `roadops_sync` or `roadops_reporting`, and never use
  `postgres`, a database owner, `service_role`, or a browser key in the app;
- a distinct `roadops_sync_login` `INHERIT` login, known only to the API/worker/
  scheduler processes, that is a member of `roadops_sync`; do not reuse the API
  login because source-owned writes must remain distinguishable and constrained;
- optionally, a separate `INHERIT` reporting login that is only a member of
  `roadops_reporting`; the migration script creates it only when both reporting
  username and password are supplied;
- egress to the explicitly approved YTP, RoadVision/S3, SMTP and notification
  endpoints only.

For autoscaled stateless containers, Supabase's transaction pooler can be tested
on port 6543. For stable long-lived containers, evaluate the session pooler or a
direct IPv6 connection. The chosen mode must be load-tested with the exact PDO
settings before production; do not assume prepared-statement compatibility.

## Release order

1. Back up and verify restore capability; take a database advisory/change lock.
2. Run the immutable API image once with `roadops-apply-migrations` using a
   short-lived database-owner credential from the platform secret manager. The
   owner credential must exist only in this one-shot migration job; API, worker,
   scheduler and web containers never receive it.
3. If the migration job fails or records `FAILED`, stop. Inspect the database and
   add a forward migration; never edit or blindly replay an applied file.
4. Roll API and workers with health checks. Keep the prior image digest available.
5. Deploy the Vercel web build only after the API contract checks and health pass.
6. Execute smoke tests: login/CSRF, scoped dashboard, one idempotent no-op test in
   a staging tenant, webhook signature rejection and planner blocker output.

`compose.production.example.yml` documents process separation. A real platform
must inject all sensitive values from its secret manager, use immutable image
digests, provide TLS and configure replica counts/availability primitives. Do not
copy it verbatim into production.

## Rollback

Application rollback means switching API/gateway image digests back. Database
schema rollback is forward-only: ship a corrective migration. Restore from PITR
only through an approved incident procedure because it can discard operational
history and integration offsets.
