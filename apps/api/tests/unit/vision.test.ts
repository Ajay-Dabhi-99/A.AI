import { describe, expect, it } from 'vitest';
import {
  buildContext,
  estimateMessageTokens,
  IMAGE_TOKEN_ESTIMATE,
  MESSAGE_OVERHEAD_TOKENS,
} from '../../src/ai/context-builder.js';
import { fallbackCandidates } from '../../src/ai/model-router.js';
import { cleanFileName } from '../../src/modules/attachments/attachment.service.js';
import { testModel } from '../helpers/scripted-provider.js';

const image = { mimeType: 'image/png', data: 'iVBORw0KGgo=' };

describe('vision context (ADR-015 §5)', () => {
  it('counts a fixed estimate per image', () => {
    const text = { role: 'user' as const, content: 'abcd' };
    expect(estimateMessageTokens(text)).toBe(1 + MESSAGE_OVERHEAD_TOKENS);
    expect(estimateMessageTokens({ ...text, images: [image, image] })).toBe(
      1 + MESSAGE_OVERHEAD_TOKENS + 2 * IMAGE_TOKEN_ESTIMATE,
    );
  });

  it('keeps images on the message they were sent with', () => {
    const context = buildContext({
      history: [
        { role: 'user', content: 'earlier' },
        { role: 'assistant', content: 'reply' },
        { role: 'user', content: 'what is this?', images: [image] },
      ],
      contextWindow: 32_000,
      maxOutputTokens: 1_000,
    });
    expect(context.messages.at(-1)?.images).toEqual([image]);
    expect(context.estimatedInputTokens).toBeGreaterThan(IMAGE_TOKEN_ESTIMATE);
  });

  it('rejects a message whose images cannot fit the model', () => {
    expect(() =>
      buildContext({
        history: [{ role: 'user', content: 'hi', images: [image] }],
        contextWindow: 1_200,
        maxOutputTokens: 100,
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTEXT_TOO_LARGE' }));
  });
});

describe('vision fallback routing', () => {
  it('only falls back to vision models when the request carries images', () => {
    const failed = testModel('alpha', 'see-1', { supportsVision: true });
    const available = [
      failed,
      testModel('beta', 'text-1'),
      testModel('gamma', 'see-2', { supportsVision: true }),
    ];
    const up = () => false;
    expect(fallbackCandidates(failed, available, up).map((model) => model.id)).toEqual([
      'text-1',
      'see-2',
    ]);
    expect(
      fallbackCandidates(failed, available, up, { vision: true }).map((model) => model.id),
    ).toEqual(['see-2']);
  });
});

describe('cleanFileName', () => {
  it('keeps display text only', () => {
    expect(cleanFileName('../../etc/holiday photo.png')).toBe('holiday photo.png');
    expect(cleanFileName('C:\\Users\\me\\scan\u0007.jpg')).toBe('scan.jpg');
    expect(cleanFileName('   ')).toBeNull();
    expect(cleanFileName(undefined)).toBeNull();
    expect(cleanFileName(`${'a'.repeat(200)}.png`)).toHaveLength(120);
  });
});
