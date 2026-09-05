import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { config } from './config/env__IMPORT_SUFFIX__';
import { errorHandler } from './middleware/error-handler__IMPORT_SUFFIX__';
import { notFound } from './middleware/not-found__IMPORT_SUFFIX__';
import { apiRouter } from './routes/index__IMPORT_SUFFIX__';
import { responseMiddleware } from './utils/api-response__IMPORT_SUFFIX__';

/** Bodies above this size are rejected before they are parsed, not after. */
const BODY_LIMIT = '1mb';

export const app = express();

// The default banner advertises the framework to anyone scanning; nothing depends on it.
app.disable('x-powered-by');

// One proxy hop, which is what a single load balancer or ingress in front of the app means. Set
// this to the real number of hops: trusting more than there are lets a client forge its own IP.
app.set('trust proxy', 1);

// A single validated origin rather than a wildcard, because `credentials: true` and `origin: '*'`
// are mutually exclusive in the browser and a permissive fallback would silently drop cookies.
app.use(cors({ origin: config.clientUrl, credentials: true }));

app.use(express.json({ limit: BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
app.use(cookieParser());

// Before the routes, so every handler below can answer with `res.api(...)`.
app.use(responseMiddleware);

app.use('/api', apiRouter);

// Order matters and is the whole point of these two lines: nothing matched, then nothing else can
// handle the error. The error handler is last in the chain, always.
app.use(notFound);
app.use(errorHandler);
