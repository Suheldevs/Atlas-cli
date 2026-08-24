/** Roles this application recognises. Extend the union; the middleware needs no changes. */
export type Role = 'user' | 'admin';

export const ROLES: readonly Role[] = ['user', 'admin'];

/** The role every new account gets. Promoting an admin is a deliberate act, never a signup field. */
export const DEFAULT_ROLE: Role = 'user';

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * A user as stored. Carries the password hash, so it must never leave the server —
 * `toPublicUser` is the only sanctioned way to put a user into a response.
 */
export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: Role;
  readonly createdAt: Date;
}

/** A user as sent to a client. */
export interface PublicUser {
  readonly id: string;
  readonly email: string;
  readonly role: Role;
}

/**
 * Built by naming every field explicitly rather than by deleting `passwordHash` from a copy.
 * A field added to `UserRecord` later is then absent from responses until someone deliberately
 * adds it here, which is the safe direction for that mistake to fail in.
 */
export function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, email: user.email, role: user.role };
}

/** Stored lower-cased so `A@b.com` and `a@b.com` cannot become two accounts. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
