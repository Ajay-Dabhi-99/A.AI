# Phase 8: Vision + image

**Gate (blueprint §16):** uploads validated and securely handled.

**Status: CODE COMPLETE.** Every check that can run without real infrastructure passes. DONE requires the earlier live gates, this phase's migration applied, a private Supabase Storage bucket with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` configured, the live attachment suite passing, and one manual upload plus one vision answer with a real key.

Design: [ADR-015](../decisions/ADR-015-vision-images.md). API: [attachments](../api/attachments.md), [generation](../api/generation.md), [chat](../api/chat.md).

Product decisions (2026-09-15): Supabase Storage (private bucket, signed URLs); image-generation job abstraction built with **no provider enabled** (the only key is a rate-limited Gemini key).

## Tasks

| ID        | Scope                                                                                                               | Where                                                                                                                                                                | Status                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| MODEL-042 | Upload validation: magic bytes, declared type, size, dimensions; metadata stripping                                 | `apps/api/src/ai/image-sniff.ts`, `apps/api/src/modules/attachments/attachment.service.ts`                                                                           | CODE COMPLETE                            |
| MODEL-043 | Private object storage: interface, Supabase REST adapter, signed URLs, delete and cleanup                           | `apps/api/src/services/storage/object-storage.ts`, `scripts/cleanup-attachments.ts`, `packages/config/src/server.ts`                                                 | CODE COMPLETE (no real bucket)           |
| MODEL-044 | Attachments API and `attachments` table with RLS; rate limit; `/api/me` limits                                      | `apps/api/src/modules/attachments/attachment.routes.ts`, `src/repositories/attachment.repository.ts`, `prisma/migrations/20260916090000_attachments_generation_jobs` | CODE COMPLETE (migration not applied)    |
| MODEL-045 | Vision chat: `attachmentIds`, image parts on the OpenAI-compatible wire, image token estimate, vision-only fallback | `apps/api/src/modules/chat/chat.service.ts`, `packages/ai-providers/src/openai-compatible.ts`, `apps/api/src/ai/{context-builder,model-router}.ts`                   | CODE COMPLETE (no real call)             |
| MODEL-046 | Image-generation jobs: provider interface, `generation_jobs` with RLS, CAS claim, Redis mirror, routes (disabled)   | `packages/ai-core/src/image.ts`, `apps/api/src/modules/image/*`, `src/repositories/generation-job.repository.ts`                                                     | CODE COMPLETE (no provider, by decision) |
| MODEL-047 | Web: attach images in chat, signed-URL thumbnails in history, `/image` page                                         | `apps/web/src/features/chat/{composer,use-attachment-drafts,attachment-image,message-view}.tsx`, `apps/web/src/pages/image-page.tsx`                                 | CODE COMPLETE                            |

## Verification

Run on 2026-09-16, Windows 11, Node 22, pnpm 10.34.5. No provider was called: every test uses scripted providers and in-memory storage.

| Check                                         | Command                                             | Result                                                                                                                                                                                                                       |
| --------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format, lint, typecheck (7 workspaces), build | `pnpm verify`                                       | PASS                                                                                                                                                                                                                         |
| Unit                                          | `pnpm test:unit`                                    | PASS, 381 tests (config 19, shared-types 9, ai-core 4, validation 41, ai-providers 34, api 202, web 72)                                                                                                                      |
| Integration                                   | `pnpm test:integration`                             | PASS, 74 tests (adds attachments 12, image generation 4)                                                                                                                                                                     |
| Upload gate                                   | `apps/api/tests/integration/attachments.test.ts`    | PASS: guests refused; SVG, mismatched type, oversize, huge dimensions, empty, non-multipart and extra parts rejected with nothing stored; EXIF/text removed; random key; owner-only signed URL; rate limit; disabled storage |
| Vision chat                                   | same file                                           | PASS: images reach the provider as base64 of the stripped bytes; saved with the message; one-message use; non-vision model refused before quota; foreign image refused; objects deleted with the conversation; 24 h cleanup  |
| Image parsing and stripping                   | `apps/api/tests/unit/image-sniff.test.ts`           | PASS                                                                                                                                                                                                                         |
| Supabase adapter (fake fetch)                 | `apps/api/tests/unit/object-storage.test.ts`        | PASS: endpoints, headers, no upsert, signed URL, bulk delete, errors never contain keys or paths                                                                                                                             |
| Migration SQL                                 | `prisma migrate diff`                               | Generated from the Phase 7 schema, RLS appended                                                                                                                                                                              |
| Live: attachment rows, CAS, cascade, RLS      | `pnpm test:live` (`tests/live/attachments.test.ts`) | **NOT RUN: `.env` database and Redis URLs are placeholders**                                                                                                                                                                 |
| Real bucket upload, real vision answer        | manual                                              | **NOT RUN: no Supabase Storage credentials**                                                                                                                                                                                 |

## Gate evidence

- Nothing is stored until the bytes are identified, the declared type matches, dimensions are within 1–8192 and metadata is stripped; the multipart stream is cut at `ATTACHMENT_MAX_BYTES`.
- The storage path never uses the browser's file name; objects are private and served only through 5-minute signed URLs to the owner.
- The service-role key is server-only (`@a-ai/config/server`), never logged; storage errors carry status codes only.
- Both new tables enable Row Level Security in the migration, and the live suite asserts it.

## Defects found and fixed during Phase 8

| Severity        | Issue                                                                              | Fix                                                |
| --------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| P3 (build)      | Cleanup script imported packages the root workspace does not depend on (typecheck) | Reads the few settings it needs from `process.env` |
| P3 (build)      | A value import used only as a type in the job service (lint)                       | Typed with `Attachment` from shared-types          |
| P3 (tests only) | Existing `/api/me` fixtures compared `limits` exactly                              | Fixtures include attachment limits                 |

## Deferred, by design

- An image-generation provider (enable when a key with image quota exists).
- Re-sending earlier images in later turns (attach again instead).
- HEIC/AVIF uploads, image resizing, and malware scanning of stored objects.
- Scheduling `pnpm attachments:cleanup` (Phase 10 deployment).
