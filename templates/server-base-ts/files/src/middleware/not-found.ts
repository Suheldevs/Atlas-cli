import type { RequestHandler } from 'express';

import ApiError from '../utils/api-error__IMPORT_SUFFIX__';

/**
 * Mounted after every route, so reaching it means nothing matched.
 *
 * It throws rather than responding: an unknown route is a 404 with the same envelope as every
 * other failure, and routing it through the error handler is what guarantees that.
 */
export const notFound: RequestHandler = (request) => {
  throw new ApiError(404, `route not found: ${request.method} ${request.originalUrl}`);
};
