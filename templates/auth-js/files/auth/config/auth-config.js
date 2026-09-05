/**
 * The auth module's view of the application configuration.
 *
 * **This is the only file in `auth/` that reads the central config, and nothing in `auth/` reads
 * `process.env` at all.** Environment parsing, the "collect every error then fail once" report and
 * the frozen result are owned by `src/config/env.js`; this module selects the slice auth needs,
 * applies the defaults for the optional keys, derives the cookie attributes, and freezes the result.
 *
 * Keeping that seam in one file is the point. If the central config renames a key or changes how it
 * is exported, one file changes — not fifteen.
 */
import * as centralConfig from '../../config/env__IMPORT_SUFFIX__';

import { assertAuthConfigSatisfied } from './env-schema__IMPORT_SUFFIX__';

/**
 * @typedef {'strict' | 'lax' | 'none'} SameSitePolicy
 */

/**
 * @typedef {object} AuthConfig
 * @property {string} accessTokenSecret
 * @property {string} refreshTokenSecret
 * @property {string} issuer
 * @property {string} audience
 * @property {number} accessTokenTtlSeconds
 * @property {number} refreshTokenTtlSeconds
 * @property {string} cookieName
 * @property {boolean} cookieSecure
 * @property {SameSitePolicy} cookieSameSite
 * @property {number} bcryptRounds
 * @property {boolean} isProduction
 */

/** Short by design: the role is embedded in the token, so a change only lands on expiry. */
const DEFAULT_ACCESS_TTL_SECONDS = 900;

/** Seven days, matching the default `src/config/env.js` applies to `JWT_REFRESH_TTL`. */
const DEFAULT_REFRESH_TTL_SECONDS = 604800;

/**
 * The unit suffixes `src/config/env.js` accepts on a TTL, in seconds.
 *
 * @type {Readonly<Record<string, number>>}
 */
const DURATION_UNITS = Object.freeze({ ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 });

/** `15m` → 900. */
const DURATION = /^(\d+)(ms|s|m|h|d)$/u;

const DEFAULT_COOKIE_NAME = 'refresh_token';

/**
 * 10, not the 12 often quoted for bcrypt.
 *
 * bcryptjs is pure JavaScript and several times slower than the native binding at the same cost
 * factor, so 12 here costs noticeably more login latency than 12 with native bcrypt. 10 is the OWASP
 * floor and a reasonable default for this implementation; raise it once you have measured login
 * latency under real load — and regenerate `TIMING_DECOY_HASH` when you do.
 */
const DEFAULT_BCRYPT_ROUNDS = 10;

/**
 * The resolved config object, however `src/config/env.js` chooses to export it.
 *
 * Namespace-imported and probed rather than destructured, so this module works whether that file
 * ends with `export const config = …` or `export default …` — the two shapes a "single frozen
 * config object" is written as. It is not a silent fallback: if neither exists, the throw below says
 * exactly what is wrong and where to fix it.
 *
 * @returns {Record<string, unknown>}
 */
function resolveCentralConfig() {
  const candidate =
    /** @type {Record<string, unknown> | undefined} */ (
      /** @type {Record<string, unknown>} */ (centralConfig).config
    ) ??
    /** @type {Record<string, unknown> | undefined} */ (
      /** @type {Record<string, unknown>} */ (centralConfig).default
    );

  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error(
      'src/config/env.js must export the resolved configuration as `config` (or as its default ' +
        'export). The auth module reads every setting from there and nothing from process.env.',
    );
  }

  return candidate;
}

/**
 * @param {Record<string, unknown>} config
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
function stringOr(config, key, fallback) {
  const value = config[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

/**
 * @param {Record<string, unknown>} config
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function numberOr(config, key, fallback) {
  const value = config[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * A validated TTL string such as `15m` or `7d`, in whole seconds.
 *
 * This is a unit conversion, not a second round of validation: `src/config/env.js` has already
 * rejected anything that does not match its duration grammar, and re-reporting a bad value here
 * would put the same typo in the boot report twice. The fallback exists only for the case where the
 * key is absent altogether — a config object assembled by a test, or a central config that has not
 * been extended with the key yet.
 *
 * Rounded up, and floored at one second: a TTL of `500ms` is a misconfiguration, but a token whose
 * `exp` equals its `iat` would be born expired and is a worse way to find out.
 *
 * @param {Record<string, unknown>} config
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function durationToSeconds(config, key, fallback) {
  const value = config[key];

  if (typeof value !== 'string') {
    return fallback;
  }

  const match = DURATION.exec(value.trim());

  if (match === null) {
    return fallback;
  }

  const unit = DURATION_UNITS[match[2]];

  if (unit === undefined) {
    return fallback;
  }

  return Math.max(1, Math.ceil(Number(match[1]) * unit));
}

/**
 * Reads the central config and derives the auth settings, or throws.
 *
 * Exported so a test can pass a fixture instead of the real configuration.
 *
 * @param {Record<string, unknown>} [config] Defaults to the resolved central config.
 * @returns {AuthConfig}
 */
