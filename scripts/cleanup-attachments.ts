/**
 * Removes image uploads that were never sent with a message within 24 hours
 * (Phase 8, ADR-015 §4). Supabase Storage has no lifecycle rules, so schedule
 * this (for example daily) wherever the API is deployed.
 *
 *   pnpm attachments:cleanup
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client.js';
import { AttachmentService } from '../apps/api/src/modules/attachments/attachment.service.js';
import { createPrismaAttachmentRepository } from '../apps/api/src/repositories/attachment.repository.js';
import { RATE_LIMITS, RateLimiter } from '../apps/api/src/services/rate-limit.service.js';
import { createSupabaseStorage } from '../apps/api/src/services/storage/object-storage.js';
import { systemClock } from '../apps/api/src/shared/clock.js';

type Deps = ConstructorParameters<typeof AttachmentService>[0];

const setting = (name: string) => process.env[name]?.trim() || undefined;
const supabaseUrl = setting('SUPABASE_URL');
const serviceRoleKey = setting('SUPABASE_SERVICE_ROLE_KEY');
const databaseUrl = setting('DATABASE_URL');

if (!supabaseUrl || !serviceRoleKey) {
  console.log('Image uploads are not configured (SUPABASE_URL is empty). Nothing to clean up.');
  process.exit(0);
}
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Add it to the root .env file.');
  process.exit(1);
}

/** Console output without keys or values: the service logs counts and codes only. */
const noop = () => undefined;
const logger = {
  level: 'info',
  info: noop,
  debug: noop,
  trace: noop,
  warn: (_fields: unknown, message: string) => console.warn(message),
  error: (_fields: unknown, message: string) => console.error(message),
  fatal: (_fields: unknown, message: string) => console.error(message),
  silent: noop,
  child: () => logger,
} as unknown as Deps['logger'];

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

const attachments = new AttachmentService({
  repository: createPrismaAttachmentRepository(prisma),
  storage: createSupabaseStorage({
    url: supabaseUrl,
    serviceRoleKey,
    bucket: setting('SUPABASE_STORAGE_BUCKET') ?? 'a-ai-attachments',
  }),
  // Cleanup never uploads, so the limiter is never consulted.
  rateLimiter: new RateLimiter({
    hitWindow: () => Promise.reject(new Error('not used by cleanup')),
  } as unknown as ConstructorParameters<typeof RateLimiter>[0]),
  uploadRule: RATE_LIMITS.uploadByUser,
  maxBytes: Number(setting('ATTACHMENT_MAX_BYTES') ?? 5_242_880),
  clock: systemClock,
  logger,
});

try {
  const removed = await attachments.cleanupUnattached();
  console.log(`Removed ${removed} unsent image upload(s).`);
} catch (error) {
  console.error('Cleanup failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
