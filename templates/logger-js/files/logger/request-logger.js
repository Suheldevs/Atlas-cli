/**
 * HTTP request logging.
 *
 * The middleware reads only `method`, `originalUrl` and `headers` from the request and only the
 * status code and the `finish` event from the response, so Express's own objects satisfy it without
 * this file importing Express. That is deliberate: a logger has no business adding a web framework
 * to a project's dependencies, and `template.json` declares only winston.
 */
import { randomUUID } from 'node:crypto';

import { logger as defaultLogger } from './index__IMPORT_SUFFIX__';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * An inbound request id is caller-controlled, so it is trusted only if it looks like an id. A value
 * containing a newline would let a caller forge whole log lines in the development formatter, and an
 * unbounded one would inflate every record belonging to that request.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * A header sent twice arrives as an array — a proxy adding `x-request-id` to a request that already
 * carried one produces exactly that.
 *
 * @param {string | string[] | undefined} value
 * @returns {string | undefined}
 */
function firstHeader(value) {
  if (value === undefined || typeof value === 'string') return value;
  return value[0];
}

/**
 * @param {import('express').Request} request
 * @returns {string}
 */
function resolveRequestId(request) {
  const candidate = firstHeader(request.headers[REQUEST_ID_HEADER]);
  return candidate !== undefined && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

/**
 * @param {number} statusCode
 * @returns {'error' | 'warn' | 'info'}
 */
function levelFor(statusCode) {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}

/**
 * Path only. Query strings routinely carry credentials — `?access_token=`, `?signature=`,
 * password-reset tokens — and a URL is the one field nobody thinks of as sensitive.
 *
 * @param {import('express').Request} request
 * @returns {string}
 */
function pathOf(request) {
  const [path] = request.originalUrl.split('?');
  return path ?? request.originalUrl;
}

/**
 * Express middleware that assigns `req.id` and `req.log`, echoes the request id back on the
 * response, and logs one record per completed request.
 *
 * Mount it ahead of your routers: every handler that reads `req.log` depends on having run after it.
 *
 * @param {{ logger?: import('winston').Logger }} [options] Pass a logger to use one built with a
 *   different config; defaults to the shared instance.
 * @returns {import('express').RequestHandler}
 */
export function requestLogger(options = {}) {
  // Resolved per call rather than at module scope. `index.js` re-exports this function, so the two
  // modules form a cycle, and reading the shared logger while `index.js` is still evaluating would
  // hit its temporal dead zone. By the time a request arrives, it is long since initialised.
  const base = options.logger ?? defaultLogger;

  return (request, response, next) => {
    // Monotonic, unlike `Date.now()`: an NTP correction mid-request cannot produce a negative
    // duration or a wildly wrong one.
    const startedAt = process.hrtime.bigint();
    const requestId = resolveRequestId(request);

    // Held in a local as well as on the request. The `finish` listener below uses the local, so it
    // cannot be defeated by later middleware reassigning the property.
    const requestLog = base.child({ requestId });

    request.id = requestId;
    request.log = requestLog;
    // Echoed back so a caller — or a browser's network tab — can quote the id in a bug report.
    response.setHeader(REQUEST_ID_HEADER, requestId);

    // `finish` is the first moment at which the status code and the duration are both final.
    response.on('finish', () => {
      const elapsedNs = process.hrtime.bigint() - startedAt;

      // Request bodies are never logged, at any level. They carry passwords, card numbers and
      // personal data, and redaction only knows the field names it was given — the body is the one
      // place a caller can invent names it has never heard of.
      requestLog.log(levelFor(response.statusCode), 'request completed', {
        method: request.method,
        path: pathOf(request),
        statusCode: response.statusCode,
        // Integer division to microseconds first, so the value is a readable 12.437 rather than a
        // fifteen-digit float.
        durationMs: Number(elapsedNs / 1000n) / 1000,
      });
    });

    next();
  };
}
