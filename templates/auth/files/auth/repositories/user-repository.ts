/**
 * The user persistence boundary.
 *
 * Every service in this module depends on `UserRepository` and on nothing below it — no driver, no
 * schema, no connection. That is the whole reason Atlas can generate either the Mongoose or the
 * Prisma implementation into a project and leave the registration, login and password-change flows
 * untouched: swapping databases becomes a question of which file was written, not of rewriting
 * business logic. It is also what makes the flows testable, since an in-memory object satisfying
 * this interface is a complete substitute.
 *
 * Absence is reported as `undefined`, never `null`. Both drivers signal a miss with `null` and both
 * implementations translate it at the boundary, so the rest of the codebase keeps a single spelling
 * for "no value" and no caller has to remember which store it is talking to.
 */
import type { Role, UserRecord } from '../domain/user__IMPORT_SUFFIX__';

/**
 * What a caller supplies to create a user.
 *
 * `passwordHash`, not `password`: hashing belongs to the service layer, and a repository that
 * accepted a plaintext password would be one refactor away from storing it.
 */
export interface CreateUserInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly role: Role;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | undefined>;
  findById(id: string): Promise<UserRecord | undefined>;
  /** Rejects with `EmailAlreadyRegisteredError` if the address is taken. */
  create(input: CreateUserInput): Promise<UserRecord>;
  /** Resolves whether or not `id` matched, so both implementations behave identically. */
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
}
