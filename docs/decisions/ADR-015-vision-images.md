# ADR-015: Image uploads, vision chat and image-generation jobs

**Status:** Accepted (2026-09-15, Phase 8)

## Context

Blueprint §16 Phase 8: "file upload, vision input, image generation job abstraction", gated on "uploads validated and securely handled". §12 separates vision chat (a normal streaming chat request) from image generation (an asynchronous job with an attachment). §13 requires payload limits and rejecting unsupported file types before processing. §8 lists an `attachments` table.

The product owner chose on 2026-09-15:

- **Storage:** Supabase Storage, a private bucket behind short-lived signed URLs.
- **Image generation:** build the job abstraction, but ship with no image provider enabled. The only configured key is a rate-limited Gemini key.

## Decisions

### 1. Uploads are for signed-in users

A guest's chat lives in Redis for a day (ADR-002), while an upload is a durable object in storage. Letting anonymous visitors store files invites abuse and cost for little benefit. Guests see "Sign up to attach images"; the upload route returns `401 AUTH_REQUIRED`.

### 2. Every upload is validated before anything is stored

`POST /api/attachments` accepts `multipart/form-data` with exactly one file field and nothing else (`@fastify/multipart`, limits enforced while streaming).

| Check         | Rule                                                                                  | Failure                |
| ------------- | ------------------------------------------------------------------------------------- | ---------------------- |
| Size          | ≤ `ATTACHMENT_MAX_BYTES` (default 5 MiB); the stream is cut as soon as it is exceeded | `413 VALIDATION_ERROR` |
| Count         | one file part, no other fields or parts                                               | `4xx VALIDATION_ERROR` |
| Real type     | magic bytes must be PNG, JPEG, WebP or GIF; SVG and everything else are rejected      | `415 VALIDATION_ERROR` |
| Declared type | the part's content type must match the sniffed type                                   | `415 VALIDATION_ERROR` |
| Dimensions    | parsed from the image header; 1–8192 px each side                                     | `400 VALIDATION_ERROR` |
| Rate          | 30 uploads per user per hour (Redis)                                                  | `429 RATE_LIMITED`     |

The browser's file name is never used as a storage path. It is kept only as display text (control characters removed, ≤ 120 characters). Objects are stored at `users/{userId}/{attachmentId}.{ext}` with the sniffed content type, never the declared one.

### 3. Metadata is stripped

Photos carry EXIF, which often includes GPS coordinates. Before storing:

- **JPEG:** APP1 (EXIF, XMP), APP13 (IPTC) and COM segments are removed.
- **PNG:** `tEXt`, `zTXt`, `iTXt`, `eXIf` and `tIME` chunks are removed.
- **WebP:** `EXIF` and `XMP ` chunks are removed and the `VP8X` flags cleared.

Pixel data is untouched; no image library decodes untrusted input. GIF has no EXIF block and is stored as uploaded.

The SHA-256 of the stored bytes is recorded.

### 4. Storage: private bucket, signed URLs, explicit cleanup

- `ObjectStorage` interface (`apps/api/src/services/storage/object-storage.ts`) with a Supabase implementation over the Storage REST API, using the service-role key server-side only. Tests use an in-memory implementation.
- Reading an image: `GET /api/attachments/:id/url` returns a signed URL valid for 5 minutes, only to the owner.
- Supabase Storage has no lifecycle rules, so cleanup is explicit:
  - Deleting a conversation (Phase 7) first deletes its images' objects.
  - `pnpm attachments:cleanup` removes uploads never attached to a message after 24 hours.
- Without `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, uploads are disabled. `/api/me` reports `limits.attachments.enabled: false`, and the web app hides the attach button. The API never pretends to store.

### 5. Vision chat

- `POST /api/chat` accepts `attachmentIds` (≤ 4) with a new message. Each must belong to the caller and not yet be attached; the chosen model must have `supportsVision`. Failures are JSON errors before streaming, and no allowance is used.
- Images travel in `AIMessage.images` (`{ mimeType, data }` base64). The OpenAI-compatible adapter turns them into `image_url` content parts with a data URL; providers without vision never receive them.
- **Context budget:** each image is estimated at 1,500 tokens, a conservative figure for the catalog's vision models. Images are sent only with the message they were attached to; earlier turns contribute their text. This keeps every request bounded and avoids downloading a conversation's whole image history each turn.
- **Fallback:** a fallback model must also support vision (Phase 6's router filters on it when the message has images).
- After the message is saved, the attachments are linked to it and appear in history as `ChatMessage.attachments`.

### 6. Image generation is a job, and it is off

- `ImageGenerationProvider` in `@a-ai/ai-core` is the extension point. The registry of image providers is empty in this phase.
- `generation_jobs` table (`queued → processing → completed | failed | cancelled`, RLS). A completed job's image is stored as an attachment with `source: generated`.
- `GET /api/image/status` returns `{ enabled: false, models: [] }`. `POST /api/image/generate` returns `503 MODEL_UNAVAILABLE` ("Image generation is not enabled on this deployment") without creating a job. Nothing is advertised as available (blueprint §25).
- When a provider is added later:
  - Jobs are claimed with a compare-and-set from `queued` to `processing`, so only one API instance runs each job.
  - Progress is mirrored in Redis at `job:{id}` for polling.
  - Generation is capped per user per day.
- The service, runner and routes are covered by tests with a scripted image provider, so enabling a real one is configuration plus an adapter.

### 7. Update 2026-09-17: a free image provider

None of the chat providers offers free image generation (Gemini's free-tier limit for its image models is 0; OpenRouter's image models are paid; Groq has none). Cloudflare Workers AI does: 10,000 neurons a day on the Workers Free plan. `CloudflareImageProvider` (FLUX.1 [schnell], 4 steps, JPEG) is registered when `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_API_TOKEN` are both set, so section 6's "off" state now applies only to deployments without them. Survey: [generation API](../api/generation.md#free-media-generation-survey-2026-09-17).

## Consequences

- Image features need a Supabase Storage bucket and the service-role key in the API's environment.
- Earlier images in a conversation are not re-sent; asking about an old image requires attaching it again.
- Image generation stays invisible until a provider with image quota is configured.
