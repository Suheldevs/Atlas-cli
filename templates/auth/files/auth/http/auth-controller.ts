/**
 * HTTP handlers for the auth endpoints.
 *
 * Two rules hold throughout this file.
 *
 * Nothing here catches. A handler validates, calls the service and writes a success response; every
 * failure leaves as a thrown error and is rendered by `errorHandler`. Express 5 forwards both a
 * synchronous throw and a rejected promise there, so the `try/catch` is not omitted by oversight.
 * Keeping the error → status mapping in one module is what stops a `res.status(500).json({ error })`
 * appearing in a handler six months from now and putting a driver message — table names, SQL, a
 * library version — into a response body.
 *
 * And the service arrives by injection. `createAuthController` takes an `AuthService` rather than
 * importing a singleton, so a test can drive these handlers against a fake without a database, and
 * so the wiring stays visible in one place at startup.
 */
import type { Request, Response } from 'express';

import { authConfig } from '../config/auth-config__IMPORT_SUFFIX__';
import { UnauthenticatedError } from '../domain/auth-errors__IMPORT_SUFFIX__';
import type { PublicUser } from '../domain/user__IMPORT_SUFFIX__';
import type { AuthResult, AuthService } from '../services/auth-service__IMPORT_SUFFIX__';

import { validateLogin, validateSignup } from './auth-validators__IMPORT_SUFFIX__';
import { getAuth } from './require-auth__IMPORT_SUFFIX__';

/**
 * The cookie is scoped to the path this router is mounted at, so the browser attaches the refresh
 * token to `/auth/*` and to nothing else. Every other request in the application — every API call,
 * every image, every third-party pixel on the same origin — is sent without it, which shrinks both
 * the number of places it can leak from (a proxy log, a crash reporter, an errant `console.log` of
 * request headers) and the surface any CSRF has to aim at.
 *
 * It has to agree with the mount path: `app.use('/auth', createAuthRouter(service))`. Change one and
 * change the other, or the browser stores a cookie it will never send back. It must also match on
 * the way out — a `Set-Cookie` that clears a cookie is matched on name *and* path, so clearing with
 * the wrong path leaves the original in place, still valid.
 */
const REFRESH_COOKIE_PATH = '/auth';

/** What a successful signup, login or refresh puts in the response body. */
export interface AuthSuccessBody {
  readonly user: PublicUser;
  /**
   * Short-lived, and returned in the body on purpose: the client needs to read it to build an
   * `Authorization: Bearer` header, so it cannot be `httpOnly`. Keep it in memory — a JavaScript
   * variable or a closure, not `localStorage`. Its blast radius is one access-token lifetime.
   */
  readonly accessToken: string;
  /**
   * ISO 8601, converted explicitly rather than left as a `Date` for `res.json` to serialise. The
   * wire format is then stated in the type instead of being a property of whichever serialiser
   * happens to run, and a client can schedule its silent refresh without decoding the token.
   */
  readonly accessTokenExpiresAt: string;
}

/** What `GET /me` returns. */
export interface MeBody {
  readonly user: PublicUser;
}

export interface AuthController {
  readonly signup: (req: Request, res: Response) => Promise<void>;
  readonly login: (req: Request, res: Response) => Promise<void>;
  readonly refresh: (req: Request, res: Response) => Promise<void>;
  readonly logout: (req: Request, res: Response) => Promise<void>;
  readonly me: (req: Request, res: Response) => void;
  readonly adminPing: (req: Request, res: Response) => void;
}

function successBody(result: AuthResult): AuthSuccessBody {
  return {
    user: result.user,
    accessToken: result.tokens.accessToken,
    accessTokenExpiresAt: result.tokens.accessTokenExpiresAt.toISOString(),
  };
}

/**
 * The refresh token goes in an `httpOnly` cookie and never into the response body.
 *
 * A token in the body is a token the client has to put somewhere, and in practice that somewhere is
 * `localStorage` — which is readable by any JavaScript that reaches the page. One reflected XSS, one
 * compromised npm dependency, one third-party script, and a long-lived credential walks out. An
 * `httpOnly` cookie is not readable by script at all: the same XSS can still *use* the session while
 * the page is open, but it cannot exfiltrate a token and keep the session after the tab closes.
 *
 * `sameSite: 'strict'` is what makes the cookie safe to send automatically. Because the browser
 * attaches it without being asked, a cross-site page could otherwise trigger a rotation; `strict`
 * means the cookie is withheld on any request that did not originate from this site.
 *
 * `secure` comes from config rather than being hardcoded so a plain-HTTP `localhost` still works in
 * development. It must be `true` everywhere else — a refresh token sent over HTTP is a refresh token
 * given to anyone on the network path.
 */
