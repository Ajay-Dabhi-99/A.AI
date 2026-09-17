# Roadmap and implementation tracker

Authoritative tracker (blueprint §20, §26). A phase is DONE only when its gate passes; "Implemented where" names real paths and "Tests" names commands that passed.

Board states (blueprint §24): BACKLOG → READY → IN PROGRESS → CODE COMPLETE → VERIFICATION → DONE, or BLOCKED with blocker, owner and next action.

## Phase tracker

| Phase | Feature                     | Status                                                                                                        | Implemented where                                                                                                                                  | Tests / verification                                                          |
| ----- | --------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| P0    | Foundation and architecture | **BLOCKED** (code complete; live gate needs Supabase + Upstash credentials)                                   | `apps/api`, `apps/web`, `packages/*`, `prisma/`, `.github/`, `docs/`                                                                               | `pnpm verify` PASS; `pnpm test:live` not run. See [phase-0.md](phase-0.md)    |
| P1    | Auth + guest identity       | **CODE COMPLETE** (live suite and E2E pending; real verification email delivered 2026-09-16)                  | `apps/api/src/modules/{auth,guest,users}`, `src/services`, `src/repositories`, `apps/web/src/pages`, `prisma/migrations`                           | See [phase-1.md](phase-1.md)                                                  |
| P2    | Single-model chat           | **CODE COMPLETE** (live suite and E2E pending; real calls to all three providers made 2026-09-17)             | `packages/ai-providers`, `apps/api/src/modules/chat`, `src/providers`, `src/ai`, `apps/web/src/features/chat`, `prisma/migrations`                 | See [phase-2.md](phase-2.md)                                                  |
| P3    | Model registry + selector   | **CODE COMPLETE** (migration, live suite and admin QA pending)                                                | `apps/api/src/modules/models`, `src/providers/model-registry.service.ts`, `apps/web/src/pages/models-page.tsx`, `prisma/`                          | See [phase-3.md](phase-3.md)                                                  |
| P4    | Comparison engine           | **CODE COMPLETE** (migration, live suite, real comparison and E2E pending)                                    | `apps/api/src/modules/comparison`, `src/repositories/comparison.repository.ts`, `apps/web/src/features/compare`, `prisma/`                         | `pnpm verify` PASS (250 unit, 51 integration). See [phase-4.md](phase-4.md)   |
| P5    | Context + token management  | **CODE COMPLETE** (migration, live suite and real summary pending)                                            | `apps/api/src/ai/{context-builder,token.service,summarizer,usage}.ts`, `apps/api/src/services/context.service.ts`, `prisma/`                       | `pnpm verify` PASS (280 unit, 53 integration). See [phase-5.md](phase-5.md)   |
| P6    | Fallback + routing          | **CODE COMPLETE** (migration, live suite pending; real retry and fallback observed 2026-09-17)                | `apps/api/src/ai/{retry-policy,model-router}.ts`, `apps/api/src/providers/provider-health.service.ts`, `modules/chat`, `prisma/`                   | `pnpm verify` PASS (312 unit, 55 integration). See [phase-6.md](phase-6.md)   |
| P7    | History + analytics         | **CODE COMPLETE** (migration and live traceability suite pending)                                             | `apps/api/src/repositories/history.repository.ts`, `apps/api/src/modules/history`, `apps/web/src/pages/{history,dashboard}-page.tsx`               | `pnpm verify` PASS (343 unit, 58 integration). See [phase-7.md](phase-7.md)   |
| P8    | Vision + image              | **CODE COMPLETE** (migration, storage bucket, live suite and real vision call pending)                        | `apps/api/src/modules/{attachments,image}`, `src/services/storage`, `src/ai/image-sniff.ts`, `apps/web/src/features/chat`, `prisma/`               | `pnpm verify` PASS (381 unit, 74 integration). See [phase-8.md](phase-8.md)   |
| P9    | Video + audio               | **CODE COMPLETE** (migration, live suite and browser voice check pending; real transcription PASS 2026-09-17) | `apps/api/src/modules/{jobs,audio}`, `src/ai/media-sniff.ts`, `packages/ai-providers/src/transcription.ts`, `apps/web/src/features/jobs`           | `pnpm verify` PASS (409 unit, 84 integration). See [phase-9.md](phase-9.md)   |
| P10   | Hardening + deployment      | **CODE COMPLETE** (release gate needs production accounts: deploy, live suite, smoke, browser smoke in CI)    | `render.yaml`, `apps/web/vercel.json`, `apps/api/src/ops/smoke.ts`, `apps/api/src/plugins/error-reporting.ts`, `apps/web/e2e`, `.github/workflows` | `pnpm verify` PASS (417 unit, 89 integration). See [phase-10.md](phase-10.md) |

