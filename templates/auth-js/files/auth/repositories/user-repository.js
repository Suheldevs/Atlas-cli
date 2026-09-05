/**
 * The user persistence boundary, backed by Mongoose.
 *
 * Every service in this module depends on the *shape* below and on nothing under it. That is what
 * makes the registration, login and password-upgrade flows testable against a plain object, and what
 * would let a different store be dropped in without touching a line of them — the dependency points
 * inwards, and the driver is named in exactly two files: this one and `models/user.model.js`.
 *
 * Absence is reported as `undefined`, never `null`. Mongoose signals a miss with `null` and it is
 * translated here at the boundary, so the rest of the codebase keeps a single spelling for
 * "no value" and no caller has to remember which store it is talking to.
 */
import mongoose from 'mongoose';

import { EmailAlreadyRegisteredError } from '../domain/auth-errors__IMPORT_SUFFIX__';
import { DEFAULT_ROLE, isRole, normalizeEmail } from '../domain/user__IMPORT_SUFFIX__';
import { DUPLICATE_KEY_ERROR, UserModel } from '../models/user.model__IMPORT_SUFFIX__';

/**
 * What a caller supplies to create a user.
 *
 * `passwordHash`, not `password`: hashing belongs to the service layer, and a repository that
 * accepted a plaintext password would be one refactor away from storing it.
 *
 * @typedef {object} CreateUserInput
 * @property {string} name
 * @property {string} email
 * @property {string} passwordHash
 * @property {import('../domain/user__IMPORT_SUFFIX__').Role} role
 */

/**
 * The contract `createAuthService` is written against. Any object with these four methods will do,
 * which is what an in-memory test double is.
 *
 * @typedef {object} UserRepository
 * @property {(email: string) => Promise<import('../domain/user__IMPORT_SUFFIX__').UserRecord | undefined>} findByEmail
 * @property {(id: string) => Promise<import('../domain/user__IMPORT_SUFFIX__').UserRecord | undefined>} findById
 * @property {(input: CreateUserInput) => Promise<import('../domain/user__IMPORT_SUFFIX__').UserRecord>} create
 *   Rejects with `EmailAlreadyRegisteredError` if the address is taken.
 * @property {(id: string, passwordHash: string) => Promise<void>} updatePasswordHash Resolves
 *   whether or not `id` matched.
 */

/**
 * Mapped field by field rather than spread, so a field added to the collection cannot leak into a
 * `UserRecord` unnoticed.
 *
 * `role` is re-checked with `isRole` rather than trusted, and falls back to the default. A value
 * written by hand — a migration script, a mongosh session, `'Admin'` for `'admin'` — must not become
 * an authorisation grant merely because it is sitting in the document. Falling back to `user` means
 * the effective permissions can only ever be narrower than the raw row, never wider, which is the
 * only direction this mistake is safe to fail in.
 *
 * @param {any} doc
 * @returns {import('../domain/user__IMPORT_SUFFIX__').UserRecord}
 */
function toUserRecord(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    email: doc.email,
    passwordHash: doc.passwordHash,
    role: isRole(doc.role) ? doc.role : DEFAULT_ROLE,
    createdAt: doc.createdAt,
  };
}

/**
 * `findById` casts its argument and throws a `CastError` on anything that is not an ObjectId, which
 * turns a request carrying a malformed id into a 500. Validating first turns it into the same
 * "no such user" answer a well-formed but unused id already gets.
 *
 * @param {string} id
 * @returns {mongoose.Types.ObjectId | undefined}
 */
function toObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : undefined;
}

/**
 * Recognised structurally rather than with `instanceof MongoServerError`. Mongoose re-throws the
 * driver's error unwrapped, and the class lives in `mongodb` — a transitive dependency whose module
 * layout this file has no business depending on.
 *
 * `email` is the only unique index on the collection besides the driver-generated `_id`, so any
 * duplicate-key rejection reaching `create` is an email collision.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isDuplicateKeyError(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    /** @type {{ code: unknown }} */ (error).code === DUPLICATE_KEY_ERROR
  );
}

/**
 * Uses Mongoose's default connection, which the application opens once at startup.
 *
 * @implements {UserRepository}
 */
export class MongooseUserRepository {
  /**
   * @param {string} email
   * @returns {Promise<import('../domain/user__IMPORT_SUFFIX__').UserRecord | undefined>}
   */
  async findByEmail(email) {
    // Normalised here as well as in the service: the unique index is on the stored value, so it
    // only guarantees anything if every read and write agrees on what that value looks like.
    //
    // `+passwordHash` is required because the schema marks the field `select: false`. That default
    // is what keeps the hash out of every query written elsewhere in the application; the two places
    // that legitimately need it ask for it by name, here and in `findById`.
    const doc = await UserModel.findOne({ email: normalizeEmail(email) })
      .select('+passwordHash')
      .exec();

    return doc === null ? undefined : toUserRecord(doc);
  }

  /**
   * @param {string} id
   * @returns {Promise<import('../domain/user__IMPORT_SUFFIX__').UserRecord | undefined>}
   */
  async findById(id) {
    const objectId = toObjectId(id);

    if (objectId === undefined) {
      return undefined;
    }

    const doc = await UserModel.findById(objectId).select('+passwordHash').exec();

    return doc === null ? undefined : toUserRecord(doc);
  }

  /**
   * @param {CreateUserInput} input
   * @returns {Promise<import('../domain/user__IMPORT_SUFFIX__').UserRecord>}
   */
  async create(input) {
    try {
      const doc = await UserModel.create({
        name: input.name,
        email: normalizeEmail(input.email),
        passwordHash: input.passwordHash,
        // Taken from the argument, which the service sets to `DEFAULT_ROLE`. It is never read from
        // a request body — see `signup` in the auth service.
        role: input.role,
        createdAt: new Date(),
      });

      return toUserRecord(doc);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // Translated rather than propagated, and deliberately carries no detail about which address
        // collided beyond what the caller already sent.
        throw new EmailAlreadyRegisteredError({ cause: error });
      }

      throw error;
    }
  }

  /**
   * @param {string} id
   * @param {string} passwordHash
   * @returns {Promise<void>}
   */
  async updatePasswordHash(id, passwordHash) {
    const objectId = toObjectId(id);

    if (objectId === undefined) {
      return;
    }

    await UserModel.updateOne({ _id: objectId }, { $set: { passwordHash } }).exec();
  }
}
