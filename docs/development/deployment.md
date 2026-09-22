# Deployment, backups and rollback

How A.ai runs in production and how to release, roll back and recover. Design: [ADR-017](../decisions/ADR-017-production-hosting.md). Checklist: [release-checklist.md](release-checklist.md). First-time setup, step by step: [deployment-guide.md](deployment-guide.md).

The live production deployment runs on `ajaydabhi.site` (ADR-017, amendment of 2026-09-22); the exact values are in [Live production values](#live-production-values). Elsewhere in this file `example.com` stands for whatever domain an environment uses — staging has its own.

## Topology

| Part        | Service             | Address                           | Config                          |
| ----------- | ------------------- | --------------------------------- | ------------------------------- |
| Web app     | Vercel              | `https://aai.ajaydabhi.site`      | `apps/web/vercel.json`          |
| API         | Render web service  | `https://api.ajaydabhi.site`      | `render.yaml`                   |
| Cleanup job | Render cron, daily  | —                                 | `render.yaml`                   |
| Database    | Supabase PostgreSQL | pooled `6543`, direct `5432`      | `DATABASE_URL`, `DIRECT_URL`    |
| Redis       | Upstash             | `rediss://…`                      | `REDIS_URL`                     |
| Files       | Supabase Storage    | private bucket `a-ai-attachments` | `SUPABASE_*`                    |
| Errors      | Sentry (optional)   | —                                 | `SENTRY_DSN`, `VITE_SENTRY_DSN` |

Environments: **production**, **staging** (same shape, separate projects) and **test** (used only by `pnpm test:live` in CI). Never point staging or test at production data.

## One-time setup

### 1. Supabase

1. Create the production project in the region closest to your users. Settings → Database: copy the pooled connection string (port 6543) as `DATABASE_URL` and the direct one (port 5432) as `DIRECT_URL`.
2. Storage → New bucket `a-ai-attachments`, **Public: off**. Settings → API: copy the project URL (`SUPABASE_URL`) and the `service_role` key (`SUPABASE_SERVICE_ROLE_KEY`). The service-role key goes to the API only.
3. Database → Backups: confirm daily backups; enable point-in-time recovery if the plan offers it.
4. Repeat for staging and for the test project (the test project needs no bucket).

### 2. Upstash

Create a Redis database per environment (TLS on). Copy the `rediss://` URL as `REDIS_URL`.

### 3. Render (API)

1. New → Blueprint → select the repository; Render reads `render.yaml`. Change `region` there first if Singapore is not closest to your users.
2. Fill every variable marked `sync: false` (table below). `CORS_ORIGIN` and `APP_URL` are the web app's origin, `https://aai.ajaydabhi.site` in production.
3. Settings → Custom Domain: add `api.ajaydabhi.site` and create the CNAME Render shows at your DNS provider (it points at the service's `*.onrender.com` host). Render issues the certificate; the domain shows **Verified** when both are ready.
4. Settings → Deploy Hook: copy the URL (it is a secret).
5. The first deploy runs `pnpm db:deploy` before starting. Check `https://api.example.com/ready` returns `ready`.

### 4. Vercel (web)

1. Add New → Project → the repository. **Root Directory:** `apps/web` (framework, build and output come from `vercel.json`).
2. Environment variables (Production): `VITE_API_URL=https://api.ajaydabhi.site`, and optionally `VITE_SENTRY_DSN`. It is read at build time, so changing it needs a redeploy.
3. Domains: add `aai.ajaydabhi.site` and create the DNS record Vercel shows.
4. Settings → Git → Deploy Hooks: create one for `main` and copy it (a secret). Turn off automatic production deployments from Git, so only the Deploy workflow releases.

### 5. Sentry (optional)

Create two projects (Node for the API, React for the web). Put the API DSN in Render (`SENTRY_DSN`) and the browser DSN in Vercel (`VITE_SENTRY_DSN`). In Sentry project settings, keep "Data Scrubber" and "Scrub IP addresses" on; the SDKs already strip headers, cookies, bodies and query strings.

### 6. GitHub

Settings → Environments:

| Environment  | Secrets                                                  | Variables               | Protection             |
| ------------ | -------------------------------------------------------- | ----------------------- | ---------------------- |
| `test`       | `TEST_DATABASE_URL`, `TEST_DIRECT_URL`, `TEST_REDIS_URL` | —                       | —                      |
| `staging`    | `RENDER_DEPLOY_HOOK_URL`, `VERCEL_DEPLOY_HOOK_URL`       | `API_URL`, `WEB_ORIGIN` | —                      |
| `production` | `RENDER_DEPLOY_HOOK_URL`, `VERCEL_DEPLOY_HOOK_URL`       | `API_URL`, `WEB_ORIGIN` | Required reviewer: you |

Settings → Branches: require the `CI` checks (`Typecheck, lint, test, build` and `Browser smoke`) before merging to `main`.

## API environment variables (Render)

| Variable                                               | Required     | Value / source                                                        |
| ------------------------------------------------------ | ------------ | --------------------------------------------------------------------- |
| `NODE_ENV`                                             | yes          | `production` (in `render.yaml`)                                       |
| `DATABASE_URL`, `DIRECT_URL`                           | yes          | Supabase pooled and direct connection strings                         |
| `REDIS_URL`                                            | yes          | Upstash, `rediss://`                                                  |
| `JWT_SECRET`                                           | yes          | 48+ random bytes; rotating it signs everyone out                      |
| `CORS_ORIGIN`, `APP_URL`                               | yes          | `https://app.example.com`                                             |
| `RESEND_API_KEY`, `EMAIL_FROM`                         | yes          | Resend, with a verified sending domain                                |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` | at least one | Provider dashboards; check quotas for expected traffic                |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`            | for uploads  | Supabase (both or neither)                                            |
| `CHAT_SUGGESTIONS_ENABLED`                             | no           | `true` (default) suggests follow-up questions after each answer       |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_API_TOKEN`     | for images   | Cloudflare Workers AI REST API token (both or neither); needs storage |
| `TRUST_PROXY_HOPS`                                     | no           | `1` on Render (in `render.yaml`)                                      |
| `SENTRY_DSN`                                           | no           | Sentry API project                                                    |
| `RENDER_GIT_COMMIT`                                    | automatic    | Set by Render; `/health` reports it                                   |

`pnpm check:env` validates a set of variables without printing values.

## Live production values

Recorded 2026-09-22. None of these is a secret; every secret stays in the Render, Vercel and GitHub dashboards.

| Setting                  | Where                              | Value                                                      |
| ------------------------ | ---------------------------------- | ---------------------------------------------------------- |
| Web app                  | Vercel, root directory `apps/web`  | `https://aai.ajaydabhi.site`                               |
| API                      | Render web service `a-ai-api`      | `https://api.ajaydabhi.site`                               |
| `aai` DNS record         | domain registrar                   | CNAME to the host Vercel shows                             |
| `api` DNS record         | domain registrar                   | CNAME to `a-ai-csbq.onrender.com`                          |
| `CORS_ORIGIN`, `APP_URL` | Render                             | `https://aai.ajaydabhi.site`                               |
| `VITE_API_URL`           | Vercel, Production                 | `https://api.ajaydabhi.site`                               |
| `API_URL`, `WEB_ORIGIN`  | GitHub environment `production`    | `https://api.ajaydabhi.site`, `https://aai.ajaydabhi.site` |
| `KEEP_ALIVE_URL`         | GitHub Actions variable (optional) | defaults to `https://api.ajaydabhi.site/health`            |

The apex `ajaydabhi.site` and `www` serve a different site; A.ai only owns the two labels above.

**If the API subdomain ever fails** (DNS, certificate, or a Render domain change): clear `VITE_API_URL` in Vercel and redeploy. The app falls back to `/api` on its own origin, which `apps/web/vercel.json` rewrites to the same API, and sessions keep working because the cookies are then same-origin.

## Releasing

1. Merge to `main` with CI green.
2. Actions → **Deploy** → Run workflow → choose `staging` first.
3. The workflow:
   - runs `pnpm verify`, the browser smoke and the live tests on the commit;
   - triggers both deploy hooks;
   - waits for `https://api…/health` to report the commit, then runs `pnpm smoke`.
4. Check the staging app by hand (sign up, chat, compare, history), then run the workflow for `production`.
5. Record in the roadmap:
   - the commit;
   - the Render deploy id and the Vercel deployment URL;
   - the smoke output.

Run the deployment smoke by hand at any time:

```bash
pnpm smoke --api https://api.ajaydabhi.site --web https://aai.ajaydabhi.site
```

It calls no AI provider and creates one short-lived guest session.

## Rolling back

Code first, data never needs to move for a code rollback because migrations are additive.

1. **API:** Render → a-ai-api → Events → the previous successful deploy → **Rollback**. Migrations are not re-run.
2. **Web:** Vercel → Deployments → the previous production deployment → **Instant Rollback**.
3. Run `pnpm smoke --api … --web …` against production. Health reports the commit that is live.
4. Open an issue with the request ids or Sentry events that triggered the rollback.

### Migration rules that keep rollback safe

- Add columns as nullable or with defaults; add tables; add indexes.
- Remove or rename a column only in a later release, after no deployed version reads it (expand → migrate → contract).
- A migration is never edited after release. To undo one, write a new migration.

## Backups and restore

| Data                                   | Backup                                                      | Restore                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL (accounts, history)         | Supabase daily backups; point-in-time recovery when enabled | Supabase → Database → Backups → restore. Restoring replaces the database: stop deploys, restore, run `pnpm smoke`. |
| Redis (sessions, quotas, job progress) | None; short-lived by design                                 | Nothing to restore. Guests get new sessions; signed-in users stay signed in (sessions are in PostgreSQL).          |
| Storage objects (images, videos)       | Not included in database backups                            | Lost files show "Unavailable" in the app. For stronger guarantees, add a scheduled bucket copy.                    |

Drill a restore on **staging** before launch and every quarter: restore yesterday's backup, run `pnpm test:live` against it and the smoke test, and note the time it took.

## Incidents

- Every error response carries a `requestId`, which is also the `x-request-id` response header. Search Render logs for it, or filter Sentry by the `requestId` tag.
- `/ready` failing with the process alive means a dependency is down: Supabase, Upstash or no provider key. Render's health check uses `/health`, so instances are not restarted in a loop during a dependency outage.
- A provider outage shows as fallback labels in chat (ADR-013) and `GET /api/providers/health`; it never takes the API down.
