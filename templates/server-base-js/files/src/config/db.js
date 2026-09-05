import mongoose from 'mongoose';

import { config, mongodbUriForDisplay } from './env__IMPORT_SUFFIX__';

/**
 * Pool and timeout settings, stated rather than inherited from the driver.
 *
 * The driver defaults to a 30-second server-selection window and to buffering commands while
 * disconnected, which together turn an unreachable database into requests that hang well past any
 * sensible client timeout. Both are turned down here so a database problem looks like a database
 * problem.
 */
const CONNECT_OPTIONS = {
  // Fail a query immediately while disconnected instead of queueing it against a reconnect that
  // may never happen.
  bufferCommands: false,
  serverSelectionTimeoutMS: 10_000,
  socketTimeoutMS: 45_000,
  maxPoolSize: 10,
  minPoolSize: 1,
  autoIndex: config.dbAutoIndex,
};

let eventsBound = false;

/** Bound once: `connectDatabase` may legitimately be called again by a test harness. */
function bindConnectionEvents() {
  if (eventsBound) return;
  eventsBound = true;

  const { connection } = mongoose;

  connection.on('connected', () => {
    console.log(`MongoDB connected: ${connection.host}/${connection.name}`);
  });

  // After the initial connect succeeds the driver reconnects on its own; these are the events
  // that make that visible instead of silent.
  connection.on('error', (error) => {
    console.error(`MongoDB connection error: ${error.message}`);
  });

  connection.on('disconnected', () => {
    console.warn('MongoDB disconnected.');
  });

  connection.on('reconnected', () => {
    console.log('MongoDB reconnected.');
  });
}

/**
 * Opens the connection pool, once, at boot.
 *
 * Rejects rather than retrying in a loop: a wrong connection string, a firewall or a bad password
 * do not fix themselves, and a process that retries them forever looks alive while serving
 * nothing. The caller exits; a supervisor decides whether to restart.
 */
export async function connectDatabase() {
  // Reject filters on paths the schema does not declare rather than dropping them silently,
  // which is how a typo in a query turns into "matches every document".
  mongoose.set('strictQuery', true);

  bindConnectionEvents();

  try {
    await mongoose.connect(config.mongodbUri, CONNECT_OPTIONS);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    throw new Error(
      `Could not connect to MongoDB at ${mongodbUriForDisplay}: ${reason}\n` +
        'Check that the server is reachable and that MONGODB_URI names the right host, database and credentials.',
      { cause: error },
    );
  }
}

/** Closes the connection pool. Safe to call when nothing is connected. */
export async function disconnectDatabase() {
  await mongoose.disconnect();
}
