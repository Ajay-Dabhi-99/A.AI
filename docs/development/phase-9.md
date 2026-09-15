# Phase 9: Video + audio

**Gate (blueprint §16):** long jobs are resilient to refresh/reconnect.

**Status: CODE COMPLETE.** Every check that can run without real infrastructure passes. DONE requires:

- the earlier live gates;
- this phase's migration applied and the live attachment/job suite passing;
- one real voice transcription with a `GROQ_API_KEY`, and read-aloud checked in a real browser.

Video has no provider by decision.

Design: [ADR-016](../decisions/ADR-016-video-audio-jobs.md). API: [generation](../api/generation.md), [audio](../api/audio.md).

Product decisions (2026-09-17):

- Speech-to-text: Groq Whisper, never the limited Gemini key.
- Text-to-speech: browser voices.
- Video: job abstraction, no provider enabled.
- Recordings: deleted right after transcription.

## Tasks

| ID        | Scope                                                                                                     | Where                                                                                                                      | Status                                    |
| --------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| MODEL-048 | Media job contract for image and video: progress mirror, cancel (CAS), list, per-kind limits and timeouts | `apps/api/src/modules/jobs/{media-job.service,job-center,media.routes}.ts`, `packages/shared-types/src/media.ts`           | CODE COMPLETE                             |
| MODEL-049 | Resilience: SSE snapshots, startup and periodic recovery of interrupted and orphaned jobs                 | `apps/api/src/modules/jobs/media.routes.ts`, `apps/api/src/app.ts` (`onReady`)                                             | CODE COMPLETE                             |
| MODEL-050 | Video attachments: container sniffing, size cap, nullable dimensions                                      | `apps/api/src/ai/media-sniff.ts`, `attachment.service.ts`, `prisma/migrations/20260917090000_media_jobs`                   | CODE COMPLETE (migration not applied)     |
| MODEL-051 | Speech-to-text: Groq Whisper adapter, validated short request, recording wiped, rate limits               | `packages/ai-providers/src/transcription.ts`, `apps/api/src/modules/audio/*`                                               | CODE COMPLETE (no real call)              |
| MODEL-052 | Web: `/video` and `/image` resume from `?job=`, reconnect then poll, cancel, recent jobs                  | `apps/web/src/features/jobs/*`, `apps/web/src/pages/{image,video}-page.tsx`                                                | CODE COMPLETE                             |
| MODEL-053 | Web: voice input into the draft; read aloud with browser voices                                           | `apps/web/src/features/chat/{use-voice-input,use-read-aloud,composer,message-view}.ts*`, `apps/web/src/lib/speech-text.ts` | CODE COMPLETE (real mic/voices not tried) |

## Verification

Run on 2026-09-17, Windows 11, Node 22, pnpm 10.34.5. No provider was called: every test uses scripted providers, in-memory storage and fake browser media APIs.

| Check                                          | Command                                                                                         | Result                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format, lint, typecheck (7 workspaces), build  | `pnpm verify`                                                                                   | PASS                                                                                                                                                                                                                                      |
| Unit                                           | `pnpm test:unit`                                                                                | PASS, 409 tests (config 19, shared-types 9, ai-core 4, validation 46, ai-providers 37, api 214, web 80)                                                                                                                                   |
| Integration                                    | `pnpm test:integration`                                                                         | PASS, 84 tests (adds jobs 5, audio 5)                                                                                                                                                                                                     |
| Refresh / reconnect (server)                   | `apps/api/tests/integration/jobs.test.ts`                                                       | PASS: progress snapshots stream; a reconnect after the end replays the final snapshot and closes; list and by-id reads; owner-only; cancel reaches open streams and aborts the provider; jobs left by a stopped instance run at startup   |
| Recovery rules                                 | `apps/api/tests/unit/media-job.service.test.ts`                                                 | PASS: stale processing → `PROVIDER_TIMEOUT`, orphaned queued → resumed, unknown model → `MODEL_UNAVAILABLE`, fresh jobs untouched; cancel while storing discards the file; timeout; bad or oversized video                                |
| Refresh / reconnect (web)                      | `apps/web/tests/video-page.test.tsx`                                                            | PASS: `/video?job=` resumes and plays; three reconnects then polling; cancel                                                                                                                                                              |
| Speech-to-text                                 | `apps/api/tests/integration/audio.test.ts`, `packages/ai-providers/tests/transcription.test.ts` | PASS: off without key; guest transcription; bytes and hints reach the provider; bad type, mismatch, empty, oversize, bad language rejected before any call; provider 429 passes `Retry-After`; empty transcript refused; guest rate limit |
| Voice and read aloud (web)                     | `apps/web/tests/chat-voice.test.tsx`                                                            | PASS: recording goes to the draft, not to chat; mic hidden when off; read aloud speaks plain text and stops                                                                                                                               |
| Migration SQL                                  | `prisma migrate diff`                                                                           | Generated from the Phase 8 schema                                                                                                                                                                                                         |
| Live: job CAS and nullable dimensions          | `pnpm test:live`                                                                                | **NOT RUN: `.env` database and Redis URLs are placeholders**                                                                                                                                                                              |
| Real transcription, real microphone and voices | manual                                                                                          | **NOT RUN: no `GROQ_API_KEY`; not tried in a real browser**                                                                                                                                                                               |

## Gate evidence

- A job is addressed by id in the page URL and in `GET /api/jobs`, so a refresh or a new tab resumes it.
- Every stream event is a complete snapshot; the client reconnects with backoff and falls back to polling.
- The job row is the source of truth with compare-and-set transitions; an API restart fails or restarts what it left behind.

## Defects found and fixed during Phase 9

| Severity        | Issue                                                                                                                            | Fix                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| P2 (source)     | Escape sequences written as raw control characters in `attachment.service.ts` and `tokens.ts`; git treated `tokens.ts` as binary | Rewritten as `\u0000`-style escapes; behaviour unchanged |
| P3 (tests only) | The recovery test aged the job with the real clock while the app used the test clock                                             | Aged with the app's clock                                |
| P3 (tests only) | The video page tests matched the header's API status as well as the job status                                                   | Queries scoped to the current job section                |

## Deferred, by design

- A video provider, and a server text-to-speech job (both fit the job contract).
- Redis pub/sub instead of per-stream polling on the server.
- Keeping recordings as playable attachments.
