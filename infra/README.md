# Infrastructure

The local stack is production-shaped but not a production control plane:

- Nginx exposes one origin on port 8080;
- Next.js runs as a non-root standalone server;
- Laravel PHP-FPM, worker and scheduler are separate non-root containers;
- PostgreSQL 17 with PostGIS and Redis 7.4 are local dependencies;
- SQL migrations are ordered, checksummed and refuse edited or ambiguous reruns.
- the migration job provisions separate API and sync logins; an optional
  reporting login is created only when both reporting credentials are supplied.

Start locally:

```bash
cp infra/local.env.example .env
# generate APP_KEY and unique database passwords, then edit .env
make up
```

Run future schema changes only with `make migrate` (the one-shot
`roadops-apply-migrations` container). The schema uses ordered SQL files and is
not managed by `php artisan migrate`.

Never commit `.env`. Local volumes are retained by `make down`. Removing volumes
deletes local state and is intentionally not automated by the Makefile.

Production guidance is split between `vercel/` for the web app and `php-host/`
for the PHP/worker/scheduler containers. A container orchestrator, TLS, managed
data stores, secret manager, backups, monitoring and alerting remain required.
The supplied Nginx gateway emits HSTS for production traffic; expose it only
behind a TLS terminator that preserves the original HTTPS scheme. The local
plain-HTTP port is for development and HSTS is ignored there by conforming
browsers.
