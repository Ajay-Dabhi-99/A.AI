import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaClient } from '../../src/plugins/prisma.js';
import { createPrismaAttachmentRepository } from '../../src/repositories/attachment.repository.js';
import { createPrismaConversationRepository } from '../../src/repositories/conversation.repository.js';
import { createPrismaGenerationJobRepository } from '../../src/repositories/generation-job.repository.js';
import { createPrismaRepositories } from '../../src/repositories/prisma.repositories.js';
import { testEnv } from '../helpers/test-app.js';

/** Phase 8 data gate against real Supabase PostgreSQL. Storage objects are not touched. */
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('Live attachment tests need TEST_DATABASE_URL (Supabase test project).');
}

let prisma: PrismaClient;
const userIds: string[] = [];

async function newUser(): Promise<string> {
  const user = await createPrismaRepositories(prisma).users.create({
    email: `live-attachments-${randomUUID()}@example.test`,
    passwordHash: 'hash',
  });
  userIds.push(user.id);
  return user.id;
}

function newAttachment(userId: string, source: 'upload' | 'generated' = 'upload') {
  const id = randomUUID();
  return createPrismaAttachmentRepository(prisma).create({
    id,
    userId,
    source,
    kind: 'image',
    mimeType: 'image/png',
    sizeBytes: 100,
    width: 4,
    height: 3,
    sha256: 'a'.repeat(64),
    fileName: 'square.png',
    storageKey: `users/${userId}/${id}.png`,
  });
}

beforeAll(() => {
  prisma = createPrismaClient(testEnv({ DATABASE_URL: databaseUrl }));
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

describe('attachments in PostgreSQL', () => {
  it('links an upload to one message only and cascades with the conversation', async () => {
    const userId = await newUser();
    const attachments = createPrismaAttachmentRepository(prisma);
    const conversations = createPrismaConversationRepository(prisma);
    const conversation = await conversations.create({ userId, title: 'Vision' });
    const message = await conversations.addUserMessage(conversation.id, 'What is this?');
    const attachment = await newAttachment(userId);

    expect(await attachments.attachToMessage([attachment.id], userId, message.id, new Date())).toBe(
      1,
    );
    // A second request cannot send the same image again.
    expect(await attachments.attachToMessage([attachment.id], userId, message.id, new Date())).toBe(
      0,
    );
    expect((await attachments.listForMessages([message.id])).map((row) => row.id)).toEqual([
      attachment.id,
    ]);
    expect(await attachments.storageKeysForConversation(conversation.id, userId)).toEqual([
      attachment.storageKey,
    ]);
    expect(await attachments.storageKeysForConversation(conversation.id, randomUUID())).toEqual([]);

    await prisma.conversation.delete({ where: { id: conversation.id } });
    expect(await attachments.findForUser(attachment.id, userId)).toBeNull();
  });

  it('lists unsent uploads for cleanup, never generated images', async () => {
    const userId = await newUser();
    const attachments = createPrismaAttachmentRepository(prisma);
    const upload = await newAttachment(userId);
    const generated = await newAttachment(userId, 'generated');

    const stale = await attachments.listUnattachedBefore(new Date(Date.now() + 60_000), 1_000);
    const ids = stale.map((row) => row.id);
    expect(ids).toContain(upload.id);
    expect(ids).not.toContain(generated.id);
    expect(await attachments.deleteMany([upload.id])).toBe(1);
  });

  it('claims a generation job exactly once', async () => {
    const userId = await newUser();
    const jobs = createPrismaGenerationJobRepository(prisma);
    const job = await jobs.create({
      userId,
      kind: 'image',
      provider: 'pixels',
      model: 'pix-1',
      prompt: 'a fox',
    });
    const [first, second] = await Promise.all([
      jobs.claim(job.id, new Date()),
      jobs.claim(job.id, new Date()),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);

    const image = await newAttachment(userId, 'generated');
    await jobs.complete(job.id, image.id, new Date());
    expect(await jobs.findForUser(job.id, userId)).toMatchObject({
      status: 'COMPLETED',
      attachmentId: image.id,
    });
    expect(await jobs.findForUser(job.id, randomUUID())).toBeNull();
  });

  it('enables row level security on the new tables', async () => {
    const rows = await prisma.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity FROM pg_class
      WHERE relname IN ('attachments', 'generation_jobs') AND relkind = 'r'
      AND relnamespace = 'public'::regnamespace
      ORDER BY relname`;
    expect(rows).toEqual([
      { relname: 'attachments', relrowsecurity: true },
      { relname: 'generation_jobs', relrowsecurity: true },
    ]);
  });
});
