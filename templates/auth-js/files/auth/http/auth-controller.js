/**
 * HTTP handlers for the auth endpoints.
 *
 * Three rules hold throughout this file.
 *
 * **Nothing here catches, and nothing here writes a failure.** A handler validates, calls the
 * service and writes a success response through `res.api`; every failure leaves as a thrown
 * `ApiError` and is rendered by the application's global error handler. Express 5 forwards both a
 * synchronous throw and a rejected promise there, so the absent `try/catch` is deliberate. Keeping
 * the error → status mapping in one place is what stops a `res.status(500).json({ error })`
 * appearing here six months from now and putting a driver message — collection names, a query, a
 * library version — into a response body.
 *
 * **Every success goes through `res.api(statusCode, message, data, meta)`**, so an auth response
 * carries the same `{ statusCode, success, message, data, timestamp }` envelope as every other route
 * in the application. The `data` payloads below are a contract the front end is written against;
 * they are listed on each handler and should not be changed casually.
 *
 * **The service arrives by injection.** `createAuthController` takes an auth service rather than
 * importing a singleton, so a test can drive these handlers against a fake with no database, and the
 * wiring stays visible in one place at startup.
 */
import { authConfig } from '../config/auth-config__IMPORT_SUFFIX__';
import {
  UnauthenticatedError,
  ValidationFailedError,
} from '../domain/auth-errors__IMPORT_SUFFIX__';

import { validateLogin, validateSignup } from './auth-validators__IMPORT_SUFFIX__';
import { getAuth } from './require-auth__IMPORT_SUFFIX__';

/**
 * The cookie is scoped to the path this router is mounted at, so the browser attaches the refresh
 * token to `/api/auth/*` and to nothing else. Every other request in the application — every API
 * call, every image, every third-party pixel on the same origin — is sent without it, which shrinks
 * both the number of places it can leak from (a proxy log, a crash reporter, an errant
 * `console.log` of request headers) and the surface any CSRF has to aim at.
 *
 * It has to agree with the mount path: `app.use('/api/auth', createAuthRouter(authService))`. Change
 * one and change the other, or the browser stores a cookie it will never send back. It must also
 * match on the way out — a `Set-Cookie` that clears a cookie is matched on name *and* path, so
 * clearing with the wrong path leaves the original in place, still valid.
 */
const REFRESH_COOKIE_PATH = '/api/auth';

/**
 * @typedef {import('../services/auth-service__IMPORT_SUFFIX__').AuthResult} AuthResult
 * @typedef {import('../services/auth-service__IMPORT_SUFFIX__').AuthService} AuthService
 */

/**
 * The refresh token goes in an `httpOnly` cookie and never into the response body.
 *
 * A token in the body is a token the client has to put somewhere, and in practice that somewhere is
 * `localStorage` — readable by any JavaScript that reaches the page. One reflected XSS, one
 * compromised npm dependency, one third-party script, and a long-lived credential walks out. An
 * `httpOnly` cookie is not readable by script at all: the same XSS can still *use* the session while
 * the page is open, but it cannot exfiltrate the token and keep the session after the tab closes.
 *
 * `secure` and `sameSite` are read from config rather than hardcoded, because both have to differ
 * between a plain-HTTP localhost and a cross-origin production deployment. See the notes on
 * `cookieSecure` and `cookieSameSite` in `config/auth-config.js` — in particular what `SameSite=None`
 * costs and what has to make up for it.
 *
 * @param {import('express').Response} res
 * @param {AuthResult} result
 * @returns {void}
 */
function setRefreshCookie(res, result) {
  res.cookie(authConfig.cookieName, result.tokens.refreshToken, {
    httpOnly: true,
    secure: authConfig.cookieSecure,
    sameSite: authConfig.cookieSameSite,
    path: REFRESH_COOKIE_PATH,
    // Expiry is set from the token's own lifetime, so a cookie the browser still holds always
    // carries a token the server would still accept.
    expires: result.tokens.refreshTokenExpiresAt,
  });
}

/**
 * Attributes must match `setRefreshCookie` or the browser keeps the cookie it already has.
 *
 * @param {import('express').Response} res
 * @returns {void}
 */
function clearRefreshCookie(res) {
  res.clearCookie(authConfig.cookieName, {
    httpOnly: true,
    secure: authConfig.cookieSecure,
    sameSite: authConfig.cookieSameSite,
    path: REFRESH_COOKIE_PATH,
  });
}

/**
 * `req.cookies` is populated by `cookie-parser`. It is read defensively so a missing cookie, a
 * cookie sent as an array, or a request that never went through the parser all produce the same
 * `undefined` rather than a surprise at a call site.
 *
 * @param {import('express').Request} req
 * @returns {string | undefined}
 */
