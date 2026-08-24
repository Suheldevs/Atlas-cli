/**
 * Resolved auth configuration.
 *
 * Read once, from the environment, through readers that refuse anything unsafe.
 */
import { readAuthEnv, type EnvSource } from './env-schema__IMPORT_SUFFIX__';

export interface AuthConfig {
  readonly jwtSecret: string;
  readonly issuer: string;
  readonly audience: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly cookieName: string;
  readonly cookieSecure: boolean;
  readonly bcryptRounds: number;
}

/**
 * Reads the environment, or throws.
 *
 * A misconfigured auth module must not boot. The alternative — defaulting something and carrying
 * on — means the failure surfaces at the first login attempt in production, by which time the
 * signal is a support ticket rather than a failed deploy.
 *
 * The message is prefixed so the cause is obvious in a container log where the only other output is
 * a stack trace: "JWT_SECRET is not set" on its own has been mistaken for an application bug more
 * than once.
 */
export function loadAuthConfig(env: EnvSource = process.env): AuthConfig {
  let value;

  try {
    value = readAuthEnv(env);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid auth configuration: ${detail}`, { cause: error });
  }

  return Object.freeze({
    jwtSecret: value.JWT_SECRET,
    issuer: value.JWT_ISSUER,
    audience: value.JWT_AUDIENCE,
    accessTokenTtlSeconds: value.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: value.REFRESH_TOKEN_TTL_SECONDS,
    cookieName: value.AUTH_COOKIE_NAME,
    cookieSecure: value.AUTH_COOKIE_SECURE,
    bcryptRounds: value.BCRYPT_ROUNDS,
  });
}

let resolved: AuthConfig | undefined;

function resolve(): AuthConfig {
  resolved ??= loadAuthConfig();
  return resolved;
}

/**
 * The shared configuration, resolved on first property read rather than at import time.
 *
 * A plain `export const authConfig = loadAuthConfig()` would throw the moment any module in the
 * import graph is loaded — including in a unit test for something unrelated that never
 * authenticates, and in a build step that imports the router to enumerate routes. A `Proxy` keeps
 * the ergonomics of a plain object (`authConfig.cookieName`, and usable as a default parameter
 * value) while deferring the failure to the first code path that genuinely needs a secret.
 */
export const authConfig: AuthConfig = new Proxy({} as AuthConfig, {
  get: (_target, property) => Reflect.get(resolve(), property),
  has: (_target, property) => Reflect.has(resolve(), property),
  ownKeys: () => Reflect.ownKeys(resolve()),
  getOwnPropertyDescriptor: (_target, property) =>
    Reflect.getOwnPropertyDescriptor(resolve(), property),
});

/** Discards the memoised configuration. Intended for tests that manipulate the environment. */
export function resetAuthConfig(): void {
  resolved = undefined;
}
