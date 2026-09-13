# Phase 2: Single-model chat

**Gate:** complete chat loop including reconnect and failure states.

## Tasks

| ID         | Scope                                                                                                        | Key paths                              |
| ---------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| MODEL-017  | Groq adapter (fastest free tier, used to prove the pipeline first)                                           | `packages/ai-providers/src/groq`       |
| MODEL-009  | OpenRouter adapter                                                                                           | `packages/ai-providers/src/openrouter` |
| MODEL-010  | Gemini adapter                                                                                               | `packages/ai-providers/src/gemini`     |
| MODEL-011a | Provider wiring from configured keys                                                                         | `apps/api/src/providers`               |
| MODEL-011b | `POST /api/chat` SSE: normalized events, heartbeats, abort on disconnect                                     | `apps/api/src/modules/chat`            |
| MODEL-011c | Basic context budget (trim newest-first, `CONTEXT_TOO_LARGE`)                                                | `apps/api/src/ai/token.service.ts`     |
| MODEL-012  | `conversations`, `messages`, `model_runs` tables (RLS), persistence for users; Redis temp history for guests | `prisma/`, `apps/api/src/repositories` |
| MODEL-011d | Web chat UI: fetch-stream parser, incremental rendering, stop, retry, markdown rendered safely               | `apps/web/src/features/chat`           |

One provider adapter per task (blueprint §17). Every adapter is unit-tested against every row of the error table in [provider abstraction](../architecture/provider-abstraction.md).
