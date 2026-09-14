# Roadmap and implementation tracker

Authoritative tracker (blueprint §20, §26). A phase is DONE only when its gate passes; "Implemented where" names real paths and "Tests" names commands that passed.

Board states (blueprint §24): BACKLOG → READY → IN PROGRESS → CODE COMPLETE → VERIFICATION → DONE, or BLOCKED with blocker, owner and next action.

## Phase tracker

| Phase | Feature                     | Status                                                                      | Implemented where                                                                                                                  | Tests / verification                                                       |
| ----- | --------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P0    | Foundation and architecture | **BLOCKED** (code complete; live gate needs Supabase + Upstash credentials) | `apps/api`, `apps/web`, `packages/*`, `prisma/`, `.github/`, `docs/`                                                               | `pnpm verify` PASS; `pnpm test:live` not run. See [phase-0.md](phase-0.md) |
| P1    | Auth + guest identity       | **CODE COMPLETE** (live suite, E2E and real-email QA pending)               | `apps/api/src/modules/{auth,guest,users}`, `src/services`, `src/repositories`, `apps/web/src/pages`, `prisma/migrations`           | See [phase-1.md](phase-1.md)                                               |
| P2    | Single-model chat           | **CODE COMPLETE** (live suite, real provider calls and E2E pending)         | `packages/ai-providers`, `apps/api/src/modules/chat`, `src/providers`, `src/ai`, `apps/web/src/features/chat`, `prisma/migrations` | See [phase-2.md](phase-2.md)                                               |
| P3    | Model registry + selector   | BACKLOG                                                                     |                                                                                                                                    |                                                                            |
| P4    | Comparison engine           | BACKLOG                                                                     |                                                                                                                                    |                                                                            |
| P5    | Context + token management  | BACKLOG                                                                     |                                                                                                                                    |                                                                            |
| P6    | Fallback + routing          | BACKLOG                                                                     |                                                                                                                                    |                                                                            |
| P7    | History + analytics         | BACKLOG                                                                     |                                                                                                                                    |                                                                            |
| P8    | Vision + image              | BACKLOG                                                                     |                                                                                                                                    |                                                                            |
| P9    | Video + audio               | BACKLOG                                                                     |                                                                                                                                    |                                                                            |
| P10   | Hardening + deployment      | BACKLOG                                                                     |                                                                                                                                    |                                                                            |

Phases 1 and 2 were built before the Phase 0 gate closed, by explicit decision on 2026-09-13. None of P0–P2 can be marked DONE until real Supabase, Upstash and at least one provider key are configured and the live suites pass.

## Task IDs

The blueprint defines MODEL-001 to MODEL-014. IDs from MODEL-015 on are added here as phases are broken down.

| ID        | Task                                           | Phase | Status                           |
| --------- | ---------------------------------------------- | ----- | -------------------------------- |
| MODEL-001 | Initialize monorepo                            | P0    | CODE COMPLETE                    |
| MODEL-002 | Configure React application                    | P0    | CODE COMPLETE                    |
| MODEL-003 | Configure Fastify API                          | P0    | CODE COMPLETE                    |
| MODEL-004 | Configure Prisma                               | P0    | CODE COMPLETE                    |
| MODEL-005 | Supabase database + Upstash Redis connectivity | P0    | VERIFICATION (needs credentials) |
| MODEL-008 | Create AI provider interface                   | P0    | CODE COMPLETE                    |
| MODEL-015 | CI workflows, issue and PR templates           | P0    | CODE COMPLETE                    |
| MODEL-016 | Redis storage interface + rate limiting        | P1    | CODE COMPLETE                    |
| MODEL-006 | Authentication (schema, API, web)              | P1    | CODE COMPLETE                    |
| MODEL-007 | Guest sessions, identity resolver, quota       | P1    | CODE COMPLETE                    |
| MODEL-018 | Email verification + password reset            | P1    | CODE COMPLETE                    |
| MODEL-017 | Groq provider                                  | P2    | CODE COMPLETE (no real call)     |
| MODEL-009 | OpenRouter provider                            | P2    | CODE COMPLETE (no real call)     |
| MODEL-010 | Gemini provider                                | P2    | CODE COMPLETE (no real call)     |
| MODEL-011 | Streaming chat (API + web)                     | P2    | CODE COMPLETE                    |
| MODEL-012 | Persist conversations                          | P2    | CODE COMPLETE                    |
| MODEL-019 | Guest-to-user migration                        | P2    | CODE COMPLETE                    |
| MODEL-013 | Model registry                                 | P3    | BACKLOG                          |
| MODEL-014 | Model comparison                               | P4    | BACKLOG                          |

MODEL-008 is listed in the blueprint between Phase 1 tasks, but the provider interface skeleton is Phase 0 scope (§16), so it was delivered there.
