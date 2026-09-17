# Generation API (image and video jobs)

**Image jobs: Phase 8. Video jobs, progress, cancel, resume and recovery: Phase 9.** Image generation uses Cloudflare Workers AI (FLUX.1 [schnell], MODEL-064) when `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_API_TOKEN` are set; no video provider is enabled. Types: `packages/shared-types/src/media.ts`. Design: [ADR-015 §6](../decisions/ADR-015-vision-images.md), [ADR-016](../decisions/ADR-016-video-audio-jobs.md). Speech: [audio](audio.md).

| Method | Path                     | Access       | Success                     | Purpose                                              |
| ------ | ------------------------ | ------------ | --------------------------- | ---------------------------------------------------- |
| GET    | `/api/image/status`      | Anyone       | `200 MediaGenerationStatus` | Whether image generation is offered, and models      |
| POST   | `/api/image/generate`    | User         | `202 MediaJobResponse`      | Start an image job                                   |
| GET    | `/api/image/:id`         | User (owner) | `200 MediaJobResponse`      | An image job                                         |
| GET    | `/api/video/status`      | Anyone       | `200 MediaGenerationStatus` | Whether video generation is offered, and models      |
| POST   | `/api/video/generate`    | User         | `202 MediaJobResponse`      | Start a video job                                    |
| GET    | `/api/video/:id`         | User (owner) | `200 MediaJobResponse`      | A video job                                          |
| GET    | `/api/jobs?kind=&limit=` | User         | `200 MediaJobListResponse`  | Recent jobs, newest first (`limit` 1–50, default 10) |
| GET    | `/api/jobs/:id`          | User (owner) | `200 MediaJobResponse`      | Any job by id                                        |
| POST   | `/api/jobs/:id/cancel`   | User (owner) | `200 MediaJobResponse`      | Cancel a queued or processing job (idempotent)       |
| GET    | `/api/jobs/:id/events`   | User (owner) | `200 text/event-stream`     | Live job snapshots until the job ends                |

## Current deployment state

Without the Cloudflare settings (or without storage) no image provider is registered, and no video provider is ever registered, so the `status` routes return `{ "enabled": false, "models": [] }`. With them, `GET /api/image/status` returns `{ "enabled": true, "models": [{ "provider": "cloudflare", "model": "@cf/black-forest-labs/flux-1-schnell", "name": "FLUX.1 [schnell]" }] }`. `generate` returns `503 MODEL_UNAVAILABLE` ("Image generation is not enabled on this deployment." / "Video generation is not enabled on this deployment.") and creates no job. The `/image` and `/video` pages say so. Nothing is advertised as available (blueprint §25).

## `POST /api/{image,video}/generate`

```json
{
  "provider": "…",
  "model": "…",
  "prompt": "a paper boat drifting down a river",
  "conversationId": "new"
}
```

`prompt` is trimmed, 1–2,000 characters; unknown fields are rejected.

## The job object

```json
{
  "job": {
    "id": "…",
    "kind": "video",
    "status": "processing",
    "provider": "…",
    "model": "…",
    "prompt": "a paper boat drifting down a river",
    "progress": 0.42,
    "errorCode": null,
    "attachment": null,
    "createdAt": "…",
    "completedAt": null
  }
}
```

| Field        | Meaning                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `status`     | `queued` → `processing` → `completed`, `failed` or `cancelled`                                                                |
| `progress`   | 0–1 while processing when the provider reports it, `1` when completed, otherwise `null`                                       |
| `errorCode`  | For `failed`: `PROVIDER_TIMEOUT`, `RATE_LIMITED`, `MODEL_UNAVAILABLE`, `VALIDATION_ERROR` (unusable output) …                 |
| `attachment` | For `completed`: `kind` `image` or `video` (`width`/`height` null for video). Show it through `GET /api/attachments/:id/url`. |

## `GET /api/jobs/:id/events`

```
event: job
data: {"id":"…","kind":"video","status":"processing","progress":0.42,…}

event: job
data: {"id":"…","kind":"video","status":"completed","progress":1,"attachment":{…},…}
```

- The first event is the current snapshot; later events are sent whenever the job changes. The stream closes after the job ends, or after 10 minutes.
- Every event is a full snapshot: a client that reconnects gets the current state from its first event. Unknown or foreign jobs are a JSON `404` before the stream opens.
- The web app reconnects after 1, 2 and 4 seconds, then polls `GET /api/jobs/:id` every 3 seconds.

| Status | Code                | When                                                        |
| ------ | ------------------- | ----------------------------------------------------------- |
| 401    | `AUTH_REQUIRED`     | Not signed in                                               |
| 404    | `NOT_FOUND`         | Job is not yours, wrong kind for the route, or malformed id |
| 429    | `RATE_LIMITED`      | Over 20 image jobs or 5 video jobs in a day                 |
| 503    | `MODEL_UNAVAILABLE` | Generation not enabled, or unknown model                    |

## How jobs run and recover

