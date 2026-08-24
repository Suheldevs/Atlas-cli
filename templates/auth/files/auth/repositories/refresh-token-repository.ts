/**
 * The refresh-token persistence boundary.
 *
 * Rotation and reuse detection are written against this interface alone, with no driver, schema or
 * connection in sight. That is what lets Atlas generate either the Mongoose or the Prisma
 * implementation into a project without a line of the rotation logic changing, and what makes that
 * logic testable against a plain in-memory object.
 *
 * Absence is reported as `undefined`, never `null`. Both drivers signal a miss with `null` and both
 * implementations translate it at the boundary, so the rest of the codebase keeps a single spelling
 * for "no value" and no caller has to remember which store it is talking to.
 *
 * Records are kept until they expire rather than deleted on rotation: a rotated-away token has to
 * remain findable, because finding one is precisely how a replay is detected.
 */

export interface StoredRefreshToken {
  readonly jti: string;
  /** Shared by every token descended from one login, so a replay can revoke the whole lineage. */
  readonly family: string;
  readonly userId: string;
  readonly expiresAt: Date;
  /** Set once — when the token is rotated away, or when its family is revoked wholesale. */
  readonly revokedAt: Date | undefined;
}

export interface RefreshTokenRepository {
  save(token: StoredRefreshToken): Promise<void>;
  find(jti: string): Promise<StoredRefreshToken | undefined>;
  /** Idempotent: a token already revoked keeps the timestamp it was first revoked at. */
  revoke(jti: string, at: Date): Promise<void>;
  revokeFamily(family: string, at: Date): Promise<void>;
  /**
   * Revokes every live token belonging to a user — "sign out everywhere".
   *
   * A single statement in both Mongo and SQL, which is why it belongs here rather than being
   * assembled from `revokeFamily` calls by the service: a loop would race a concurrent refresh
   * that creates a new family part-way through.
   */
  revokeAllForUser(userId: string, at: Date): Promise<void>;
  /** Returns how many records were removed, so a scheduled sweep can log what it did. */
  deleteExpired(now: Date): Promise<number>;
}
