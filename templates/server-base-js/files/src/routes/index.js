import { Router } from 'express';

import { healthRouter } from './health.routes__IMPORT_SUFFIX__';

/**
 * Everything under `/api`.
 *
 * One router per feature, mounted here: the list of things this API serves is then readable in a
 * single file rather than spread across whichever modules happened to call `app.use`.
 */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
