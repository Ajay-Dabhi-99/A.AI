import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { json, mockApi, sse } from './fixtures';

/** The production Content-Security-Policy, read from the Vercel config the site is deployed with. */
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const csp = vercel.headers
  .flatMap((rule) => rule.headers)
  .find((header) => header.key === 'Content-Security-Policy')?.value as string;

/** Fails the test on any console error or uncaught exception in the page. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // The mocked API answers unmocked optional calls with 404 on purpose.
    if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
  });
  return errors;
}

test('the landing page renders under the production CSP', async ({ page }) => {
  const errors = watchForErrors(page);
  await mockApi(page);
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': csp },
      });
    },
  );

  await page.goto('/');
  await expect(page.getByRole('link', { name: 'A.ai home' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(errors.filter((error) => error.includes('Content Security Policy'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('a guest can chat and see the streamed answer', async ({ page }) => {
  const errors = watchForErrors(page);
  await mockApi(page, {
    'POST /api/chat': sse([
      [
        'message.start',
        {
          runId: 'r1',
          provider: 'groq',
          model: 'openai/gpt-oss-20b',
          conversationId: null,
          context: {
            inputTokens: 40,
            budgetTokens: 120_000,
            contextWindow: 131_072,
            droppedMessages: 0,
            summaryIncluded: false,
          },
        },
      ],
      ['message.delta', { runId: 'r1', text: 'Hello from the smoke test.' }],
      ['message.done', { runId: 'r1', status: 'completed', messageId: null, latencyMs: 420 }],
    ]),
  });

  await page.goto('/chat');
  await page.getByRole('textbox', { name: 'Message' }).fill('Say hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Hello from the smoke test.')).toBeVisible();
  await expect(page.getByText('Say hello')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the chat explains a rejected message', async ({ page }) => {
  await mockApi(page, {
    'POST /api/chat': json(
      {
        error: {
          code: 'QUOTA_EXCEEDED',
          message: 'You have used all 20 messages for today.',
          retryable: false,
          requestId: 'e2e-quota',
        },
      },
      429,
    ),
  });
  await page.goto('/chat');
  await page.getByRole('textbox', { name: 'Message' }).fill('One more?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('You have used all 20 messages for today.')).toBeVisible();
  // The draft comes back so nothing typed is lost.
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('One more?');
});

test('capabilities that are off say so', async ({ page }) => {
  await mockApi(page);
  await page.goto('/video');
  await expect(page.getByText('Video generation is not enabled on this deployment')).toBeVisible();
  await page.goto('/image');
  await expect(page.getByText('Image generation is not enabled on this deployment')).toBeVisible();
});

test('deep links and unknown pages load the app', async ({ page }) => {
  await mockApi(page);
  await page.goto('/compare');
  await expect(page.getByRole('link', { name: 'A.ai home' })).toBeVisible();
  await page.goto('/this-page-does-not-exist');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('a long answer stays in view as it types', async ({ page }) => {
  const history = Array.from({ length: 12 }, (_, index) => [
    {
      id: `u${index}`,
      role: 'user',
      content: `Question ${index}`,
      createdAt: '2030-01-01T00:00:00.000Z',
    },
    {
      id: `a${index}`,
      role: 'assistant',
      content: `Answer ${index}. `.repeat(40),
      createdAt: '2030-01-01T00:00:01.000Z',
    },
  ]).flat();
  const answer = Array.from({ length: 30 }, (_, index) => `Paragraph ${index} of the reply.`).join(
    '\n\n',
  );
  await mockApi(page, {
    'GET /api/guest/conversation': json({
      messages: history,
      expiresAt: '2030-01-01T00:00:00.000Z',
    }),
    'POST /api/chat': sse([
      [
        'message.start',
        {
          runId: 'r1',
          provider: 'groq',
          model: 'openai/gpt-oss-20b',
          conversationId: null,
          context: {
            inputTokens: 40,
            budgetTokens: 120_000,
            contextWindow: 131_072,
            droppedMessages: 0,
            summaryIncluded: false,
          },
        },
      ],
      ['message.delta', { runId: 'r1', text: answer }],
      ['message.done', { runId: 'r1', status: 'completed', messageId: null, latencyMs: 420 }],
    ]),
  });

  await page.goto('/chat');
  await expect(page.getByText('Question 11')).toBeVisible();
  const list = page.locator('[aria-live="polite"]');
  // Read older messages, then ask something new.
  await list.evaluate((element) => element.scrollTo({ top: 0 }));
  await page.getByRole('textbox', { name: 'Message' }).fill('Tell me more');
  await page.getByRole('button', { name: 'Send message' }).click();

  const last = page.getByText('Paragraph 29 of the reply.');
  await expect(last).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Message' });
  const lastBox = await last.boundingBox();
  const listBox = await list.boundingBox();
  const composerBox = await composer.boundingBox();
  expect(lastBox && listBox && composerBox).toBeTruthy();
  // The newest line sits inside the visible list, above the message box.
  expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(listBox!.y + listBox!.height);
  expect(lastBox!.y + lastBox!.height).toBeLessThan(composerBox!.y);
});
