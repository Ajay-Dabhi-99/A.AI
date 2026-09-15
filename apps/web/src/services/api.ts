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

async function request(path: string, init: RequestInit = {}): Promise<Response> {
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

  if (!response.ok) throw await toApiError(response);
  if (!options.schema) return undefined as T;

  const parsed = options.schema.safeParse(await response.json().catch(() => null));
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
