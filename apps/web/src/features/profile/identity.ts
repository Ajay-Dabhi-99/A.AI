import type { AuthUser } from '@a-ai/shared-types';

function nameParts(user: AuthUser): string[] {
  return [user.firstName, user.lastName].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  );
}

/** The account's name when set, otherwise the part of the email before the @. */
export function displayName(user: AuthUser): string {
  const full = nameParts(user).join(' ');
  return full || (user.email.split('@')[0] ?? user.email);
}

/** One or two letters for the avatar: initials, or the first letter of the email. */
export function initials(user: AuthUser): string {
  const parts = nameParts(user);
  if (parts.length > 0) {
    return parts
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join('')
      .toUpperCase();
  }
  return (user.email.charAt(0) || '?').toUpperCase();
}

/** How many of the optional profile details are filled in. */
export function profileCompletion(user: AuthUser): { done: number; total: number } {
  const fields = [user.firstName, user.lastName, user.phone];
  return {
    done: fields.filter((value) => typeof value === 'string' && value.trim() !== '').length,
    total: fields.length,
  };
}
