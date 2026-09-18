import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, apiUrl, fetchReadiness, NetworkError } from '../src/services/api';
import { gatewayResponse, jsonResponse, readyReport } from './helpers/render';

describe('apiUrl', () => {
  it('builds same-origin paths by default and absolute URLs when a base is set', () => {
    expect(apiUrl('/ready', '')).toBe('/ready');
    expect(apiUrl('/ready', 'https://api.a-ai.app')).toBe('https://api.a-ai.app/ready');
  });
});

describe('fetchReadiness', () => {
  it('returns the report for 200 and sends credentials', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(readyReport));
    await expect(fetchReadiness()).resolves.toEqual(readyReport);
    expect(fetchMock).toHaveBeenCalledWith(
      '/ready',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('treats 503 with a valid report as a degraded result, not an error', async () => {
    const degraded = { ...readyReport, status: 'not_ready' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(degraded, 503));
    await expect(fetchReadiness()).resolves.toMatchObject({ status: 'not_ready' });
  });

  it('raises ApiError from the error envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Slow down',
            retryable: true,
            requestId: 'req-9',
          },
        },
        429,
      ),
    );
    const error = await fetchReadiness().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      retryable: true,
      requestId: 'req-9',
    });
  });

  it('raises NetworkError when the API cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchReadiness()).rejects.toBeInstanceOf(NetworkError);
  });
});

/**
 * The API sleeps when idle on its current hosting, so the first request after a
 * quiet period is answered by the proxy in front of it while the instance boots.
 */
describe('cold start', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a GET the proxy refused until the API answers', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(gatewayResponse(502))
      .mockResolvedValueOnce(gatewayResponse(503))
      .mockResolvedValue(jsonResponse(readyReport));

    const pending = fetchReadiness();
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(pending).resolves.toEqual(readyReport);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up and reports the last gateway failure', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(gatewayResponse(502));

    const pending = expect(fetchReadiness()).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 502,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('accepts a 503 the API answered itself instead of retrying it', async () => {
    const degraded = { ...readyReport, status: 'not_ready' };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(degraded, 503));

    await expect(fetchReadiness()).resolves.toMatchObject({ status: 'not_ready' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never replays a POST, which the API may already have carried out', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(gatewayResponse(504));

    const pending = expect(apiRequest('/api/chat', { method: 'POST', body: {} })).rejects.toThrow(
      ApiError,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports an unreachable API at once instead of waiting out a boot', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));

    await expect(fetchReadiness()).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
