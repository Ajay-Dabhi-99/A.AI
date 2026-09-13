import { describe, expect, it, vi } from 'vitest';
import {
  LogEmailSender,
  RESEND_ENDPOINT,
  ResendEmailSender,
} from '../../src/services/email/email-sender.js';
import {
  accountExistsEmail,
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from '../../src/services/email/templates.js';
import { silentLogger } from '../helpers/fakes.js';

const link = 'https://app.a-ai.test/verify-email#token=abc_DEF-123';

describe('email templates', () => {
  it('puts the link in both the text and HTML versions', () => {
    for (const message of [
      verificationEmail({ to: 'a@b.co', link }),
      passwordResetEmail({ to: 'a@b.co', link }),
      passwordChangedEmail({ to: 'a@b.co', resetLink: link }),
    ]) {
      expect(message.to).toBe('a@b.co');
      expect(message.text).toContain(link);
      expect(message.html).toContain(link);
    }
    const exists = accountExistsEmail({
      to: 'a@b.co',
      loginLink: 'https://x/login',
      resetLink: link,
    });
    expect(exists.text).toContain('https://x/login');
  });

  it('escapes HTML in interpolated values', () => {
    const message = verificationEmail({
      to: 'a@b.co',
      link: 'https://x/"><script>alert(1)</script>',
    });
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });
});

describe('ResendEmailSender', () => {
  const message = verificationEmail({ to: 'a@b.co', link });

  it('posts the message to Resend with the API key', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"id":"1"}', { status: 200 }));
    const sender = new ResendEmailSender({
      apiKey: 're_test',
      from: 'A.ai <no-reply@a-ai.test>',
      fetchImpl,
    });

    await sender.send(message);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_test');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'A.ai <no-reply@a-ai.test>',
      to: ['a@b.co'],
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  });

  it('throws on a rejected send without leaking the response body', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"message":"key re_test is invalid"}', { status: 403 }),
    );
    const sender = new ResendEmailSender({ apiKey: 're_test', from: 'A.ai <x@y.z>', fetchImpl });

    const error = await sender.send(message).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Resend returned HTTP 403');
  });
});

describe('LogEmailSender', () => {
  it('logs the email contents instead of sending', async () => {
    const logger = silentLogger();
    await new LogEmailSender(logger).send(verificationEmail({ to: 'a@b.co', link }));
    expect(logger.info).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.info.mock.calls[0])).toContain(link);
  });
});
