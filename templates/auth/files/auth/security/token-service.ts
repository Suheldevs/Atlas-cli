/**
 * Issues and verifies the JWT pair.
 *
 * The rule this file is organised around: a valid signature proves a token was minted by this
 * service and has not been altered. It proves nothing about what the payload contains. Claims are
 * therefore re-validated after verification — a token signed months ago by an older build of this
 * same application is correctly signed and may still carry a payload that no longer matches
 * `AccessTokenClaims`, and trusting the decoded object because `verify` returned would hand that
 * shape straight to the authorisation middleware.
 */

import { randomUUID } from 'node:crypto';

// A default import, not `import { sign, verify }`. `jsonwebtoken` is CommonJS, and Node can only
// synthesise named exports from a CJS module when its static analyser can see them being assigned —
// which it cannot here. Named imports typecheck perfectly (the @types package declares them) and
// then throw `does not provide an export named 'sign'` at startup. The default import is the module
// object itself, which always works.
import jwt from 'jsonwebtoken';
import type { JwtPayload, VerifyOptions } from 'jsonwebtoken';

import { authConfig, type AuthConfig } from '../config/auth-config__IMPORT_SUFFIX__';
import { InvalidTokenError } from '../domain/auth-errors__IMPORT_SUFFIX__';
import type {
  AccessTokenClaims,
  IssuedTokens,
  RefreshTokenClaims,
} from '../domain/tokens__IMPORT_SUFFIX__';
import { isRole, type Role, type UserRecord } from '../domain/user__IMPORT_SUFFIX__';

/**
 * The private claim separating the two token types.
 *
 * Both tokens are signed with the same secret, so without this claim a refresh token is a
 * perfectly valid access token: it verifies, it has a `sub`, and every protected route would
 * accept it. That would defeat the point of short access-token lifetimes — the credential a
 * client holds for weeks and stores in a cookie would work as a bearer token everywhere. The
 * claim is checked on the way in, not just written on the way out.
 */
type TokenType = 'access' | 'refresh';

const HS256 = 'HS256';

/** Attached as `cause`, so the reason survives into logs without reaching a response body. */
function invalidToken(reason: string, cause?: unknown): InvalidTokenError {
  return new InvalidTokenError(reason, { cause });
}

function requireString(value: unknown, claim: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidToken(`Token has no usable "${claim}" claim.`);
  }
  return value;
}

function requireRole(value: unknown): Role {
  if (!isRole(value)) {
    // Fail closed. A role name this build does not know cannot be authorised correctly, and
    // defaulting it to `user` would silently change the caller's permissions. Rejecting the token
    // sends the client through the refresh flow, which re-reads the role from the user record and
    // issues an access token this build does understand.
    throw invalidToken('Token carries a role this service does not recognise.');
  }
  return value;
}

export interface TokenService {
  /**
   * Pass `family` to continue an existing refresh lineage during rotation; omit it for a fresh
   * login, which starts a new one.
   */
  issuePair(user: UserRecord, family?: string): IssuedTokens;
  verifyAccess(token: string): AccessTokenClaims;
  verifyRefresh(token: string): RefreshTokenClaims;
}

