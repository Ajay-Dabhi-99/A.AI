# Deployment guide: A.ai from zero to production

This guide takes you from a fresh clone to a live, verified release of A.ai. It is based on the code and configuration in this repository. Design decisions: [ADR-005](../decisions/ADR-005-infrastructure.md) and [ADR-017](../decisions/ADR-017-production-hosting.md). Short operator reference: [deployment.md](deployment.md). Per-release checklist: [release-checklist.md](release-checklist.md).

A printable, click-by-click version (41 numbered steps) is in [A.ai-Deployment-Guide.pdf](A.ai-Deployment-Guide.pdf) and [A.ai-Deployment-Guide.docx](A.ai-Deployment-Guide.docx).

No custom domain yet (site on `*.vercel.app`, API on `*.onrender.com`, Render free plan)? Follow [A.ai-Free-Hosting-Guide.pdf](A.ai-Free-Hosting-Guide.pdf) ([.docx](A.ai-Free-Hosting-Guide.docx)) instead: it forwards `/api` through Vercel so sign-in cookies work.

Replace `example.com` with your own domain throughout. The live deployment this repository releases uses `aai.ajaydabhi.site` (web) and `api.ajaydabhi.site` (API); its settings are listed in [deployment.md → Live production values](deployment.md#live-production-values).

---

## 1. What gets deployed

```
                    Browser
                       |
         +-------------+--------------+
         |                            |
 https://app.example.com     https://api.example.com
   Vercel (static SPA)        Render web service (Fastify, Node 22)
   apps/web  -> dist/         apps/api -> dist/server.js
                                     |
            +------------------------+-------------------------+
            |                        |                         |
   Supabase PostgreSQL        Upstash Redis            Supabase Storage
   (accounts, chats,          (guest sessions,         (private bucket
    history, registry)         quotas, rate limits,     a-ai-attachments)
                               job progress)
                                     |
                     AI providers: Gemini, Groq, OpenRouter
                     Email: Resend    Errors: Sentry (optional)

   Render cron job "a-ai-attachments-cleanup": daily 03:30 UTC
```

| Part         | Host                | Built from                               | Config file            |
| ------------ | ------------------- | ---------------------------------------- | ---------------------- |
| Web app      | Vercel              | `apps/web` (Vite build → `dist`)         | `apps/web/vercel.json` |
| API          | Render web service  | `apps/api` (tsc → `dist/server.js`)      | `render.yaml`          |
| Cleanup job  | Render cron         | `scripts/cleanup-attachments.ts`         | `render.yaml`          |
| Database     | Supabase PostgreSQL | `prisma/schema.prisma`, `migrations`     | `prisma.config.ts`     |
| Cache/limits | Upstash Redis       | —                                        | `REDIS_URL`            |
| Files        | Supabase Storage    | —                                        | `SUPABASE_*`           |
| CI / release | GitHub Actions      | `.github/workflows/ci.yml`, `deploy.yml` | GitHub environments    |

Docker is not used anywhere (ADR-005).

### One repository runs everything

The whole product lives in one GitHub repository (a monorepo), and each service reads a different part of it:

| Service        | Connects to            | Reads                                        |
| -------------- | ---------------------- | -------------------------------------------- |
| GitHub Actions | the repository         | `.github/workflows/ci.yml`, `deploy.yml`     |
| Render         | same repo, branch main | `render.yaml` (API, cron job, migrations)    |
| Vercel         | same repo, branch main | Root Directory `apps/web` + `vercel.json`    |
| Supabase       | no Git link            | receives migrations from Render's pre-deploy |

Pushing code never releases anything: `render.yaml` sets `autoDeploy: false`, and Vercel's Git deployments are switched off (section 7). A release happens only when you run **Actions → Deploy**, which calls both deploy hooks after the full gate passes.

Settings are kept apart by kind:

- build and start commands live in Git (`render.yaml`, `vercel.json`);
- API secrets live in the Render dashboard;
- `VITE_API_URL` lives in Vercel;
- deploy hooks and test database URLs live in GitHub environment secrets.

Branch flow: work on `develop` or `feature/*`, open a PR into `main` (CI must be green), merge, then run Deploy. Staging is optional. It uses the same repo and branch, with a second Render web service, a second Vercel project on the same repo, and a GitHub `staging` environment.

### Why a custom domain is required

The API signs users in with host-only cookies (`__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax`; see ADR-008). The browser only sends them to the API when the app and API are **same-site**, which means they must share a registrable domain: `app.example.com` and `api.example.com`.

If you use the default hosts instead (`*.vercel.app` calling `*.onrender.com`), the cookies are third-party. Browsers block them, so sign-in and guest sessions will not work. You need a domain you control before you deploy.

---

## 2. Prerequisites

### Accounts

| Service                    | Plan needed                              | Used for                                                 |
| -------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| GitHub                     | Any                                      | Code, CI, the manual Deploy workflow                     |
| Domain registrar           | Any, with DNS editing                    | `app.` and `api.` subdomains                             |
| Supabase                   | 2–3 projects (production, staging, test) | PostgreSQL + Storage                                     |
| Upstash                    | 2–3 Redis databases                      | Sessions, quotas, rate limits                            |
| Render                     | **Paid** (Starter or higher)             | Pre-deploy migration step and cron jobs need a paid plan |
| Vercel                     | Any                                      | Static web hosting                                       |
| Resend                     | Any, with a **verified domain**          | Verification and password-reset emails                   |
| Gemini / Groq / OpenRouter | At least one API key                     | AI responses. Groq also enables voice input.             |
| Sentry                     | Optional                                 | Error reports                                            |

### Local tools (for the checks and one-off commands)

- Node.js **22.13 or newer** (Render pins `22.16.0`)
- pnpm **10** (`corepack enable` activates the version pinned in `package.json`)
- Git

```bash
corepack enable
pnpm install
pnpm verify
```

`pnpm install` also runs `prisma generate`, which creates the Prisma client in `apps/api/src/generated/prisma`. `pnpm verify` must pass before you deploy anything.

---

## 3. Generate secrets

`JWT_SECRET` signs cookies and hashes session and email-link tokens. It must be at least 32 characters; use 48 random bytes. Generate a **different** value for each environment:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Rotating it later signs every user out and invalidates any open email links.

Store all secrets in a password manager. Never commit them. `.env` is git-ignored, and `render.yaml` marks every secret `sync: false`.

---

## 4. Supabase (database and file storage)

Repeat this for **production** and **staging**. For the **test** project, do steps 1–2 only (it needs no bucket).

1. **Create a project** in the region closest to your users. Choose the same region as your Render service (the Blueprint defaults to Singapore).
2. **Connection strings:** click **Connect** and copy both strings:
   - **Pooled** (Supavisor, port `6543`) → `DATABASE_URL`. The running API uses this one.
   - **Direct** (port `5432`) → `DIRECT_URL`. `prisma migrate deploy` uses this one (see `prisma.config.ts`).

   Both must start with `postgres://` or `postgresql://`. Put the database password into the string, URL-encoded if it contains special characters.

3. **Storage bucket:** go to Storage → New bucket and name it `a-ai-attachments`. Turn **Public off**. The API serves files through signed URLs only.
4. **API keys:** in Project Settings → API, copy:
   - the Project URL → `SUPABASE_URL` (an origin such as `https://xxxx.supabase.co`, with no path);
   - the `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`.

   The service-role key goes to the **API only**, never to Vercel. Set both variables or neither; the API refuses to start with only one. With neither, image uploads are turned off.

5. **Backups:** in Database → Backups, confirm that daily backups run. Turn on point-in-time recovery if your plan has it.

**Row Level Security:** every migration in `prisma/migrations` enables RLS on the tables it creates. The API connects as the database owner through Prisma, so RLS does not block it, but it closes Supabase's public Data API to those tables. If you add a table later, enable RLS in the same migration.

You do not run migrations by hand in production. Render runs `pnpm db:deploy` before every release (see section 6).

---

## 5. Upstash (Redis)

For each environment:

1. Create a Redis database in the region closest to your Render service. Keep **TLS on**.
2. Open **Connect**, choose **TCP / ioredis**, and copy the URL → `REDIS_URL`.

In production the URL **must** start with `rediss://` (with TLS); the API refuses to start otherwise. Redis holds only short-lived data (guest sessions, quotas, rate-limit windows, job progress), so it needs no backups.

---

## 6. Render (API and cleanup job)

`render.yaml` defines two services:

| Service                    | Type                | Build                                                                                                                  | Start                          |
| -------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `a-ai-api`                 | web                 | `corepack enable && NODE_ENV=development pnpm install --frozen-lockfile && pnpm turbo run build --filter=@a-ai/api...` | `node apps/api/dist/server.js` |
| `a-ai-attachments-cleanup` | cron (`30 3 * * *`) | `corepack enable && NODE_ENV=development pnpm install --frozen-lockfile`                                               | `pnpm attachments:cleanup`     |

The API also has:

- **Pre-deploy command:** `pnpm db:deploy` applies pending migrations before the new version gets traffic.
- **Health check:** `/health`. It checks only that the process is alive, so an outage in Supabase or Upstash does not cause a restart loop.
- **`autoDeploy: false`:** only the GitHub Deploy workflow releases.

`NODE_ENV=development` during install is intentional. Otherwise pnpm skips the dev dependencies that the build needs (TypeScript, turbo, tsx). The app itself runs with `NODE_ENV=production`.

### Steps

1. **Region:** Render uses `region: singapore` from `render.yaml`. To change it, edit `render.yaml` for both services and commit the change **before** you create the Blueprint.
2. Go to Render → **New → Blueprint**, connect the GitHub repository, and select the `main` branch. Render reads `render.yaml` and creates both services.
3. **Fill the secret variables.** Render prompts for every `sync: false` variable. Use the tables below.
4. **Custom domain:** open `a-ai-api` → Settings → Custom Domains, add `api.example.com`, and create the CNAME record Render shows at your DNS provider. Wait until Render reports the certificate as issued.
5. **Deploy hook:** open `a-ai-api` → Settings → Deploy Hook and copy the URL. It is a secret; you will store it in GitHub in section 11.
6. **First deploy:** trigger a manual deploy once, then check it:

   ```bash
   curl https://api.example.com/health
   curl https://api.example.com/ready
   ```

   `/health` returns `{"status":"ok",…,"commit":"<sha>"}`. `/ready` returns HTTP 200 with status `ready` once PostgreSQL, Redis and at least one AI provider key are all working. It returns 503 if any of them is not.

### API variables (`a-ai-api`)

Already set by `render.yaml`: `NODE_VERSION=22.16.0`, `NODE_ENV=production`, `HOST=0.0.0.0`, `LOG_LEVEL=info`, `TRUST_PROXY_HOPS=1`, `SUPABASE_STORAGE_BUCKET=a-ai-attachments`, `SENTRY_ENVIRONMENT=production`. Render sets `PORT` and `RENDER_GIT_COMMIT` itself.

You fill in the following variables:

| Variable                    | Required         | Value                                                                                 |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | yes              | Supabase pooled string (port 6543)                                                    |
| `DIRECT_URL`                | yes              | Supabase direct string (port 5432), used by migrations                                |
| `REDIS_URL`                 | yes              | Upstash `rediss://…`                                                                  |
| `JWT_SECRET`                | yes              | From section 3 (32+ characters)                                                       |
| `CORS_ORIGIN`               | yes              | `https://app.example.com` (exact origin, `https://`, no path; comma-separate several) |
| `APP_URL`                   | yes              | `https://app.example.com` (used in email links)                                       |
| `RESEND_API_KEY`            | yes (production) | From section 8. The API will not start in production without it.                      |
| `EMAIL_FROM`                | yes              | `A.ai <no-reply@example.com>`, on a domain verified in Resend                         |
| `GEMINI_API_KEY`            | at least one     | Google AI Studio                                                                      |
| `GROQ_API_KEY`              | at least one     | Groq console (also enables voice input)                                               |
| `OPENROUTER_API_KEY`        | at least one     | OpenRouter                                                                            |
| `SUPABASE_URL`              | for uploads      | Supabase Project URL (set together with the key)                                      |
| `SUPABASE_SERVICE_ROLE_KEY` | for uploads      | Supabase `service_role` key                                                           |
| `SENTRY_DSN`                | no               | Sentry Node project DSN; leave empty to send nothing                                  |

A provider without a key is disabled, never faked. Leave an unused provider key empty.

Optional tuning variables and their defaults (from `packages/config/src/server.ts`):

| Variable                    | Default    | Range / meaning                                |
| --------------------------- | ---------- | ---------------------------------------------- |
| `GUEST_SESSION_TTL_MINUTES` | `1440`     | 5–10080                                        |
| `GUEST_DAILY_MESSAGE_LIMIT` | `20`       | 1–1000                                         |
| `USER_DAILY_MESSAGE_LIMIT`  | `200`      | 1–100000                                       |
| `GUEST_COMPARE_MAX_MODELS`  | `2`        | 2–4 models per comparison                      |
| `USER_COMPARE_MAX_MODELS`   | `4`        | 2–4                                            |
| `CONTEXT_SUMMARY_ENABLED`   | `true`     | Summarize long chats (ADR-012)                 |
| `CHAT_FALLBACK_ENABLED`     | `true`     | Another model answers when one fails (ADR-013) |
| `ATTACHMENT_MAX_BYTES`      | `5242880`  | 100 KiB–20 MiB                                 |
| `AUDIO_MAX_BYTES`           | `10485760` | 100 KiB–25 MiB                                 |
| `VIDEO_MAX_BYTES`           | `52428800` | 1 MiB–200 MiB                                  |

`TRUST_PROXY_HOPS=1` is correct on Render because the service port is reachable only through Render's proxy. On a host that exposes the port directly, set it to `0`. Never set it higher than the real number of proxies, or clients could fake their IP address and get around rate limits.

### Cleanup cron variables (`a-ai-attachments-cleanup`)

Set `DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the same values as the API.

### Validate the variables without printing them

On your machine, put the production values in a temporary `.env` with `NODE_ENV=production` (and delete the file afterwards), or open the Render Shell, then run:

```bash
pnpm check:env
```

It prints only which settings are valid, whether `DIRECT_URL` is set and which providers are configured. It never prints values.

---

## 7. Vercel (web app)

`apps/web/vercel.json` already defines:

- **Install:** `cd ../.. && pnpm install --frozen-lockfile` (the whole monorepo)
- **Build:** `cd ../.. && pnpm turbo run build --filter=@a-ai/web...`
- **Output:** `dist`
- **SPA rewrite:** every path serves `index.html`, so deep links work.
- **Security headers:** a strict CSP (`script-src 'self'`, `frame-ancestors 'none'`), HSTS, `X-Frame-Options: DENY`, `nosniff`, a Referrer-Policy, a Permissions-Policy (microphone for the app only), COOP.
- **Caching:** immutable caching for `/assets/*`. `index.html` is not cached.

### Steps

1. Go to Vercel → **Add New → Project** and import the repository.
2. Set **Root Directory** to `apps/web`. Leave framework, build and output settings as they are; `vercel.json` supplies them.
3. Add these **environment variables** for Production (and Preview if you use it):

   | Variable          | Value                                                                      |
   | ----------------- | -------------------------------------------------------------------------- |
   | `VITE_API_URL`    | `https://api.example.com` (an origin only, with no path or trailing slash) |
   | `VITE_SENTRY_DSN` | Optional: the Sentry React project DSN                                     |

   `VITE_*` values are **baked in at build time** and are visible to every visitor. Never put a secret here. After you change one, redeploy.

4. **Domain:** in Settings → Domains, add `app.example.com` and create the DNS record Vercel shows.
5. **Deploy hook:** in Settings → Git → Deploy Hooks, create a hook for branch `main` and copy the URL (a secret).
6. **Turn off automatic Git deployments**, so that only the Deploy workflow releases, after the gate has passed. Add `"git": { "deploymentEnabled": false }` to `apps/web/vercel.json` (a documented Vercel setting). After the first Deploy workflow run, confirm that Vercel → Deployments shows a deployment created by the hook; if it does not, remove the setting and let Vercel deploy on push instead.

---

## 8. Resend (email)

Sign-up verification and password-reset emails go through Resend. The production API **refuses to start** without `RESEND_API_KEY`.

1. In Resend → **Domains**, add `example.com` (or a subdomain such as `mail.example.com`). Add the SPF, DKIM (and optionally DMARC) records it shows, then wait until the domain is **Verified**.
2. In **API Keys**, create a key with sending access → `RESEND_API_KEY`.
3. Set `EMAIL_FROM` to an address on the verified domain, for example `A.ai <no-reply@example.com>`.

The default `onboarding@resend.dev` sender delivers only to your own Resend account address, so real users would never receive their emails.

---

## 9. Sentry (optional)

1. Create two projects: **Node.js** (API) and **React** (web).
2. Set the API DSN as `SENTRY_DSN` on Render and the browser DSN as `VITE_SENTRY_DSN` on Vercel.
3. In each Sentry project's settings, keep **Data Scrubber** and **Scrub IP addresses** on.

Without a DSN, the SDKs are never loaded and nothing is sent. When a DSN is set, only unexpected errors are reported. They are tagged with `requestId`, and headers, cookies, bodies and query strings are removed before sending.

---

## 10. DNS summary

| Record            | Type                        | Points to                | Created in |
| ----------------- | --------------------------- | ------------------------ | ---------- |
| `app.example.com` | CNAME / A (as Vercel shows) | Vercel                   | Section 7  |
| `api.example.com` | CNAME                       | Your Render service host | Section 6  |
| Resend SPF/DKIM   | TXT / CNAME / MX            | As Resend shows          | Section 8  |

Use the same parent domain for `app.` and `api.` (see section 1).

---

## 11. GitHub (CI and the Deploy workflow)

### Workflows in the repository

| Workflow     | Trigger                                                            | What it does                                                                                           |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `ci.yml`     | Every PR; pushes to `main`/`develop`                               | Format check, lint, typecheck, unit tests, integration tests, build; then the Playwright browser smoke |
| `deploy.yml` | **Manual** (`workflow_dispatch`), target `staging` or `production` | Full gate → both deploy hooks → waits for `/health` to report the commit → release smoke               |

### Environments

Go to Settings → **Environments** and create:

| Environment  | Secrets                                                  | Variables                                                                               | Protection             |
| ------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------- |
| `test`       | `TEST_DATABASE_URL`, `TEST_DIRECT_URL`, `TEST_REDIS_URL` | —                                                                                       | —                      |
| `staging`    | `RENDER_DEPLOY_HOOK_URL`, `VERCEL_DEPLOY_HOOK_URL`       | `API_URL=https://api.staging.example.com`, `WEB_ORIGIN=https://app.staging.example.com` | —                      |
| `production` | `RENDER_DEPLOY_HOOK_URL`, `VERCEL_DEPLOY_HOOK_URL`       | `API_URL=https://api.example.com`, `WEB_ORIGIN=https://app.example.com`                 | Required reviewer: you |

The `test` secrets must point to a **separate** Supabase project and Upstash database, never production. `pnpm test:live` applies migrations to the test database and writes test data there.

For staging, create a second Render Blueprint and a second Vercel project, with their own Supabase and Upstash resources and staging subdomains.

### Branch protection

In Settings → Branches → `main`, require the checks **Typecheck, lint, test, build** and **Browser smoke (Playwright, mocked API)** before merging.

---

## 12. Releasing

1. Merge to `main` with CI green.
2. Go to **Actions → Deploy → Run workflow** and choose **staging**.
3. The workflow then:
   1. **Gate** (`test` environment): `pnpm install --frozen-lockfile`, `pnpm verify`, installs Chromium, runs `pnpm test:e2e` and `pnpm test:live`.
   2. **Settings check:** fails if any deploy hook or URL is missing (values are never printed).
   3. **Deploy hooks:** sends a POST to the Render and Vercel hooks. Render builds the API, runs `pnpm db:deploy`, then swaps in the new version.
   4. **Release smoke:**
      ```bash
      pnpm smoke --api "$API_URL" --web "$WEB_ORIGIN" --commit "$GITHUB_SHA" --wait 900
      ```
      This waits up to 15 minutes for `/health` to report the new commit, then checks readiness, security headers, the error envelope and request id, validation before any provider call, CORS allow and deny, guest cookie flags, the model list, capability status, the web CSP and deep links. It **calls no AI provider**.
4. Test staging by hand: sign up and verify the email, chat as a guest until the quota is hit, chat while signed in and reload, run a comparison, check history and the dashboard.
5. Run the workflow again for **production** (approve it when GitHub asks).
6. Record the commit SHA, Render deploy id, Vercel deployment URL and smoke output in [roadmap.md](roadmap.md).

You can run the smoke test by hand at any time:

```bash
pnpm smoke --api https://api.example.com --web https://app.example.com
```

---

## 13. After the first production deploy

1. **Model registry:** the API fills the registry with the default models the first time it loads them, so no seed step is needed. To seed explicitly, run `pnpm db:seed` (idempotent; it never overwrites admin edits).
2. **Create the first admin.** Sign up in the app, verify your email, then run the following from the Render Shell for `a-ai-api`, or locally with the production `DATABASE_URL` in `.env`:

   ```bash
   pnpm admin:promote you@example.com
   ```

   There is deliberately no API for granting admin rights. Revoke them with `--revoke`. If you used a local `.env`, delete the production values from it afterwards.

3. **Cleanup job:** open `a-ai-attachments-cleanup` in Render and use **Trigger Run** once to confirm it finishes successfully.
4. **Provider quotas:** check the rate limits and billing caps for each provider key against the traffic you expect.
5. Work through the rest of [release-checklist.md](release-checklist.md).

---

## 14. Rolling back

Migrations are forward-only and additive, so a code rollback never needs a database rollback.

1. **API:** in Render → `a-ai-api` → Events, pick the previous successful deploy and click **Rollback**. Migrations are not re-run.
2. **Web:** in Vercel → Deployments, pick the previous production deployment and click **Instant Rollback**.
3. Run `pnpm smoke --api … --web …`. `/health` shows which commit is live.
4. Open an issue with the request ids or Sentry events that led to the rollback.

Migration rules that keep rollback safe:

- Add tables, nullable columns, columns with defaults, and indexes.
- Remove or rename a column only in a later release, once no deployed version reads it (expand → migrate → contract).
- Never edit a migration after it has been released. To undo one, write a new migration.

---

## 15. Backups and restore

| Data                           | Backup                                                    | Restore                                                                                   |
| ------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| PostgreSQL (accounts, history) | Supabase daily backups; point-in-time recovery if enabled | Supabase → Database → Backups. Stop deploys, restore, then run `pnpm smoke`.              |
| Redis (sessions, quotas, jobs) | None (short-lived by design)                              | Nothing to restore. Guests get new sessions; signed-in sessions live in PostgreSQL.       |
| Storage (images, videos)       | Not in database backups                                   | Lost files show as "Unavailable" in the app. Add a scheduled bucket copy if files matter. |

Practise a restore on **staging** before launch and every quarter. Restore yesterday's backup, run `pnpm test:live` and the smoke test against it, and note how long it took.

---

## 16. Troubleshooting

The API validates its whole environment at startup and exits with a list of the problem variables (never their values). Check the Render deploy log first.

| Symptom                                                                  | Cause and fix                                                                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `REDIS_URL: production requires TLS (rediss://)`                         | Use the Upstash TLS URL, which starts with `rediss://`.                                                                        |
| `CORS_ORIGIN.0: production origins must use https://`                    | Set `CORS_ORIGIN=https://app.example.com`, with no trailing slash or path.                                                     |
| `RESEND_API_KEY: production requires a real email provider`              | Add the Resend key (section 8).                                                                                                |
| `JWT_SECRET: must be at least 32 characters`                             | Generate a new one (section 3).                                                                                                |
| `set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY together`                | Set both variables, or clear both.                                                                                             |
| Pre-deploy `pnpm db:deploy` fails                                        | Check `DIRECT_URL` (direct connection, port 5432, correct password). Look for a failed migration under Supabase → Database.    |
| Build fails with `tsc`/`turbo` not found                                 | The install step must keep `NODE_ENV=development`, as `render.yaml` does.                                                      |
| `/health` works but `/ready` returns 503                                 | A dependency is down or not configured: the database, Redis, or **no provider key at all**. The response body names which one. |
| Sign-in "works" but the user is immediately signed out; guest chat fails | The app and API are not on the same parent domain, so cookies are blocked (section 1).                                         |
| Browser console shows CORS errors                                        | `CORS_ORIGIN` does not exactly match the app origin, including scheme and subdomain.                                           |
| The app calls the wrong API                                              | `VITE_API_URL` is baked in at build time. Fix it in Vercel, then redeploy.                                                     |
| Verification emails never arrive                                         | `EMAIL_FROM` is not on a verified Resend domain, or it is still `onboarding@resend.dev`.                                       |
| Image upload button missing or failing                                   | The Supabase Storage variables are not set, or the bucket `a-ai-attachments` does not exist.                                   |
| Microphone button missing                                                | `GROQ_API_KEY` is not set (voice input uses Groq Whisper).                                                                     |
| Deploy workflow times out waiting for the commit                         | The Render build or pre-deploy step failed; check the Render deploy log. `/health` must report `RENDER_GIT_COMMIT`.            |
| All users or guests hit rate limits together                             | `TRUST_PROXY_HOPS` is wrong for the host; it should be `1` on Render.                                                          |

Every error response includes a `requestId`, also sent as the `x-request-id` header. Search the Render logs for it, or filter Sentry by the `requestId` tag.

---

## 17. Quick checklist

- [ ] Domain with `app.` and `api.` subdomains
- [ ] Supabase: production, staging and test projects; private `a-ai-attachments` bucket; backups on
- [ ] Upstash: one `rediss://` database per environment
- [ ] Resend: domain verified, key created
- [ ] At least one AI provider key; quotas checked
- [ ] Render Blueprint created, all secrets filled, `api.` domain added, deploy hook copied
- [ ] Vercel project with root `apps/web`, `VITE_API_URL` set, `app.` domain added, deploy hook copied, auto production deploys off
- [ ] GitHub environments `test`, `staging` and `production` configured; branch protection on `main`
- [ ] Deploy to staging → smoke passes → manual checks
- [ ] Deploy to production → smoke passes
- [ ] First admin promoted; cleanup cron run once
- [ ] Release recorded in `roadmap.md`
