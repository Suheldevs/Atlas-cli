/**
 * Auth orchestration.
 *
 * Everything security-relevant that is not cryptography lives here: what a failed login is allowed
 * to reveal, when a password gets re-hashed, and what happens when a refresh token is replayed.
 */
import {
  InvalidCredentialsError,
  InvalidTokenError,
  TokenReusedError,
} from '../domain/auth-errors__IMPORT_SUFFIX__';
import type { TokenPair } from '../domain/tokens__IMPORT_SUFFIX__';
import {
  DEFAULT_ROLE,
  normalizeEmail,
  toPublicUser,
  type PublicUser,
} from '../domain/user__IMPORT_SUFFIX__';
import type { RefreshTokenRepository } from '../repositories/refresh-token-repository__IMPORT_SUFFIX__';
import type { UserRepository } from '../repositories/user-repository__IMPORT_SUFFIX__';
import { bcryptHasher } from '../security/bcrypt-hasher__IMPORT_SUFFIX__';
import {
  assertPasswordAcceptable,
  type PasswordHasher,
} from '../security/password-hasher__IMPORT_SUFFIX__';
import type { TokenService } from '../security/token-service__IMPORT_SUFFIX__';

export interface AuthResult {
  readonly user: PublicUser;
  readonly tokens: TokenPair;
}

export interface AuthService {
  signup(input: { readonly email: string; readonly password: string }): Promise<AuthResult>;
  login(input: { readonly email: string; readonly password: string }): Promise<AuthResult>;
  refresh(refreshToken: string): Promise<AuthResult>;
  logout(refreshToken: string): Promise<void>;
  logoutAll(userId: string): Promise<void>;
}

export interface AuthServiceDependencies {
  readonly users: UserRepository;
  readonly refreshTokens: RefreshTokenRepository;
  readonly tokens: TokenService;
  readonly hasher?: PasswordHasher;
}

/**
 * A real bcrypt hash of a value nobody knows, verified against when the email is unknown.
 *
 * Without this, an unknown address returns as fast as the database lookup while a known one costs a
 * full bcrypt verification — a difference of tens of milliseconds that is trivially measurable over
 * a few requests, and enough to enumerate an entire user list.
 *
 * It has to be a *bcrypt* hash, and at the same cost factor as `BCRYPT_ROUNDS`. A hash from another
 * scheme makes `compare` throw immediately instead of doing the work, which returns faster than the
 * real path and reintroduces exactly the timing signal this constant exists to remove. If you raise
 * the rounds in config, regenerate this:
 *
 * ```
 * node -e "import('bcryptjs').then(async b => console.log(await b.hash(require('node:crypto').randomBytes(32).toString('base64'), 10)))"
 * ```
 */
const TIMING_DECOY_HASH = '$2b$10$3D7pJpBcHLI8ktnPNSr9juYMT8CH963chDePw7AeNihf5aPbeyEwG';

export function createAuthService(dependencies: AuthServiceDependencies): AuthService {
  const { users, refreshTokens, tokens } = dependencies;
  const hasher = (): PasswordHasher => dependencies.hasher ?? bcryptHasher;

  /** Issues a pair and records the refresh half, so rotation has something to invalidate. */
  async function issueAndRecord(
    user: Parameters<TokenService['issuePair']>[0],
    family?: string,
  ): Promise<AuthResult> {
    const issued = await tokens.issuePair(user, family);

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
    async signup(input): Promise<AuthResult> {
      const email = normalizeEmail(input.email);
      assertPasswordAcceptable(input.password);

      const passwordHash = await hasher().hash(input.password);

      // The role is assigned here and never read from the caller. Accepting a `role` field from a
      // request body is the classic privilege-escalation bug: sign up as an admin. Promote the first
      // admin directly in the database.
      const user = await users.create({ email, passwordHash, role: DEFAULT_ROLE });

      return issueAndRecord(user);
    },

    async login(input): Promise<AuthResult> {
      const email = normalizeEmail(input.email);
      const user = await users.findByEmail(email);

      if (user === undefined) {
        // Deliberate wasted work — see TIMING_DECOY_HASH. The result is discarded.
        await hasher().verify(input.password, TIMING_DECOY_HASH);
        throw new InvalidCredentialsError({ cause: 'no user with that email' });
      }

      if (!(await hasher().verify(input.password, user.passwordHash))) {
        throw new InvalidCredentialsError({ cause: 'password did not match' });
      }

      // Only after a *successful* verify: this is how hashing parameters get upgraded when the
      // config is raised, without forcing a password reset on anybody.
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
     * so the server cannot tell attacker from user by inspection. What it *can* see is a token
     * being used twice — which only happens if two parties hold it. At that point the safe move is
     * to assume compromise and kill the whole lineage, forcing a re-login that the attacker cannot
     * complete without the password.
     */
    async refresh(refreshToken): Promise<AuthResult> {
      const claims = await tokens.verifyRefresh(refreshToken);
      const stored = await refreshTokens.find(claims.jti);
      const now = new Date();

      if (stored === undefined || stored.revokedAt !== undefined) {
        // Unknown or already-rotated: a replay. Revoke everything descended from that login.
        await refreshTokens.revokeFamily(claims.family, now);
        throw new TokenReusedError();
      }

      if (stored.expiresAt.getTime() <= now.getTime()) {
        // The signature check should already have rejected this; the stored copy is the backstop
        // for a token minted before a TTL was shortened.
        await refreshTokens.revoke(stored.jti, now);
        throw new InvalidTokenError('This session has expired. Please sign in again.');
      }

      const user = await users.findById(stored.userId);

      if (user === undefined) {
        // The account went away while the session was live. Nothing left to refresh into.
        await refreshTokens.revokeFamily(stored.family, now);
        throw new InvalidTokenError();
      }

      // Revoked before the replacement is handed out, never after: a crash in between must leave
      // the old token dead rather than leave two live tokens in the same family.
      await refreshTokens.revoke(stored.jti, now);

      return issueAndRecord(user, stored.family);
    },

    /**
     * Ends one session.
     *
     * Only the presented token is revoked, not its family — signing out of a laptop must not sign
     * you out of your phone. Idempotent, and silent about an invalid token: a client clearing a
     * stale cookie should not receive an error for doing the right thing.
     */
    async logout(refreshToken): Promise<void> {
      try {
        const claims = await tokens.verifyRefresh(refreshToken);
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
     * statement in both Mongo and SQL, and doing it in a loop over families would be both slower
     * and racy against a concurrent refresh.
     */
    async logoutAll(userId): Promise<void> {
      await refreshTokens.revokeAllForUser(userId, new Date());
    },
  };
}
