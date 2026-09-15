# Attachments API (image uploads)

**Implemented in Phase 8.** Types: `packages/shared-types/src/attachments.ts`. Schemas: `packages/validation/src/attachments.ts`. Design: [ADR-015](../decisions/ADR-015-vision-images.md).

Images are uploaded first, then sent with a chat message by id. Uploads require a signed-in account and configured Supabase Storage.

## Endpoints

| Method | Path                       | Access       | Success                        | Purpose                                    |
| ------ | -------------------------- | ------------ | ------------------------------ | ------------------------------------------ |
| POST   | `/api/attachments`         | User         | `201 AttachmentUploadResponse` | Upload one image (`multipart/form-data`)   |
| GET    | `/api/attachments/:id/url` | User (owner) | `200 AttachmentUrlResponse`    | Signed URL to the private image, 5 minutes |

`GET /api/me` reports what the caller may upload in `limits.attachments`:

```json
{
  "enabled": true,
  "maxBytes": 5242880,
  "maxPerMessage": 4,
  "mimeTypes": ["image/png", "image/jpeg", "image/webp", "image/gif"]
}
```

`enabled` is always `false` for guests, and for everyone when storage is not configured.

## `POST /api/attachments`

One part named `file`, nothing else:

```bash
curl -X POST http://localhost:4000/api/attachments -b cookies.txt -F "file=@photo.jpg;type=image/jpeg"
```

```json
{
  "attachment": {
    "id": "…",
    "kind": "image",
    "mimeType": "image/jpeg",
    "sizeBytes": 183211,
    "width": 1600,
    "height": 1200,
    "fileName": "photo.jpg",
    "source": "upload",
    "createdAt": "2026-09-16T10:00:00.000Z"
  }
}
```

What the API does, in order: checks storage and the rate limit (before reading the body), limits the stream to `ATTACHMENT_MAX_BYTES`, identifies the image by its bytes, checks the declared type and dimensions, strips EXIF/XMP/IPTC/text metadata, stores the result at `users/{userId}/{attachmentId}.{ext}` and records its SHA-256. `sizeBytes` is the stored (stripped) size.

| Status | Code                | When                                                                   |
| ------ | ------------------- | ---------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`  | Empty file, damaged container, dimensions outside 1–8192, no file part |
| 401    | `AUTH_REQUIRED`     | Not signed in                                                          |
| 413    | `VALIDATION_ERROR`  | Larger than `ATTACHMENT_MAX_BYTES`, or extra fields/parts              |
| 415    | `VALIDATION_ERROR`  | Not PNG/JPEG/WebP/GIF (SVG included), type mismatch, not multipart     |
| 429    | `RATE_LIMITED`      | More than 30 uploads in an hour                                        |
| 503    | `MODEL_UNAVAILABLE` | Storage not configured, or temporarily unreachable (`retryable`)       |

## `GET /api/attachments/:id/url`

```json
{
  "url": "https://<project>.supabase.co/storage/v1/object/sign/a-ai-attachments/users/…?token=…",
  "expiresAt": "…"
}
```

`404` for someone else's image or a malformed id (ids cannot be probed). Responses are `cache-control: no-store`.

## Sending images with a message

`POST /api/chat` with `attachmentIds` ([chat](chat.md)). Each image is sent once, with the message it was attached to; the saved user message lists it in `attachments` in `GET /api/conversations/:id`. Later turns carry text only.

## Generated files

Image and video generation jobs store their output as attachments with `source: "generated"` ([generation](generation.md)). Videos have `kind: "video"`, `mimeType` `video/mp4` or `video/webm`, and `width`/`height` of `null`. Generated files cannot be sent with a chat message.

## Lifecycle

- Deleting a conversation deletes its image rows and then their storage objects.
- `pnpm attachments:cleanup` removes uploads never sent within 24 hours. Supabase Storage has no lifecycle rules: schedule it daily in production.

## Setup

1. Supabase dashboard → Storage → New bucket `a-ai-attachments` (or `SUPABASE_STORAGE_BUCKET`), **Public: off**.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the API environment (both or neither). The service-role key must never reach the web app.
3. Optionally set `ATTACHMENT_MAX_BYTES` (100 KiB to 20 MiB).
