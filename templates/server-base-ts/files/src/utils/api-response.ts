import type { NextFunction, Request, Response } from 'express';

import { capitalizeWords } from './capitalize-words__IMPORT_SUFFIX__';

declare global {
  namespace Express {
    interface Response {
      /**
       * Sends an `ApiResponse` envelope with the given status.
       *
       * `res.api(200, 'User created', user)` is the full form. `res.api(200, { user })` is the
       * shorthand: a plain object in the message position is the payload, and the message
       * defaults to `'Success'`.
       */
      api(statusCode: number, message?: string, data?: unknown, meta?: unknown): void;
      api(statusCode: number, data: Record<string, unknown>, meta?: unknown): void;
    }
  }
}

export interface ApiResponseBody {
  readonly statusCode: number;
  readonly success: boolean;
  readonly message: string;
  readonly data: unknown;
  readonly meta?: unknown;
  readonly timestamp: Date;
}

/**
 * The one response envelope every successful route returns.
 *
 * `success` is derived from the status rather than passed in, so the two can never disagree —
 * a `200` that says `success: false` is the kind of thing a client learns not to trust.
 */
export function ApiResponse(
  statusCode: number,
  message = 'Success',
  data: unknown = null,
  meta: unknown = null,
): ApiResponseBody {
  const body: ApiResponseBody = {
    statusCode,
    success: statusCode < 400,
    message: capitalizeWords(message),
    data,
    timestamp: new Date(),
  };

  // `meta` is omitted rather than sent as null: pagination information that is not there should
  // not look like pagination information that is empty.
  return meta ? { ...body, meta } : body;
}

/** A plain object in the message position is the payload. Arrays are not: they are never messages. */
function isPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Attaches `res.api` to every response.
 *
 * Mounted before the routes so that handlers never assemble the envelope by hand — the moment
 * two handlers spell it differently, clients start special-casing endpoints.
 */
export function responseMiddleware(_request: Request, response: Response, next: NextFunction): void {
  response.api = (
    statusCode: number,
    message?: string | Record<string, unknown>,
    data?: unknown,
    meta?: unknown,
  ): void => {
    if (isPayload(message)) {
      // Shorthand form: the arguments shift along by one.
      response.status(statusCode).json(ApiResponse(statusCode, 'Success', message, data ?? null));
      return;
    }

    response
      .status(statusCode)
      .json(ApiResponse(statusCode, message ?? 'Success', data ?? null, meta ?? null));
  };

  next();
}
