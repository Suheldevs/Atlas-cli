import { capitalizeWords } from './capitalize-words__IMPORT_SUFFIX__';

/**
 * The one response envelope every successful route returns.
 *
 * `success` is derived from the status rather than passed in, so the two can never disagree — a
 * `200` that says `success: false` is the kind of thing a client learns not to trust.
 *
 * @param {number} statusCode
 * @param {string} [message]
 * @param {unknown} [data]
 * @param {unknown} [meta] Pagination or similar. Omitted from the body when absent.
 */
export function ApiResponse(statusCode, message = 'Success', data = null, meta = null) {
  return {
    statusCode,
    success: statusCode < 400,
    message: capitalizeWords(message),
    data,
    // Omitted rather than sent as null: pagination information that is not there should not look
    // like pagination information that is empty.
    ...(meta ? { meta } : {}),
    timestamp: new Date(),
  };
}

/** A plain object in the message position is the payload. Arrays are not: they are never messages. */
function isPayload(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Attaches `res.api` to every response.
 *
 * Mounted before the routes so that handlers never assemble the envelope by hand — the moment two
 * handlers spell it differently, clients start special-casing endpoints.
 *
 *   res.api(200, 'User created', user);        // full form
 *   res.api(200, { user });                    // shorthand: a plain object is the payload
 *   res.api(200, 'Users', users, { page: 1 }); // with meta
 */
export function responseMiddleware(_request, response, next) {
  response.api = (statusCode, message, data, meta) => {
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
