import { describe, expect, it } from 'vitest';
import { instructionsUpdateSchema } from '../src/index.js';

describe('instructionsUpdateSchema', () => {
  it('trims text and treats blank as not set', () => {
    expect(
      instructionsUpdateSchema.parse({ about: '  I build apps.  ', style: '   ', enabled: true }),
    ).toEqual({ about: 'I build apps.', style: null, enabled: true });
    expect(instructionsUpdateSchema.parse({ about: null, style: null, enabled: false })).toEqual({
      about: null,
      style: null,
      enabled: false,
    });
  });

  it('refuses long text, missing fields and extra fields', () => {
    for (const body of [
      { about: 'x'.repeat(1_501), style: null, enabled: true },
      { about: null, style: null },
      { about: null, enabled: true },
      { about: null, style: null, enabled: 'yes' },
      { about: null, style: null, enabled: true, userId: 'someone' },
    ]) {
      expect(instructionsUpdateSchema.safeParse(body).success).toBe(false);
    }
    expect(
      instructionsUpdateSchema.safeParse({ about: 'x'.repeat(1_500), style: null, enabled: true })
        .success,
    ).toBe(true);
  });
});
