# Release checklist

From blueprint §18 and the v4 infrastructure checklist. Every item is checked for every release.

## Before deploy

- [ ] `pnpm verify` passes on the release commit
- [ ] `pnpm test:live` passes against the test Supabase project and Upstash database
- [ ] E2E smoke suite passes
- [ ] `pnpm db:deploy` applied; every new table has RLS enabled
- [ ] Required env vars present in each environment (`pnpm check:env` in CI, values never printed)
- [ ] Provider quotas and billing limits checked for expected traffic
- [ ] Fresh clone works without Docker

## After deploy

- [ ] `GET /health` 200 and `GET /ready` 200 in production
- [ ] Stopping Redis access makes `/ready` fail clearly (staging only)
- [ ] CORS allows only production origins
- [ ] Error pages render; an error's `x-request-id` is findable in logs
- [ ] Guest chat enforces the quota server-side
- [ ] Rate limiting still correct after an API restart
- [ ] Logged-in conversations persist

## Record

- [ ] Release commit SHA, version and date recorded in `docs/development/roadmap.md`
- [ ] Rollback: previous Render deploy and Vercel deployment IDs noted
