# Audio API (speech-to-text)

**Implemented in Phase 9.** Types: `packages/shared-types/src/audio.ts`. Schemas: `packages/validation/src/audio.ts`. Design: [ADR-016](../decisions/ADR-016-video-audio-jobs.md).

Text-to-speech ("Read aloud") runs in the browser with the Web Speech API. It has no API route and stores no audio.

## Endpoints

| Method | Path                        | Access        | Success                     | Purpose                                 |
| ------ | --------------------------- | ------------- | --------------------------- | --------------------------------------- |
| GET    | `/api/audio/status`         | Anyone        | `200 AudioStatus`           | Whether voice input is available        |
| POST   | `/api/audio/transcriptions` | Guest or user | `200 TranscriptionResponse` | Turn one recording into text, keep none |

## `GET /api/audio/status`

```json
{
  "transcription": {
    "enabled": true,
    "maxBytes": 10485760,
    "maxDurationSeconds": 120,
    "mimeTypes": ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/flac"]
  },
  "speech": { "mode": "browser" }
}
```

`enabled` is `false` without `GROQ_API_KEY`.

## `POST /api/audio/transcriptions`

One part named `file`, nothing else. Optional `?language=en` (two letters) hints the language; without it the provider detects it.

```bash
curl -X POST "http://localhost:4000/api/audio/transcriptions?language=en" -F "file=@note.webm;type=audio/webm"
```

```json
{
  "transcript": {
    "text": "What is the weather like tomorrow?",
    "language": "en",
    "durationMs": 2300,
    "provider": "groq",
    "model": "whisper-large-v3-turbo"
  }
}
```

The recording is checked, sent to the provider once, and wiped from memory. It is never stored, and neither the recording nor the transcript is logged. The web app puts the text into the message box for the user to review; it is not sent to a chat model automatically.

| Status | Code                | When                                                                                                        |
| ------ | ------------------- | ----------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`  | Empty recording, no speech recognized, bad `language`, no file                                              |
| 413    | `VALIDATION_ERROR`  | Larger than `AUDIO_MAX_BYTES`, or extra fields/parts                                                        |
| 415    | `VALIDATION_ERROR`  | Not a supported container, type mismatch, not multipart                                                     |
| 429    | `RATE_LIMITED`      | Over 60/hour (user), 10/hour (guest) or 30/hour (guest IP); or the provider's own limit, with `Retry-After` |
| 503    | `MODEL_UNAVAILABLE` | Voice input not enabled, or the provider is unavailable                                                     |
| 504    | `PROVIDER_TIMEOUT`  | Transcription took longer than 60 s                                                                         |

Responses are `cache-control: no-store`.

## Setup

Set `GROQ_API_KEY` in the API environment (the same key enables Groq chat models). Optionally lower `AUDIO_MAX_BYTES`.
