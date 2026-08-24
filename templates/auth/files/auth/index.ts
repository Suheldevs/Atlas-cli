/**
 * The auth module's public surface.
 *
 * Note what is **not** re-exported: the database repositories and the password hasher. Only one of
 * each is generated into a project — Atlas asks which — so a static import of the other would be a
 * missing module. They are imported directly by the file that assembles them, which is yours.
 *
 * Assembling it takes four lines. With Mongoose and argon2:
 *
 * ```ts
 * import { createAuthService, setPasswordHasher, tokenService } from './auth/index.js';
 * import { argon2Hasher } from './auth/security/argon2-hasher.js';
 * import { MongooseUserRepository } from './auth/repositories/mongoose-user-repository.js';
 * import { MongooseRefreshTokenRepository } from './auth/repositories/mongoose-refresh-token-repository.js';
 *
 * setPasswordHasher(argon2Hasher);
 *
 * export const authService = createAuthService({
 *   users: new MongooseUserRepository(),
 *   refreshTokens: new MongooseRefreshTokenRepository(),
 *   tokens: tokenService,
 * });
 * ```
 *
 * With scrypt, import `scryptHasher` from `./auth/security/scrypt-hasher.js` instead. Drop the
 * `.js` from every specifier above if your project is CommonJS.
 *
 * Then mount it, and register the error handler *after* your routes:
 *
 * ```ts
 * app.use('/auth', createAuthRouter(authService));
 * app.use(authErrorHandler);
 * ```
 *
 * With Prisma, pass your existing client into the repositories instead:
 * `new PrismaUserRepository(prisma)`.
 */

export type { Role, UserRecord, PublicUser } from './domain/user__IMPORT_SUFFIX__';
export { ROLES, isRole, toPublicUser, normalizeEmail } from './domain/user__IMPORT_SUFFIX__';

export type {
  AccessTokenClaims,
  RefreshTokenClaims,
  TokenPair,
  IssuedTokens,
} from './domain/tokens__IMPORT_SUFFIX__';

export {
  AuthError,
  InvalidCredentialsError,
  EmailAlreadyRegisteredError,
  InvalidTokenError,
  TokenReusedError,
  UnauthenticatedError,
  ForbiddenError,
  WeakPasswordError,
  isAuthError,
} from './domain/auth-errors__IMPORT_SUFFIX__';

export type { AuthConfig } from './config/auth-config__IMPORT_SUFFIX__';
export { authConfig, loadAuthConfig, resetAuthConfig } from './config/auth-config__IMPORT_SUFFIX__';

export type { PasswordHasher } from './security/password-hasher__IMPORT_SUFFIX__';
export {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_BYTES,
  assertPasswordAcceptable,
} from './security/password-hasher__IMPORT_SUFFIX__';

export { bcryptHasher, createBcryptHasher } from './security/bcrypt-hasher__IMPORT_SUFFIX__';

export type { TokenService } from './security/token-service__IMPORT_SUFFIX__';
export { createTokenService, tokenService } from './security/token-service__IMPORT_SUFFIX__';

export type {
  UserRepository,
  CreateUserInput,
} from './repositories/user-repository__IMPORT_SUFFIX__';
export type {
  RefreshTokenRepository,
  StoredRefreshToken,
} from './repositories/refresh-token-repository__IMPORT_SUFFIX__';

export type { AuthService, AuthResult } from './services/auth-service__IMPORT_SUFFIX__';
export { createAuthService } from './services/auth-service__IMPORT_SUFFIX__';

export { createAuthRouter } from './http/auth-routes__IMPORT_SUFFIX__';
export { authErrorHandler } from './http/error-handler__IMPORT_SUFFIX__';
export type { AuthenticatedContext } from './http/require-auth__IMPORT_SUFFIX__';
export { requireAuth, getAuth } from './http/require-auth__IMPORT_SUFFIX__';
export { requireRole } from './http/require-role__IMPORT_SUFFIX__';