export function createTokenService(config: AuthConfig = authConfig): TokenService {
  /**
   * Built on first use, not here.
   *
   * `authConfig` is a lazily-resolving proxy so that importing any part of this module does not
   * demand a JWT_SECRET — a unit test for something unrelated, or a build step that imports the
   * router to enumerate routes, must not have to configure auth. Reading `config.issuer` in this
   * function body would resolve it immediately and throw at import time, which defeats the point
   * entirely and is easy to reintroduce, because it looks like ordinary hoisting.
   */
  let cachedVerifyOptions: VerifyOptions | undefined;

  function options(): VerifyOptions {
    cachedVerifyOptions ??= {
      // The most important line in this file. Left unset, `verify` accepts any algorithm the key
      // could plausibly be used with, and the header naming that algorithm is supplied by whoever
      // sent the token — the classic JWT failure, where a token arrives claiming a different `alg`
      // and is validated under rules the server never chose. One value, fixed here, is the defence.
      algorithms: [HS256],
      // Both of these make the corresponding claim *required*, not merely compared when present.
      // Skipping `audience` is the subtle one: any service sharing this secret — a sibling
      // deployment, a staging environment restored from the same secret store, an internal tool
      // that signs its own service tokens — could otherwise mint credentials that authenticate
      // here, because the signature really does check out.
      issuer: config.issuer,
      audience: config.audience,
    };

    return cachedVerifyOptions;
  }

  function verifyOfType(token: string, expected: TokenType): JwtPayload {
    let payload: JwtPayload | string;
    try {
      payload = jwt.verify(token, config.jwtSecret, options());
    } catch (error) {
      // One message for every failure mode. Telling a caller apart `TokenExpiredError` from
      // `JsonWebTokenError` from a claim mismatch tells someone forging tokens which part to fix
      // next; the distinction belongs in the log, via `cause`.
      throw invalidToken('Token is not valid.', error);
    }

    // `verify` returns a string when the token payload was signed as a plain string rather than an
    // object. This service only ever signs objects, so a string here means the token came from
    // somewhere else and nothing below can be trusted to exist.
    if (typeof payload === 'string') {
      throw invalidToken('Token payload is not an object.');
    }

    // Bracket notation for every private claim: they come through `JwtPayload`'s index signature,
    // and dot access on one is an error under `noPropertyAccessFromIndexSignature`.
    if (payload['tt'] !== expected) {
      throw invalidToken(`Expected a token of type "${expected}".`);
    }

    return payload;
  }

  return {
    issuePair(user: UserRecord, family?: string): IssuedTokens {
      // One clock reading for both tokens: `iat` then matches, and the two expiries are exactly
      // the configured TTLs apart. NumericDate is seconds since the epoch, not milliseconds.
      const issuedAt = Math.floor(Date.now() / 1000);
      const accessExpiry = issuedAt + config.accessTokenTtlSeconds;
      const refreshExpiry = issuedAt + config.refreshTokenTtlSeconds;
      const refreshJti = randomUUID();
      // A new lineage per login; an existing one is threaded through on rotation, which is what
      // lets reuse detection revoke every descendant of a replayed token instead of just that one.
      const tokenFamily = family ?? randomUUID();

      // `iat` and `exp` are set explicitly rather than via `expiresIn`, because both tokens have
      // to agree on the same instant. `expiresIn` is resolved from the clock at each call, so two
      // sequential calls would disagree by however long the first one took.
      const accessToken = jwt.sign(
        {
          tt: 'access',
          email: user.email,
          role: user.role,
          iat: issuedAt,
          exp: accessExpiry,
        },
        config.jwtSecret,
        {
          algorithm: HS256,
          issuer: config.issuer,
          audience: config.audience,
          subject: user.id,
          jwtid: randomUUID(),
        },
      );

      // No email and no role here on purpose. A refresh token is only ever exchanged for a new
      // pair, and that exchange reloads the user anyway, so putting authorisation data in the
      // long-lived credential would buy nothing and give it weeks in which to go stale.
      const refreshToken = jwt.sign(
        { tt: 'refresh', family: tokenFamily, iat: issuedAt, exp: refreshExpiry },
        config.jwtSecret,
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

    verifyAccess(token: string): AccessTokenClaims {
      const payload = verifyOfType(token, 'access');
      return {
        sub: requireString(payload.sub, 'sub'),
        email: requireString(payload['email'], 'email'),
        role: requireRole(payload['role']),
        jti: requireString(payload.jti, 'jti'),
      };
    },

    verifyRefresh(token: string): RefreshTokenClaims {
      const payload = verifyOfType(token, 'refresh');
      return {
        sub: requireString(payload.sub, 'sub'),
        jti: requireString(payload.jti, 'jti'),
        family: requireString(payload['family'], 'family'),
      };
    },
  };
}

/**
 * The shared instance.
 *
 * Safe to import from anywhere: `createTokenService` reads nothing from the configuration until a
 * token is actually issued or verified.
 */
export const tokenService: TokenService = createTokenService();
