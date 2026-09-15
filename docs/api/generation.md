# Generation API (image and video jobs)

**Image jobs: Phase 8. Video jobs, progress, cancel, resume and recovery: Phase 9.** No generation provider is enabled on this deployment. Types: `packages/shared-types/src/media.ts`. Design: [ADR-015 §6](../decisions/ADR-015-vision-images.md), [ADR-016](../decisions/ADR-016-video-audio-jobs.md). Speech: [audio](audio.md).

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

No image or video provider is registered, so both `status` routes return `{ "enabled": false, "models": [] }`. `generate` returns `503 MODEL_UNAVAILABLE` ("Image generation is not enabled on this deployment." / "Video generation is not enabled on this deployment.") and creates no job. The `/image` and `/video` pages say so. Nothing is advertised as available (blueprint §25).

## `POST /api/{image,video}/generate`

```json
{ "provider": "…", "model": "…", "prompt": "a paper boat drifting down a river" }
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

## Enabling a provider later

Implement `MediaGenerationProvider` (`packages/ai-core/src/image.ts`) in `packages/ai-providers`, call `onProgress` when the provider reports progress, and register it in the API container (`imageProviders` or `videoProviders`). Storage must be configured. No route or UI change is needed.
