/**
 * The Mongoose model for user accounts.
 *
 * Kept apart from the repository so the schema — indexes especially — can be read, reviewed and
 * migrated without going through the code that queries it. Nothing outside `repositories/` should
 * import this model: the repository is the seam, and a controller reaching for `UserModel` directly
 * is how a `passwordHash` ends up in a response.
 */
import mongoose, { Schema } from 'mongoose';

import { ROLES } from '../domain/user__IMPORT_SUFFIX__';

/** MongoDB's duplicate-key error, stable across server and driver versions. */
export const DUPLICATE_KEY_ERROR = 11000;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },

    // Stored lower-cased by the repository, which normalises on every read and write. The unique
    // index below is on the stored value, so it only guarantees anything if both sides agree on
    // what that value looks like.
    email: { type: String, required: true },

    // `select: false` keeps the hash out of every query that does not ask for it by name. It is a
    // second lock on the same door as `toPublicUser`: even a handler that serialises a raw document
    // straight to the client cannot leak the hash, because the field was never loaded. The
    // repository asks for it explicitly on the one path that needs it — verifying a login.
    passwordHash: { type: String, required: true, select: false },

    // `enum` is the database's own copy of the role vocabulary, and it is worth the duplication: it
    // stops a migration script or a mongosh session writing `'superadmin'` into a field that
    // authorisation is decided from. The repository still re-checks with `isRole` on the way out,
    // because a value written before this constraint existed is not covered by it.
    role: { type: String, required: true, enum: [...ROLES] },

    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
);

/**
 * This index — not the `findByEmail` lookup a registration flow does first — is what actually
 * prevents two accounts for one address. That lookup is a race: two concurrent registrations can
 * both find nothing and both go on to insert, and no amount of checking first closes the window.
 * MongoDB rejects the loser with error 11000, and translating that in the repository is how the race
 * surfaces as the same "already registered" answer the sequential path produces.
 *
 * It exists only once `syncIndexes()` (or `autoIndex`, on by default in development) has run against
 * the collection. On a production deployment with `autoIndex: false`, build it as part of the deploy
 * — an application relying on an index that was never created is an application with no uniqueness
 * constraint at all.
 */
userSchema.index({ email: 1 }, { unique: true });

/**
 * A model may only be registered once per connection; the second call throws `OverwriteModelError`.
 * A dev server with hot reload re-evaluates this module on every edit, so without the lookup the
 * first save after a change would crash the process instead of writing a user.
 */
export const UserModel = mongoose.models.User ?? mongoose.model('User', userSchema);
