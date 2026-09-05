/**
 * The Mongoose model for stored refresh tokens.
 *
 * One row per issued refresh token, kept until it expires rather than deleted on rotation: a
 * rotated-away token has to remain findable, because finding one is precisely how a replay is
 * detected. Deleting on rotation would turn every detected attack into an ordinary "unknown token".
 *
 * Note what is *not* stored: the token itself. Only its `jti` is, so a dump of this collection
 * cannot be replayed against the API — the credential lives in the client's cookie and in the
 * signature, never here.
 */
import mongoose, { Schema } from 'mongoose';

const refreshTokenSchema = new Schema(
  {
    jti: { type: String, required: true },
    family: { type: String, required: true },

    // A plain string rather than an `ObjectId` reference. Nothing here ever joins to the users
    // collection — tokens are found by `jti` and revoked by `family` — so a reference would buy only
    // `populate`, at the cost of a cast on the way in and out of a security-critical path.
    userId: { type: String, required: true },

    expiresAt: { type: Date, required: true },

    // `null` rather than absent, because the revocation queries filter on `revokedAt: null` and a
    // consistent representation keeps that filter honest. The repository is where it becomes the
    // `undefined` the rest of the codebase uses.
    revokedAt: { type: Date, required: false, default: null },
  },
  { versionKey: false },
);

/**
 * Unique because `jti` identifies one credential. If rotation ever reissues an id, two records would
 * claim the same token and reuse detection would read whichever the index returned first; a rejected
 * insert is far easier to diagnose than that.
 */
refreshTokenSchema.index({ jti: 1 }, { unique: true });

/** Not unique: every token descended from one login shares a family, and revocation reads them all. */
refreshTokenSchema.index({ family: 1 });

/** Supports "sign out everywhere", which revokes every live token for one user in one statement. */
refreshTokenSchema.index({ userId: 1 });

/**
 * A TTL index. `expireAfterSeconds: 0` means "expire at the time stored in this field" rather than
 * "expire immediately", so MongoDB's background monitor deletes each record once `expiresAt` has
 * passed and the collection stays bounded with no application involvement.
 *
 * `deleteExpired` is still worth scheduling. The TTL monitor exists only on a replica-set primary,
 * runs about once a minute, and is absent or disabled on several deployments this code may land in —
 * `mongodb-memory-server` in tests, some managed tiers, a standalone started with
 * `--setParameter ttlMonitorEnabled=false`. An explicit sweep is the bound that holds everywhere.
 */
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * A model may only be registered once per connection; the second call throws `OverwriteModelError`.
 * A dev server with hot reload re-evaluates this module on every edit, so without the lookup the
 * first save after a change would crash the process instead of storing a token.
 */
export const RefreshTokenModel =
  mongoose.models.RefreshToken ?? mongoose.model('RefreshToken', refreshTokenSchema);
