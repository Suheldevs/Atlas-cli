/**
 * The auth error middleware.
 *
 * One place maps a thrown error onto a status code and a body. Controllers throw and never catch,
 * which is what stops a stray `res.status(500).json({ error })` somewhere in the module from
 * leaking a stack trace or a database message.
 */
import type { NextFunction, Request, Response } from 'express';

import { isAuthError, ValidationError } from '../domain/auth-errors__IMPORT_SUFFIX__';

/** Field-level detail for a failed body validation. */
export interface FieldIssue {
  readonly path: string;
  readonly message: string;
}

export interface ErrorBody {
  /** Stable, machine-readable. Clients branch on this rather than on the message text. */
  readonly code: string;
  readonly message: string;
  readonly issues?: readonly FieldIssue[];
}

/**
 * Reported for anything unrecognised.
 *
 * Deliberately says nothing. Error messages are a reliable source of stack traces, table names,
 * file paths and library versions, and an attacker reads them far more carefully than a user does.
 */
const GENERIC_FAILURE: ErrorBody = {
  code: 'internal_error',
  message: 'Something went wrong.',
};

/**
 * Only the path and the rule that failed — never the submitted value.
 *
 * A validation error on a password field that echoed the input back would put the password into
 * the response body, and from there into browser devtools, proxy logs and error trackers.
 */
function toFieldIssues(error: ValidationError): readonly FieldIssue[] {
  return error.issues.map((issue) => ({ path: issue.field, message: issue.message }));
}

export function authErrorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Express cannot change a response whose headers are already sent; handing it back is the only
  // correct move, and it will close the connection.
  if (res.headersSent) {
    next(error);
    return;
  }

  // Checked before the generic branch below, not after. `ValidationError` is itself an `AuthError`,
  // so the order is what decides whether a client gets the per-field detail or just a bare 400.
  if (error instanceof ValidationError) {
    res.status(error.status).json({
      code: error.code,
      message: error.message,
      issues: toFieldIssues(error),
    });
    return;
  }

  if (isAuthError(error)) {
    res.status(error.status).json({ code: error.code, message: error.message });
    return;
  }

  // Logged server-side, where the detail belongs. Pairing this module with a structured logger
  // is better than `console.error` — this stays dependency-free so the template does not assume
  // one is installed.
  console.error('[auth] unhandled error', error);

  res.status(500).json(GENERIC_FAILURE);
}
