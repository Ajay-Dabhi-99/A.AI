import { AIProviderError } from '@a-ai/ai-core';
import type { ErrorCode } from '@a-ai/shared-types';

/**
 * HTTP plumbing shared by every REST-based adapter: one timeout policy, one
 * cancellation policy and one status-to-taxonomy mapping.
 */

export type HttpErrorClassification = { code: ErrorCode; retryable: boolean };

export function classifyHttpStatus(status: number): HttpErrorClassification {
  if (status === 408 || status === 504) return { code: 'PROVIDER_TIMEOUT', retryable: true };
  if (status === 429) return { code: 'RATE_LIMITED', retryable: true };
  // A rejected key or unknown model is a configuration problem: retrying cannot help.
  if (status === 401 || status === 403 || status === 404) {
    return { code: 'MODEL_UNAVAILABLE', retryable: false };
  }
  if (status >= 500) return { code: 'MODEL_UNAVAILABLE', retryable: true };
  return { code: 'PROVIDER_BAD_RESPONSE', retryable: false };
}

/** Parses Retry-After as delta-seconds or an HTTP date. */
export function parseRetryAfter(
  header: string | null,
  now: number = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

export type ProviderFetchOptions = {
  provider: string;
  url: string;
  init?: Omit<RequestInit, 'signal'>;
  /**
   * Time allowed until the response headers arrive. It does not limit reading
   * the body, so long streamed answers are not cut off; adapters apply their
   * own idle timeout while streaming.
   */
  timeoutMs: number;
  /** Caller cancellation (client disconnected, user pressed stop). Applies to the body too. */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

/**
 * fetch with a connect timeout. Outcomes:
 * - caller aborted      -> rethrows the caller's abort reason (not a provider failure)
 * - timeout elapsed     -> AIProviderError PROVIDER_TIMEOUT
 * - network failure     -> AIProviderError MODEL_UNAVAILABLE (retryable)
 * - non-2xx response    -> AIProviderError classified by status
 */
export async function providerFetch(options: ProviderFetchOptions): Promise<Response> {
  const { provider, url, init, timeoutMs, signal, fetchImpl = fetch } = options;
  const connect = new AbortController();
  const timer = setTimeout(
    () => connect.abort(new DOMException(`${provider} connect timeout`, 'TimeoutError')),
    timeoutMs,
  );
  const combined = signal ? AbortSignal.any([signal, connect.signal]) : connect.signal;

  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: combined });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (connect.signal.aborted) {
      throw new AIProviderError({
        provider,
        code: 'PROVIDER_TIMEOUT',
        message: `${provider} did not respond within ${timeoutMs}ms`,
        cause: error,
      });
    }
    throw new AIProviderError({
      provider,
      code: 'MODEL_UNAVAILABLE',
      message: `${provider} could not be reached`,
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const { code, retryable } = classifyHttpStatus(response.status);
    // Drain the body so the connection is released; never surface its content.
    await response.body?.cancel().catch(() => undefined);
    throw new AIProviderError({
      provider,
      code,
      retryable,
      status: response.status,
      retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')),
      message: `${provider} returned HTTP ${response.status}`,
    });
  }

  return response;
}
