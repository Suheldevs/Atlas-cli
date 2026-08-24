/**
 * Prisma-backed refresh-token store.
 *
 * The client is injected for the same reason as in the user repository: one pool per process.
 */
import type { PrismaClient } from '@prisma/client';

import type {
  RefreshTokenRepository,
  StoredRefreshToken,
} from './refresh-token-repository__IMPORT_SUFFIX__';

interface RefreshTokenRow {
  readonly jti: string;
  readonly family: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

function toStoredRefreshToken(row: RefreshTokenRow): StoredRefreshToken {
  return {
    jti: row.jti,
    family: row.family,
    userId: row.userId,
    expiresAt: row.expiresAt,
    // `undefined` throughout the module; `null` only ever exists at the database boundary.
    revokedAt: row.revokedAt ?? undefined,
  };
}

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  readonly #prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  async save(token: StoredRefreshToken): Promise<void> {
    await this.#prisma.refreshToken.create({
      data: {
        jti: token.jti,
        family: token.family,
        userId: token.userId,
        expiresAt: token.expiresAt,
        revokedAt: token.revokedAt ?? null,
      },
    });
  }

  async find(jti: string): Promise<StoredRefreshToken | undefined> {
    const row = await this.#prisma.refreshToken.findUnique({ where: { jti } });
    return row === null ? undefined : toStoredRefreshToken(row);
  }

  /**
   * Filtered on `revokedAt: null` so an already-revoked token keeps its original timestamp. That
   * timestamp records when the credential was retired — and, when a replay caused it, when the
   * family was compromised. Overwriting it on a second call destroys the evidence.
   */
  async revoke(jti: string, at: Date): Promise<void> {
    await this.#prisma.refreshToken.updateMany({
      where: { jti, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async revokeFamily(family: string, at: Date): Promise<void> {
    await this.#prisma.refreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  /** One statement, so it cannot race a concurrent refresh creating a new family part-way through. */
  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await this.#prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  /**
   * Only expiry is considered. A revoked-but-unexpired row has to stay: presenting it is exactly
   * what reuse detection needs to see, and deleting it early turns a detected replay into an
   * ordinary "unknown token".
   */
  async deleteExpired(now: Date): Promise<number> {
    const result = await this.#prisma.refreshToken.deleteMany({
      where: { expiresAt: { lte: now } },
    });

    return result.count;
  }
}
