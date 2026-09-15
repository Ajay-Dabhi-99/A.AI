# Security review (Phase 10)

Reviewed on 2026-09-17 against blueprint §13 (security, rate limits, abuse) and §19 (definition of done), over the code at the Phase 9 commit plus the Phase 10 changes. Severity uses the blueprint scale: critical, high, medium, low.

## Findings

| ID  | Area          | Finding                                                                                                                                                        | Severity        | Status                                                                                                                                                                                            |
| --- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-1 | Rate limiting | `trustProxy: true` in production trusted every `X-Forwarded-For` hop, so a client could send its own address and escape per-IP rate limits and guest IP limits | High            | **Fixed:** exactly `TRUST_PROXY_HOPS` hops (production default 1); `tests/integration/hardening.test.ts`                                                                                          |
| S-2 | Web           | No Content-Security-Policy or other security headers on the web app; the pre-paint theme script was inline, which would force `'unsafe-inline'`                | Medium          | **Fixed:** `apps/web/vercel.json` headers; the theme script moved to `/theme-init.js`; the landing page is browser-tested under the production CSP                                                |
| S-3 | Observability | Unexpected production errors were only in host logs, with no alerting                                                                                          | Low             | **Fixed:** Sentry reporter (API and web), off without a DSN, scrubbed of headers, cookies, bodies, query strings and user data; unit-tested scrubbing                                             |
| S-4 | Web           | A crash in a page left a blank screen                                                                                                                          | Low             | **Fixed:** route error page with recovery and reporting; `apps/web/tests/error-page.test.tsx`                                                                                                     |
| S-5 | Release       | No automated check that a deployment serves the intended commit with the expected security posture                                                             | Medium          | **Fixed:** `pnpm smoke` (commit, readiness, headers, CORS allow/deny, cookie flags, error envelope, web CSP) in the Deploy workflow                                                               |
| D-1 | Dependencies  | `mysql2 3.15.3` inside the Prisma CLI: GHSA-3f6p-5ww8-9rcr (high), GHSA-rgwj-5xj2-c3m3 (moderate)                                                              | High            | **Fixed:** pnpm override to `3.23.1`. Not reachable anyway: A.ai uses PostgreSQL through `@prisma/adapter-pg`                                                                                     |
| D-2 | Dependencies  | `deepmerge-ts < 8` inside `@prisma/config`: GHSA-ggr8-5vv4-36mx (stack exhaustion on recursive object graphs)                                                  | High (advisory) | **Accepted, not exploitable here:** only Prisma's CLI merges its own static config file; no user input reaches it. A major-version override could break Prisma. Re-check on every Prisma upgrade. |
| I-1 | Information   | `GET /ready` lists which AI providers are configured (names only, no keys)                                                                                     | Low             | Accepted: needed by the web status pill; reveals no secret                                                                                                                                        |
| I-2 | Web CSP       | `connect-src`, `img-src` and `media-src` allow any `https:` origin (API domain per deployment, Supabase signed URLs)                                           | Low             | Accepted (ADR-017 §5); scripts stay same-origin                                                                                                                                                   |

## Verified controls (no change needed)

| Control                            | Evidence                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider keys are server-side only | `@a-ai/config/server` is blocked from the web app by ESLint; web env schema has only `VITE_API_URL`, `VITE_SENTRY_DSN`                                                       |
| Secrets never logged or echoed     | Env validation prints names only; pino redacts `authorization`, `cookie`, `set-cookie`; provider and storage errors carry status codes, not bodies (tests in Phases 1, 2, 8) |
| Sessions                           | Random tokens, only the HMAC stored; `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax` in production; smoke test checks the flags                                              |
| CSRF                               | SameSite cookies plus the origin check on state-changing requests (ADR-008)                                                                                                  |
| CORS                               | Exact origins with credentials; unknown origins get no CORS headers (smoke test)                                                                                             |
| Input validation                   | Zod on every body and query; 1 MB JSON limit; multipart limits per route; uploads and recordings sniffed before use (Phases 8–9)                                             |
| Authorization                      | Every conversation, comparison, attachment and job query is scoped to its owner in the repository query; foreign and malformed ids return 404 (integration tests per phase)  |
| Rate limits and quotas             | Redis-backed, per IP, per user and per guest; server-side (Phases 1, 8, 9)                                                                                                   |
| Database exposure                  | RLS enabled on every table, so Supabase's Data API exposes nothing (migrations; live suite checks new tables)                                                                |
| Error envelope                     | Unknown errors become `INTERNAL_ERROR` with a generic message (`tests/unit/to-api-error.test.ts`, `hardening.test.ts`)                                                       |
| Uploaded files                     | Private bucket, random keys, metadata stripped, 5-minute signed URLs, owner-only (Phase 8)                                                                                   |
| Voice recordings                   | Never stored or logged; buffer wiped after transcription (Phase 9)                                                                                                           |
| Headers on the API                 | helmet with `default-src 'none'`, `frame-ancestors 'none'`, HSTS, `nosniff` (smoke test)                                                                                     |

## Not covered by this review

- Penetration testing by a third party.
- Load testing against real infrastructure. Without production-like Supabase, Upstash and provider quotas the numbers would not mean anything; run it on staging before launch.
- Supabase and Upstash account security: MFA on accounts, least-privilege team members, IP allow-lists where the plan offers them.

## Re-review triggers

A new public route, a new third-party service, a dependency advisory rated high or critical, or any change to cookies, CORS, CSP or authentication.
