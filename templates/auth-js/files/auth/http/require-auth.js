/**
 * Access-token authentication middleware.
 *
 * Mount it on any route that needs a caller identity. It verifies the signature, expiry, issuer and
 * audience of the bearer token through `tokenService` and attaches the claims to the request as
 * `req.auth`.
 *
 * Authorisation from here on is decided from the token alone — no database round trip. That is what
 * makes an authenticated request cheap, and the trade is real: a role removed, or a user disabled,
 * stays in force until the access token expires. It is why access-token lifetimes are measured in
 * minutes, and why revoking access *now* means revoking the refresh family (`logoutAll`) and
 * accepting that the current access token has a few minutes left to live. If a particular route
 * needs revoke-immediately semantics, look the user up in that route.
 */
import { UnauthenticatedError } from '../domain/auth-errors__IMPORT_SUFFIX__';
import { tokenService } from '../security/token-service__IMPORT_SUFFIX__';

/**
 * The verified claims, plus `sub` under a name that reads like what it is.
 *
 * @typedef {import('../domain/tokens__IMPORT_SUFFIX__').AccessTokenClaims & { userId: string }} AuthenticatedContext
 */

/**
 * A request that may carry an auth context.
 *
 * The property is *optional*, and that is the honest shape: it is only there on routes that ran
 * `requireAuth`. Declaring it as always present would read better at call sites and be a lie on
 * every unprotected route — `getAuth` below is where the optionality is paid off exactly once
 * instead of at each use.
 *
 * @typedef {import('express').Request & { auth?: AuthenticatedContext }} AuthenticatedRequest
 */

/**
 * `Bearer`, one space, then a token containing no whitespace — and nothing else on the line.
 *
 * The scheme is matched case-insensitively because RFC 7235 defines it that way and real clients
 * send `bearer`. The rest is deliberately stricter than the RFC, which tolerates extra spaces and
 * trailing parameters: nothing legitimate sends them, and a permissive header parser is how one
 * component's idea of "the token" comes to differ from another's.
 */
const BEARER_HEADER = /^Bearer (\S+)$/iu;

/**
 * @param {import('express').Request} req
 * @returns {string}
 */
function readBearerToken(req) {
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
 * It does not catch. Express forwards a synchronous throw from a middleware to the error middleware,
 * so an `InvalidTokenError` from `verifyAccess` — expired, wrong signature, wrong audience — travels
 * to the global error handler and renders as a 401 there. Catching it here to write a 401 by hand
 * would put the same decision in two places, and the two would drift.
 *
 * @param {AuthenticatedRequest} req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 * @returns {void}
 */
export function requireAuth(req, _res, next) {
  const claims = tokenService.verifyAccess(readBearerToken(req));

  // Assigned as one frozen object rather than field by field, so nothing downstream can quietly
  // upgrade a request by writing `req.auth.role = 'admin'`.
  req.auth = Object.freeze({ ...claims, userId: claims.sub });

  next();
}

/**
 * Reads the auth context, or throws `UnauthenticatedError`.
 *
 * Downstream code wants `req.auth.userId` without a guard on every use, and reading the property
 * directly is exactly the wrong shortcut: a handler accidentally mounted without `requireAuth` would
 * read `undefined.userId` and crash with a 500 that says nothing. This throws the error the
 * situation actually is — a 401, rendered like every other 401 — whether the cause is a missing
 * middleware or a missing credential.
 *
 * @param {AuthenticatedRequest} req
 * @returns {AuthenticatedContext}
 */
export function getAuth(req) {
  const auth = req.auth;

  if (auth === undefined) {
    throw new UnauthenticatedError();
  }

  return auth;
}
