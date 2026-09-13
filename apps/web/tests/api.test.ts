import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiUrl, fetchReadiness, NetworkError } from '../src/services/api';
import { jsonResponse, readyReport } from './helpers/render';

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

  it('raises ApiError for unexpected payloads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>Bad gateway</html>', { status: 502 }),
    );
    await expect(fetchReadiness()).rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 502 });
  });

  it('raises NetworkError when the API cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchReadiness()).rejects.toBeInstanceOf(NetworkError);
  });
});
