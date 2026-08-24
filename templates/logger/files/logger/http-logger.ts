/**
 * HTTP request logging.
 *
 * Typed structurally rather than against Express: this file declares the small shape of the
 * request and response it actually touches, and Express's own `Request`/`Response` satisfy it by
 * structure. Nothing here imports `express`.
 *
 * That is deliberate. A logger has no business adding a web framework to a project's
 * dependencies, and `template.json` declares only `winston` — so importing Express types here
 * would generate code that does not compile in any project that happens not to have them.
 */
import { randomUUID } from 'node:crypto';

import type { Logger } from 'winston';

import { logger } from './logger__IMPORT_SUFFIX__';

/**
 * Makes `request.id` and `request.log` visible to route handlers typed against Express.
 *
 * `declare global { namespace Express { ... } }` is self-declaring: it compiles whether or not
 * `@types/express` is installed, and merges with it when it is.
 *
 * Both are declared required rather than optional because the middleware assigns them before any
 * route runs. That is a contract about where it is mounted: install `httpLogger` ahead of your
 * routers, or this type is lying to every handler that reads it.
 */
declare global {
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
    }
  }
}

/** The part of an inbound request this middleware reads. */
export interface LoggableRequest {
  readonly method: string;
  /** The URL as received, before any router rewrote it. Includes the query string. */
  readonly originalUrl: string;
  /** Node's `IncomingHttpHeaders`: a header sent twice arrives as an array. */
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  id?: string;
  log?: Logger;
}

/** The part of a response this middleware touches. */
export interface LoggableResponse {
  readonly statusCode: number;
  setHeader(name: string, value: string): unknown;
  /** Only the one event this middleware listens for. */
  on(event: 'finish', listener: () => void): unknown;
}

export type HttpLoggerMiddleware = (
  request: LoggableRequest,
  response: LoggableResponse,
  next: () => void,
) => void;

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * An inbound request id is caller-controlled, so it is trusted only if it looks like an id. A
 * value containing a newline would let a caller forge whole log lines in the development
 * formatter, and an unbounded one would inflate every record belonging to that request.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function firstHeader(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined || typeof value === 'string') {
    return value;
  }
  // A proxy that adds `x-request-id` to a request that already carried one produces an array.
  return value[0];
}

function resolveRequestId(request: LoggableRequest): string {
  const candidate = firstHeader(request.headers[REQUEST_ID_HEADER]);
  return candidate !== undefined && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

function levelFor(statusCode: number): 'error' | 'warn' | 'info' {
  if (statusCode >= 500) {
    return 'error';
  }
  if (statusCode >= 400) {
    return 'warn';
  }
  return 'info';
}

/**
 * Path only. Query strings routinely carry credentials — `?access_token=`, `?signature=`,
 * password-reset tokens — and a URL is the one field nobody thinks of as sensitive.
 */
function pathOf(request: LoggableRequest): string {
  const [path] = request.originalUrl.split('?');
  return path ?? request.originalUrl;
}

export function httpLogger(): HttpLoggerMiddleware {
  return (request, response, next): void => {
    // Monotonic, unlike `Date.now()`: an NTP correction mid-request cannot produce a negative
    // duration or a wildly wrong one.
    const startedAt = process.hrtime.bigint();
    const requestId = resolveRequestId(request);

    // Held in a local as well as on the request. The `finish` listener below uses the local, so
    // it cannot be defeated by later middleware reassigning the property.
    const requestLog = logger.child({ requestId });

    request.id = requestId;
    request.log = requestLog;
    // Echoed back so a caller — or a browser's network tab — can quote the id in a bug report.
    response.setHeader(REQUEST_ID_HEADER, requestId);

    // `finish` is the first moment at which the status code and the duration are both final.
    response.on('finish', () => {
      const elapsedNs = process.hrtime.bigint() - startedAt;

      // Request bodies are never logged, at any level. They carry passwords, card numbers and
      // personal data, and redaction only knows the field names it was given — the body is the
      // one place a caller can invent names it has never heard of.
      requestLog.log(levelFor(response.statusCode), 'request completed', {
        method: request.method,
        path: pathOf(request),
        statusCode: response.statusCode,
        // Integer division to microseconds first, so the value is a readable 12.437 rather than
        // a fifteen-digit float.
        durationMs: Number(elapsedNs / 1000n) / 1000,
      });
    });

    next();
  };
}
