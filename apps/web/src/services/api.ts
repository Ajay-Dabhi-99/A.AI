import type { ErrorCode, ReadinessResponse } from '@a-ai/shared-types';
import { apiErrorBodySchema, readinessResponseSchema } from '@a-ai/validation';
import { webEnv } from '@/lib/env';

/** A failure the API described with its error envelope. */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId: string | undefined;

  constructor(options: {
    code: ErrorCode;
    message: string;
    status: number;
    retryable: boolean;
    requestId?: string;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
    this.requestId = options.requestId;
  }
}

/** The API could not be reached at all (offline, DNS, CORS, server down). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('Could not reach the A.ai API.', { cause });
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

async function toApiError(response: Response): Promise<ApiError> {
  const parsed = apiErrorBodySchema.safeParse(await response.json().catch(() => null));
  if (parsed.success) {
    const { code, message, retryable, requestId } = parsed.data.error;
    return new ApiError({ code, message, retryable, requestId, status: response.status });
  }
  return new ApiError({
    code: 'INTERNAL_ERROR',
    message: `Unexpected response from the API (HTTP ${response.status}).`,
    status: response.status,
    retryable: response.status >= 500,
    requestId: response.headers.get('x-request-id') ?? undefined,
  });
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
