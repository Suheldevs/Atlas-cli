/**
 * The auth module's environment contract.
 *
 * Defaults are chosen so that an unconfigured deployment is *secure*, not merely working. Where
 * no safe default exists — the signing key — there is deliberately no default at all.
 *
 * Every reader below throws rather than falling back on a bad value. An environment variable that
 * is set but unparseable is a deployment mistake, and the moment to surface it is at boot, where it
 * fails loudly once, rather than per request, where it fails as a 500 nobody connects to the typo.
 */

/**
 * Below this, HS256 is brute-forceable offline: an attacker with one token can grind candidate
 * keys locally at full speed, with no rate limit to stop them.
 */
const MIN_SECRET_LENGTH = 32;

export interface AuthEnv {
  readonly JWT_SECRET: string;
  readonly JWT_ISSUER: string;
  readonly JWT_AUDIENCE: string;
  readonly ACCESS_TOKEN_TTL_SECONDS: number;
  readonly REFRESH_TOKEN_TTL_SECONDS: number;
  readonly AUTH_COOKIE_NAME: string;
  readonly AUTH_COOKIE_SECURE: boolean;
  readonly BCRYPT_ROUNDS: number;
}

/** The source of values. Defaulted rather than read directly, so tests can pass a fixture. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * An empty value counts as unset.
 *
 * `JWT_ISSUER=` in a `.env` file is a leftover, not a request for an empty issuer — and an empty
 * issuer would be silently accepted by the token verifier as a claim that always matches.
 */
function read(source: EnvSource, key: string): string | undefined {
  const raw = source[key];
  return raw === undefined || raw.trim() === '' ? undefined : raw.trim();
}

function requiredString(source: EnvSource, key: string, minLength: number): string {
  const value = read(source, key);

  if (value === undefined) {
    throw new Error(`${key} is not set. The auth module cannot start without it.`);
  }

  if (value.length < minLength) {
    throw new Error(`${key} must be at least ${String(minLength)} characters.`);
  }

  return value;
}

function optionalString(source: EnvSource, key: string, fallback: string): string {
  return read(source, key) ?? fallback;
}

/**
 * A positive integer, or the fallback.
 *
 * `Number()` is deliberately not used: it accepts `'12px'` as `NaN` but also `''` as `0`, `'0x10'`
 * as 16, and `' 12 '` as 12. The explicit pattern means only a plain run of digits parses, so a
 * malformed TTL is a boot failure rather than a silently wrong expiry.
 */
function positiveInteger(source: EnvSource, key: string, fallback: number): number {
  const raw = read(source, key);

  if (raw === undefined) {
    return fallback;
  }

  if (!/^\d+$/u.test(raw)) {
    throw new Error(`${key} must be a whole number of seconds, but was "${raw}".`);
  }

  const value = Number.parseInt(raw, 10);

  if (value <= 0 || !Number.isSafeInteger(value)) {
    throw new Error(`${key} must be a positive integer, but was "${raw}".`);
  }

  return value;
}

/** Accepts the two spellings an env var can realistically carry, and nothing else. */
function booleanValue(source: EnvSource, key: string, fallback: boolean): boolean {
  const raw = read(source, key);

  if (raw === undefined) {
    return fallback;
  }

  if (raw === 'true') {
    return true;
  }

  if (raw === 'false') {
    return false;
  }

  // Not coerced. `AUTH_COOKIE_SECURE=yes` under a truthiness check would read as `true`, and
  // `AUTH_COOKIE_SECURE=0` would read as `true` as well — a non-empty string. Both are the kind of
  // mistake that only shows up as a cookie missing its Secure flag in production.
  throw new Error(`${key} must be "true" or "false", but was "${raw}".`);
}

export function readAuthEnv(source: EnvSource = process.env): AuthEnv {
  return {
    /**
     * No default, on purpose. A generated fallback secret is the single most damaging thing this
     * file could contain: it would work in development, survive review, and ship — at which point
     * every deployment that forgot to set it shares a signing key with every other one.
     */
    JWT_SECRET: requiredString(source, 'JWT_SECRET', MIN_SECRET_LENGTH),

    JWT_ISSUER: optionalString(source, 'JWT_ISSUER', 'atlas-auth'),
    JWT_AUDIENCE: optionalString(source, 'JWT_AUDIENCE', 'atlas-api'),

    /** Short by design: the role is embedded in the token, so a change only lands on expiry. */
    ACCESS_TOKEN_TTL_SECONDS: positiveInteger(source, 'ACCESS_TOKEN_TTL_SECONDS', 900),
    REFRESH_TOKEN_TTL_SECONDS: positiveInteger(source, 'REFRESH_TOKEN_TTL_SECONDS', 2_592_000),

    AUTH_COOKIE_NAME: optionalString(source, 'AUTH_COOKIE_NAME', 'refresh_token'),

    /**
     * Defaults to true. A developer on plain HTTP localhost opts *out* explicitly; the reverse
     * default would mean a production deployment that forgot this variable sends its refresh
     * cookie over cleartext.
     */
    AUTH_COOKIE_SECURE: booleanValue(source, 'AUTH_COOKIE_SECURE', true),

    /**
     * 10, not the 12 often quoted for bcrypt.
     *
     * bcryptjs is pure JavaScript and several times slower than the native binding at the same cost
     * factor, so 12 here costs noticeably more login latency than 12 with native bcrypt. 10 is the
     * OWASP floor and a reasonable default for this implementation; raise it once you have measured
     * login latency under real load.
     */
    BCRYPT_ROUNDS: positiveInteger(source, 'BCRYPT_ROUNDS', 10),
  };
}
