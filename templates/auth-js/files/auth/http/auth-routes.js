/**
 * The auth router.
 *
 * Mount it at `/api/auth`:
 *
 *   app.use('/api/auth', createAuthRouter(authService));
 *
 * That path is not arbitrary. The refresh cookie is scoped to it (`REFRESH_COOKIE_PATH` in
 * `auth-controller.js`), so mounting the router somewhere else means the browser stores a cookie it
 * will never send back and refresh fails in a way that looks like a token bug.
 *
 * The router is self-contained on purpose: it mounts its own JSON body parser, cookie parser and
 * response helper rather than requiring the host application to have added them in the right order.
 * A router that silently misbehaves because the app forgot `cookieParser()` — refresh would simply
 * never find the cookie — is a worse trade than parsing twice, and all three are cheap no-ops when
 * the work has already been done upstream.
 *
 * There is deliberately no error middleware here. Errors thrown by these handlers are `ApiError`s
 * and belong to the application's global handler in `middleware/error-handler.js`, mounted after all
 * routes. A second, router-local handler would render auth failures in a different envelope from
 * every other failure in the application, which is the exact inconsistency the shared handler
 * exists to prevent.
 */
import cookieParser from 'cookie-parser';
import { json, Router } from 'express';

import { responseMiddleware } from '../../utils/api-response__IMPORT_SUFFIX__';

import { createAuthController } from './auth-controller__IMPORT_SUFFIX__';
import { requireAuth } from './require-auth__IMPORT_SUFFIX__';
import { requireRole } from './require-role__IMPORT_SUFFIX__';

/**
 * Bodies here are small and fixed — a name, an email and a password. Capping the size keeps a
 * multi-megabyte POST from reaching the password hasher, which is deliberately expensive and
 * therefore a denial-of-service amplifier.
 */
const MAX_BODY_BYTES = '16kb';

/**
 * @param {import('../services/auth-service__IMPORT_SUFFIX__').AuthService} service
 * @returns {import('express').Router}
 */
export function createAuthRouter(service) {
  const controller = createAuthController(service);
  const router = Router();

  router.use(json({ limit: MAX_BODY_BYTES }));
  router.use(cookieParser());

  // Guarantees `res.api` exists on these routes even if the application has not mounted the
  // response helper globally. Re-attaching it is harmless; a missing `res.api` would turn every
  // successful auth response into a TypeError rendered as a 500.
  router.use(responseMiddleware);

  // Express 5 forwards a rejected promise from a handler to the error middleware, so these need no
  // try/catch wrapper — the controllers throw and the global handler renders.
  router.post('/signup', controller.signup);
  router.post('/login', controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', requireAuth, controller.me);

  // Present to show the shape of a guarded route, and deliberately trivial: it reports the caller's
  // own role rather than doing admin work, so there is nothing here to delete carefully.
  //
  // Order matters and is not interchangeable. `requireAuth` must come first — `requireRole` reads
  // the context that middleware attaches and does not verify a token itself, so reversing them means
  // the role check runs against nothing and answers 401 where it should answer 403.
  router.get('/admin/ping', requireAuth, requireRole('admin'), controller.adminPing);

  return router;
}
