# Release checklist

From blueprint §18–19 and [ADR-017](../decisions/ADR-017-production-hosting.md). Every item is checked for every release. How-to: [deployment.md](deployment.md).

## Before deploy

- [ ] CI is green on the release commit: `pnpm verify` and the browser smoke (`pnpm test:e2e`)
- [ ] `pnpm test:live` passes against the test Supabase project and Upstash database
- [ ] New migrations are additive (expand → migrate → contract); every new table enables RLS
- [ ] Required variables are present in Render and Vercel (`pnpm check:env` for the API; values never printed)
- [ ] Provider quotas and billing limits checked for expected traffic
- [ ] Previous Render deploy id and Vercel production deployment noted (rollback targets)
- [ ] Staging released and checked by hand before production
- [ ] Fresh clone works without Docker

## Deploy

- [ ] Actions → Deploy → `staging`, then `production` (gate, hooks, wait for the commit, smoke)
- [ ] `pnpm db:deploy` ran in Render's pre-deploy step without errors

## After deploy

- [ ] The Deploy workflow's smoke test passed. It checks:
  - `/health` reports the release commit, and `/ready` is ready;
  - security headers are present on the API and the web app, and the web CSP forbids inline scripts;
  - CORS allows only the app origin;
  - guest cookies are `__Host-`, `Secure`, `HttpOnly` and `SameSite=Lax`;
  - the error envelope carries a request id;
  - deep links load the app.
- [ ] By hand: sign up and verify email; guest chat hits its quota server-side; signed-in chat persists; comparison with one failing model; history and dashboard
- [ ] An error's `x-request-id` is findable in Render logs (and in Sentry when enabled)
- [ ] Rate limiting still correct after an API restart
- [ ] Staging only: stopping Redis access makes `/ready` fail clearly

## Record

- [ ] Release commit SHA, version, date, Render deploy id, Vercel deployment and smoke output recorded in `docs/development/roadmap.md`
- [ ] Known issues listed; none release-blocking

## Rollback (if the smoke test or manual checks fail)

- [ ] Render → Rollback to the noted deploy; Vercel → Instant Rollback to the noted deployment
- [ ] `pnpm smoke --api … --web …` passes against the rolled-back release
- [ ] Issue opened with request ids / Sentry events
