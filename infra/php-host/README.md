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

## Private inspection files and work guides

Both Compose files now mount a persistent `private-uploads` volume only into the
API at `/var/www/storage/app/private`. The API image creates that directory with
owner UID/GID 10001 and mode 0700 before a new named volume is populated. Uploaded
inspection photos and work instruction PDFs/videos survive API container
replacement. Never run `docker compose down -v` on a live installation: that
removes the named data volumes. Existing bind mounts or restored volumes must
retain owner 10001 and restrictive permissions.

Nginx accepts a 105 MiB request; PHP accepts a 100 MiB file inside a 105 MiB POST.
The application enforces smaller limits for inspection files and document guides,
and accepts up to 100 MiB for MP4 guides. API `/tmp` and gateway body-buffer storage
are 256 MiB each, so a large accepted upload is not blocked by the old 15 MiB
limits or 16/32 MiB proxy temporary disk. Monitor free space and scale these
buffers to the required concurrent upload volume. An upstream load balancer must
allow the same request size and upload duration.

This is private storage: the gateway does not mount it, no public URL maps to it,
and no `storage:link` command is needed. The authenticated content endpoints check
road-division access on each request; retired work guides cannot be opened. The
original bytes, their SHA256 digest, and audit metadata remain linked.

Back up the private volume together with the PostgreSQL database, retain the
application encryption key in the secret manager, and test restoring all three
to an isolated environment. On a multi-host deployment, replace the host-local
named volume with a persistent shared filesystem accessible by every API replica;
independent disks per replica are not supported. Inspect uploaded file persistence
by uploading a small real image and PDF, replacing the API container, then opening
both through the authorized application routes. Also confirm another road
division cannot open either file.

## Optional AI work recommendation

Only the API container receives the optional AI settings in Compose:
`WORK_RECOMMENDATION_AI_ENABLED`, `OPENAI_API_KEY`,
`OPENAI_WORK_RECOMMENDATION_MODEL`, and
`WORK_RECOMMENDATION_AI_TIMEOUT_SECONDS`. They default to disabled/empty and no
secret or model choice is embedded in the image. If enabled, inject the API key
from the secret manager, explicitly select the model, and permit API egress to
`api.openai.com` over HTTPS. The browser and ordinary worker processes do not
receive this key. Disable the feature to operate with explicit human work
selection. A model recommendation never publishes or starts a work order.
