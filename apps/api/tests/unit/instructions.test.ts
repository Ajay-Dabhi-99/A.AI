import { describe, expect, it } from 'vitest';
import { withInstructions } from '../../src/modules/users/instructions.service.js';

const base = 'You are A.ai.';

describe('withInstructions', () => {
  it('leaves the prompt alone when there is nothing to send', () => {
    expect(withInstructions(base, null)).toBe(base);
    expect(withInstructions(base, { about: 'Dev', style: 'Short', enabled: false })).toBe(base);
    expect(withInstructions(base, { about: null, style: null, enabled: true })).toBe(base);
  });

  it('adds what is set, after the assistant rules and clearly marked', () => {
    const prompt = withInstructions(base, {
      about: 'I am a developer.',
      style: null,
      enabled: true,
    });
    expect(prompt.startsWith(`${base}\n`)).toBe(true);
    expect(prompt).toContain('<about_user>\nI am a developer.\n</about_user>');
    expect(prompt).not.toContain('response_preferences');
    expect(prompt).toContain('unless they conflict with the rules above');

    const both = withInstructions(base, { about: 'Dev', style: 'Use bullets.', enabled: true });
    expect(both).toContain('<response_preferences>\nUse bullets.\n</response_preferences>');
    expect(both.indexOf('about_user')).toBeLessThan(both.indexOf('response_preferences'));
  });
});
