export const SERVICE_NAME = 'a-ai-api';

/** Bumped on release; reported by GET /health. */
export const APP_VERSION = '0.1.0';

/** Upper bound for a single readiness probe so /ready never hangs. */
export const READINESS_PROBE_TIMEOUT_MS = 2_000;

/** Largest accepted JSON body. Image uploads use multipart with ATTACHMENT_MAX_BYTES (ADR-015). */
export const BODY_LIMIT_BYTES = 1_048_576;
