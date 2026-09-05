/**
 * Issues and verifies the JWT pair.
 *
 * The rule this file is organised around: a valid signature proves a token was minted by this
 * service and has not been altered. It proves nothing about what the payload contains. Claims are
 * therefore re-validated after verification — a token signed months ago by an older build of this
 * same application is correctly signed and may still carry a payload that no longer matches the
 * claim shape, and trusting the decoded object because `verify` returned would hand that shape
 * straight to the authorisation middleware.
 *
 * That rule has more force in JavaScript than it had in TypeScript, because nothing else is
 * checking. `payload.role` is whatever was signed; `requireRole` below is the only thing standing
 * between a hand-crafted claim and an authorisation decision.
 */

import { randomUUID } from 'node:crypto';

// A default import, not `import { sign, verify }`. `jsonwebtoken` is CommonJS, and Node can only
// synthesise named exports from a CJS module when its static analyser can see them being assigned —
// which it cannot here. The named form looks correct and then throws
// `does not provide an export named 'sign'` at startup. The default import is the module object
// itself, which always works.
import jwt from 'jsonwebtoken';

import { authConfig } from '../config/auth-config__IMPORT_SUFFIX__';
import { InvalidTokenError } from '../domain/auth-errors__IMPORT_SUFFIX__';
import { isRole } from '../domain/user__IMPORT_SUFFIX__';

/**
 * The private claim separating the two token types.
 *
 * The two kinds are already signed with different keys, so a refresh token presented as a bearer
 * token fails its signature check before this claim is ever read. The claim is the second lock on
 * the same door, and it is worth keeping: it is what still holds if the two secrets are ever
 * misconfigured to the same value, which is exactly the kind of copy-paste that happens once in a
 * `.env` and is never noticed. Without either defence a refresh token is a perfectly valid access
 * token — it verifies, it has a `sub`, and every protected route accepts it — which would hand
 * bearer-token power to the credential a client holds for weeks.
 *
 * Checked on the way in, not just written on the way out.
 *
 * @typedef {'access' | 'refresh'} TokenType
 */

const HS256 = 'HS256';

/**
 * The token-issuing and token-verifying seam.
 *
 * @typedef {object} TokenService
 * @property {(user: import('../domain/user__IMPORT_SUFFIX__').UserRecord, family?: string) =>
 *   import('../domain/tokens__IMPORT_SUFFIX__').IssuedTokens} issuePair Pass `family` to continue an
 *   existing refresh lineage during rotation; omit it for a fresh login, which starts a new one.
 * @property {(token: string) => import('../domain/tokens__IMPORT_SUFFIX__').AccessTokenClaims}
 *   verifyAccess
 * @property {(token: string) => import('../domain/tokens__IMPORT_SUFFIX__').RefreshTokenClaims}
 *   verifyRefresh
 */

/**
 * Attached as `cause`, so the reason survives into logs without reaching a response body.
 *
 * @param {string} reason
 * @param {unknown} [cause]
 * @returns {InvalidTokenError}
 */
function invalidToken(reason, cause) {
  return new InvalidTokenError(reason, { cause });
}

/**
 * @param {unknown} value
 * @param {string} claim
 * @returns {string}
 */
function requireString(value, claim) {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidToken(`Token has no usable "${claim}" claim`);
  }

  return value;
}

/**
 * @param {unknown} value
 * @returns {import('../domain/user__IMPORT_SUFFIX__').Role}
 */
function requireRole(value) {
  if (!isRole(value)) {
    // Fail closed. A role name this build does not know cannot be authorised correctly, and
    // defaulting it to `user` would silently change the caller's permissions. Rejecting the token
    // sends the client through the refresh flow, which re-reads the role from the user record and
    // issues an access token this build does understand.
    throw invalidToken('Token carries a role this service does not recognise');
  }

  return /** @type {import('../domain/user__IMPORT_SUFFIX__').Role} */ (value);
}

/**
 * @param {import('../config/auth-config__IMPORT_SUFFIX__').AuthConfig} [config]
 * @returns {TokenService}
 */
