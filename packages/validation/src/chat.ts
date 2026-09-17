import type {
  AIModel,
  ChatMessage,
  ChatStreamEvent,
  ChatStreamEventMap,
  ChatStreamEventName,
  ChatSuggestionsResponse,
  ConversationSearchResponse,
  ConversationShareResponse,
  SharedConversation,
  ConversationDetail,
  ConversationListResponse,
  GuestConversationResponse,
  GuestMigrationResponse,
  ModelsResponse,
  ProviderInfo,
} from '@a-ai/shared-types';
import { z } from 'zod';
import { ATTACHMENTS_PER_MESSAGE_MAX, attachmentSchema, mediaJobSchema } from './attachments.js';
import { errorCodeSchema } from './errors.js';

export const CHAT_MESSAGE_MAX_LENGTH = 16_000;

/**
 * POST /api/chat. Send a new `message`; or `retry: true` to answer the last
 * unanswered user message again (after a failure or stop) without repeating it;
 * or `regenerate: true` to replace the latest answer with a new one; or
 * `edit: true` with `message` to replace the latest question and answer it
 * again (MODEL-068).
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
    regenerate: z.boolean().optional(),
    edit: z.boolean().optional(),
    /** Uploaded images to send with a new message (Phase 8). */
    attachmentIds: z
      .array(z.uuid('Unknown attachment'))
      .max(ATTACHMENTS_PER_MESSAGE_MAX, `Attach at most ${ATTACHMENTS_PER_MESSAGE_MAX} images`)
      .refine((ids) => new Set(ids).size === ids.length, 'Attach each image only once')
      .optional(),
  })
  .refine(
    (body) => [body.retry, body.regenerate, body.edit].filter((flag) => flag === true).length <= 1,
    { path: ['retry'], message: 'Choose one of retry, regenerate or edit' },
  )
  .refine(
    (body) => (body.retry === true || body.regenerate === true) !== (body.message !== undefined),
    { path: ['message'], message: 'Send a message, or retry the previous one' },
  )
  .refine(
    (body) => !body.attachmentIds?.length || (body.message !== undefined && body.edit !== true),
    { path: ['attachmentIds'], message: 'Images can only be sent with a new message' },
  );

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const SUGGESTION_QUESTION_MAX_LENGTH = 4_000;
export const SUGGESTION_ANSWER_MAX_LENGTH = 8_000;

/** POST /api/chat/suggestions: follow-ups for one question and its answer (MODEL-067). */
export const chatSuggestionsRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(SUGGESTION_QUESTION_MAX_LENGTH),
    answer: z.string().trim().min(1).max(SUGGESTION_ANSWER_MAX_LENGTH),
  })
  .strict();

export type ChatSuggestionsRequest = z.infer<typeof chatSuggestionsRequestSchema>;

export const chatSuggestionsResponseSchema = z.object({
  suggestions: z.array(z.string()).max(3),
}) satisfies z.ZodType<ChatSuggestionsResponse>;

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
  inputPricePerMillionUsd: z.number().nonnegative().nullable(),
  outputPricePerMillionUsd: z.number().nonnegative().nullable(),
}) satisfies z.ZodType<AIModel>;

export const providerInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  configured: z.boolean(),
}) satisfies z.ZodType<ProviderInfo>;

export const modelsResponseSchema = z.object({
  models: z.array(aiModelSchema),
  defaultModel: z.object({ provider: z.string(), id: z.string() }).nullable(),
  providers: z.array(providerInfoSchema),
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
      fallbackFrom: z.object({ provider: z.string(), model: z.string() }).optional(),
    })
    .optional(),
  attachments: z.array(attachmentSchema).optional(),
}) satisfies z.ZodType<ChatMessage>;

const conversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  // Defaults to unpinned so the web app still reads an API from before MODEL-062.
  pinnedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const conversationListResponseSchema = z.object({
  conversations: z.array(conversationSummarySchema),
}) satisfies z.ZodType<ConversationListResponse>;

export const conversationDetailSchema = conversationSummarySchema.extend({
  messages: z.array(chatMessageSchema),
  // Defaults to none so the web app still reads an API from before MODEL-065.
  mediaJobs: z.array(mediaJobSchema).default([]),
}) satisfies z.ZodType<ConversationDetail>;

export const CHAT_SEARCH_MIN_LENGTH = 2;
export const CHAT_SEARCH_MAX_LENGTH = 120;
export const CHAT_SEARCH_LIMIT = 20;

/** GET /api/conversations/search (MODEL-071). */
export const conversationSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, ' '))
    .pipe(
      z
        .string()
        .min(CHAT_SEARCH_MIN_LENGTH, `Type at least ${CHAT_SEARCH_MIN_LENGTH} characters`)
        .max(
          CHAT_SEARCH_MAX_LENGTH,
          `Searches can be at most ${CHAT_SEARCH_MAX_LENGTH} characters`,
        ),
    ),
});

export const conversationSearchResponseSchema = z.object({
  results: z.array(
    conversationSummarySchema.extend({
      matchedIn: z.enum(['title', 'message']),
      snippet: z.string().nullable(),
    }),
  ),
}) satisfies z.ZodType<ConversationSearchResponse>;

export const conversationShareResponseSchema = z.object({
  share: z
    .object({
      token: z.string(),
      messageCount: z.number().int().nonnegative(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .nullable(),
}) satisfies z.ZodType<ConversationShareResponse>;

export const sharedConversationSchema = z.object({
  title: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      model: z.string().nullable(),
    }),
  ),
  sharedAt: z.string(),
  truncated: z.boolean(),
}) satisfies z.ZodType<SharedConversation>;

/** Share tokens: 32 random bytes, base64url (43 characters). */
export const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);

export const guestConversationResponseSchema = z.object({
  messages: z.array(chatMessageSchema),
  expiresAt: z.string(),
}) satisfies z.ZodType<GuestConversationResponse>;

export const guestMigrationResponseSchema = z.object({
  conversationId: z.string().nullable(),
}) satisfies z.ZodType<GuestMigrationResponse>;

export const usageSchema = z.object({
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
    context: z.object({
      inputTokens: z.number().int().nonnegative(),
      budgetTokens: z.number().int().nonnegative(),
      contextWindow: z.number().int().positive(),
      droppedMessages: z.number().int().nonnegative(),
      summaryIncluded: z.boolean(),
    }),
  }),
  'message.delta': z.object({ runId: z.string(), text: z.string() }),
  'message.retry': z.object({
    runId: z.string(),
    attempt: z.number().int().positive(),
    delayMs: z.number().int().nonnegative(),
    code: errorCodeSchema,
  }),
  'message.fallback': z.object({
    runId: z.string(),
    from: z.object({ provider: z.string(), model: z.string() }),
    to: z.object({ provider: z.string(), model: z.string() }),
    code: errorCodeSchema,
    reason: z.string(),
  }),
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