- The `generation_jobs` row is the source of truth; progress is mirrored in Redis at `job:{jobId}` for 1 hour.
- A job is claimed with a compare-and-set from `QUEUED` to `PROCESSING`, so only one API instance runs it. Completion and cancellation are compare-and-set too.
- Timeouts: image 120 s, video 15 minutes (`PROVIDER_TIMEOUT`).
- Output is validated like an upload: images are sniffed and stripped of metadata, videos must be MP4 or WebM within `VIDEO_MAX_BYTES`.
- At startup and every 5 minutes, jobs left behind by a stopped instance are handled: stale `PROCESSING` jobs fail with `PROVIDER_TIMEOUT`, and `QUEUED` jobs older than a minute are started.

## Images inside a chat (MODEL-065)

The chat page creates images; there is no separate image tab (the `/image` route still exists for old links but is not linked).

- `conversationId` (optional) on `POST /api/image/generate`: a saved chat's id to create the image in, or `"new"` to start a chat titled after the prompt. Another user's or an unknown chat is `404 NOT_FOUND` and creates nothing; any other value is `400`. Without it the job belongs to no chat.
- The job records the chat (`generation_jobs."conversationId"`, `ON DELETE CASCADE`) and marks the chat as recently active. Every `MediaJob` now has `conversationId` (`null` when not in a chat).
- `GET /api/conversations/:id` adds `mediaJobs`: that chat's jobs, oldest first, each with its status and image. The web app shows each as the request ("Create image") followed by the image, in time order with the messages.
- Image prompts are not chat messages: they are never sent to chat models as context, and retry does not repeat them.
- Deleting the chat deletes its jobs, the generated image rows and the stored files.

## Cloudflare Workers AI (images)

- Adapter: `packages/ai-providers/src/cloudflare-image.ts`, registered by `imageProvidersFromEnv` in `apps/api/src/services/container.ts`.
- Request: `POST https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell` with `{ "prompt": "…", "steps": 4 }` and `Authorization: Bearer {CLOUDFLARE_AI_API_TOKEN}`. The answer is a base64 JPEG in `result.image`; the API verifies the bytes before storing them.
- Errors: 429 → `RATE_LIMITED` (also when the 10,000-neuron daily allowance is used up), 401/403/404 → `MODEL_UNAVAILABLE`, 5xx → `MODEL_UNAVAILABLE` (retryable), a missing or corrupt image → `PROVIDER_BAD_RESPONSE`. The job fails with that code; nothing is retried automatically.
- Cost: free within the daily allowance (≈ 58 neurons per image). The per-user cap of 20 images a day still applies.
- Setup: Cloudflare dashboard → Workers AI → Use REST API. Copy the Account ID, create an API token with Workers AI Read and Edit, and set both variables. Supabase Storage must also be configured. The API reads them at startup, so restart it afterwards.
- Checking a token: the "Create a Workers AI API Token" button makes a user-owned token, which verifies at `GET /client/v4/user/tokens/verify` (the account-level `/accounts/{id}/tokens/verify` answers "Invalid API Token" for it). Workers AI accepts it either way.
- Verified 2026-09-17: a real call returned a 1024×1024 JPEG in 3.2 s.

## Free media generation survey (2026-09-17)

Checked with the deployment's own keys and the providers' public model lists and pricing pages.

| Provider                  | Image generation                                                                                                                                       | Video generation                                 | Evidence                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Groq                      | None                                                                                                                                                   | None                                             | `GET /openai/v1/models`: chat, guard, Whisper and Orpheus (text-to-speech) models only                                                    |
| OpenRouter                | Paid only (Gemini image models, GPT-5 image)                                                                                                           | None                                             | `GET /api/v1/models`: no image-output model has zero pricing; no video-output model                                                       |
| Gemini                    | Listed for the key (`gemini-2.5-flash-image`, `gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`, `gemini-3-pro-image`) but **free tier limit 0** | Veo 3.1 (standard, fast, lite) listed, paid only | Pricing page: "Not available" on the free tier; one `generateContent` call answered `429` "generate_content_free_tier_requests, limit: 0" |
| Pollinations              | Needs an account key and "pollen" credits for every model                                                                                              | Same                                             | `gen.pollinations.ai/v1/models` pricing                                                                                                   |
| **Cloudflare Workers AI** | **Free:** 10,000 neurons a day on the Workers Free plan; FLUX.1 [schnell] ≈ 58 neurons per 1024×1024 image at 4 steps (≈ 170 images a day)             | None listed                                      | Workers AI pricing page                                                                                                                   |

Decision: image generation uses Cloudflare Workers AI FLUX.1 [schnell] (MODEL-064); video stays off until a provider offers usable free or budgeted video generation.

## Enabling a provider later

Implement `MediaGenerationProvider` (`packages/ai-core/src/image.ts`) in `packages/ai-providers`, call `onProgress` when the provider reports progress, and register it in the API container (`imageProviders` or `videoProviders`). Storage must be configured. No route or UI change is needed.
