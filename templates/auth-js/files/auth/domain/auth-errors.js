/**
 * The auth module's errors.
 *
 * Every one of these is an *expected* outcome — a wrong password, a replayed token, a missing
 * header — and every one of them is an `ApiError`, the project-wide error type. They are thin
 * subclasses, not a parallel hierarchy: the status code and the message are all they add, so the
 * global error handler in `middleware/error-handler.js` renders them exactly as it renders an
 * `ApiError` thrown anywhere else in the application, and the envelope a client sees is the same
 * one every other route produces.
 *
 * Anything reaching that handler which is *not* an `ApiError` is a bug, and is deliberately
 * rendered as a bare 500 with no detail.
 *
 * Two conventions hold throughout:
 *
 * - The message is the whole public story. Nothing here interpolates an email address, a user id,
 *   a database message or a token — those reach logs through `cause`, never a response body.
 * - `code` is for logs, not for the wire. Several of these render as an identical 401 with an
 *   identical message on purpose (see `InvalidCredentialsError`), and `code` is what lets an
 *   operator tell them apart afterwards without the response telling an attacker.
 */
import ApiError from '../../utils/api-error__IMPORT_SUFFIX__';

/**
 * Attaches the log-only fields every auth error carries.
 *
 * `cause` is assigned rather than passed to `super`, because `ApiError` takes
 * `(statusCode, message, errors, stack)` and has no `cause` parameter. Assigning it afterwards
 * still gets it printed by `console.error` and by every structured logger, which is the point:
 * the reason survives into the log while the response body stays generic.
 *
 * @param {ApiError} error
 * @param {string} code
 * @param {{ cause?: unknown } | undefined} options
 * @returns {void}
 */
function describe(error, code, options) {
  Object.defineProperty(error, 'code', { value: code, enumerable: false, writable: false });

  if (options?.cause !== undefined) {
    error.cause = options.cause;
  }
}

/**
 * Wrong password, unknown email — deliberately indistinguishable.
 *
 * The message is fixed. Telling a caller "no such user" turns the login endpoint into an account
 * enumeration oracle: an attacker learns which addresses are registered by watching which ones come
 * back differently, which is exactly the list they want before a credential-stuffing run. The real
 * reason belongs in `cause`, which stays server-side.
 */
export class InvalidCredentialsError extends ApiError {
  /** @param {{ cause?: unknown }} [options] */
  constructor(options) {
    super(401, 'Invalid email or password');
    describe(this, 'invalid_credentials', options);
  }
}

export class EmailAlreadyRegisteredError extends ApiError {
  /** @param {{ cause?: unknown }} [options] */
  constructor(options) {
    super(409, 'That email address is already registered');
    describe(this, 'email_already_registered', options);
  }
}

export class InvalidTokenError extends ApiError {
  /**
   * @param {string} [message]
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message = 'The token is invalid or has expired', options) {
    super(401, message);
    describe(this, 'invalid_token', options);
  }
}

/**
 * A refresh token was presented after it had already been rotated.
 *
 * Distinct from `InvalidTokenError` because the response to it is different: the whole token family
 * is revoked. See `refresh` in the auth service for the reasoning. The client cannot tell the two
 * apart from the status code, and should not be able to.
 */
export class TokenReusedError extends ApiError {
  /** @param {{ cause?: unknown }} [options] */
  constructor(options) {
    super(401, 'This session has been ended for security reasons. Please sign in again');
    describe(this, 'token_reused', options);
  }
}

export class UnauthenticatedError extends ApiError {
  /**
   * @param {string} [message]
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message = 'Authentication is required', options) {
    super(401, message);
    describe(this, 'unauthenticated', options);
  }
}

/** Authenticated, but not permitted. 403 rather than 401 — the credential was fine. */
export class ForbiddenError extends ApiError {
  /**
   * @param {string} [message]
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message = 'You do not have access to this resource', options) {
    super(403, message);
    describe(this, 'forbidden', options);
  }
}

export class WeakPasswordError extends ApiError {
  /**
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(message, options) {
    super(400, message);
    describe(this, 'weak_password', options);
  }
}

/**
 * The request body was not the shape this endpoint accepts.
 *
 * Carries every issue rather than the first one, in `ApiError`'s `errors` array — a client fixing a
 * form one field per round trip is a worse experience than seeing all four problems at once, and
 * the validators collect them anyway.
 *
 * Only the field path and the rule that failed ever go in. Never the submitted value: a validation
 * error on a password field that echoed the input back would put the password into the response
 * body, and from there into browser devtools, proxy logs and error trackers.
 */
export class ValidationFailedError extends ApiError {
  /**
   * @param {readonly { field: string, message: string }[]} issues
   * @param {{ cause?: unknown }} [options]
   */
  constructor(issues, options) {
    super(
      400,
      'Validation failed',
      issues.map((issue) => ({ field: issue.field, message: issue.message })),
    );
    describe(this, 'validation_failed', options);
  }
}

/**
 * True for anything this module (or the rest of the application) threw deliberately.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isApiError(value) {
  return value instanceof ApiError;
}
