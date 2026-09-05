/**
 * The refresh-token persistence boundary, backed by Mongoose.
 *
 * Rotation and reuse detection are written against the shape below and against no driver, schema or
 * connection. That is what makes the most security-sensitive logic in the module testable against a
 * plain in-memory object, and what keeps the store replaceable.
 *
 * Records are kept until they expire rather than deleted on rotation: a rotated-away token has to
 * remain findable, because finding one is precisely how a replay is detected.
 *
 * Absence is reported as `undefined`, never `null` — translated here at the boundary, so the rest of
 * the codebase keeps a single spelling for "no value".
 */
import { RefreshTokenModel } from '../models/refresh-token.model__IMPORT_SUFFIX__';

/**
 * @typedef {object} StoredRefreshToken
 * @property {string} jti
 * @property {string} family Shared by every token descended from one login, so a replay can revoke
 *   the whole lineage.
 * @property {string} userId
 * @property {Date} expiresAt
 * @property {Date | undefined} revokedAt Set once — when the token is rotated away, or when its
 *   family is revoked wholesale.
 */

/**
 * The contract `createAuthService` is written against.
 *
 * @typedef {object} RefreshTokenRepository
 * @property {(token: StoredRefreshToken) => Promise<void>} save
 * @property {(jti: string) => Promise<StoredRefreshToken | undefined>} find
 * @property {(jti: string, at: Date) => Promise<void>} revoke Idempotent: a token already revoked
 *   keeps the timestamp it was first revoked at.
 * @property {(family: string, at: Date) => Promise<void>} revokeFamily
 * @property {(userId: string, at: Date) => Promise<void>} revokeAllForUser
 * @property {(now: Date) => Promise<number>} deleteExpired Returns how many records were removed.
 */

/**
 * Mapped field by field, so a field added to the collection cannot leak into a domain value.
 *
 * @param {any} doc
 * @returns {StoredRefreshToken}
 */
function toStoredRefreshToken(doc) {
  return {
    jti: doc.jti,
    family: doc.family,
    userId: doc.userId,
    expiresAt: doc.expiresAt,
    revokedAt: doc.revokedAt ?? undefined,
  };
}

/**
 * Uses Mongoose's default connection, which the application opens once at startup.
 *
 * @implements {RefreshTokenRepository}
 */
export class MongooseRefreshTokenRepository {
  /**
   * @param {StoredRefreshToken} token
   * @returns {Promise<void>}
   */
  async save(token) {
    await RefreshTokenModel.create({
      jti: token.jti,
      family: token.family,
      userId: token.userId,
      expiresAt: token.expiresAt,
      revokedAt: token.revokedAt ?? null,
    });
  }

  /**
   * @param {string} jti
   * @returns {Promise<StoredRefreshToken | undefined>}
   */
  async find(jti) {
    const doc = await RefreshTokenModel.findOne({ jti }).exec();

    return doc === null ? undefined : toStoredRefreshToken(doc);
  }

  /**
   * Filtered on `revokedAt: null` so an already-revoked token keeps its original timestamp. That
   * timestamp is the record of when the credential was retired — and, when a replay triggered it, of
   * when the family was compromised. Overwriting it on a second call would destroy the evidence.
   *
   * The filter also matches a record written before the field existed, since MongoDB treats a
   * missing field and an explicit `null` as equal.
   *
   * @param {string} jti
   * @param {Date} at
   * @returns {Promise<void>}
   */
  async revoke(jti, at) {
    await RefreshTokenModel.updateOne({ jti, revokedAt: null }, { $set: { revokedAt: at } }).exec();
  }

  /**
   * Revokes every live token in a lineage. This is the response to a detected replay, so it has to
   * be one statement: a loop that revoked row by row could be interleaved with the attacker's next
   * refresh and leave a live descendant behind.
   *
   * @param {string} family
   * @param {Date} at
   * @returns {Promise<void>}
   */
  async revokeFamily(family, at) {
    await RefreshTokenModel.updateMany(
      { family, revokedAt: null },
      { $set: { revokedAt: at } },
    ).exec();
  }

  /**
   * "Sign out everywhere". One statement, so it cannot race a concurrent refresh creating a new
   * family half-way through.
   *
   * @param {string} userId
   * @param {Date} at
   * @returns {Promise<void>}
   */
  async revokeAllForUser(userId, at) {
    await RefreshTokenModel.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: at } },
    ).exec();
  }

  /**
   * Only expiry is considered. A revoked-but-unexpired record has to stay: presenting it is exactly
   * what reuse detection needs to see, and deleting it early would turn a detected replay into an
   * ordinary "unknown token".
   *
   * @param {Date} now
   * @returns {Promise<number>}
   */
  async deleteExpired(now) {
    const result = await RefreshTokenModel.deleteMany({ expiresAt: { $lte: now } }).exec();

    return result.deletedCount;
  }
}
