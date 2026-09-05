/**
 * Auth orchestration.
 *
 * Everything security-relevant that is not cryptography lives here: what a failed login is allowed
 * to reveal, when a password gets re-hashed, and what happens when a refresh token is replayed.
 *
 * Nothing in this file touches Express, and nothing in it validates a request body — it is handed
 * values that are already the right shape and returns values the HTTP layer renders. That is what
 * lets the rotation logic below be exercised against two plain objects and no server.
 */
import {
  InvalidCredentialsError,
  InvalidTokenError,
  TokenReusedError,
} from '../domain/auth-errors__IMPORT_SUFFIX__';
import { DEFAULT_ROLE, normalizeEmail, toPublicUser } from '../domain/user__IMPORT_SUFFIX__';
import { assertPasswordAcceptable, bcryptHasher } from '../security/bcrypt-hasher__IMPORT_SUFFIX__';

/**
 * @typedef {object} AuthResult
 * @property {import('../domain/user__IMPORT_SUFFIX__').PublicUser} user
 * @property {import('../domain/tokens__IMPORT_SUFFIX__').TokenPair} tokens
 */

/**
 * @typedef {object} AuthServiceDependencies
 * @property {import('../repositories/user-repository__IMPORT_SUFFIX__').UserRepository} users
 * @property {import('../repositories/refresh-token-repository__IMPORT_SUFFIX__').RefreshTokenRepository} refreshTokens
 * @property {import('../security/token-service__IMPORT_SUFFIX__').TokenService} tokens
 * @property {import('../security/bcrypt-hasher__IMPORT_SUFFIX__').PasswordHasher} [hasher]
 *   Defaults to the bcrypt hasher. Injectable so tests can substitute something cheap.
 */

/**
 * @typedef {object} AuthService
 * @property {(input: { name: string, email: string, password: string }) => Promise<AuthResult>} signup
 * @property {(input: { email: string, password: string }) => Promise<AuthResult>} login
 * @property {(refreshToken: string) => Promise<AuthResult>} refresh
 * @property {(refreshToken: string) => Promise<void>} logout
 * @property {(userId: string) => Promise<void>} logoutAll
 */

/**
 * A real bcrypt hash of a value nobody knows, verified against when the email is unknown.
 *
 * Without this, an unknown address returns as fast as the database lookup while a known one costs a
 * full bcrypt verification — a difference of tens of milliseconds that is trivially measurable over
 * a few requests, and enough to enumerate an entire user list. The equal-status, equal-message
 * response in `InvalidCredentialsError` is only half the defence; this is the other half, and
 * without it the timing channel says everything the message refuses to.
 *
 * It has to be a *bcrypt* hash, and at the same cost factor as `BCRYPT_ROUNDS`. A hash from another
 * scheme makes `compare` throw immediately instead of doing the work, which returns faster than the
 * real path and reintroduces exactly the timing signal this constant exists to remove — silently,
 * with every test still green. If you raise the rounds in config, regenerate this:
 *
 * node -e "import('bcryptjs').then(async b => console.log(await b.hash(require('node:crypto').randomBytes(32).toString('base64'), 10)))"
 */
const TIMING_DECOY_HASH = '$2b$10$3D7pJpBcHLI8ktnPNSr9juYMT8CH963chDePw7AeNihf5aPbeyEwG';

/**
 * @param {AuthServiceDependencies} dependencies
 * @returns {AuthService}
 */
