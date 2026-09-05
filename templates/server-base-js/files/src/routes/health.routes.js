import { Router } from 'express';

export const healthRouter = Router();

/**
 * GET /api/health
 *
 * Deliberately cheap and dependency-free: a readiness probe that touches the database reports the
 * database's health, not the process's, and takes the whole service down with it.
 */
healthRouter.get('/', (_request, response) => {
  response.api(200, 'Service is healthy', {
    ok: true,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
