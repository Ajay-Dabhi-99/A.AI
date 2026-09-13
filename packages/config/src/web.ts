import { z } from 'zod';

/**
 * Browser-safe environment contract. Only VITE_-prefixed values belong here;
 * everything in this schema ships to every visitor.
 */
export const webEnvSchema = z.object({
  VITE_API_URL: z
    .string()
    .optional()
    .transform((value) => (value ?? '').trim().replace(/\/+$/, ''))
    .refine(
      (value) => value === '' || /^https?:\/\/[^/]+$/.test(value),
      'must be empty (same-origin) or an http(s) origin with no path',
    ),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function parseWebEnv(source: Record<string, unknown>): WebEnv {
  const result = webEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid web environment configuration:\n  - ${issues.join('\n  - ')}`);
  }
  return result.data;
}
