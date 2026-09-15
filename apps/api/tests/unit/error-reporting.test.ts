import { describe, expect, it } from 'vitest';
import { noopErrorReporter, scrubEvent } from '../../src/plugins/error-reporting.js';

describe('error report scrubbing (ADR-017)', () => {
  it('strips headers, cookies, bodies, query strings, users and breadcrumbs', () => {
    const event = scrubEvent({
      message: 'boom',
      request: {
        url: 'https://api.example.com/api/chat?token=secret',
        headers: { cookie: '__Host-a_ai_session=abc', authorization: 'Bearer key' },
        cookies: { '__Host-a_ai_session': 'abc' },
        data: { message: 'my private prompt' },
        query_string: 'token=secret',
      },
      user: { ip_address: '203.0.113.9', email: 'person@example.com' },
      breadcrumbs: [{ message: 'POST /api/chat' }],
      extra: { body: 'my private prompt' },
      tags: { requestId: 'req-1' },
    });

    expect(event).toEqual({
      message: 'boom',
      request: { url: 'https://api.example.com/api/chat' },
      breadcrumbs: [],
      tags: { requestId: 'req-1' },
    });
    expect(JSON.stringify(event)).not.toMatch(/secret|private prompt|person@example|Bearer/);
  });

  it('sends nothing without a DSN', async () => {
    expect(noopErrorReporter.enabled).toBe(false);
    expect(() => noopErrorReporter.capture(new Error('x'))).not.toThrow();
    await expect(noopErrorReporter.flush(10)).resolves.toBeUndefined();
  });
});
