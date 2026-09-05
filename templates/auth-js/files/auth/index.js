/**
 * The auth module's public surface.
 *
 * Wiring it into an application is one line, because there is exactly one of everything to choose:
 * Mongoose for storage, bcrypt for hashing, `jsonwebtoken` for tokens.
 *
 *   import { createAuthModule } from './auth/index.js';
 *
 *   const auth = createAuthModule();
 *   app.use('/api/auth', auth.router);
 *
 * Mount it at `/api/auth` and nowhere else — the refresh cookie is path-scoped to that prefix, so a
 * different mount point silently breaks the refresh flow. Register the application's global error
 * handler after your routes; this module throws `ApiError`s and renders none of them itself.
 *
 * The pieces are exported individually too, for the cases the one-liner does not cover: swapping in
 * a different store, installing a fast password hasher in tests, or guarding your own routes with
 * `requireAuth` and `requireRole`.
 *
 * Two things this module needs from the rest of the application:
 *
 *   - `src/config/env.js` must resolve `jwtAccessSecret`, `jwtRefreshSecret` and `nodeEnv`. Wiring
 *     `collectAuthConfigIssues` into that validator makes a missing one appear in the same boot
 *     report as every other configuration error.
 *   - A Mongoose connection must be open before the first request. The repositories use the default
 *     connection and do not open one.
 */

import { createAuthRouter } from './http/auth-routes__IMPORT_SUFFIX__';
import { MongooseRefreshTokenRepository } from './repositories/refresh-token-repository__IMPORT_SUFFIX__';
import { MongooseUserRepository } from './repositories/user-repository__IMPORT_SUFFIX__';
import { tokenService } from './security/token-service__IMPORT_SUFFIX__';
import { createAuthService } from './services/auth-service__IMPORT_SUFFIX__';

/**
 * @typedef {object} AuthModule
 * @property {import('express').Router} router Mount at `/api/auth`.
 * @property {import('./services/auth-service__IMPORT_SUFFIX__').AuthService} service The same
 *   service the router uses. Reach for it to run `logoutAll` after a password change, or to seed an
 *   account from a script.
 */

/**
 * Assembles the module with its default dependencies.
 *
 * Every dependency is overridable, which is what makes the whole module testable without a database:
 * pass two in-memory objects satisfying `UserRepository` and `RefreshTokenRepository` and the
 * rotation and reuse-detection logic can be exercised in milliseconds.
 *
 * @param {Partial<import('./services/auth-service__IMPORT_SUFFIX__').AuthServiceDependencies>} [dependencies]
 * @returns {AuthModule}
 */
export function createAuthModule(dependencies = {}) {
  const service = createAuthService({
    users: dependencies.users ?? new MongooseUserRepository(),
    refreshTokens: dependencies.refreshTokens ?? new MongooseRefreshTokenRepository(),
    tokens: dependencies.tokens ?? tokenService,
    ...(dependencies.hasher === undefined ? {} : { hasher: dependencies.hasher }),
  });

  return { router: createAuthRouter(service), service };
}

export { ROLES, DEFAULT_ROLE, isRole, toPublicUser, normalizeEmail } from './domain/user__IMPORT_SUFFIX__';

export {
  InvalidCredentialsError,
  EmailAlreadyRegisteredError,
  InvalidTokenError,
  TokenReusedError,
  UnauthenticatedError,
  ForbiddenError,
  WeakPasswordError,
  ValidationFailedError,
  isApiError,
} from './domain/auth-errors__IMPORT_SUFFIX__';

export { authConfig, loadAuthConfig, resetAuthConfig } from './config/auth-config__IMPORT_SUFFIX__';
export {
  AUTH_CONFIG_REQUIREMENTS,
  MIN_SECRET_LENGTH,
  assertAuthConfigSatisfied,
  collectAuthConfigIssues,
} from './config/env-schema__IMPORT_SUFFIX__';

export {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
  assertPasswordAcceptable,
  bcryptHasher,
  createBcryptHasher,
} from './security/bcrypt-hasher__IMPORT_SUFFIX__';

export { createTokenService, tokenService } from './security/token-service__IMPORT_SUFFIX__';

export { UserModel } from './models/user.model__IMPORT_SUFFIX__';
export { RefreshTokenModel } from './models/refresh-token.model__IMPORT_SUFFIX__';

export { MongooseUserRepository } from './repositories/user-repository__IMPORT_SUFFIX__';
export { MongooseRefreshTokenRepository } from './repositories/refresh-token-repository__IMPORT_SUFFIX__';

export { createAuthService } from './services/auth-service__IMPORT_SUFFIX__';

export { createAuthRouter } from './http/auth-routes__IMPORT_SUFFIX__';
export { createAuthController } from './http/auth-controller__IMPORT_SUFFIX__';
export { requireAuth, getAuth } from './http/require-auth__IMPORT_SUFFIX__';
export { requireRole } from './http/require-role__IMPORT_SUFFIX__';
export { validateLogin, validateSignup } from './http/auth-validators__IMPORT_SUFFIX__';
