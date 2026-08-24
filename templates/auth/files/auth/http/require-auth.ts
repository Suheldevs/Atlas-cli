/**
 * Access-token authentication middleware.
 *
 * Mount it on any route that needs a caller identity. It verifies the signature, expiry, issuer and
 * audience of the bearer token through `tokenService` and attaches the claims to the request.
 *
 * Authorisation from here on is decided from the token alone — no database round trip. That is what
 * makes an authenticated request cheap, and the trade is real: a role removed, or a user disabled,
 * stays in force until the access token expires. It is why access-token lifetimes are measured in
 * minutes, and why revoking access *now* means revoking the refresh family (`logoutAll`) and
 * accepting that the current access token has a few minutes left to live. If you need
 * revoke-immediately semantics on a particular route, look the user up in that route.
 */
import type { NextFunction, Request, Response } from 'express';

import { UnauthenticatedError } from '../domain/auth-errors__IMPORT_SUFFIX__';
import type { AccessTokenClaims } from '../domain/tokens__IMPORT_SUFFIX__';
import { tokenService } from '../security/token-service__IMPORT_SUFFIX__';

/** The verified claims, plus `sub` under a name that reads like what it is. */
export interface AuthenticatedContext extends AccessTokenClaims {
  readonly userId: string;
}

/**
 * `declare global { namespace Express { ... } }` is self-declaring: it compiles with or without
 * `@types/express` present and merges with it when it is, so this file needs no configuration in
 * the host project to make `req.auth` visible to every handler.
 *
 * Optional, because the property is only there on routes that ran this middleware. A required
 * declaration would read better at call sites and be a lie on every unprotected route — see
 * `getAuth` for how the optionality is paid off exactly once instead of at each use.
 */
declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedContext;
    }
  }
}

/**
 * `Bearer`, one space, then a token containing no whitespace — and nothing else on the line.
 *
 * The scheme is matched case-insensitively because RFC 7235 defines it that way and real clients
 * send `bearer`. The rest is deliberately stricter than the RFC, which tolerates extra spaces and
 * trailing parameters: nothing legitimate sends them, and a permissive header parser is how one
 * component's idea of "the token" comes to differ from another's.
 */
const BEARER_HEADER = /^Bearer (\S+)$/i;

function readBearerToken(req: Request): string {
  const header = req.headers.authorization;

  // A missing or malformed header is not a rejected token — nothing was presented to reject. The
  // message stays vague about which of the two it was: a caller fixing their client learns nothing
  // from the difference, and an attacker probing header handling should learn nothing at all.
  if (typeof header !== 'string') {
    throw new UnauthenticatedError();
  }

  const token = BEARER_HEADER.exec(header)?.[1];
  if (token === undefined) {
    throw new UnauthenticatedError();
  }

  return token;
}

/**
 * Async, and it does not catch. Express 5 forwards a rejected promise from a middleware to the
 * error middleware, so an `InvalidTokenError` from `verifyAccess` — expired, wrong signature,
 * wrong audience — travels to `errorHandler` and renders as a 401 there. Catching it here to
 * `res.status(401)` would put the same decision in two places, and the two would drift.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const claims = await tokenService.verifyAccess(readBearerToken(req));

  req.auth = { ...claims, userId: claims.sub };

  next();
}

/**
 * Reads the auth context, or throws `UnauthenticatedError`.
 *
 * Downstream code wants `req.auth.userId` without a `!`, and a non-null assertion is exactly the
 * wrong tool: it compiles away, so a handler accidentally mounted without `requireAuth` would read
 * `undefined.userId` and crash with a 500 that says nothing. This throws the error the situation
 * actually is — 401, rendered like every other 401 — and it does so whether the cause is a missing
 * middleware or a missing credential.
 */
export function getAuth(req: Request): AuthenticatedContext {
  const auth = req.auth;
  if (auth === undefined) {
    throw new UnauthenticatedError();
  }

  return auth;
}
