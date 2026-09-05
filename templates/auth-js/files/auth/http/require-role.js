/**
 * Role authorisation middleware.
 *
 * Always mounted *after* `requireAuth` on the same route — it reads the context that middleware
 * attaches and never verifies a token itself:
 *
 *   router.delete('/users/:id', requireAuth, requireRole('admin'), handler);
 *
 * Reversing the two is not a style choice. `requireRole` alone would call `getAuth` on a request
 * nothing authenticated, which answers 401 where the route should answer 403 — and, worse, means the
 * route's protection depends on a middleware that was never asked to verify anything.
 */
import { ForbiddenError } from '../domain/auth-errors__IMPORT_SUFFIX__';

import { getAuth } from './require-auth__IMPORT_SUFFIX__';

/**
 * 401 and 403 are separate answers to separate questions, and collapsing them either way is a bug.
 *
 * 401 means "I do not know who you are, try again with a credential" — `getAuth` raises it, and a
 * client can act on it by refreshing or logging in. 403 means "I know exactly who you are and the
 * answer is still no" — retrying with a fresh token will not help, so a client that treats it as a
 * 401 loops forever.
 *
 * The direction that matters for security is the other one: answering 403 to a request that carried
 * no credential at all confirms the route exists and is guarded, which is a free existence oracle
 * for anyone mapping an API. An unauthenticated caller should learn only that they are
 * unauthenticated.
 *
 * @param {...import('../domain/user__IMPORT_SUFFIX__').Role} allowed
 * @returns {import('express').RequestHandler}
 */
export function requireRole(...allowed) {
  // Built once, when the route is declared, rather than per request.
  const allowedRoles = new Set(allowed);

  return (req, _res, next) => {
    const auth = getAuth(req);

    // `requireRole()` with no arguments denies everyone, which is the safe reading of an empty
    // policy: a guard that let every request through because somebody forgot to list a role would be
    // indistinguishable from no guard at all.
    if (!allowedRoles.has(auth.role)) {
      throw new ForbiddenError();
    }

    next();
  };
}
