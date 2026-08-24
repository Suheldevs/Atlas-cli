/**
 * Mongoose implementation of `RefreshTokenRepository`.
 *
 * Atlas generates exactly one database implementation into a project, chosen when the template is
 * run, so this file is the only thing that ever mentions Mongoose. `refresh-token-repository.ts`
 * does not import it and neither does any service — the dependency points inwards, and that is what
 * keeps the driver replaceable.
 */
import mongoose, { Schema } from 'mongoose';
import type { Document, Model } from 'mongoose';

import type {
  RefreshTokenRepository,
  StoredRefreshToken,
} from './refresh-token-repository__IMPORT_SUFFIX__';

/**
 * The stored shape.
 *
 * `userId` is a plain string rather than an `ObjectId` reference. Nothing here ever joins to the
 * users collection — tokens are found by `jti` and revoked by `family` — so a reference would buy
 * only `populate`, at the cost of a cast on the way in and out of a security-critical path.
 *
 * `revokedAt` is `Date | null` because that is what a nullable BSON field reads back as;
 * `toStoredRefreshToken` is where it becomes the `undefined` the rest of the codebase uses.
 */
interface RefreshTokenDocument extends Document {
  jti: string;
  family: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

const refreshTokenSchema = new Schema<RefreshTokenDocument>(
  {
    jti: { type: String, required: true },
    family: { type: String, required: true },
    userId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, required: false, default: null },
  },
  { versionKey: false },
);

/**
 * Unique because `jti` identifies one credential. If rotation ever reissues an id, two records
 * would claim the same token and reuse detection would read whichever the index returned first;
 * a rejected insert is far easier to diagnose than that.
 */
refreshTokenSchema.index({ jti: 1 }, { unique: true });

/** Not unique: every token descended from one login shares a family, and revocation reads them all. */
refreshTokenSchema.index({ family: 1 });

/**
 * A TTL index. `expireAfterSeconds: 0` means "expire at the time stored in this field" rather than
 * "expire immediately", so MongoDB's background monitor deletes each record once `expiresAt` has
 * passed and the collection stays bounded with no application involvement.
 *
 * `deleteExpired` is still worth scheduling. The TTL monitor exists only on a replica-set primary,
 * runs about once a minute, and is absent or disabled on several deployments this code may land in
 * — `mongodb-memory-server` in tests, some managed tiers, a standalone started with
 * `--setParameter ttlMonitorEnabled=false`. An explicit sweep is the bound that holds everywhere.
 */
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * A model may only be registered once per connection; the second call throws `OverwriteModelError`.
 * A dev server with hot reload re-evaluates this module on every edit, so without the lookup the
 * first save after a change would crash the process instead of storing a token.
 */
const RefreshTokenModel: Model<RefreshTokenDocument> =
  (mongoose.models['RefreshToken'] as Model<RefreshTokenDocument> | undefined) ??
  mongoose.model<RefreshTokenDocument>('RefreshToken', refreshTokenSchema);

/** Mapped field by field, so a column added to the collection cannot leak into a domain value. */
function toStoredRefreshToken(doc: RefreshTokenDocument): StoredRefreshToken {
  return {
    jti: doc.jti,
    family: doc.family,
    userId: doc.userId,
    expiresAt: doc.expiresAt,
    revokedAt: doc.revokedAt ?? undefined,
  };
}

/** Uses Mongoose's default connection, which the application opens once at startup. */
export class MongooseRefreshTokenRepository implements RefreshTokenRepository {
  async save(token: StoredRefreshToken): Promise<void> {
    await RefreshTokenModel.create({
      jti: token.jti,
      family: token.family,
      userId: token.userId,
      expiresAt: token.expiresAt,
      revokedAt: token.revokedAt ?? null,
    });
  }

  async find(jti: string): Promise<StoredRefreshToken | undefined> {
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
   */
  async revoke(jti: string, at: Date): Promise<void> {
    await RefreshTokenModel.updateOne({ jti, revokedAt: null }, { $set: { revokedAt: at } }).exec();
  }

  async revokeFamily(family: string, at: Date): Promise<void> {
    await RefreshTokenModel.updateMany(
      { family, revokedAt: null },
      { $set: { revokedAt: at } },
    ).exec();
  }

  /** One statement, so it cannot race a concurrent refresh creating a new family half-way through. */
  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await RefreshTokenModel.updateMany(
      { userId, revokedAt: null },
      { $set: { revokedAt: at } },
    ).exec();
  }

  /**
   * Only expiry is considered. A revoked-but-unexpired record has to stay: presenting it is exactly
   * what reuse detection needs to see, and deleting it early would turn a detected replay into an
   * ordinary "unknown token".
   */
  async deleteExpired(now: Date): Promise<number> {
    const result = await RefreshTokenModel.deleteMany({ expiresAt: { $lte: now } }).exec();
    return result.deletedCount;
  }
}
