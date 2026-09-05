/**
 * The user domain: the role vocabulary, the two shapes a user takes, and the one function allowed
 * to turn the stored shape into the sent shape.
 *
 * There are no types to enforce any of this in JavaScript, which is exactly why the rules are
 * expressed as runtime functions rather than as documentation. `isRole` is a real check, and
 * `toPublicUser` is a real projection — neither degrades to a comment when a type checker is absent.
 */

/**
 * Roles this application recognises. Extend the union in the JSDoc and add the value to `ROLES`;
 * the middleware needs no changes.
 *
 * @typedef {'user' | 'admin'} Role
 */

/**
 * Frozen so a stray `ROLES.push('superadmin')` anywhere in the process cannot widen the set of
 * values `isRole` accepts. A role vocabulary editable at runtime is an authorisation decision
 * editable at runtime.
 *
 * @type {readonly Role[]}
 */
export const ROLES = Object.freeze(['user', 'admin']);

/**
 * The role every new account gets. Promoting an admin is a deliberate act, never a signup field.
 *
 * @type {Role}
 */
export const DEFAULT_ROLE = 'user';

/**
 * @param {unknown} value
 * @returns {boolean} True when `value` is one of `ROLES`.
 */
export function isRole(value) {
  return typeof value === 'string' && ROLES.includes(/** @type {Role} */ (value));
}

/**
 * A user as stored. Carries the password hash, so it must never leave the server — `toPublicUser`
 * is the only sanctioned way to put a user into a response.
 *
 * @typedef {object} UserRecord
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {string} passwordHash
 * @property {Role} role
 * @property {Date} createdAt
 */

/**
 * A user as sent to a client. This is the `user` object the API contract promises, and the shape
 * is identical on signup, login and `/me`.
 *
 * @typedef {object} PublicUser
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {Role} role
 */

/**
 * Built by naming every field explicitly rather than by deleting `passwordHash` from a copy.
 *
 * This matters more in JavaScript than it did in TypeScript. `const { passwordHash, ...rest } =
 * user` reads fine and works, and the day somebody adds `mfaSecret` or `resetToken` to the record
 * it ships that field to every client. Naming the four fields means a new one is absent from
 * responses until somebody deliberately adds it here, which is the safe direction for that mistake
 * to fail in.
 *
 * @param {UserRecord} user
 * @returns {PublicUser}
 */
export function toPublicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/**
 * Stored lower-cased so `A@b.com` and `a@b.com` cannot become two accounts.
 *
 * @param {string} email
 * @returns {string}
 */
export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}
