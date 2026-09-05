/**
 * Wraps an async route handler so a rejected promise reaches the error handler.
 *
 * Express 5 forwards rejections from a handler it awaits itself, so this is no longer the
 * load-bearing shim it was under Express 4. It is kept because it still does two useful things:
 * it makes the forwarding explicit at the call site, and it covers handlers reached through
 * third-party middleware that invokes them directly rather than through the router.
 *
 * @param {(request: import('express').Request, response: import('express').Response, next: import('express').NextFunction) => unknown} handler
 * @returns {import('express').RequestHandler}
 */
export function asyncHandler(handler) {
  return (request, response, next) => {
    // Wrapped in `Promise.resolve` so a handler that is not async is still handled correctly.
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}