function readRefreshCookie(req) {
  const cookies = req.cookies;

  if (typeof cookies !== 'object' || cookies === null) {
    return undefined;
  }

  const value = /** @type {Record<string, unknown>} */ (cookies)[authConfig.cookieName];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The cookie is the only accepted source. There is deliberately no fall back to `req.body`.
 *
 * A fallback would undo the cookie: a client that can put the refresh token in a JSON body is a
 * client that is holding it in script-reachable storage, and once both paths work the weaker one
 * sets the security level of the endpoint for everyone. It also removes the question of which token
 * to rotate when a request presents two different ones — a question with no good answer and a
 * genuine reuse-detection hazard, since rotating one while the other stays live is exactly the state
 * the family check exists to catch.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function requireRefreshToken(req) {
  const token = readRefreshCookie(req);

  if (token === undefined) {
    // No credential was presented, so this is a 401 for the same reason a missing `Authorization`
    // header is: there is nothing to declare invalid.
    throw new UnauthenticatedError();
  }

  return token;
}

/**
 * Turns a failed validation result into the thrown `ApiError` the global handler renders.
 *
 * This is the one conversion point between the two conventions: validators return results because a
 * malformed body is an expected outcome they must be able to accumulate, and the HTTP layer throws
 * because that is how every other failure in this application reaches the client. Doing it here
 * rather than in the validators keeps them free of Express and of the error type.
 *
 * @template T
 * @param {import('./validate__IMPORT_SUFFIX__').ValidationResult<T>} result
 * @returns {T}
 */
function valueOrThrow(result) {
  if (!result.ok) {
    throw new ValidationFailedError(result.errors);
  }

  return result.value;
}

/**
 * @typedef {object} AuthController
 * @property {import('express').RequestHandler} signup
 * @property {import('express').RequestHandler} login
 * @property {import('express').RequestHandler} refresh
 * @property {import('express').RequestHandler} logout
 * @property {import('express').RequestHandler} me
 * @property {import('express').RequestHandler} adminPing
 */

/**
 * @param {AuthService} service
 * @returns {AuthController}
 */
export function createAuthController(service) {
  return {
    /** `POST /api/auth/signup` → `data: { user, accessToken }` */
    signup: async (req, res) => {
      const input = valueOrThrow(validateSignup(req.body));
      const result = await service.signup(input);

      setRefreshCookie(res, result);

      // 201: the request created a user, and the resource it created is in the body.
      //
      // The access token is short-lived and returned in the body on purpose: the client has to read
      // it to build an `Authorization: Bearer` header, so it cannot be `httpOnly`. Keep it in memory
      // — a variable or a closure, not `localStorage`. Its blast radius is one token lifetime.
      //
      // The expiry rides in `meta`, not `data`, so a client can schedule a silent refresh without
      // decoding the token and without the documented `data` shape changing. ISO 8601, converted
      // explicitly rather than left as a `Date` for the serialiser to guess at.
      res.api(
        201,
        'Account created',
        { user: result.user, accessToken: result.tokens.accessToken },
        { accessTokenExpiresAt: result.tokens.accessTokenExpiresAt.toISOString() },
      );
    },

    /** `POST /api/auth/login` → `data: { user, accessToken }` */
    login: async (req, res) => {
      const input = valueOrThrow(validateLogin(req.body));
      const result = await service.login(input);

      setRefreshCookie(res, result);

      res.api(
        200,
        'Logged in',
        { user: result.user, accessToken: result.tokens.accessToken },
        { accessTokenExpiresAt: result.tokens.accessTokenExpiresAt.toISOString() },
      );
    },

    /** `POST /api/auth/refresh` → `data: { accessToken }` */
    refresh: async (req, res) => {
      const result = await service.refresh(requireRefreshToken(req));

      // Rotation: the service issued a new refresh token and retired the one presented, so the
      // cookie is overwritten on every refresh. A client that keeps replaying the old value is
      // either broken or an attacker holding a stolen copy, and reuse detection treats it as the
      // latter — it revokes the whole family.
      setRefreshCookie(res, result);

      res.api(200, 'Token refreshed', { accessToken: result.tokens.accessToken }, {
        accessTokenExpiresAt: result.tokens.accessTokenExpiresAt.toISOString(),
      });
    },

    /** `POST /api/auth/logout` → `data: null` */
    logout: async (req, res) => {
      const token = readRefreshCookie(req);

      // Clearing the cookie is not logging out. `Set-Cookie` is a request to a client that may
      // ignore it, and it does nothing at all to the token itself: anyone holding a copy — the
      // script that stole it, the proxy that logged it — can keep refreshing with it until it
      // expires. The server-side revocation below is the logout; the cookie clear is housekeeping.
      //
      // Revoke first. If the store is unreachable the request fails and the client keeps a cookie
      // whose token is still valid, which is true and retryable. Clearing first and then failing
      // would leave the user believing they were logged out while the credential lived on — the one
      // outcome worth engineering the order around.
      if (token !== undefined) {
        await service.logout(token);
      }

      clearRefreshCookie(res);

      // 200 with a null payload rather than 204, so the response carries the same envelope as every
      // other endpoint. Answered the same way whether or not a token was presented: logout is
      // idempotent, and a 401 to a caller who has already lost the cookie leaves them no way to
      // reach a clean state.
      res.api(200, 'Logged out', null);
    },

    /** `GET /api/auth/me` → `data: { user }` */
    me: (req, res) => {
      // No database hit — this is the verified token's own view of the user, which is the same view
      // every authorisation decision on the request is already made from. It follows that a change
      // made in the last few minutes (a role granted, a name corrected) shows up only after the
      // access token expires. Read from the repository here instead if you need it fresher.
      const auth = getAuth(req);

      res.api(200, 'Current user', {
        user: { id: auth.userId, name: auth.name, email: auth.email, role: auth.role },
      });
    },

    /** `GET /api/auth/admin/ping` — the worked example of a role-guarded route. */
    adminPing: (req, res) => {
      // Reached only when `requireRole('admin')` let the request through, so there is no second role
      // check here. Re-checking would suggest the middleware is not trusted, and the two copies
      // would eventually disagree.
      const auth = getAuth(req);

      res.api(200, 'Admin access confirmed', { role: auth.role });
    },
  };
}
