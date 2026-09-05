// First import, deliberately: reading it validates the whole environment and exits on anything
// wrong, so nothing below — no Mongoose dial, no bound port — happens for a misconfigured process.
import { config, describeConfig } from './config/env__IMPORT_SUFFIX__';

import { createServer } from 'node:http';

import { app } from './app__IMPORT_SUFFIX__';
import { connectDatabase, disconnectDatabase } from './config/db__IMPORT_SUFFIX__';

/** How long a shutdown may take before the process exits regardless. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = createServer(app);

let shuttingDown = false;

function closeServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

/**
 * Stops accepting connections, drains the ones in flight, then closes the database.
 *
 * The order is the point: closing Mongoose first would fail every request already being served.
 * The timer is the backstop for a connection that never drains — an orchestrator that has sent
 * SIGTERM will send SIGKILL soon enough, and leaving on our own terms is better than being killed
 * halfway through a write.
 */
async function shutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${reason} received — shutting down.`);

  const forceExit = setTimeout(() => {
    console.error(`Shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS}ms — exiting.`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  // Unreferenced, so the timer itself is never what keeps the event loop alive.
  forceExit.unref();

  try {
    await closeServer();
    await disconnectDatabase();
    clearTimeout(forceExit);
    console.log('Shutdown complete.');
    process.exit(0);
  } catch (error) {
    console.error('Shutdown failed.', error);
    process.exit(1);
  }
}

/**
 * The database comes up before the listener.
 *
 * A server that accepts traffic it cannot serve looks healthy to a load balancer and fails every
 * request it is given; one that has not started listening yet is simply not in the pool.
 */
async function start(): Promise<void> {
  await connectDatabase();

  server.listen(config.port, () => {
    // Non-secret values only — `describeConfig` omits the JWT secrets and strips the database
    // credentials from the connection string.
    console.log('__PROJECT_NAME__ starting with', describeConfig());
    console.log(`Listening on http://localhost:${config.port}`);
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

// A process whose state is unknown must not keep serving: log the cause and leave, rather than
// carry on with a half-finished operation behind us.
process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled promise rejection — shutting down.', reason);
  void shutdown('unhandledRejection');
});

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught exception — shutting down.', error);
  void shutdown('uncaughtException');
});

start().catch((error: unknown) => {
  console.error('Failed to start.', error instanceof Error ? error.message : error);
  process.exit(1);
});
