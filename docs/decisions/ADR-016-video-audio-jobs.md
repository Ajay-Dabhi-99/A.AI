# ADR-016: Video jobs, speech-to-text and read-aloud

**Status:** Accepted (2026-09-17, Phase 9)

## Context

Blueprint §16 Phase 9: "video jobs, STT, TTS, async job state". The gate: **long jobs are resilient to refresh/reconnect**. §12 describes speech-to-text as "async or short request" returning a transcript, and text-to-speech as "POST + stream/file". ADR-015 built the image job abstraction with no provider.

The product owner chose on 2026-09-17:

- **Speech-to-text:** Groq Whisper. It needs `GROQ_API_KEY` and never uses the rate-limited Gemini key.
- **Text-to-speech:** the browser's own voices (Web Speech API).
- **Video:** the job abstraction with progress and resume, and no provider enabled (there is no dependable free video API; blueprint review §16).
- **Recordings:** deleted right after transcription; only the transcript is kept, and only as chat text the user chooses to send.

## Decisions

### 1. One media job contract for image and video

`MediaJobService` (`apps/api/src/modules/jobs/media-job.service.ts`) runs one kind per instance (`image`, `video`) over the Phase 8 `generation_jobs` table. `JobCenter` addresses any job by id.

| Route                        | Purpose                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| `GET /api/{kind}/status`     | Enabled flag and models (public)                             |
| `POST /api/{kind}/generate`  | Start a job, `202`                                           |
| `GET /api/{kind}/:id`        | Job of that kind                                             |
| `GET /api/jobs?kind=&limit=` | The user's recent jobs, newest first                         |
| `GET /api/jobs/:id`          | Any kind                                                     |
| `POST /api/jobs/:id/cancel`  | Cancel a queued or processing job (idempotent)               |
| `GET /api/jobs/:id/events`   | Server-Sent Events, a full snapshot on connect and on change |

- Progress (0–1) reported by a provider's `onProgress` is mirrored in Redis at `job:{id}` (1% steps, 1 hour TTL). The database row stays the source of truth for status.
- Timeouts: image 2 minutes, video 15 minutes. Daily caps per user: 20 images, 5 videos.
- Generated videos are validated by container signature (MP4 `ftyp`, WebM EBML), capped by `VIDEO_MAX_BYTES` (default 50 MiB), and stored as attachments with `kind: video` and null dimensions (migration `20260917090000_media_jobs`).

### 2. How jobs survive refresh, reconnect and restart

| Failure                                | What happens                                                                                                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser refresh or tab reopened        | The job id is in the address (`/video?job=<id>`); the page loads the job and follows it again. Recent jobs are listed.                                                                                                        |
| Event stream drops                     | Every event is a full snapshot, so the client reconnects (after 1, 2, 4 s) and misses nothing.                                                                                                                                |
| Stream keeps failing (buffering proxy) | The client polls `GET /api/jobs/:id` every 3 s.                                                                                                                                                                               |
| Stream open for 10 minutes             | The server closes it; the client reconnects.                                                                                                                                                                                  |
| User cancels                           | The row moves to `CANCELLED` by compare-and-set; the provider call on that instance is aborted; a file stored at that moment is discarded.                                                                                    |
| API instance stops mid-job             | At startup and every 5 minutes, `recover` fails `PROCESSING` jobs older than their timeout plus 1 minute (`PROVIDER_TIMEOUT`) and starts `QUEUED` jobs older than 1 minute. The claim makes this safe with several instances. |

Push (SSE) was chosen over polling alone because a video job may run for minutes and the page should update immediately. Polling is kept as the fallback. The server-side stream re-reads the job every second, a query per open stream per second. That is acceptable at MVP scale; Redis pub/sub is the upgrade path.

### 3. Speech-to-text is a short request

`POST /api/audio/transcriptions` takes one multipart recording from guests and users.

1. Checks, before the body is read: a provider is configured, and rate limits pass (60/hour per user; 10/hour per guest and 30/hour per guest IP).
2. The stream is cut at `AUDIO_MAX_BYTES` (default 10 MiB, max 25 MiB, Groq's limit).
3. The container is sniffed (WebM, Ogg, MP4/M4A, MP3, WAV, FLAC) and must match the declared type. Codec parameters are ignored, and browsers' `video/webm` label for audio is accepted.
4. The recording is sent once to Groq `whisper-large-v3-turbo` (`verbose_json`, optional `?language=xx`) with a 60 s timeout. A client that disconnects aborts the call.
5. The buffer is zero-filled afterwards. Nothing is stored; logs carry size and timings, never the text.

The web app records at most 120 seconds with `MediaRecorder`. The transcript goes **into the draft**, never sent automatically, so the user reviews it first. Without `GROQ_API_KEY`, `GET /api/audio/status` reports `enabled: false` and the microphone is hidden.

### 4. Text-to-speech runs in the browser

"Read aloud" on an answer uses `speechSynthesis`. The Markdown is converted to plain text, and code blocks are announced as omitted. One answer is read at a time, and reading stops when the user leaves. There is no server route, provider cost or stored audio; the button is hidden when the browser has no voices. A server TTS job (an audio attachment) can be added later on the same job contract.

## Consequences

- Voice input needs `GROQ_API_KEY`. The key was added on 2026-09-17 and a real transcription passed; without the key the microphone button stays hidden.
- Video generation stays invisible until a provider with video quota is registered (`videoProviders`).
- Read-aloud voice quality varies by device and browser.
- Earlier Phase 8 image routes keep working; image jobs gained cancel, progress, recovery and resume.
