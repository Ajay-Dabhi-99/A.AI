import { parseWebEnv } from '@a-ai/config/web';

/** Validated at startup: a misconfigured build fails loudly instead of calling the wrong API. */
export const webEnv = parseWebEnv(import.meta.env);