export function loadAuthConfig(config = resolveCentralConfig()) {
  // Runs whether or not the central validator was wired to `collectAuthConfigIssues`. When it was,
  // this never fires — the process already failed at boot with one combined report.
  assertAuthConfigSatisfied(config);

  // `src/config/env.js` derives `isProduction` itself. Preferred when present so the two cannot
  // disagree, with the direct comparison as the fallback for a config assembled by a test.
  const isProduction =
    typeof config.isProduction === 'boolean'
      ? config.isProduction
      : stringOr(config, 'nodeEnv', 'development') === 'production';

  return Object.freeze({
    accessTokenSecret: String(config.jwtAccessSecret),

    /**
     * A separate key from the access secret, and the reason the two token types cannot be
     * interchanged even if the `tt` claim check in the token service were removed: a token signed
     * with one key simply does not verify under the other.
     */
    refreshTokenSecret: String(config.jwtRefreshSecret),

    issuer: stringOr(config, 'jwtIssuer', 'atlas-auth'),
    audience: stringOr(config, 'jwtAudience', 'atlas-api'),

    // The central config states these as durations (`15m`, `7d`) because that is what an operator
    // writes in a `.env`. Tokens need seconds, and both tokens in a pair need to be computed from
    // one clock reading, so they are converted once here rather than handed to `expiresIn`.
    accessTokenTtlSeconds: durationToSeconds(config, 'jwtAccessTtl', DEFAULT_ACCESS_TTL_SECONDS),
    refreshTokenTtlSeconds: durationToSeconds(config, 'jwtRefreshTtl', DEFAULT_REFRESH_TTL_SECONDS),

    cookieName: stringOr(config, 'authCookieName', DEFAULT_COOKIE_NAME),

    /**
     * Derived from the environment, never hardcoded and never read from a variable of its own.
     *
     * `Secure` in production is not negotiable: a refresh token sent over plain HTTP is a refresh
     * token given to anyone on the network path. It is off in development only so a plain-HTTP
     * localhost still works — browsers refuse to store a `Secure` cookie from an insecure origin,
     * so leaving it on would make login appear to succeed and refresh silently fail.
     */
    cookieSecure: isProduction,

    /**
     * `SameSite` is the CSRF control on this cookie, and the two values here are a real trade.
     *
     * `lax` in development keeps a same-origin localhost setup working with no surprises.
     *
     * `none` in production is what a browser requires when the API and the front end are served
     * from different origins — the deployment this template assumes — because the cookie has to
     * travel on a cross-site request or refresh never works at all. It is only legal alongside
     * `Secure`, which is why the two are derived from the same condition.
     *
     * Be clear about what that costs: `none` means the browser attaches this cookie to cross-site
     * requests, so `/api/auth/refresh` and `/api/auth/logout` become CSRF-reachable. Two things
     * blunt it — the cookie is path-scoped to the auth router, and the access token in the response
     * body is unreadable to an attacker's page unless CORS explicitly allows that origin — but
     * neither is a substitute for a strict CORS allowlist with credentials enabled only for your own
     * front end. If the API and the front end share an origin, change this to `'strict'` and get the
     * stronger guarantee back.
     *
     * @type {SameSitePolicy}
     */
    cookieSameSite: isProduction ? 'none' : 'lax',

    bcryptRounds: numberOr(config, 'bcryptRounds', DEFAULT_BCRYPT_ROUNDS),

    isProduction,
  });
}

/** @type {AuthConfig | undefined} */
let resolved;

/** @returns {AuthConfig} */
function resolveAuthConfig() {
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
 *
 * Both signing keys are reachable through it, so treat the object the way you would treat a secret:
 * never log it, never spread it into an error, never put it in a response.
 *
 * @type {AuthConfig}
 */
export const authConfig = /** @type {AuthConfig} */ (
  /** @type {unknown} */ (
    new Proxy(
      {},
      {
        get: (_target, property) => Reflect.get(resolveAuthConfig(), property),
        has: (_target, property) => Reflect.has(resolveAuthConfig(), property),
        ownKeys: () => Reflect.ownKeys(resolveAuthConfig()),
        getOwnPropertyDescriptor: (_target, property) => {
          const descriptor = Reflect.getOwnPropertyDescriptor(resolveAuthConfig(), property);

          // Reported as configurable even though the resolved object is frozen. A proxy may not
          // describe a property as non-configurable unless the *target* also has it, and the target
          // here is permanently empty — so returning the frozen descriptor unchanged makes
          // `Object.keys(authConfig)` throw a TypeError about a proxy invariant. Nothing is loosened
          // by this: the underlying object stays frozen and there is no `set` trap, so the proxy is
          // still read-only.
          return descriptor === undefined ? undefined : { ...descriptor, configurable: true };
        },
      },
    )
  )
);

/**
 * Discards the memoised configuration. Intended for tests that manipulate the environment.
 *
 * @returns {void}
 */
export function resetAuthConfig() {
  resolved = undefined;
}