export function createTokenService(config = authConfig) {
  /**
   * Built on first use, not here.
   *
   * `authConfig` is a lazily-resolving proxy so that importing any part of this module does not
   * demand a configured environment — a unit test for something unrelated, or a build step that
   * imports the router to enumerate routes, must not have to set two signing secrets to run.
   * Reading `config.issuer` in this function body would resolve it immediately and throw at import
   * time, which defeats the point entirely and is easy to reintroduce, because it looks like
   * ordinary hoisting.
   *
   * @type {jwt.VerifyOptions | undefined}
   */
  let cachedVerifyOptions;

  /** @returns {jwt.VerifyOptions} */
  function options() {
    cachedVerifyOptions ??= {
      // The most important line in this file. Left unset, `verify` accepts any algorithm the key
      // could plausibly be used with, and the header naming that algorithm is supplied by whoever
      // sent the token — the classic JWT failure, where a token arrives claiming a different `alg`
      // and is validated under rules the server never chose. One value, fixed here, is the defence.
      algorithms: [HS256],
      // Both of these make the corresponding claim *required*, not merely compared when present.
      // Skipping `audience` is the subtle one: any service sharing this secret — a sibling
      // deployment, a staging environment restored from the same secret store, an internal tool that
      // signs its own service tokens — could otherwise mint credentials that authenticate here,
      // because the signature really does check out.
      issuer: config.issuer,
      audience: config.audience,
    };

    return cachedVerifyOptions;
  }

  /**
   * The signing key for each token type.
   *
   * Two keys, not one. A refresh token cannot be verified with the access key and vice versa, so a
   * disclosure of the access secret — the one that travels in `Authorization` headers, gets pasted
   * into bug reports and shows up in proxy logs — does not let anybody forge a month-long refresh
   * credential.
   *
   * @param {TokenType} type
   * @returns {string}
   */
  function secretFor(type) {
    return type === 'access' ? config.accessTokenSecret : config.refreshTokenSecret;
  }

  /**
   * @param {string} token
   * @param {TokenType} expected
   * @returns {jwt.JwtPayload}
   */
  function verifyOfType(token, expected) {
    /** @type {jwt.JwtPayload | string} */
    let payload;

    try {
      payload = jwt.verify(token, secretFor(expected), options());
    } catch (error) {
      // One message for every failure mode. Telling a caller apart `TokenExpiredError` from
      // `JsonWebTokenError` from a claim mismatch tells someone forging tokens which part to fix
      // next; the distinction belongs in the log, via `cause`.
      throw invalidToken('Token is not valid', error);
    }

    // `verify` returns a string when the token payload was signed as a plain string rather than an
    // object. This service only ever signs objects, so a string here means the token came from
    // somewhere else and nothing below can be trusted to exist.
    if (typeof payload !== 'object' || payload === null) {
      throw invalidToken('Token payload is not an object');
    }

    if (payload.tt !== expected) {
      throw invalidToken(`Expected a token of type "${expected}"`);
    }

    return payload;
  }

  return {
    issuePair(user, family) {
      // One clock reading for both tokens: `iat` then matches, and the two expiries are exactly the
      // configured TTLs apart. NumericDate is seconds since the epoch, not milliseconds.
      const issuedAt = Math.floor(Date.now() / 1000);
      const accessExpiry = issuedAt + config.accessTokenTtlSeconds;
      const refreshExpiry = issuedAt + config.refreshTokenTtlSeconds;
      const refreshJti = randomUUID();
      // A new lineage per login; an existing one is threaded through on rotation, which is what lets
      // reuse detection revoke every descendant of a replayed token instead of just that one.
      const tokenFamily = family ?? randomUUID();

      // `iat` and `exp` are set explicitly rather than via `expiresIn`, because both tokens have to
      // agree on the same instant. `expiresIn` is resolved from the clock at each call, so two
      // sequential calls would disagree by however long the first one took.
      const accessToken = jwt.sign(
        {
          tt: 'access',
          email: user.email,
          name: user.name,
          role: user.role,
          iat: issuedAt,
          exp: accessExpiry,
        },
        secretFor('access'),
        {
          algorithm: HS256,
          issuer: config.issuer,
          audience: config.audience,
          subject: user.id,
          jwtid: randomUUID(),
        },
      );

      // No email, name or role here on purpose. A refresh token is only ever exchanged for a new
      // pair, and that exchange reloads the user anyway, so putting identity or authorisation data
      // in the long-lived credential would buy nothing and give it weeks in which to go stale.
      const refreshToken = jwt.sign(
        { tt: 'refresh', family: tokenFamily, iat: issuedAt, exp: refreshExpiry },
        secretFor('refresh'),
        {
          algorithm: HS256,
          issuer: config.issuer,
          audience: config.audience,
          subject: user.id,
          jwtid: refreshJti,
        },
      );

      return {
        accessToken,
        refreshToken,
        accessTokenExpiresAt: new Date(accessExpiry * 1000),
        refreshTokenExpiresAt: new Date(refreshExpiry * 1000),
        refreshJti,
        family: tokenFamily,
      };
    },

    verifyAccess(token) {
      const payload = verifyOfType(token, 'access');

      return {
        sub: requireString(payload.sub, 'sub'),
        email: requireString(payload.email, 'email'),
        name: requireString(payload.name, 'name'),
        role: requireRole(payload.role),
        jti: requireString(payload.jti, 'jti'),
      };
    },

    verifyRefresh(token) {
      const payload = verifyOfType(token, 'refresh');

      return {
        sub: requireString(payload.sub, 'sub'),
        jti: requireString(payload.jti, 'jti'),
        family: requireString(payload.family, 'family'),
      };
    },
  };
}

/**
 * The shared instance.
 *
 * Safe to import from anywhere: `createTokenService` reads nothing from the configuration until a
 * token is actually issued or verified.
 *
 * @type {TokenService}
 */
export const tokenService = createTokenService();
