# Roadmap and implementation tracker

Authoritative tracker (blueprint §20, §26). A phase is DONE only when its gate passes; "Implemented where" names real paths and "Tests" names commands that passed.

Board states (blueprint §24): BACKLOG → READY → IN PROGRESS → CODE COMPLETE → VERIFICATION → DONE, or BLOCKED with blocker, owner and next action.

## Phase tracker

| Phase | Feature                     | Status                                                   | Implemented where                                                    | Tests / verification                                                       |
| ----- | --------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| P0    | Foundation and architecture | **BLOCKED** (code complete; live gate needs credentials) | `apps/api`, `apps/web`, `packages/*`, `prisma/`, `.github/`, `docs/` | `pnpm verify` PASS; `pnpm test:live` pending. See [phase-0.md](phase-0.md) |
| P1    | Auth + guest identity       | BACKLOG                                                  |                                                                      |                                                                            |
| P2    | Single-model chat           | BACKLOG                                                  |                                                                      |                                                                            |
| P3    | Model registry + selector   | BACKLOG                                                  |                                                                      |                                                                            |
| P4    | Comparison engine           | BACKLOG                                                  |                                                                      |                                                                            |
| P5    | Context + token management  | BACKLOG                                                  |                                                                      |                                                                            |
| P6    | Fallback + routing          | BACKLOG                                                  |                                                                      |                                                                            |
| P7    | History + analytics         | BACKLOG                                                  |                                                                      |                                                                            |
| P8    | Vision + image              | BACKLOG                                                  |                                                                      |                                                                            |
| P9    | Video + audio               | BACKLOG                                                  |                                                                      |                                                                            |
| P10   | Hardening + deployment      | BACKLOG                                                  |                                                                      |                                                                            |

## Task IDs

The blueprint defines MODEL-001 to MODEL-014. IDs from MODEL-015 on are added here as phases are broken down.

| ID        | Task                                                                                                     | Phase | Status                           |
| --------- | -------------------------------------------------------------------------------------------------------- | ----- | -------------------------------- |
| MODEL-001 | Initialize monorepo                                                                                      | P0    | CODE COMPLETE                    |
| MODEL-002 | Configure React application                                                                              | P0    | CODE COMPLETE                    |
| MODEL-003 | Configure Fastify API                                                                                    | P0    | CODE COMPLETE                    |
| MODEL-004 | Configure Prisma                                                                                         | P0    | CODE COMPLETE                    |
| MODEL-005 | Configure Supabase database + Upstash Redis connectivity (guest-session persistence itself is MODEL-007) | P0    | VERIFICATION (needs credentials) |
| MODEL-008 | Create AI provider interface                                                                             | P0    | CODE COMPLETE                    |
| MODEL-015 | CI workflows, issue/PR templates                                                                         | P0    | CODE COMPLETE                    |
| MODEL-006 | Implement authentication                                                                                 | P1    | BACKLOG                          |
| MODEL-007 | Implement guest sessions and expiration                                                                  | P1    | BACKLOG                          |
| MODEL-016 | Redis-backed rate limiting + quota service                                                               | P1    | BACKLOG                          |
| MODEL-009 | OpenRouter provider                                                                                      | P2    | BACKLOG                          |
| MODEL-010 | Gemini provider                                                                                          | P2    | BACKLOG                          |
| MODEL-017 | Groq provider                                                                                            | P2    | BACKLOG                          |
| MODEL-011 | Streaming                                                                                                | P2    | BACKLOG                          |
| MODEL-012 | Persist conversations                                                                                    | P2    | BACKLOG                          |
| MODEL-013 | Model registry                                                                                           | P3    | BACKLOG                          |
| MODEL-014 | Model comparison                                                                                         | P4    | BACKLOG                          |

MODEL-008 is listed in the blueprint between Phase 1 tasks, but the provider interface skeleton is Phase 0 scope (§16), so it was delivered there.