Phases 1–10 were built before the Phase 0 gate closed, by explicit decision on 2026-09-13. None of P0–P10 can be marked DONE until the live suites, the missing E2E flows, real provider checks and a staging deploy pass.

## Current state (2026-09-16)

Verified on the local machine; this supersedes the "placeholders" and "migration not applied" notes in the phase files.

| Area                | State                                                                                                                                                                                                                                                  | Evidence                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Supabase PostgreSQL | Real project in `.env` (`DATABASE_URL`, `DIRECT_URL`); **all 13 migrations applied** (including `conversation_pin`, `chat_image_jobs` and `user_interests`, 2026-09-17)                                                                                | `pnpm exec prisma migrate status` → "Database schema is up to date"                                                                                                      |
| Upstash Redis       | Real database in `.env` (`REDIS_URL`)                                                                                                                                                                                                                  | `GET /ready` → database up, redis up                                                                                                                                     |
| API boot            | Starts and serves `/ready`. `pnpm dev:api` (`tsx watch`) hangs before listening on this Windows machine; `api-run` in `.claude/launch.json` (no watch) works                                                                                           | `.claude/launch.json`                                                                                                                                                    |
| Email (Resend)      | `RESEND_API_KEY` set, `EMAIL_FROM` = `onboarding@resend.dev`. Resend answers **403 for any recipient except the Resend account owner** until a domain is verified. Signup, token rotation and resend behave correctly; the 403 is logged, not surfaced | API log `email delivery failed … HTTP 403`; auth integration 10 PASS, unit 22 PASS                                                                                       |
| Providers           | `GEMINI_API_KEY`, `GROQ_API_KEY` and `OPENROUTER_API_KEY` all set (2026-09-17). Real checks: see [Provider checks](#provider-checks-2026-09-17)                                                                                                        | `/ready` → `configured: ["openrouter", "gemini", "groq"]`; `/api/models` lists 6 models, default `groq/openai/gpt-oss-120b`; `/api/audio/status` → transcription enabled |
| Supabase Storage    | `SUPABASE_URL` and service-role key set; bucket upload not yet exercised                                                                                                                                                                               | —                                                                                                                                                                        |
| Live suite          | **Not run**: `TEST_DATABASE_URL`, `TEST_DIRECT_URL`, `TEST_REDIS_URL` empty locally and not configured as GitHub secrets (the "Live infrastructure tests" workflow fails at its secrets check on every push)                                           | GitHub Actions run 35013930635                                                                                                                                           |
| CI browser smoke    | Failed on every push since `c99e355`: `getByLabel('Message')` also matched the "Send message" button. Selector fixed to `getByRole('textbox', { name: 'Message' })` in `apps/web/e2e/smoke.spec.ts`; **CI result pending the next push**               | Failing run 35013930646; fix format, lint and typecheck PASS locally (no local Chromium)                                                                                 |
| Branch flow (§21.5) | Commits go directly to `main`; `main` is not protected; no `staging`/`production` GitHub environments                                                                                                                                                  | GitHub API                                                                                                                                                               |

## Provider checks (2026-09-17)

Run against the local API (`api-run`, port 4000) as a guest, one short prompt each ("Reply with exactly one word: ready"). Key values were never printed.

| Check                                                     | Result                                                                                                                                                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keys valid                                                | Groq `GET /openai/v1/models` and OpenRouter `GET /api/v1/key` answered; OpenRouter key is free tier                                                                                                                              |
| Catalog ids exist                                         | Groq: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `whisper-large-v3-turbo`, `whisper-large-v3`. OpenRouter: `google/gemma-4-31b-it:free`, `nvidia/nemotron-3-super-120b-a12b:free`. Gemini ids not re-listed (rate-limited key) |
| Chat, Groq `openai/gpt-oss-20b`                           | PASS: "ready", 822 ms                                                                                                                                                                                                            |
| Chat, OpenRouter `nvidia/nemotron-3-super-120b-a12b:free` | PASS after one retry (`MODEL_UNAVAILABLE`), 2.5 s                                                                                                                                                                                |
| Chat, OpenRouter `google/gemma-4-31b-it:free`             | Upstream 429 twice ("temporarily rate-limited upstream"); the app emitted `message.retry`, then `message.fallback` to Groq `openai/gpt-oss-120b`, which answered. A direct call minutes later succeeded                          |
| Gemini                                                    | Answered in the app earlier the same day, including a fallback from Gemini 3.8 Flash to Gemini 3.5 Flash-Lite shown in the chat                                                                                                  |
| Comparison, Groq + OpenRouter Gemma                       | PASS: both columns "ready" (2.4 s, 2.8 s)                                                                                                                                                                                        |
| Comparison with a failed column                           | Groq completed (752 ms, provider usage 116 in / 74 out); OpenRouter Nemotron failed with `MODEL_UNAVAILABLE` (Nvidia "Service temporarily overloaded", HTTP 503) and only that column showed the error                           |
| Usage reporting                                           | Groq and OpenRouter both return provider token counts (`usage.source = "provider"`)                                                                                                                                              |
| Transcription, Groq Whisper                               | PASS: a Windows text-to-speech WAV of "Compare the fastest models for a coding question." came back word for word (`whisper-large-v3-turbo`, 3.6 s audio)                                                                        |

Free OpenRouter models are shared and often rate-limited or overloaded upstream; the retry, fallback and per-column errors above are the expected behavior, not defects.

## Open items blocking DONE

| #   | Item                                                                                                                                                 | Phases     | Owner / next action                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| 1   | CI browser smoke green on `main`                                                                                                                     | P10        | Push the selector fix and confirm the `e2e` job passes                              |
| 2   | `pnpm test:live` passes (separate test Supabase project + Upstash database, local `.env` and secrets)                                                | P0–P9      | Owner creates test infrastructure; then run locally and in CI                       |
| 3   | E2E: signup → verify → settings → logout; guest chat → signup → migrated; compare with one failure                                                   | P1, P2, P4 | Not written                                                                         |
| 4   | Real summary (the only provider check left; chat, comparison with a failed column, retry and fallback passed 2026-09-17)                             | P5         | A conversation long enough to overflow a model's context window; one deliberate run |
| 5   | Real verification and reset emails to any address                                                                                                    | P1         | Owner verifies a sending domain in Resend and sets `EMAIL_FROM`                     |
| 6   | Admin promote + disable model; real bucket upload + vision answer; microphone and read-aloud in a real browser (API transcription passed 2026-09-17) | P3, P8, P9 | Manual QA now that the database is live and all provider keys are set               |
| 7   | Per-provider concurrency caps (blueprint §13), deferred from Phase 6 and not implemented                                                             | P6 / P10   | New task                                                                            |
| 8   | Domain, Render, Vercel, GitHub environments; staging deploy + `pnpm smoke`; restore drill; production                                                | P10        | Owner creates accounts ([deployment.md](deployment.md)); then Deploy workflow       |

## Task IDs

The blueprint defines MODEL-001 to MODEL-014. IDs from MODEL-015 on are added here as phases are broken down.

| ID        | Task                                                      | Phase | Status                            |
| --------- | --------------------------------------------------------- | ----- | --------------------------------- |
| MODEL-001 | Initialize monorepo                                       | P0    | CODE COMPLETE                     |
| MODEL-002 | Configure React application                               | P0    | CODE COMPLETE                     |
| MODEL-003 | Configure Fastify API                                     | P0    | CODE COMPLETE                     |
| MODEL-004 | Configure Prisma                                          | P0    | CODE COMPLETE                     |
| MODEL-005 | Supabase database + Upstash Redis connectivity            | P0    | VERIFICATION (needs credentials)  |
| MODEL-008 | Create AI provider interface                              | P0    | CODE COMPLETE                     |
| MODEL-015 | CI workflows, issue and PR templates                      | P0    | CODE COMPLETE                     |
| MODEL-016 | Redis storage interface + rate limiting                   | P1    | CODE COMPLETE                     |
| MODEL-006 | Authentication (schema, API, web)                         | P1    | CODE COMPLETE                     |
| MODEL-007 | Guest sessions, identity resolver, quota                  | P1    | CODE COMPLETE                     |
| MODEL-018 | Email verification + password reset                       | P1    | CODE COMPLETE                     |
| MODEL-060 | Account profile + redesigned profile page                 | P1    | CODE COMPLETE (verified locally)  |
| MODEL-061 | First and last name required at signup and in the profile | P1    | CODE COMPLETE (verified locally)  |
| MODEL-062 | Pin, rename and delete chats from the sidebar             | P7    | CODE COMPLETE (migration applied) |
| MODEL-063 | Chat and navigation UI polish (see below)                 | P10   | CODE COMPLETE                     |
| MODEL-064 | Free image generation on Cloudflare Workers AI            | P8    | CODE COMPLETE (real call PASS)    |
| MODEL-065 | Create images inside the chat (no separate tab)           | P8    | CODE COMPLETE                     |
| MODEL-066 | Topics after signing in and topic-based starter prompts   | P1    | CODE COMPLETE                     |
| MODEL-067 | Follow-up question suggestions after each answer          | P2    | CODE COMPLETE (real call PASS)    |
| MODEL-017 | Groq provider                                             | P2    | CODE COMPLETE (real call PASS)    |
| MODEL-009 | OpenRouter provider                                       | P2    | CODE COMPLETE (real call PASS)    |
| MODEL-010 | Gemini provider                                           | P2    | CODE COMPLETE (used in the app)   |
| MODEL-011 | Streaming chat (API + web)                                | P2    | CODE COMPLETE                     |
| MODEL-012 | Persist conversations                                     | P2    | CODE COMPLETE                     |
| MODEL-019 | Guest-to-user migration                                   | P2    | CODE COMPLETE                     |
| MODEL-013 | Model registry                                            | P3    | CODE COMPLETE                     |
| MODEL-020 | Admin role + promote command                              | P3    | CODE COMPLETE                     |
| MODEL-021 | Models API (catalog + admin PATCH)                        | P3    | CODE COMPLETE                     |
| MODEL-022 | Model prices + estimated run cost                         | P3    | CODE COMPLETE                     |
| MODEL-023 | Web `/models` page + admin controls                       | P3    | CODE COMPLETE                     |
| MODEL-014 | Model comparison (API, persistence, stream)               | P4    | CODE COMPLETE (real call PASS)    |
| MODEL-024 | Configurable comparison model limits                      | P4    | CODE COMPLETE                     |
| MODEL-025 | Web `/compare` page                                       | P4    | CODE COMPLETE                     |
| MODEL-026 | Context budget invariant + summary in context             | P5    | CODE COMPLETE                     |
| MODEL-027 | Calibrated per-model token estimates                      | P5    | CODE COMPLETE                     |
| MODEL-028 | Conversation summaries (hook, background, CAS)            | P5    | CODE COMPLETE (no real call)      |
| MODEL-029 | Usage normalization                                       | P5    | CODE COMPLETE                     |
| MODEL-030 | Context info in the stream and chat UI                    | P5    | CODE COMPLETE                     |

Phase 6 tasks: MODEL-031 retry/fallback decision table, MODEL-032 fallback order, MODEL-033 provider circuit breaker and health API, MODEL-034 chat attempt loop, MODEL-035 fallback run columns (migration not applied), MODEL-036 web retry/fallback labels and health badges; all CODE COMPLETE, see [phase-6.md](phase-6.md).

Phase 7 tasks: MODEL-037 history list with search and filters, MODEL-038 run detail and saved comparisons, MODEL-039 rename and delete, MODEL-040 usage analytics (personal and admin), MODEL-041 usage indexes (migration not applied) and traceability checks; all CODE COMPLETE, see [phase-7.md](phase-7.md).

Phase 8 tasks: MODEL-042 upload validation and metadata stripping, MODEL-043 private object storage and cleanup, MODEL-044 attachments API and table (migration not applied), MODEL-045 vision chat, MODEL-046 image-generation jobs (no provider enabled, by decision), MODEL-047 web attach UI and `/image` page; all CODE COMPLETE, see [phase-8.md](phase-8.md).

Phase 9 tasks: MODEL-048 media job contract, MODEL-049 refresh/reconnect/restart resilience, MODEL-050 video attachments (migration not applied), MODEL-051 speech-to-text with Groq Whisper, MODEL-052 web job pages that resume, MODEL-053 voice input and read aloud; all CODE COMPLETE, see [phase-9.md](phase-9.md).

Phase 10 tasks: MODEL-054 security review and fixes, MODEL-055 error reporting and crash page, MODEL-056 production configuration (Render, Vercel, health commit), MODEL-057 deployment smoke test and deploy workflow, MODEL-058 browser smoke in CI, MODEL-059 deployment, backup and rollback docs; all CODE COMPLETE, see [phase-10.md](phase-10.md).

UI follow-ups (2026-09-17): MODEL-062 is described in [phase-7.md](phase-7.md#model-062-pin-and-rename-from-the-sidebar-2026-09-17). MODEL-063 covers web-only changes, all in `apps/web/src`:

- Chat streaming: `features/chat/use-smooth-text.ts` types answers word by word, and `markdown.tsx` fades new words in (memoised, so other messages are not re-parsed). `thinking-indicator.tsx` shows the waiting state. The retry notice names the cause: busy, slow or a hiccup.
- Chat scrolling (`features/chat/chat-panel.tsx`): the view follows a typing answer and jumps to a newly sent message even after scrolling up. It shows a scroll-to-latest button. Scrollbars are hidden in the chat and on the page, and scrolling still works.
- Model picker (`features/chat/model-picker.tsx`): a minimal list grouped by provider (coloured dot), each model with one muted line for context size, vision and price; the selected model is tinted and checked. `components/ui/select.tsx` has optional `leading` and `description` item slots.
- Header (`components/layout/site-header.tsx`): plain links with an underline on the current page, set from `aria-current` with no measuring or animation. Lazy pages preload when the browser is idle (`app/page-loaders.ts`), so switching pages does not flash a spinner.
- Responsive layout: below `lg` the header links move into a menu panel (`components/ui/dialog.tsx` `SheetContent`), and the chat sidebar opens as a drawer from a Chats button (`pages/chat-page.tsx`). The footer uses the short copyright on phones. Edge screenshots at 390 px and 768 px of home, chat, compare, models, history, dashboard, settings, login and signup show no horizontal overflow (`scrollWidth - clientWidth = 0`).
- New dependencies, pinned exactly: `@radix-ui/react-dropdown-menu` 2.1.24 (chat ⋯ menu) and `@radix-ui/react-dialog` 1.1.23 (delete confirmation, drawers).
- Footer (`components/layout/site-footer.tsx`): 30 px, copyright on the left, "Developed by Ajay Dabhi" on the right. It no longer shows the status badge.
- Evidence: `pnpm verify` PASS (web 92 unit). Browser smoke in Edge (`channel: 'msedge'`, local Chromium not installed): 6 tests, one run with 1 unidentified failure, then 3 full runs and `--repeat-each=5` (30/30) PASS; later desktop and Pixel 7 projects in Edge, 12/12 PASS. The new test `a long answer stays in view as it types` failed before the scroll fix and passes after it.

MODEL-064 (2026-09-17): no chat provider offers free image or video generation ([survey](../api/generation.md#free-media-generation-survey-2026-09-17)), so image jobs use Cloudflare Workers AI FLUX.1 [schnell]: `packages/ai-providers/src/cloudflare-image.ts`, `imageProvidersFromEnv` in `apps/api/src/services/container.ts`, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_API_TOKEN` in `packages/config/src/server.ts` and `.env.example`. Tests: `packages/ai-providers/tests/cloudflare-image.test.ts` (6: request shape, decoding, unknown model, 429/403, bad bodies, abort), `packages/config/tests/storage-env.test.ts` (both-or-neither, no value echo), `apps/api/tests/integration/image-generation.test.ts` (status lists FLUX.1 when configured). Real check 2026-09-17: with `CLOUDFLARE_ACCOUNT_ID` and a user-owned API token (`GET /user/tokens/verify` → active) in `.env`, the restarted API reports `GET /api/image/status` → `enabled: true` with FLUX.1 [schnell]; the adapter produced a 1024×1024 JPEG (341 KB, 3.2 s) that `sniffImage` accepts. A full job through `/image` needs a signed-in account and was left to the owner. Video stays disabled.

MODEL-065 (2026-09-17): images are created in the chat, not on a separate tab.

- API: `generation_jobs."conversationId"` (migration `20260917150000_chat_image_jobs`, cascade, index), `conversationId` (`<uuid>` or `"new"`) on `POST /api/image/generate`, `MediaJob.conversationId`, `ConversationDetail.mediaJobs`. `MediaJobService.start` checks ownership, creates the chat for `"new"` and touches it. `HistoryService.delete` also removes the chat's generated image rows and files (`AttachmentService.generatedIdsForConversation`, `removeRows`).
- Web: an **Image** toggle in the composer (signed-in users, while image generation is enabled) swaps the model picker for the image model and sends to `createImage` in `use-chat-session.ts`. `chat-image-job.tsx` follows the job (shimmer and Cancel, then the image with "Open full size", or a plain failure message). `withMediaJobs` merges saved images into the timeline. The header has no Images or Video link.
- Tests: `apps/api/tests/unit/media-job.service.test.ts` (new chat, existing chat, touch, per-chat list, other user refused), `apps/api/tests/integration/image-generation.test.ts` (create in a new chat, list with the chat, 404 for someone else's chat, 400 for a bad id, delete removes files and rows), `packages/validation/tests/media.test.ts`, `apps/web/tests/chat-page.test.tsx` (image mode request body and failure text, saved images in order, no button for guests). `pnpm verify` PASS (453 unit, 99 integration). Edge screenshot of the chat with a finished image, an image in progress and image mode. Migration applied to the development database (2026-09-17, `prisma migrate status` up to date); the new queries (`listForConversation`, `storageKeysForConversation` with jobs, `generatedIdsForConversation`, `touch`) ran against Supabase with random ids.

MODEL-066 (2026-09-17): topics after signing in.

- API: `users.interests` (`VARCHAR(40)[]`, default empty) and `users."interestsSetAt"` (migration `20260917170000_user_interests`, matched against `prisma migrate diff`), `PATCH /api/me/interests` (`interestsUpdateSchema`), `ProfileService.updateInterests`, `AuthUser.interests` and `interestsSetAt`.
- Web: `features/onboarding/interests-dialog.tsx` (asked once while `interestsSetAt` is null, not on account pages; Skip saves an empty list), `interests-picker.tsx` (12 built-in topics, own topics, 3 at most, inline validation), `interests-card.tsx` on the profile page, `topic-suggestions.ts` (three starter prompts taken in turn from the chosen topics, templates for own topics). The empty chat says "Suggested for your topics: … · Change".
- Tests: `packages/validation/tests/interests.test.ts`, `apps/api/tests/integration/profile.test.ts` (unanswered, save, skip, invalid, guest 401), `apps/web/tests/interests.test.tsx` (dialog save with an own topic, duplicate and odd topics refused, skip, save error, not shown once answered, starters, profile card).

MODEL-067 (2026-09-17): follow-up suggestions.

- API: `POST /api/chat/suggestions` (`chat.routes.ts`), `SuggestionService` (`modules/chat/suggestion.service.ts`: Groq first, healthy providers only, two attempts, 12 s, JSON or line parsing, never an error for model failures), rate limits `suggest-user`, `suggest-guest`, `suggest-ip`, `CHAT_SUGGESTIONS_ENABLED`.
- Web: `features/chat/follow-up-suggestions.tsx` under the latest answer completed in this session (`UiMessage.fresh`); a click sends the question.
- Tests: `apps/api/tests/unit/suggestion.service.test.ts` (parsing, candidates, fallback, provider down, disabled, rate limit), `apps/api/tests/integration/chat.test.ts` (guest and user, allowance untouched, empty on failure, 400, disabled), `apps/web/tests/chat-page.test.tsx` (request body, click sends, only the latest answer).
- Real check: the restarted API answered a guest request with three relevant questions from Groq in 2.0 s. Edge screenshots of the topics dialog, topic starters and follow-up chips.

MODEL-008 is listed in the blueprint between Phase 1 tasks, but the provider interface skeleton is Phase 0 scope (§16), so it was delivered there.
