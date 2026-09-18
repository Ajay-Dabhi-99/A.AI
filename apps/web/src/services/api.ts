import type { ErrorCode, ReadinessResponse, ValidationIssue } from '@a-ai/shared-types';
import { apiErrorBodySchema, readinessResponseSchema } from '@a-ai/validation';
import type { z } from 'zod';
import { webEnv } from '@/lib/env';

/** A failure the API described with its error envelope. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId: string | undefined;
  readonly details: ValidationIssue[];

  constructor(options: {
    code: ErrorCode;
    message: string;
    status: number;
    retryable: boolean;
    requestId?: string;
    details?: ValidationIssue[];
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
    this.requestId = options.requestId;
    this.details = options.details ?? [];
  }
}

/** The API could not be reached at all (offline, DNS, CORS, server down). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Could not reach the A.ai API. Check your connection and try again.', { cause });
    this.name = 'NetworkError';
  }
}

export function apiUrl(path: string, baseUrl: string = webEnv.VITE_API_URL): string {
  return `${baseUrl}${path}`;
}

/**
 * Waits before each further attempt at a request a proxy refused, in
 * milliseconds. The API runs on an instance that sleeps after an idle period
 * and takes roughly 20-60 seconds to boot; while it boots, the proxy in front
 * of it answers immediately, so these five attempts span about 32 seconds of
 * booting rather than 32 seconds of a hung connection.
 */
const COLD_START_BACKOFF_MS: readonly number[] = [1_000, 3_000, 8_000, 20_000];

/** Statuses a proxy in front of the API produces on its own. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

/**
 * True when the response came from a proxy rather than from the API. Every
 * reply the API sends carries x-request-id, set before routing, so a gateway
 * status without that header means the request never reached the app. The
 * header matters because 503 is also a real answer: /ready reports a degraded
 * platform with it, and that must be shown, not retried.
 */
function isGatewayFailure(response: Response): boolean {
  return GATEWAY_STATUSES.has(response.status) && !response.headers.has('x-request-id');
}

function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason as Error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function sendOnce(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(apiUrl(path), {
      ...init,
      credentials: 'include',
      headers: { accept: 'application/json', ...init.headers },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new NetworkError(error);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  // Only a proxy's answer is waited out. A request that threw never got an
  // answer at all, which is an unreachable API rather than a booting one, and is
  // reported at once so the status pill stays honest.
  //
  // Only GET is replayed: repeating it changes nothing on the server, so asking
  // again for an answer that never arrived is free. A POST, PATCH or DELETE may
  // have been carried out before its answer was lost, so it is sent once.
  const backoff = (init.method ?? 'GET') === 'GET' ? COLD_START_BACKOFF_MS : [];

  for (const retryIn of backoff) {
    const response = await sendOnce(path, init);
    if (!isGatewayFailure(response)) return response;
    await wait(retryIn, init.signal);
  }

  return sendOnce(path, init);
}

/** Reads the error envelope from a failed response. */
export async function toApiError(response: Response): Promise<ApiError> {
  const parsed = apiErrorBodySchema.safeParse(await response.json().catch(() => null));
  if (parsed.success) {
    const { code, message, retryable, requestId, details } = parsed.data.error;
    return new ApiError({
      code,
      message,
      retryable,
      requestId,
      status: response.status,
      ...(details ? { details } : {}),
    });
  }
  return new ApiError({
    code: 'INTERNAL_ERROR',
    message: `Unexpected response from the API (HTTP ${response.status}).`,
    status: response.status,
    retryable: response.status >= 500,
    requestId: response.headers.get('x-request-id') ?? undefined,
  });
}

type RequestOptions<T> = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Validates the success body. Omit for 204 responses. */
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
};

/** JSON request to the A.ai API with typed, validated success and error handling. */
export async function apiRequest<T = void>(
  path: string,
  options: RequestOptions<T> = {},
): Promise<T> {
  const response = await request(path, {
    method: options.method ?? 'GET',
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body), headers: { 'content-type': 'application/json' } }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  return readResponse(response, options.schema);
}

/** multipart/form-data upload. The browser sets the content type with its boundary. */
export async function apiUpload<T>(
  path: string,
  form: FormData,
  options: { schema: z.ZodType<T>; signal?: AbortSignal },
): Promise<T> {
  const response = await request(path, {
    method: 'POST',
    body: form,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return readResponse(response, options.schema);
}

async function readResponse<T>(response: Response, schema: z.ZodType<T> | undefined): Promise<T> {
  if (!response.ok) throw await toApiError(response);
  if (!schema) return undefined as T;

  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: 'Unexpected response from the API.',
      status: response.status,
      retryable: false,
      requestId: response.headers.get('x-request-id') ?? undefined,
    });
  }
  return parsed.data;
}

/** GET /ready. A 503 is a valid report (degraded), not an exception. */
export async function fetchReadiness(signal?: AbortSignal): Promise<ReadinessResponse> {
  const response = await request('/ready', signal ? { signal } : {});
  if (response.status === 200 || response.status === 503) {
    const parsed = readinessResponseSchema.safeParse(await response.json().catch(() => null));
    if (parsed.success) return parsed.data;
  }
  throw await toApiError(response);
}
