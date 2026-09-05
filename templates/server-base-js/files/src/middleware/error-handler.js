import { config } from '../config/env__IMPORT_SUFFIX__';
import ApiError from '../utils/api-error__IMPORT_SUFFIX__';

/** MongoDB's unique-index violation. */
const DUPLICATE_KEY_CODE = 11_000;

function asRecord(value) {
  return typeof value === 'object' && value !== null ? value : undefined;
}

function stringAt(record, key) {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function stackOf(error) {
  return error instanceof Error ? (error.stack ?? '') : '';
}

/** One message per failing path of a Mongoose ValidationError, in the order Mongoose reports them. */
function validationMessages(errors) {
  const record = asRecord(errors);
  if (record === undefined) return [];

  return Object.values(record)
    .map((entry) => {
      const detail = asRecord(entry);
      return detail === undefined ? undefined : stringAt(detail, 'message');
    })
    .filter((message) => message !== undefined);
}

/**
 * Turns anything thrown into an `ApiError`.
 *
 * The failures below are the ones a Mongoose + JWT stack produces constantly and that would
 * otherwise all surface as an opaque 500: a malformed `:id` is the client's mistake, not the
 * server's, and a client that cannot tell those apart cannot retry correctly. Everything else
 * becomes a 500 whose message is written here rather than taken from the throwable — an internal
 * message is exactly the kind of thing that leaks a query, a path or a hostname.
 */
function toApiError(error) {
  if (error instanceof ApiError) return error;

  const stack = stackOf(error);
  const record = asRecord(error);

  if (record !== undefined) {
    const name = stringAt(record, 'name');

    // Mongoose could not cast a value to the schema's type — usually a malformed id in the URL.
    if (name === 'CastError') {
      return new ApiError(400, `invalid ${stringAt(record, 'path') ?? 'value'}`, [], stack);
    }

    if (name === 'ValidationError') {
      return new ApiError(400, 'validation failed', validationMessages(record.errors), stack);
    }

    if (record.code === DUPLICATE_KEY_CODE) {
      const field = Object.keys(asRecord(record.keyValue) ?? {})[0] ?? 'field';
      return new ApiError(409, `${field} already exists`, [`${field} must be unique`], stack);
    }

    if (name === 'TokenExpiredError') {
      return new ApiError(401, 'session expired, please sign in again', [], stack);
    }

    if (name === 'JsonWebTokenError') {
      return new ApiError(401, 'invalid authentication token', [], stack);
    }
  }

  return new ApiError(500, 'something went wrong', [], stack);
}

/**
 * The last middleware in the chain, and the only place a failure becomes a response.
 *
 * The body is the same envelope `ApiResponse` produces for a success, so a client parses one
 * shape for every request it ever makes. The four-argument signature is what marks this as an
 * error handler to Express — `_next` is unused but must be declared.
 */
export const errorHandler = (error, request, response, _next) => {
  const apiError = toApiError(error);

  // A 5xx is a defect by definition, so the original throwable is logged in full — that trace is
  // the only record of what actually happened once the client has been handed a generic message.
  if (apiError.statusCode >= 500) {
    console.error(`${request.method} ${request.originalUrl} -> ${apiError.statusCode}`, error);
  }

  // Streaming responses and early writes leave nothing to send; overwriting would throw.
  if (response.headersSent) return;

  const body = {
    success: false,
    statusCode: apiError.statusCode,
    message: apiError.message,
    errors: apiError.errors ?? [],
    timestamp: new Date(),
  };

  // Stacks name internal paths and dependency versions. They never leave a production process.
  if (!config.isProduction) {
    body.stack = apiError.stack;
  }

  response.status(apiError.statusCode).json(body);
};
