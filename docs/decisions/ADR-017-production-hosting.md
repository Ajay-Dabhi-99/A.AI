# ADR-017: Production hosting, monitoring and release checks

**Status:** Accepted (2026-09-17, Phase 10)

## Context

Blueprint §16 Phase 10 covers the security review, performance, observability, production environment, backups and rollback documentation. Its gate: **the release candidate passes the full regression suite and a smoke test**. §18 names Vercel for the web app, a managed Node host for the API, Supabase and Upstash.

The product owner chose on 2026-09-17:

- Vercel + Render on their own domain.
- Sentry that is off without a DSN.
- A Playwright browser smoke plus an API smoke script.
- Manual deploys after the gate.

## Decisions

### 1. One site, two hosts: `app.<domain>` and `api.<domain>`

| Part     | Host                                          | Address                |
| -------- | --------------------------------------------- | ---------------------- |
| Web app  | Vercel (static build, `apps/web/vercel.json`) | `https://app.<domain>` |
| API      | Render web service (`render.yaml`)            | `https://api.<domain>` |
| Cleanup  | Render cron job, daily 03:30 UTC              | —                      |
| Database | Supabase PostgreSQL (production project)      | —                      |
| Redis    | Upstash (production database)                 | —                      |
| Files    | Supabase Storage, private bucket              | signed URLs            |

Both hosts share the registrable domain, so browser requests from the app to the API are **same-site**. The API's host-only cookies (`__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, ADR-008) are sent with credentialed `fetch`, and CORS allows exactly `https://app.<domain>`. Without a shared domain (`*.vercel.app` → `*.onrender.com`) the cookies would be third-party and blocked. The app calls the API directly (`VITE_API_URL`), so streams are not cut by a proxy's timeout.

### 2. Client addresses behind the proxy

Render terminates TLS and appends the client address to `X-Forwarded-For`. Fastify trusts exactly `TRUST_PROXY_HOPS` hops (production default 1). Fastify 5 deliberately ignores a plain hop count because it cannot check the peer's address, so the count is passed as a trust function. That is safe on Render, where the service port is reachable only through Render's proxy; on a host that exposes the port directly, set `TRUST_PROXY_HOPS=0`. Trusting every hop, as the Phase 0 setting did, lets a client choose its own address. That would defeat per-IP rate limits and guest IP hashing (security review S-1).

### 3. Error monitoring: Sentry, off without a DSN

- **API:** `SENTRY_DSN` loads `@sentry/node` at startup. Only unexpected errors (500s, unhandled rejections, startup failures) are reported, tagged with `requestId`, method and route. `beforeSend` removes request headers, cookies, bodies, query strings, user data, breadcrumbs and extras. `sendDefaultPii` is off, and tracing is off.
- **Web:** `VITE_SENTRY_DSN` loads `@sentry/react` after the first render. Route crashes show a recovery page and are reported with the same scrubbing.
- Without a DSN the SDK is never loaded and nothing is sent. Logs and `x-request-id` stay the primary tool (blueprint §14).

### 4. Release checks

| Check               | Where                                                                                                                                                                                                                                              | Uses real services?                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `pnpm verify`       | CI on every push and PR; deploy gate                                                                                                                                                                                                               | No                                  |
| Browser smoke       | `pnpm test:e2e`: Playwright runs the production build on desktop and mobile Chromium with every API call mocked, and the landing page under the production CSP                                                                                     | No                                  |
| Live infrastructure | `pnpm test:live` against the test Supabase project and Upstash database                                                                                                                                                                            | Test only                           |
| Deployment smoke    | `pnpm smoke --api --web --commit --wait`: health reports the deployed commit; readiness; security headers; error envelope; validation before providers; CORS allow and deny; guest cookie flags; models; capability status; web CSP and deep links | Production, **no AI provider call** |

The Deploy workflow is manual. It runs the gate on the exact commit, triggers both deploy hooks, waits until `GET /health` reports that commit, then runs the deployment smoke. A failed smoke fails the workflow; rollback is manual (§6).

### 5. Web security headers

`vercel.json` sets the following headers.

| Header                      | Value                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Content-Security-Policy`   | `script-src 'self'` (the pre-paint theme script moved from inline to `/theme-init.js`), `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`                                                                                                                                          |
| `Permissions-Policy`        | microphone only for the app itself (voice input), camera and geolocation off                                                                                                   |
| `X-Frame-Options`           | `DENY`                                                                                                                                                                         |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                                                                      |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                                                                                              |

`connect-src`, `img-src` and `media-src` allow `https:`. The API domain is only known per deployment, and signed Storage URLs live on the Supabase project domain. Scripts, the XSS-relevant directive, stay same-origin. Hashed assets are cached immutably; `index.html` is not.

### 6. Migrations, backups and rollback

- **Migrations** run in Render's pre-deploy step (`pnpm db:deploy`) before the new version takes traffic. They are **forward-only and additive** (expand, deploy, contract later), so the previous release keeps working against the new schema and a code rollback never needs a schema rollback.
- **Rollback:** Render "Rollback" to the previous deploy and Vercel "Instant Rollback" to the previous production deployment. Neither re-runs migrations. Both deployment ids are recorded per release.
- **Backups:**
  - Supabase daily backups, with point-in-time recovery when the plan includes it; a restore is drilled on staging before launch and quarterly.
  - Upstash holds only short-lived state (guest sessions, quotas, rate windows, job progress), which is acceptable to lose.
  - Storage objects are not part of database backups; losing them loses images, not accounts or history.

## Consequences

- Production needs a domain the owner controls, two Supabase projects (production, test), two Upstash databases, a Render paid plan (pre-deploy commands and cron) and a Vercel project.
- Nothing here can be verified end to end until those accounts exist. The smoke test is the first thing to run against them.
- Browser smoke tests need Chromium; they run in CI (the owner chose not to download browsers locally).
