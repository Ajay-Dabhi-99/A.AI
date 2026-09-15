# Roadmap and implementation tracker

Authoritative tracker (blueprint §20, §26). A phase is DONE only when its gate passes; "Implemented where" names real paths and "Tests" names commands that passed.

Board states (blueprint §24): BACKLOG → READY → IN PROGRESS → CODE COMPLETE → VERIFICATION → DONE, or BLOCKED with blocker, owner and next action.

## Phase tracker

| Phase | Feature                     | Status                                                                                 | Implemented where                                                                                                                    | Tests / verification                                                        |
| ----- | --------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| P0    | Foundation and architecture | **BLOCKED** (code complete; live gate needs Supabase + Upstash credentials)            | `apps/api`, `apps/web`, `packages/*`, `prisma/`, `.github/`, `docs/`                                                                 | `pnpm verify` PASS; `pnpm test:live` not run. See [phase-0.md](phase-0.md)  |
| P1    | Auth + guest identity       | **CODE COMPLETE** (live suite, E2E and real-email QA pending)                          | `apps/api/src/modules/{auth,guest,users}`, `src/services`, `src/repositories`, `apps/web/src/pages`, `prisma/migrations`             | See [phase-1.md](phase-1.md)                                                |
| P2    | Single-model chat           | **CODE COMPLETE** (live suite, real provider calls and E2E pending)                    | `packages/ai-providers`, `apps/api/src/modules/chat`, `src/providers`, `src/ai`, `apps/web/src/features/chat`, `prisma/migrations`   | See [phase-2.md](phase-2.md)                                                |
| P3    | Model registry + selector   | **CODE COMPLETE** (migration, live suite and admin QA pending)                         | `apps/api/src/modules/models`, `src/providers/model-registry.service.ts`, `apps/web/src/pages/models-page.tsx`, `prisma/`            | See [phase-3.md](phase-3.md)                                                |
| P4    | Comparison engine           | **CODE COMPLETE** (migration, live suite, real comparison and E2E pending)             | `apps/api/src/modules/comparison`, `src/repositories/comparison.repository.ts`, `apps/web/src/features/compare`, `prisma/`           | `pnpm verify` PASS (250 unit, 51 integration). See [phase-4.md](phase-4.md) |
| P5    | Context + token management  | **CODE COMPLETE** (migration, live suite and real summary pending)                     | `apps/api/src/ai/{context-builder,token.service,summarizer,usage}.ts`, `apps/api/src/services/context.service.ts`, `prisma/`         | `pnpm verify` PASS (280 unit, 53 integration). See [phase-5.md](phase-5.md) |
| P6    | Fallback + routing          | **CODE COMPLETE** (migration, live suite and real fallback pending)                    | `apps/api/src/ai/{retry-policy,model-router}.ts`, `apps/api/src/providers/provider-health.service.ts`, `modules/chat`, `prisma/`     | `pnpm verify` PASS (312 unit, 55 integration). See [phase-6.md](phase-6.md) |
| P7    | History + analytics         | **CODE COMPLETE** (migration and live traceability suite pending)                      | `apps/api/src/repositories/history.repository.ts`, `apps/api/src/modules/history`, `apps/web/src/pages/{history,dashboard}-page.tsx` | `pnpm verify` PASS (343 unit, 58 integration). See [phase-7.md](phase-7.md) |
| P8    | Vision + image              | **CODE COMPLETE** (migration, storage bucket, live suite and real vision call pending) | `apps/api/src/modules/{attachments,image}`, `src/services/storage`, `src/ai/image-sniff.ts`, `apps/web/src/features/chat`, `prisma/` | `pnpm verify` PASS (381 unit, 74 integration). See [phase-8.md](phase-8.md) |
| P9    | Video + audio               | BACKLOG                                                                                |                                                                                                                                      |                                                                             |
| P10   | Hardening + deployment      | BACKLOG                                                                                |                                                                                                                                      |                                                                             |

Phases 1–8 were built before the Phase 0 gate closed, by explicit decision on 2026-09-13. None of P0–P8 can be marked DONE until real Supabase, Upstash and at least one provider key are configured and the live suites pass. As of 2026-09-15 the local `.env` database and Redis URLs are placeholders (`127.0.0.1:1`), so the API cannot start locally.

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
| MODEL-013 | Model registry                                 | P3    | CODE COMPLETE                    |
| MODEL-020 | Admin role + promote command                   | P3    | CODE COMPLETE                    |
| MODEL-021 | Models API (catalog + admin PATCH)             | P3    | CODE COMPLETE                    |
| MODEL-022 | Model prices + estimated run cost              | P3    | CODE COMPLETE                    |
| MODEL-023 | Web `/models` page + admin controls            | P3    | CODE COMPLETE                    |
| MODEL-014 | Model comparison (API, persistence, stream)    | P4    | CODE COMPLETE (no real call)     |
| MODEL-024 | Configurable comparison model limits           | P4    | CODE COMPLETE                    |
| MODEL-025 | Web `/compare` page                            | P4    | CODE COMPLETE                    |
| MODEL-026 | Context budget invariant + summary in context  | P5    | CODE COMPLETE                    |
| MODEL-027 | Calibrated per-model token estimates           | P5    | CODE COMPLETE                    |
| MODEL-028 | Conversation summaries (hook, background, CAS) | P5    | CODE COMPLETE (no real call)     |
| MODEL-029 | Usage normalization                            | P5    | CODE COMPLETE                    |
| MODEL-030 | Context info in the stream and chat UI         | P5    | CODE COMPLETE                    |

Phase 6 tasks: MODEL-031 retry/fallback decision table, MODEL-032 fallback order, MODEL-033 provider circuit breaker and health API, MODEL-034 chat attempt loop, MODEL-035 fallback run columns (migration not applied), MODEL-036 web retry/fallback labels and health badges; all CODE COMPLETE, see [phase-6.md](phase-6.md).

Phase 7 tasks: MODEL-037 history list with search and filters, MODEL-038 run detail and saved comparisons, MODEL-039 rename and delete, MODEL-040 usage analytics (personal and admin), MODEL-041 usage indexes (migration not applied) and traceability checks; all CODE COMPLETE, see [phase-7.md](phase-7.md).

Phase 8 tasks: MODEL-042 upload validation and metadata stripping, MODEL-043 private object storage and cleanup, MODEL-044 attachments API and table (migration not applied), MODEL-045 vision chat, MODEL-046 image-generation jobs (no provider enabled, by decision), MODEL-047 web attach UI and `/image` page; all CODE COMPLETE, see [phase-8.md](phase-8.md).

MODEL-008 is listed in the blueprint between Phase 1 tasks, but the provider interface skeleton is Phase 0 scope (§16), so it was delivered there.
