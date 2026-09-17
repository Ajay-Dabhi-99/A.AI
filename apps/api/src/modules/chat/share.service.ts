import { randomBytes } from 'node:crypto';
import type {
  ConversationShare,
  ConversationShareResponse,
  SharedConversation,
  SharedMessage,
} from '@a-ai/shared-types';
import type { ModelRegistryService } from '../../providers/model-registry.service.js';
import type { ConversationRepository } from '../../repositories/conversation.repository.js';
import type { ShareRecord, ShareRepository } from '../../repositories/share.repository.js';
import type { Clock } from '../../shared/clock.js';
import { AppError } from '../../shared/errors/app-error.js';

/** A shared page stays readable: very long chats keep their newest messages. */
export const SHARE_MAX_MESSAGES = 200;

export type ShareServiceDeps = {
  shares: ShareRepository;
  conversations: Pick<ConversationRepository, 'findForUser' | 'listMessages'>;
  models: Pick<ModelRegistryService, 'catalog'>;
  clock: Clock;
};

const NOT_FOUND = 'This conversation does not exist.';

function toShare(record: ShareRecord): ConversationShare {
  return {
    token: record.token,
    messageCount: record.messages.length,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * Public read-only links to a chat (MODEL-070). Sharing takes a text-only
 * snapshot: images, personal instructions and later messages are never
 * included, and the link works until the owner stops sharing or deletes the chat.
 */
export class ShareService {
  readonly #deps: ShareServiceDeps;

  constructor(deps: ShareServiceDeps) {
    this.#deps = deps;
  }

  async get(userId: string, conversationId: string): Promise<ConversationShareResponse> {
    await this.#owned(userId, conversationId);
    const record = await this.#deps.shares.findForConversation(conversationId, userId);
    return { share: record ? toShare(record) : null };
  }

  /** Creates the link, or refreshes its snapshot to the chat as it is now. */
  async share(userId: string, conversationId: string): Promise<ConversationShareResponse> {
    const conversation = await this.#owned(userId, conversationId);
    const messages = await this.#deps.conversations.listMessages(conversationId);
    if (messages.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'There is nothing to share in this chat yet.');
    }
    const names = new Map(
      (await this.#deps.models.catalog()).map((model) => [
        `${model.provider}::${model.id}`,
        model.name,
      ]),
    );
    const snapshot: SharedMessage[] = messages.slice(-SHARE_MAX_MESSAGES).map((message) => ({
      role: message.role === 'USER' ? 'user' : 'assistant',
      content: message.content,
      model: message.run
        ? (names.get(`${message.run.provider}::${message.run.model}`) ?? message.run.model)
        : null,
    }));
    const record = await this.#deps.shares.save(
      { conversationId, userId, title: conversation.title, messages: snapshot },
      randomBytes(32).toString('base64url'),
      this.#deps.clock.now(),
    );
    return { share: toShare(record) };
  }

  async stop(userId: string, conversationId: string): Promise<void> {
    await this.#owned(userId, conversationId);
    if (!(await this.#deps.shares.delete(conversationId, userId))) {
      throw new AppError('NOT_FOUND', 'This conversation is not shared.');
    }
  }

  /** Public: the snapshot behind a link. */
  async read(token: string): Promise<SharedConversation> {
    const record = await this.#deps.shares.findByToken(token);
    if (!record) throw new AppError('NOT_FOUND', 'This shared chat does not exist or was removed.');
    return {
      title: record.title,
      messages: record.messages,
      sharedAt: record.updatedAt.toISOString(),
      truncated: record.messages.length >= SHARE_MAX_MESSAGES,
    };
  }

  async #owned(userId: string, conversationId: string) {
    const conversation = await this.#deps.conversations.findForUser(conversationId, userId);
    if (!conversation) throw new AppError('NOT_FOUND', NOT_FOUND);
    return conversation;
  }
}
