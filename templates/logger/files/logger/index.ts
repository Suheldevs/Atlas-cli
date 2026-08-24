/**
 * Public surface of the logging module.
 *
 * Application code imports from here and not from the individual files: the split between
 * configuration, formats, redaction and error serialisation is an implementation detail, and it
 * should be free to change without a find-and-replace across the codebase.
 */
export { serializeError, type SerializedError } from './errors__IMPORT_SUFFIX__';
export { httpLogger } from './http-logger__IMPORT_SUFFIX__';
export { createAppLogger, logger } from './logger__IMPORT_SUFFIX__';
export {
  LOG_LEVELS,
  LOG_OUTPUTS,
  resolveLoggerConfig,
  type Environment,
  type LoggerConfig,
  type LogLevel,
  type LogOutput,
} from './logger-config__IMPORT_SUFFIX__';
export {
  CIRCULAR,
  isSensitiveKey,
  REDACTED,
  redactValue,
  SENSITIVE_FIELD_NAMES,
} from './redact__IMPORT_SUFFIX__';
