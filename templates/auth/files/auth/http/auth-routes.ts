/**
 * The auth router.
 *
 * Self-contained on purpose: it mounts its own JSON and cookie parsers rather than requiring the
 * host application to add them. A router that silently misbehaves because the app forgot
 * `cookieParser()` — refresh would simply never find the cookie — is a worse trade than parsing
 * twice, and Express's parsers are no-ops when a body or cookies are already parsed.
 */
import cookieParser from 'cookie-parser';
import { json, Router } from 'express';

import type { AuthService } from '../services/auth-service__IMPORT_SUFFIX__';

import { createAuthController } from './auth-controller__IMPORT_SUFFIX__';
import { requireAuth } from './require-auth__IMPORT_SUFFIX__';
import { requireRole } from './require-role__IMPORT_SUFFIX__';

/**
 * Bodies here are small and fixed — an email and a password. Capping the size keeps a
 * multi-megabyte POST from reaching the password hasher, which is deliberately expensive and
 * therefore a denial-of-service amplifier.
 */
const MAX_BODY_BYTES = '16kb';

export function createAuthRouter(service: AuthService): Router {
  const controller = createAuthController(service);
  const router = Router();

  router.use(json({ limit: MAX_BODY_BYTES }));
  router.use(cookieParser());

  // Express 5 forwards a rejected promise from a handler to the error middleware, so these need
  // no try/catch wrapper — the controllers throw and `authErrorHandler` renders.
  router.post('/signup', controller.signup);
  router.post('/login', controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', requireAuth, controller.me);

  // Present to show the shape of a guarded route, and deliberately trivial: it reports the caller's
  // own role rather than doing admin work, so there is nothing here to delete carefully.
  //
  // Order matters and is not interchangeable. `requireAuth` must come first — `requireRole` reads
  // the context that middleware attaches and does not verify a token itself, so reversing them
  // means the role check runs against nothing and answers 401 where it should answer 403.
  router.get('/admin/ping', requireAuth, requireRole('admin'), controller.adminPing);

  return router;
}
