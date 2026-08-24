/**
 * Prisma-backed user store.
 *
 * The client is injected rather than constructed here: a second `PrismaClient` in one process opens
 * a second connection pool, and the usual symptom is exhausting the database's connection limit
 * under load for no reason anyone can find.
 */
import type { PrismaClient } from '@prisma/client';

import { EmailAlreadyRegisteredError } from '../domain/auth-errors__IMPORT_SUFFIX__';
import { DEFAULT_ROLE, isRole, type Role, type UserRecord } from '../domain/user__IMPORT_SUFFIX__';

import type { CreateUserInput, UserRepository } from './user-repository__IMPORT_SUFFIX__';

/** The columns this repository reads. Kept local so a schema change surfaces here. */
interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: string;
  readonly createdAt: Date;
}

/** Prisma's unique-constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/**
 * The role is checked rather than cast.
 *
 * A value inserted by hand — a migration, a support script, a typo — must not become an
 * authorisation grant just because it reached the database. Anything unrecognised reads back as the
 * default role, so the effective permissions can only narrow, never widen.
 */
function toUserRecord(row: UserRow): UserRecord {
  const role: Role = isRole(row.role) ? row.role : DEFAULT_ROLE;

  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    role,
    createdAt: row.createdAt,
  };
}

export class PrismaUserRepository implements UserRepository {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    const row = await this.#prisma.user.findUnique({ where: { email } });
    return row === null ? undefined : toUserRecord(row);
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    const row = await this.#prisma.user.findUnique({ where: { id } });
    return row === null ? undefined : toUserRecord(row);
  }

  /**
   * Relies on the unique index, not on a prior lookup.
   *
   * Checking `findByEmail` first and then inserting is a race: two concurrent registrations both
   * see no existing row and both proceed. The database constraint is the only real guarantee, and
   * translating its error is how that guarantee reaches the user as a 409.
   */
  async create(input: CreateUserInput): Promise<UserRecord> {
    try {
      const row = await this.#prisma.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          role: input.role,
        },
      });

      return toUserRecord(row);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new EmailAlreadyRegisteredError({ cause: error });
      }
      throw error;
    }
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.#prisma.user.update({ where: { id }, data: { passwordHash } });
  }
}
