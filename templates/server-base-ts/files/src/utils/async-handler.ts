import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async route handler so a rejected promise reaches the error handler.
 *
 * Express 5 forwards rejections from a handler it awaits itself, so this is no longer the
 * load-bearing shim it was under Express 4. It is kept because it still does two useful things:
 * it makes the forwarding explicit at the call site, and it covers handlers reached through
 * third-party middleware that invokes them directly rather than through the router.
 */
export function asyncHandler(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (request, response, next) => {
    handler(request, response, next).catch(next);
  };
}
