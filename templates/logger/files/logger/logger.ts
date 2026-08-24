/**
 * The application logger.
 *
 * Assembly only: every decision about how it behaves lives in `logger-config.ts`, and every
 * decision about how a record looks lives in `formats.ts`. The instance is created at import so
 * that a module can log during its own initialisation.
 */
import { createLogger, transports, type Logger } from 'winston';

import { buildLogFormat } from './formats__IMPORT_SUFFIX__';
import { resolveLoggerConfig, type LoggerConfig } from './logger-config__IMPORT_SUFFIX__';

/** Exported separately from `logger` so a test can build an instance with its own config. */
export function createAppLogger(config: LoggerConfig): Logger {
  return createLogger({
    level: config.level,
    silent: config.silent,
    format: buildLogFormat(config),
    defaultMeta: { service: config.serviceName },
    // One transport, and everything goes to stdout — errors included. Splitting a process's
    // output across stdout and stderr lets the two interleave unpredictably, and a collector
    // that reads them as separate streams can order the record explaining a failure after the
    // failure itself.
    transports: [new transports.Console()],
    // A transport that cannot write — full disk, closed pipe, a broken sidecar — must not end
    // the process. Losing a log line is bad; losing the server because of one is worse.
    exitOnError: false,
  });
}

export const logger: Logger = createAppLogger(resolveLoggerConfig());
