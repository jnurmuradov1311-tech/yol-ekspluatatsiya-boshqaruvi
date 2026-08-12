# Vercel deployment for `apps/web`

Only the Next.js web application is deployed to Vercel. PHP, queue workers,
scheduler, PostgreSQL and Redis run elsewhere.

## Project settings

1. Import the GitHub repository as a new Vercel project.
2. Set **Root Directory** to `apps/web` and keep framework detection on Next.js.
3. Use Node.js 22 and the normal `npm run build` command.
4. Create separate Preview and Production environment values:
   - `NEXT_PUBLIC_API_BASE_URL=/api/v1`
   - `BACKEND_INTERNAL_URL=https://<php-api-host>`
   - `NEXT_PUBLIC_E2E_FIXTURES=false`
   - `NEXT_PUBLIC_MAP_STYLE_URL=https://<approved-style-host>/style.json`
   - `NEXT_PUBLIC_MAP_CSP_ORIGINS=https://<tile-host>,https://<glyph-host>`
5. Protect preview deployments. Preview must target a staging API and database;
   it must never point at production.
6. Configure the production custom domain and verify the resulting API rewrite,
   secure cookies, CSRF flow and logout before promoting traffic.

`BACKEND_INTERNAL_URL` is read by `next.config.ts` to create the server-side
`/api/v1/*` rewrite. This keeps browser requests same-origin. The PHP API still
restricts `WEB_URL` and `CORS_ALLOWED_ORIGINS` to exact trusted origins and trusts
forwarded headers only from its hosting proxy.

Secrets for YTP, RoadVision, Supabase, Redis, email and Slack do not belong in
Vercel because the browser/web tier does not use them. They stay in the PHP host's
secret manager. Never prefix a secret with `NEXT_PUBLIC_`.

## Promotion gate

Promote only a Git commit for which `ci.yml` and `security.yml` passed, the PHP
image digest was deployed to staging, migrations completed, and Playwright passed
against the same API contract. Vercel deployment success alone is not evidence
that RoadVision or YTP is configured.
