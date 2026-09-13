# Generation API (image, video, audio)

> **Planned. Phases 8–9. Feature-gated.**

| Method | Path                  | Purpose                                                           |
| ------ | --------------------- | ----------------------------------------------------------------- |
| POST   | `/api/image/generate` | Start an image job, returns `GenerationJob` with `status: queued` |
| GET    | `/api/image/:id`      | Job status                                                        |
| POST   | `/api/video/generate` | Start a video job                                                 |
| GET    | `/api/video/:id`      | Job status                                                        |

Jobs are persisted in PostgreSQL (source of truth) with progress mirrored in Redis (`job:{jobId}`) so a page refresh or reconnect resumes the view. Outputs go to object storage (Supabase Storage) behind signed URLs with lifecycle rules. Capabilities a configured provider does not offer are not exposed (blueprint §25).
