import type {
  AIModel,
  ChatMessage,
  ChatStreamEvent,
  ChatStreamEventMap,
  ChatStreamEventName,
  ConversationDetail,
  ConversationListResponse,
  GuestConversationResponse,
  GuestMigrationResponse,
  ModelsResponse,
} from '@a-ai/shared-types';
import { z } from 'zod';
import { errorCodeSchema } from './errors.js';

export const CHAT_MESSAGE_MAX_LENGTH = 16_000;

/**
 * POST /api/chat. Send a new `message`, or `retry: true` to answer the last
 * unanswered user message again (after a failure or stop) without repeating it.
 */
export const chatRequestSchema = z
  .object({
    conversationId: z.uuid('Unknown conversation').optional(),
    provider: z.string().min(1).max(32),
    model: z.string().min(1).max(128),
    message: z
      .string()
      .trim()
      .min(1, 'Write a message first')
      .max(CHAT_MESSAGE_MAX_LENGTH, `Messages can be at most ${CHAT_MESSAGE_MAX_LENGTH} characters`)
      .optional(),
    retry: z.boolean().optional(),
  })
  .refine((body) => (body.retry === true) !== (body.message !== undefined), {
    path: ['message'],
    message: 'Send a message, or retry the previous one',
  });

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const aiModelSchema = z.object({
  id: z.string(),
  provider: z.string(),
  name: z.string(),
  category: z.enum(['text', 'vision', 'image', 'video', 'audio']),
  contextWindow: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  supportsStreaming: z.boolean(),
  supportsVision: z.boolean(),
  supportsTools: z.boolean(),
  availability: z.enum(['free', 'free-tier', 'paid']),
}) satisfies z.ZodType<AIModel>;

export const modelsResponseSchema = z.object({
  models: z.array(aiModelSchema),
  defaultModel: z.object({ provider: z.string(), id: z.string() }).nullable(),
}) satisfies z.ZodType<ModelsResponse>;

const runStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled', 'timeout']);

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.string(),
  run: z
    .object({
      provider: z.string(),
      model: z.string(),
      status: runStatusSchema,
      latencyMs: z.number().int().nonnegative().optional(),
      errorCode: z.string().optional(),
    })
    .optional(),
}) satisfies z.ZodType<ChatMessage>;

const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const conversationListResponseSchema = z.object({
  conversations: z.array(conversationSummarySchema),
}) satisfies z.ZodType<ConversationListResponse>;

export const conversationDetailSchema = conversationSummarySchema.extend({
  messages: z.array(chatMessageSchema),
}) satisfies z.ZodType<ConversationDetail>;

export const guestConversationResponseSchema = z.object({
  messages: z.array(chatMessageSchema),
  expiresAt: z.string(),
}) satisfies z.ZodType<GuestConversationResponse>;

export const guestMigrationResponseSchema = z.object({
  conversationId: z.string().nullable(),
}) satisfies z.ZodType<GuestMigrationResponse>;

const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  source: z.enum(['provider', 'estimated']),
});

export const chatStreamEventSchemas = {
  'message.start': z.object({
    runId: z.string(),
    provider: z.string(),
    model: z.string(),
    conversationId: z.string().nullable(),
  }),
  'message.delta': z.object({ runId: z.string(), text: z.string() }),
  usage: z.object({ runId: z.string(), usage: usageSchema }),
  'message.done': z.object({
    runId: z.string(),
    status: z.enum(['completed', 'cancelled']),
    messageId: z.string().nullable(),
    latencyMs: z.number().nonnegative(),
  }),
  error: z.object({
    runId: z.string().optional(),
    code: errorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
  }),
} satisfies { [Name in ChatStreamEventName]: z.ZodType<ChatStreamEventMap[Name]> };

/** Validates one SSE event from /api/chat. Unknown or malformed events return null. */
export function parseChatStreamEvent(event: string, data: string): ChatStreamEvent | null {
  if (!Object.hasOwn(chatStreamEventSchemas, event)) return null;
  const name = event as ChatStreamEventName;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = chatStreamEventSchemas[name].safeParse(json);
  return parsed.success ? ({ event: name, data: parsed.data } as ChatStreamEvent) : null;
}
