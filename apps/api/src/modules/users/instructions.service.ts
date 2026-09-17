import type { PersonalInstructions } from '@a-ai/shared-types';
import type { InstructionsUpdateRequest } from '@a-ai/validation';
import type { Repositories, UserRecord } from '../../repositories/types.js';
import { AppError } from '../../shared/errors/app-error.js';

export function toInstructions(user: UserRecord): PersonalInstructions {
  return {
    about: user.instructionsAbout,
    style: user.instructionsStyle,
    enabled: user.instructionsEnabled,
  };
}

/**
 * The system prompt with a user's personal instructions (MODEL-069). They are
 * framed as the user's preferences, below A.ai's own rules, so they can shape
 * answers but not replace the assistant's instructions.
 */
export function withInstructions(
  systemPrompt: string,
  instructions: PersonalInstructions | null,
): string {
  if (!instructions?.enabled || (!instructions.about && !instructions.style)) return systemPrompt;
  const parts = [
    systemPrompt,
    '',
    'The user has set personal instructions. Follow them when they are relevant, unless they conflict with the rules above.',
  ];
  if (instructions.about) {
    parts.push(
      '',
      'What the user wants you to know about them:',
      '<about_user>',
      instructions.about,
      '</about_user>',
    );
  }
  if (instructions.style) {
    parts.push(
      '',
      'How the user wants you to respond:',
      '<response_preferences>',
      instructions.style,
      '</response_preferences>',
    );
  }
  return parts.join('\n');
}

/** Reads and saves a signed-in user's personal instructions. */
export class InstructionsService {
  readonly #users: Repositories['users'];

  constructor(repositories: Repositories) {
    this.#users = repositories.users;
  }

  async get(userId: string): Promise<PersonalInstructions> {
    const user = await this.#users.findById(userId);
    if (!user) throw new AppError('AUTH_REQUIRED', 'Please sign in to continue.');
    return toInstructions(user);
  }

  /** The instructions to send with a chat, or null when there are none to send. */
  async forChat(userId: string): Promise<PersonalInstructions | null> {
    const user = await this.#users.findById(userId);
    if (!user) return null;
    const instructions = toInstructions(user);
    return instructions.enabled && (instructions.about || instructions.style) ? instructions : null;
  }

  async update(userId: string, input: InstructionsUpdateRequest): Promise<PersonalInstructions> {
    return toInstructions(await this.#users.updateInstructions(userId, input));
  }
}
