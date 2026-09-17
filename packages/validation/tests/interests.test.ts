import { describe, expect, it } from 'vitest';
import {
  chatSuggestionsRequestSchema,
  chatSuggestionsResponseSchema,
  INTEREST_TOPICS,
  interestsUpdateSchema,
} from '../src/index.js';

describe('interestsUpdateSchema', () => {
  it('accepts up to three topics, tidies spacing, and allows skipping', () => {
    expect(
      interestsUpdateSchema.parse({ interests: [' Coding ', 'Machine   learning', 'C++'] }),
    ).toEqual({ interests: ['Coding', 'Machine learning', 'C++'] });
    expect(interestsUpdateSchema.parse({ interests: [] })).toEqual({ interests: [] });
    expect(
      INTEREST_TOPICS.every(
        (topic) => interestsUpdateSchema.safeParse({ interests: [topic] }).success,
      ),
    ).toBe(true);
  });

  it('refuses too many, duplicate, blank, long or odd topics and extra fields', () => {
    const bad = [
      { interests: ['A1', 'B2', 'C3', 'D4'] },
      { interests: ['Travel', 'travel'] },
      { interests: ['  '] },
      { interests: ['x'] },
      { interests: ['x'.repeat(41)] },
      { interests: ['<script>'] },
      { interests: ['Travel'], userId: 'someone' },
      {},
    ];
    for (const body of bad) expect(interestsUpdateSchema.safeParse(body).success).toBe(false);
  });
});

describe('chat suggestion contracts', () => {
  it('needs a question and an answer within limits', () => {
    expect(
      chatSuggestionsRequestSchema.safeParse({ question: 'Hi', answer: 'Hello' }).success,
    ).toBe(true);
    expect(chatSuggestionsRequestSchema.safeParse({ question: ' ', answer: 'Hello' }).success).toBe(
      false,
    );
    expect(
      chatSuggestionsRequestSchema.safeParse({ question: 'Hi', answer: 'x'.repeat(8_001) }).success,
    ).toBe(false);
    expect(
      chatSuggestionsResponseSchema.safeParse({ suggestions: ['a', 'b', 'c', 'd'] }).success,
    ).toBe(false);
  });
});
