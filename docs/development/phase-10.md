# Phase 10: Hardening + deployment

**Gate (blueprint §16):** the release candidate passes the full regression suite and a smoke test.

**Status: CODE COMPLETE.** Everything that can run without production accounts passes. The gate itself needs:

- the production accounts and domain ([deployment.md](deployment.md));
- the earlier live gates;
- the browser smoke passing in CI, where Chromium is installed;
- a staging deploy whose `pnpm smoke` passes.

None of these can run yet.

Design: [ADR-017](../decisions/ADR-017-production-hosting.md). Review: [security-review.md](security-review.md). Operations: [deployment.md](deployment.md), [release-checklist.md](release-checklist.md).

Product decisions (2026-09-17):

- Vercel + Render on the owner's domain (`app.` / `api.`).
- Sentry off without a DSN.
- Playwright browser smoke plus `pnpm smoke`.
- Manual deploys after the gate.
- No local Chromium download: browser tests run in CI only.

## Tasks

| ID        | Scope                                                                                                                      | Where                                                                                                                                        | Status                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| MODEL-054 | Security review; fixes: proxy trust (S-1), web CSP and headers (S-2), `mysql2` override (D-1)                              | `docs/development/security-review.md`, `apps/api/src/app.ts`, `apps/web/vercel.json`, `apps/web/public/theme-init.js`, `pnpm-workspace.yaml` | CODE COMPLETE                                |
| MODEL-055 | Error reporting (API and web, scrubbed, off without DSN); route crash page                                                 | `apps/api/src/plugins/error-reporting.ts`, `apps/web/src/lib/error-reporting.ts`, `apps/web/src/pages/error-page.tsx`                        | CODE COMPLETE (no DSN configured)            |
| MODEL-056 | Production configuration: Render Blueprint (API + cleanup cron), Vercel config, Node version, deployed commit in `/health` | `render.yaml`, `apps/web/vercel.json`, `.nvmrc`, `packages/config/src/server.ts`, `apps/api/src/modules/health`                              | CODE COMPLETE (not deployed)                 |
| MODEL-057 | Deployment smoke test; Deploy workflow waits for the commit and runs it                                                    | `apps/api/src/ops/smoke.ts`, `scripts/smoke.ts`, `.github/workflows/deploy.yml`                                                              | CODE COMPLETE (not run against a deployment) |
| MODEL-058 | Browser smoke with a mocked API, desktop and mobile, landing page under the production CSP; CI job                         | `apps/web/playwright.config.ts`, `apps/web/e2e/*`, `.github/workflows/ci.yml`                                                                | CODE COMPLETE (runs in CI; not run locally)  |
| MODEL-059 | Deployment, backups, restore drill and rollback docs; release checklist; lazy-loaded secondary pages                       | `docs/development/{deployment,release-checklist}.md`, `apps/web/src/app/router.tsx`                                                          | CODE COMPLETE                                |

## Verification

Run on 2026-09-17, Windows 11, Node 22, pnpm 10.34.5. No AI provider, database or Redis outside the test adapters was used.

| Check                                         | Command                                                                                        | Result                                                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Format, lint, typecheck (7 workspaces), build | `pnpm verify`                                                                                  | PASS                                                                                                                           |
| Unit                                          | `pnpm test:unit`                                                                               | PASS, 417 tests (config 23, shared-types 9, ai-core 4, validation 46, ai-providers 37, api 216, web 82)                        |
| Integration                                   | `pnpm test:integration`                                                                        | PASS, 89 tests (adds hardening 5)                                                                                              |
| Smoke test logic                              | `apps/api/tests/integration/hardening.test.ts`                                                 | PASS: all 10 API checks against a real listening server; a broken database, wrong commit and wrong CORS origin are each named  |
| Proxy trust                                   | same file                                                                                      | PASS: one trusted hop uses the proxy-added address; zero hops ignore `X-Forwarded-For`                                         |
| Error reporting                               | same file, `apps/api/tests/unit/error-reporting.test.ts`, `apps/web/tests/error-page.test.tsx` | PASS: 500s reported with identifiers only, expected errors not reported, scrubbing removes headers/cookies/bodies/query/user   |
| Dependency audit (production)                 | `pnpm audit --prod`                                                                            | 1 high remaining: `deepmerge-ts` in Prisma's CLI config loader, accepted (D-2); `mysql2` advisories fixed by override          |
| Web bundle                                    | `pnpm --filter @a-ai/web build`                                                                | Initial JS 945 kB (288 kB gzip), down from 1,222 kB (363 kB gzip); nine pages split out; Sentry (475 kB) loads only with a DSN |
| Browser smoke                                 | `pnpm test:e2e`                                                                                | **NOT RUN locally: Chromium download declined; runs in the CI `e2e` job.** Type-checked and linted                             |
| Live suites                                   | `pnpm test:live`                                                                               | **NOT RUN: `.env` database and Redis URLs are placeholders**                                                                   |
| Deployment smoke                              | `pnpm smoke --api … --web …`                                                                   | **NOT RUN: no deployment exists yet**                                                                                          |
| Load test                                     | —                                                                                              | **NOT RUN: needs staging with real Supabase, Upstash and provider quotas** (security review, "Not covered")                    |

## Gate evidence so far

- The full regression suite (unit and integration) passes on this commit, and CI runs the browser smoke on every push.
- The deployment smoke is implemented, is tested against a running API, and is wired into the Deploy workflow, which fails if it does not pass.
- Rollback, restore and migration rules are written down ([deployment.md](deployment.md)).

## Defects found and fixed during Phase 10

| Severity   | Issue                                                                                      | Fix                                                                 |
| ---------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| High       | Production trusted every proxy hop, so clients could choose their IP for rate limits (S-1) | Explicit hop trust function; Fastify 5 ignores numeric `trustProxy` |
| P2 (build) | A Zod coercion in the new env settings did not type-check                                  | Explicit number transform                                           |
| P3 (build) | The theme script needed `'unsafe-inline'` under a CSP                                      | Moved to `/theme-init.js`                                           |

## Remaining before the project is DONE

1. Create the production and staging accounts, domain and GitHub environments ([deployment.md](deployment.md)).
2. Replace the local `.env` placeholders; apply migrations; pass `pnpm test:live`.
3. Pass CI, including the browser smoke.
4. Run Deploy to staging; the smoke test passes; manual QA from the release checklist; restore drill.
5. Deploy to production; record the release in the roadmap.
6. Re-check the `deepmerge-ts` advisory on the next Prisma upgrade.
