/**
 * Mongoose implementation of `UserRepository`.
 *
 * Atlas generates exactly one database implementation into a project, chosen when the template is
 * run, so this file is the only thing that ever mentions Mongoose. `user-repository.ts` does not
 * import it and neither does any service — the dependency points inwards, and that is what keeps
 * the driver replaceable.
 */
import mongoose, { Schema } from 'mongoose';
import type { Document, Model, Types } from 'mongoose';

import { EmailAlreadyRegisteredError } from '../domain/auth-errors__IMPORT_SUFFIX__';
import { DEFAULT_ROLE, isRole, normalizeEmail } from '../domain/user__IMPORT_SUFFIX__';
import type { UserRecord } from '../domain/user__IMPORT_SUFFIX__';
import type { CreateUserInput, UserRepository } from './user-repository__IMPORT_SUFFIX__';

/** MongoDB's duplicate-key error, stable across server and driver versions. */
const DUPLICATE_KEY_ERROR = 11000;

/**
 * The stored shape.
 *
 * `role` is `string` rather than `Role` on purpose: a collection holds whatever was written to it,
 * and claiming otherwise here would let an unrecognised value through `toUserRecord` untouched.
 */
interface UserDocument extends Document {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  role: string;
  createdAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
);

/**
 * This index — not the `findByEmail` lookup a registration flow does first — is what actually
 * prevents two accounts for one address. That lookup is a race: two concurrent registrations can
 * both find nothing and both go on to insert, and no amount of checking first closes the window.
 * MongoDB rejects the loser with error 11000, and translating that in `create` below is how the
 * race surfaces as the same `EmailAlreadyRegisteredError` the sequential path produces.
 */
userSchema.index({ email: 1 }, { unique: true });

/**
 * A model may only be registered once per connection; the second call throws `OverwriteModelError`.
 * A dev server with hot reload re-evaluates this module on every edit, so without the lookup the
 * first save after a change would crash the process instead of writing a user.
 */
const UserModel: Model<UserDocument> =
  (mongoose.models['User'] as Model<UserDocument> | undefined) ??
  mongoose.model<UserDocument>('User', userSchema);

/**
 * Mapped field by field rather than spread, so a column added to the collection cannot leak into a
 * `UserRecord` unnoticed.
 *
 * `role` is checked with `isRole` instead of cast, and falls back to the default. A value written by
 * hand — a migration script, a mongosh session, `'Admin'` for `'admin'` — must not become an
 * authorisation grant merely because it is sitting in the document. Falling back to `user` means the
 * effective permissions can only ever be narrower than the raw row, never wider, which is the only
 * direction this mistake is safe to fail in.
 */
function toUserRecord(doc: UserDocument): UserRecord {
  return {
    id: doc._id.toString(),
    email: doc.email,
    passwordHash: doc.passwordHash,
    role: isRole(doc.role) ? doc.role : DEFAULT_ROLE,
    createdAt: doc.createdAt,
  };
}

/**
 * `findById` casts its argument and throws a `CastError` on anything that is not an ObjectId, which
 * turns a request carrying a malformed path parameter into a 500. Validating first turns it into the
 * same "no such user" answer a well-formed but unused id already gets.
 */
function toObjectId(id: string): Types.ObjectId | undefined {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : undefined;
}

/**
 * Recognised structurally rather than with `instanceof MongoServerError`. Mongoose re-throws the
 * driver's error unwrapped, and the class lives in `mongodb` — a transitive dependency whose module
 * layout this file has no business depending on.
 *
 * `email` is the only unique index on the collection besides the driver-generated `_id`, so any
 * duplicate-key rejection reaching `create` is an email collision.
 */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === DUPLICATE_KEY_ERROR
  );
}

/** Uses Mongoose's default connection, which the application opens once at startup. */
export class MongooseUserRepository implements UserRepository {
  async findByEmail(email: string): Promise<UserRecord | undefined> {
    // Normalised here as well as in the service: the unique index is on the stored value, so it
    // only guarantees anything if every read and write agrees on what that value looks like.
    const doc = await UserModel.findOne({ email: normalizeEmail(email) }).exec();
    return doc === null ? undefined : toUserRecord(doc);
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    const objectId = toObjectId(id);
    if (objectId === undefined) return undefined;

    const doc = await UserModel.findById(objectId).exec();
    return doc === null ? undefined : toUserRecord(doc);
  }

  async create(input: CreateUserInput): Promise<UserRecord> {
    try {
      const doc = await UserModel.create({
        email: normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        role: input.role,
        createdAt: new Date(),
      });

      return toUserRecord(doc);
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new EmailAlreadyRegisteredError();
      throw error;
    }
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    const objectId = toObjectId(id);
    if (objectId === undefined) return;

    await UserModel.updateOne({ _id: objectId }, { $set: { passwordHash } }).exec();
  }
}