export function createAuthService(dependencies) {
  const { users, refreshTokens, tokens } = dependencies;
  const hasher = () => dependencies.hasher ?? bcryptHasher;

  /**
   * Issues a pair and records the refresh half, so rotation has something to invalidate.
   *
   * @param {import('../domain/user__IMPORT_SUFFIX__').UserRecord} user
   * @param {string} [family]
   * @returns {Promise<AuthResult>}
   */
  async function issueAndRecord(user, family) {
    const issued = tokens.issuePair(user, family);

    await refreshTokens.save({
      jti: issued.refreshJti,
      family: issued.family,
      userId: user.id,
      expiresAt: issued.refreshTokenExpiresAt,
      revokedAt: undefined,
    });

    return {
      user: toPublicUser(user),
      tokens: {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        accessTokenExpiresAt: issued.accessTokenExpiresAt,
        refreshTokenExpiresAt: issued.refreshTokenExpiresAt,
      },
    };
  }

  return {
    async signup(input) {
      const email = normalizeEmail(input.email);

      assertPasswordAcceptable(input.password);

      const passwordHash = await hasher().hash(input.password);

      // The role is assigned here and never read from the caller. Accepting a `role` field from a
      // request body is the classic privilege-escalation bug: sign up as an admin. Note that
      // `input` is destructured field by field rather than spread into `create` for the same
      // reason — a spread would carry any extra key a client sent straight into the document.
      // Promote your first admin directly in the database.
      const user = await users.create({
        name: input.name,
        email,
        passwordHash,
        role: DEFAULT_ROLE,
      });

      return issueAndRecord(user);
    },

    async login(input) {
      const email = normalizeEmail(input.email);
      const user = await users.findByEmail(email);

      if (user === undefined) {
        // Deliberate wasted work — see TIMING_DECOY_HASH. The result is discarded, and it must not
        // be optimised away or moved behind a condition that skips it.
        await hasher().verify(input.password, TIMING_DECOY_HASH);
        throw new InvalidCredentialsError({ cause: 'no user with that email' });
      }

      if (!(await hasher().verify(input.password, user.passwordHash))) {
        throw new InvalidCredentialsError({ cause: 'password did not match' });
      }

      // Only after a *successful* verify: this is how hashing parameters get upgraded when the
      // config is raised, without forcing a password reset on anybody. Doing it before would hash
      // an attacker's guesses at the new, higher cost on every failed attempt.
      if (hasher().needsRehash(user.passwordHash)) {
        await users.updatePasswordHash(user.id, await hasher().hash(input.password));
      }

      return issueAndRecord(user);
    },

    /**
     * Rotation with reuse detection.
     *
     * Every refresh consumes the presented token and issues a replacement in the same family. The
     * threat this defends against: a stolen refresh token is byte-identical to the legitimate one,
     * so the server cannot tell attacker from user by inspection. What it *can* see is a token being
     * used twice — which only happens if two parties hold it. At that point the safe move is to
     * assume compromise and kill the whole lineage, forcing a re-login the attacker cannot complete
     * without the password.
     *
     * @param {string} refreshToken
     * @returns {Promise<AuthResult>}
     */
    async refresh(refreshToken) {
      const claims = tokens.verifyRefresh(refreshToken);
      const stored = await refreshTokens.find(claims.jti);
      const now = new Date();

      if (stored === undefined || stored.revokedAt !== undefined) {
        // Unknown or already-rotated: a replay. Revoke everything descended from that login.
        //
        // The family comes from the presented token's own claims, which is safe precisely because
        // the signature has already been verified — the value cannot be chosen by a caller who does
        // not hold the signing key, so this cannot be turned into a way to revoke someone else's
        // sessions.
        await refreshTokens.revokeFamily(claims.family, now);
        throw new TokenReusedError();
      }

      if (stored.expiresAt.getTime() <= now.getTime()) {
        // The signature check should already have rejected this; the stored copy is the backstop for
        // a token minted before a TTL was shortened.
        await refreshTokens.revoke(stored.jti, now);
        throw new InvalidTokenError('This session has expired. Please sign in again');
      }

      const user = await users.findById(stored.userId);

      if (user === undefined) {
        // The account went away while the session was live. Nothing left to refresh into.
        await refreshTokens.revokeFamily(stored.family, now);
        throw new InvalidTokenError();
      }

      // Revoked before the replacement is handed out, never after: a crash in between must leave the
      // old token dead rather than leave two live tokens in the same family.
      await refreshTokens.revoke(stored.jti, now);

      // The role and name come from the freshly loaded user, not from the old token, so a promotion
      // or a rename takes effect on the next refresh rather than on the next login.
      return issueAndRecord(user, stored.family);
    },

    /**
     * Ends one session.
     *
     * Only the presented token is revoked, not its family — signing out of a laptop must not sign
     * you out of your phone. Idempotent, and silent about an invalid token: a client clearing a
     * stale cookie should not receive an error for doing the right thing.
     *
     * @param {string} refreshToken
     * @returns {Promise<void>}
     */
    async logout(refreshToken) {
      try {
        const claims = tokens.verifyRefresh(refreshToken);
        await refreshTokens.revoke(claims.jti, new Date());
      } catch {
        // Already invalid, expired, or forged. Either way the caller ends up logged out.
      }
    },

    /**
     * Ends every session for a user — the "sign out everywhere" action, and what you call after a
     * password change or a suspected compromise.
     *
     * Delegated to the repository rather than assembled here: revoking every row for a user is one
     * statement in Mongo, and doing it in a loop over families would be both slower and racy against
     * a concurrent refresh.
     *
     * @param {string} userId
     * @returns {Promise<void>}
     */
    async logoutAll(userId) {
      await refreshTokens.revokeAllForUser(userId, new Date());
    },
  };
}
