import type { ProfileUpdateRequest } from '@a-ai/validation';
import type { ProfileFields, Repositories, UserRecord } from '../../repositories/types.js';

/**
 * The signed-in account's own profile (MODEL-060). Every field is optional and
 * one request replaces all of them, so clearing a field is a normal update.
 * Validation (length, allowed characters, blank means null) lives in
 * `@a-ai/validation`, which the web form reuses.
 */
export class ProfileService {
  readonly #users: Repositories['users'];

  constructor(repositories: Repositories) {
    this.#users = repositories.users;
  }

  async update(userId: string, input: ProfileUpdateRequest): Promise<UserRecord> {
    const profile: ProfileFields = {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone,
    };
    return this.#users.updateProfile(userId, profile);
  }
}