function setRefreshCookie(res: Response, result: AuthResult): void {
  res.cookie(authConfig.cookieName, result.tokens.refreshToken, {
    httpOnly: true,
    secure: authConfig.cookieSecure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    // Expiry is set from the token's own lifetime, so a cookie the browser still holds always
    // carries a token the server would still accept.
    expires: result.tokens.refreshTokenExpiresAt,
  });
}

/** Attributes must match `setRefreshCookie` or the browser keeps the cookie it already has. */
function clearRefreshCookie(res: Response): void {
  res.clearCookie(authConfig.cookieName, {
    httpOnly: true,
    secure: authConfig.cookieSecure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
}

/**
 * `req.cookies` is populated by `cookie-parser`, which types it loosely; it is read as `unknown` and
 * narrowed here so a missing cookie, a cookie sent as an array, or a request that never went through
 * the parser all produce the same `undefined` rather than a surprise at a call site.
 */
function readRefreshCookie(req: Request): string | undefined {
  const cookies: unknown = req.cookies;
  if (typeof cookies !== 'object' || cookies === null) {
    return undefined;
  }

  const value: unknown = (cookies as Record<string, unknown>)[authConfig.cookieName];
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
 * The usual argument for the fallback is a native or CLI client that has no cookie jar. Those
 * clients are better served by their own endpoint with its own credential type than by widening this
 * one, and most HTTP stacks outside the browser can hold a cookie anyway.
 */
function requireRefreshToken(req: Request): string {
  const token = readRefreshCookie(req);
  if (token === undefined) {
    // No credential was presented, so this is a 401 for the same reason a missing `Authorization`
    // header is: there is nothing to declare invalid.
    throw new UnauthenticatedError();
  }

  return token;
}

export function createAuthController(service: AuthService): AuthController {
  return {
    signup: async (req, res): Promise<void> => {
      const input = validateSignup(req.body);
      const result = await service.signup(input);

      setRefreshCookie(res, result);
      // 201: the request created a user, and the resource it created is in the body.
      res.status(201).json(successBody(result));
    },

    login: async (req, res): Promise<void> => {
      const input = validateLogin(req.body);
      const result = await service.login(input);

      setRefreshCookie(res, result);
      res.status(200).json(successBody(result));
    },

    refresh: async (req, res): Promise<void> => {
      const result = await service.refresh(requireRefreshToken(req));

      // Rotation: the service issued a new refresh token and retired the one presented, so the
      // cookie is overwritten on every refresh. A client that keeps replaying the old value is
      // either broken or an attacker holding a stolen copy, and reuse detection treats it as the
      // latter — it revokes the whole family.
      setRefreshCookie(res, result);
      res.status(200).json(successBody(result));
    },

    logout: async (req, res): Promise<void> => {
      const token = readRefreshCookie(req);

      // Clearing the cookie is not logging out. `Set-Cookie` is a request to a client that may
      // ignore it, and it does nothing at all to the token itself: anyone holding a copy — the
      // script that stole it, the proxy that logged it — can keep refreshing with it until it
      // expires. The server-side revocation below is the logout; the cookie clear is housekeeping.
      //
      // Revoke first. If the store is unreachable the request fails with a 500 and the client keeps
      // a cookie whose token is still valid, which is true and retryable. Clearing first and then
      // failing would leave the user believing they were logged out while the credential lived on —
      // the one outcome worth engineering the order around.
      if (token !== undefined) {
        await service.logout(token);
      }

      clearRefreshCookie(res);

      // 204 whether or not a token was presented: logout is idempotent, and answering 401 to a
      // caller who has already lost the cookie leaves them no way to reach a clean state.
      res.status(204).end();
    },

    me: (req, res): void => {
      // No database hit — this is the verified token's own view of the user, which is the same view
      // every authorisation decision on the request is already made from. It follows that a change
      // made in the last few minutes (a role granted, an email corrected) shows up only after the
      // access token expires. Read it from the database instead if you need it fresher than that.
      const auth = getAuth(req);
      const body: MeBody = {
        user: { id: auth.userId, email: auth.email, role: auth.role },
      };

      res.status(200).json(body);
    },

    adminPing: (req, res): void => {
      // Reached only when `requireRole('admin')` let the request through, so there is no second
      // role check here. Re-checking would suggest the middleware is not trusted, and the two
      // copies would eventually disagree.
      const auth = getAuth(req);

      res.status(200).json({ ok: true, role: auth.role });
    },
  };
}
