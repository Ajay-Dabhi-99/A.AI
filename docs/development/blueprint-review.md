# Blueprint review and suggestions

Review of `ModelArena_Master_Implementation_Blueprint_v4` for a production SaaS. The architecture is sound: provider abstraction, phase gates, normalized errors and server-side quotas are the right foundations. The items below are gaps, contradictions and risks, in priority order.

## Must fix before Phase 1

### 1. Cross-site cookies will break login on Safari

The plan puts the web app on Vercel and the API on Render with HTTP-only cookie sessions. On `*.vercel.app` and `*.onrender.com` these are different sites, so the session cookie is a third-party cookie. Safari blocks those by default, and Chrome restricts them too. Login would work in development (same-origin proxy) and fail in production.

**Suggestion:** serve both from one registrable domain (`app.a.ai` + `api.a.ai`), or proxy `/api` through Vercel rewrites. Decide before building auth.

### 2. Supabase exposes Prisma tables unless RLS is enabled

Supabase publishes the `public` schema through its Data API. Tables Prisma creates there are readable and writable with the project's anon key while Row Level Security is off.

**Suggestion:** every migration enables RLS on new tables (recorded in [ADR-005](../decisions/ADR-005-infrastructure.md) and the PR template).

### 3. The document contradicts itself about Redis

§2, §8 and §25 describe guest data in PostgreSQL with scheduled cleanup and "no Upstash dependency"; the closing infrastructure decision makes Upstash mandatory with TTL cleanup. The MODEL-005 task title also changed to "guest-session persistence" and the Redis task disappeared.

**Resolved in code** as Upstash with TTLs ([ADR-002](../decisions/ADR-002-guest-session.md)). **Suggestion:** update those sections in the docx.

### 4. Auth is under-specified for a SaaS

Missing: email verification, password reset, Google sign-in, session revocation, account deletion, brute-force protection. `JWT_SECRET` implies stateless JWTs, which cannot be revoked on logout or compromise.

**Suggestion:** opaque session IDs stored server-side (revocable), with `JWT_SECRET` used to sign cookies; add verification and reset flows to Phase 1; consider Supabase Auth instead of building auth yourself.

## Should add

### 5. Billing and plans

"Pro/Future" appears in the quota table, but there is no billing phase, plans table, subscription state, webhook handling or entitlement checks. For a SaaS in India, Razorpay or Stripe. **Suggestion:** add a phase after Phase 7 and keep quota limits in a `plans` table from Phase 1 so billing plugs in later.

### 6. Streaming details that commonly fail in production

- `EventSource` only supports GET; `POST /api/chat` needs a `fetch` + `ReadableStream` client (already planned in [chat API](../api/chat.md)).
- Heartbeat comments every ~15 s, `x-accel-buffering: no`, no compression on streams.
- Abort the provider call when the client disconnects, or you pay for tokens nobody reads.
- §11 returns a final `ComparisonRun` shape; comparisons should stream multiplexed by `runId` so columns fill in live.

### 7. Fallback must never apply silently to comparisons

Phase 6 fallback is right for chat (with the substituted model labelled), but in comparison mode it would show model B's answer under model A's name.

### 8. Data model gaps

- A `comparisons` table to group runs; `model_runs.messageId` alone cannot represent one prompt answered by four models.
- Generation jobs only in Redis (`job:{jobId}`) are lost on eviction; persist jobs in PostgreSQL.
- Versioned pricing for `estimatedCost`; soft delete; indexes on `(userId, updatedAt)`.

### 9. Free-tier provider limits shape the product

OpenRouter free models, Gemini free tier and Groq all have low per-day or per-minute limits. Guest quotas must stay below provider quotas, and the model registry should store each model's rate limits. Add a global daily spend and request cap per provider as a circuit breaker.

### 10. Upstash command budget

ioredis keeps a TCP connection and every `PING`, rate-limit check and quota increment is a billed command. Readiness probes from a load balancer every few seconds add up. **Suggestion:** set an alert on Upstash usage, keep `/ready` polling intervals reasonable, and batch quota and rate-limit updates in one Lua script per request.

### 11. Guest abuse

Clearing cookies resets a guest quota. Add a hashed-IP secondary limit and consider Cloudflare Turnstile before issuing guest sessions.

### 12. Observability tools

Structured logs are specified, but nothing collects them. Add Sentry (web + API), an uptime monitor on `/ready`, and a log drain from the API host.

### 13. Legal and compliance

Terms of Service, Privacy Policy, cookie notice, data retention periods, account and data deletion (India DPDP Act 2023, GDPR for EU visitors), and disclosure that prompts are sent to third-party AI providers.

### 14. Security items not listed

- Model output is untrusted: render markdown without raw HTML and sanitize links.
- Content Security Policy and security headers on the web app (Vercel headers).
- SSRF protection when vision input accepts image URLs.

## Consider changing

### 15. Phase order

- Phase 2 chat needs a basic context budget, or long chats fail before Phase 5. Plan a minimal version in Phase 2 (done in [phase-2.md](phase-2.md)).
- Phase 3's registry is needed by Phase 2's model choice; a small static registry in Phase 2 avoids hard-coding.

### 16. Video generation in the MVP

There are no dependable free video-generation APIs, and costs are high. Keep Phase 9 video behind a feature flag or move it after launch.

### 17. A feature that would set A.ai apart

The blueprint compares models but never lets users judge them. A blind mode (model names hidden until the user votes) plus an aggregate leaderboard would make A.ai distinctive rather than another multi-model chat.

### 18. Smaller product gaps

Regenerate and edit-and-resend, share links, conversation export, prompt library, keyboard shortcuts, mobile layout of 4 comparison columns, accessibility (live regions announcing streamed text).

### 19. Name and domain check

"A.ai" reads like a domain, so visitors will expect the product at `a.ai`. Single-letter `.ai` domains are premium and almost certainly already registered. Confirm the domain you will actually use, and run a trademark search, before launch: the cookie and domain decision in item 1 depends on it.

## Changes made while implementing Phase 0

| Blueprint                                      | Implemented                        | Why                                                                      |
| ---------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `docker-compose.yml` in v3 tree                | Removed                            | v4: Docker not used                                                      |
| Env names `AUTH_SECRET`, `WEB_ORIGIN` (v2)     | `JWT_SECRET`, `CORS_ORIGIN`        | v4 environment list                                                      |
| Taxonomy without 404                           | Added `NOT_FOUND`                  | Unknown routes are not validation or internal errors                     |
| `apps/api/src/providers/provider.interface.ts` | `packages/ai-core/src/provider.ts` | One definition ([ADR-003](../decisions/ADR-003-provider-abstraction.md)) |
| Ports 3000/5173                                | 4000/5180                          | Avoid clashes with other local projects                                  |
| Latest package versions                        | Pinned older lines                 | Compatibility ([ADR-006](../decisions/ADR-006-toolchain-versions.md))    |
| Product name ModelArena                        | A.ai, package scope `@a-ai`        | Renamed 2026-09-13 ([ADR-007](../decisions/ADR-007-product-name.md))     |
