import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { probeDependency } from '../../src/modules/health/health.service.js';

function logger() {
  return { warn: vi.fn() } as unknown as FastifyBaseLogger & { warn: ReturnType<typeof vi.fn> };
}

describe('probeDependency', () => {
  it('reports up with latency when the probe resolves', async () => {
    const result = await probeDependency('database', async () => 'ok', logger());
    expect(result.status).toBe('up');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('reports a generic reason and logs only the error name/code on failure', async () => {
    const log = logger();
    const failure = Object.assign(
      new Error('password authentication failed for postgres://u:secret@h'),
      {
        code: '28P01',
      },
    );
    const result = await probeDependency('database', async () => Promise.reject(failure), log);

    expect(result).toMatchObject({ status: 'down', error: 'unreachable' });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('secret');
    expect(log.warn.mock.calls[0]?.[0]).toMatchObject({
      dependency: 'database',
      errorCode: '28P01',
    });
  });

  it('times out a hanging probe', async () => {
    const result = await probeDependency('redis', () => new Promise(() => undefined), logger(), 30);
    expect(result).toMatchObject({ status: 'down', error: 'timed out after 30ms' });
  });
});
