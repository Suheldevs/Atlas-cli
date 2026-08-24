/**
 * The auth module's error hierarchy.
 *
 * Every one of these is an *expected* outcome — a wrong password, a replayed token, a missing
 * header. They carry the status and a stable machine-readable code so the error middleware can
 * render them without a lookup table, and so a client can branch without matching on prose.
 *
 * Anything not in this file reaching the middleware is a bug, and is deliberately rendered as a
 * bare 500 with no detail.
 */

export abstract class AuthError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });

    // `new.target` rather than a literal, so each subclass reports its own name.
    this.name = new.target.name;

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target);
    }
  }
}

/**
 * Wrong password, unknown email — deliberately indistinguishable.
 *
 * The message is fixed. Telling a caller "no such user" turns the login endpoint into an account
 * enumeration oracle: an attacker learns which addresses are registered by watching which ones
 * come back differently, which is exactly the list they want before a credential-stuffing run.
 * The real reason belongs in `cause`, which stays server-side.
 */
export class InvalidCredentialsError extends AuthError {
  readonly status = 401;
  readonly code = 'invalid_credentials';

  constructor(options?: { readonly cause?: unknown }) {
    super('Invalid email or password.', options);
  }
}

export class EmailAlreadyRegisteredError extends AuthError {
  readonly status = 409;
  readonly code = 'email_already_registered';

  constructor(options?: { readonly cause?: unknown }) {
    super('That email address is already registered.', options);
  }
}

export class InvalidTokenError extends AuthError {
  readonly status = 401;
  readonly code = 'invalid_token';

  constructor(message = 'The token is invalid or has expired.', options?: { readonly cause?: unknown }) {
    super(message, options);
  }
}

/**
 * A refresh token was presented after it had already been rotated.
 *
 * Distinct from `InvalidTokenError` because the response to it is different: the whole token
 * family is revoked. See `refresh` in the auth service for the reasoning.
 */
export class TokenReusedError extends AuthError {
  readonly status = 401;
  readonly code = 'token_reused';

  constructor(options?: { readonly cause?: unknown }) {
    super('This session has been ended for security reasons. Please sign in again.', options);
  }
}

export class UnauthenticatedError extends AuthError {
  readonly status = 401;
  readonly code = 'unauthenticated';

  constructor(message = 'Authentication is required.', options?: { readonly cause?: unknown }) {
    super(message, options);
  }
}

/** Authenticated, but not permitted. 403 rather than 401 — the credential was fine. */
export class ForbiddenError extends AuthError {
  readonly status = 403;
  readonly code = 'forbidden';

  constructor(message = 'You do not have access to this resource.', options?: { readonly cause?: unknown }) {
    super(message, options);
  }
}

export class WeakPasswordError extends AuthError {
  readonly status = 400;
  readonly code = 'weak_password';

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
  }
}

/** One thing wrong with one field. `field` is the request-body key, so a form can map it back. */
export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

/**
 * The request body was not the shape this endpoint accepts.
 *
 * Carries every issue rather than the first one. A client fixing a form one field per round trip is
 * a worse experience than seeing all four problems at once, and the validators collect them anyway.
 */
export class ValidationError extends AuthError {
  readonly status = 400;
  readonly code = 'validation_failed';
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[], options?: { readonly cause?: unknown }) {
    super('The request body is invalid.', options);
    this.issues = issues;
  }
}

export function isAuthError(value: unknown): value is AuthError {
  return value instanceof AuthError;
}
