import type { PersonalInstructionsResponse } from '@a-ai/shared-types';
import { z } from 'zod';

/** Personal instructions (MODEL-069). */
export const INSTRUCTIONS_MAX_LENGTH = 1_500;

const instructionText = z
  .string()
  .trim()
  .max(INSTRUCTIONS_MAX_LENGTH, `Keep this under ${INSTRUCTIONS_MAX_LENGTH} characters`)
  .nullable()
  // Blank means "not set".
  .transform((value) => (value ? value : null));

/** PATCH /api/me/instructions: replaces all three fields. */
export const instructionsUpdateSchema = z
  .object({
    about: instructionText,
    style: instructionText,
    enabled: z.boolean(),
  })
  .strict();

export type InstructionsUpdateRequest = z.infer<typeof instructionsUpdateSchema>;

export const personalInstructionsResponseSchema = z.object({
  instructions: z.object({
    about: z.string().nullable(),
    style: z.string().nullable(),
    enabled: z.boolean(),
  }),
}) satisfies z.ZodType<PersonalInstructionsResponse>;
