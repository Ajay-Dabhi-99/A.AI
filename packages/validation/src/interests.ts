import { z } from 'zod';

/** Topics a user can pick after signing in (MODEL-066). */
export const INTEREST_MAX = 3;
export const INTEREST_MAX_LENGTH = 40;

/** Built-in topics; users can also add their own. */
export const INTEREST_TOPICS = [
  'Coding',
  'Business',
  'Marketing',
  'Writing',
  'Design',
  'Data & AI',
  'Education',
  'Health & Fitness',
  'Travel',
  'Finance',
  'Career',
  'Science',
] as const;

const topicSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2, 'Topics need at least 2 characters')
      .max(INTEREST_MAX_LENGTH, `Topics can be at most ${INTEREST_MAX_LENGTH} characters`)
      .regex(/^[\p{L}\p{N}][\p{L}\p{N} &'+.#/-]*$/u, 'Use letters, numbers and simple punctuation'),
  );

/** PATCH /api/me/interests. An empty list skips the question. */
export const interestsUpdateSchema = z
  .object({
    interests: z
      .array(topicSchema)
      .max(INTEREST_MAX, `Pick at most ${INTEREST_MAX} topics`)
      .refine(
        (topics) => new Set(topics.map((topic) => topic.toLowerCase())).size === topics.length,
        'Pick each topic only once',
      ),
  })
  .strict();

export type InterestsUpdateRequest = z.infer<typeof interestsUpdateSchema>;
