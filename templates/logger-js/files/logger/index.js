/**
 * The application logger, and the public surface of the logging module.
 *
 * Two shapes over one pipeline: structured JSON to stdout in production, where a log aggregator is
 * the reader, and a colourised line in development, where a person is. Everything before the final
 * formatter is shared, so a record cannot be redacted in one mode and not the other.
 *
 * Application code imports from here rather than from the individual files — the split between
 * redaction, error serialisation and request logging is an implementation detail that should be
 * free to change without a find-and-replace across the codebase.
 *
 * This module deliberately depends on nothing but winston. It has to be usable before the rest of
 * the application is wired — including by the error layer itself — so importing the shared error or
 * response helpers here would both create an import cycle and make logging unavailable during
 * startup, which is exactly when it is most needed.
 */
import { createLogger, format, transports } from 'winston';

import { redactSecrets } from './redact__IMPORT_SUFFIX__';
import { errorSerializer } from './serialize-error__IMPORT_SUFFIX__';

/**
 * The npm levels winston uses, most severe first. A level's index is its severity: setting `info`
 * enables everything up to and including `info` and drops the rest.
 *
 * @type {readonly string[]}
 */
export const LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];

/** @type {readonly string[]} */
export const LOG_OUTPUTS = ['json', 'pretty'];

/**
 * @typedef {object} LoggerConfig
 * @property {string} level
 * @property {'json' | 'pretty'} output `json` when a log aggregator is the reader, `pretty` when a
 *   person is.
 * @property {boolean} color Only ever true for `pretty` output on a terminal, so a redirected log
 *   file stays clean.
 * @property {string} serviceName Stamped onto every record as `service`, so one aggregator can hold
 *   many deployments.
 * @property {boolean} silent
 * @property {string} nodeEnv
 */

const LEVEL_NAMES = new Set(LOG_LEVELS);
const OUTPUT_NAMES = new Set(LOG_OUTPUTS);

/**
 * An empty or whitespace-only value counts as unset. `LOG_LEVEL=` in a `.env` file is a blank
 * somebody left behind, not a request for a level named `''`.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 * @returns {string | undefined}
 */
function read(env, name) {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Unusable values fail at boot with a message naming the variable. `LOG_LEVEL=verbse` silently
 * downgraded to `info` hides the very logs somebody is relying on during an incident, and hides
 * them until the next deploy.
 *
 * @param {string} value
 * @returns {string}
 */
function parseLevel(value) {
  if (LEVEL_NAMES.has(value)) return value;
  throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}; received "${value}".`);
}

/**
 * @param {string} value
 * @returns {'json' | 'pretty'}
 */
function parseOutput(value) {
  if (OUTPUT_NAMES.has(value)) return value;
  throw new Error(`LOG_FORMAT must be one of ${LOG_OUTPUTS.join(', ')}; received "${value}".`);
}

/**
 * @param {string} name
 * @param {string} value
 * @returns {boolean}
 */
function parseBoolean(name, value) {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`${name} must be one of true, false, 1, 0; received "${value}".`);
}

/**
 * Opt out with `NO_COLOR`, opt in with `FORCE_COLOR` (https://no-color.org), otherwise follow the
 * terminal. ANSI escapes written into a redirected log file are noise every later reader has to
 * strip back out, and the escape sequences break line-oriented greps.
 *
 * @param {Record<string, string | undefined>} env
 * @param {'json' | 'pretty'} output
 * @returns {boolean}
 */
function resolveColor(env, output) {
  if (output !== 'pretty') return false;
  if (read(env, 'NO_COLOR') !== undefined) return false;
  if (read(env, 'FORCE_COLOR') !== undefined) return true;
  return process.stdout.isTTY === true;
}

/**
 * Logger configuration, resolved from the environment.
 *
 * A separate function from the logger itself so a test can build a config literal without touching
 * `process.env`.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {LoggerConfig}
 */
export function resolveLoggerConfig(env = process.env) {
  const nodeEnv = read(env, 'NODE_ENV') ?? 'development';
  const isProduction = nodeEnv === 'production';

  const levelValue = read(env, 'LOG_LEVEL');
  const level =
    levelValue === undefined ? (isProduction ? 'info' : 'debug') : parseLevel(levelValue);

  const outputValue = read(env, 'LOG_FORMAT');
  const output =
    outputValue === undefined ? (isProduction ? 'json' : 'pretty') : parseOutput(outputValue);

  // Silenced under test so assertions are not buried in log output. `LOG_SILENT=false` brings it
  // back for the one test being debugged, without editing this file.
  const silentValue = read(env, 'LOG_SILENT');
  const silent =
    silentValue === undefined ? nodeEnv === 'test' : parseBoolean('LOG_SILENT', silentValue);

  return {
    level,
    output,
    color: resolveColor(env, output),
    serviceName: read(env, 'SERVICE_NAME') ?? '__PROJECT_NAME__',
    silent,
    nodeEnv,
  };
}

const RESET = '\u001b[0m';
const DIM = '\u001b[2m';

/** @type {Readonly<Record<string, string>>} */
const LEVEL_COLORS = {
  error: '\u001b[31m',
  warn: '\u001b[33m',
  info: '\u001b[32m',
  http: '\u001b[35m',
  verbose: '\u001b[36m',
  debug: '\u001b[34m',
  silly: '\u001b[90m',
};

/** Length of the longest level name, so messages line up down the left edge of a terminal. */
const LEVEL_WIDTH = 7;

const PRETTY_TIMESTAMP = 'HH:mm:ss.SSS';

/**
 * Keys the pretty line renders itself, so the metadata block must not repeat them. `service` is in
 * the list because it is constant for the lifetime of the process: useful in JSON where records
 * from several deployments are mixed, pure noise on every line of a local terminal.
 *
 * @type {ReadonlySet<string>}
 */
const INLINE_KEYS = new Set(['level', 'message', 'timestamp', 'service', 'error']);

/**
 * @param {string} text
 * @param {string} color
 * @param {boolean} enabled
 * @returns {string}
 */
function paint(text, color, enabled) {
  return enabled ? `${color}${text}${RESET}` : text;
}

/**
 * @param {string} text
 * @returns {string}
 */
function indent(text) {
  return text.replace(/^/gm, '  ');
}

/**
 * @param {unknown} message
 * @returns {string}
 */
function renderMessage(message) {
  if (typeof message === 'string') return message;

  // `JSON.stringify` returns `undefined` for `undefined`, functions and symbols. It cannot throw
  // here: redaction has already replaced every cycle and every bigint, and the only values left
  // that it rejects are the ones the fallback handles.
  return JSON.stringify(message) ?? String(message);
}

/**
 * @param {Record<string, unknown>} record
 * @returns {string | undefined}
 */
function collectMetadata(record) {
  /** @type {Record<string, unknown>} */
  const metadata = {};
  let present = false;

  for (const key of Object.keys(record)) {
    if (INLINE_KEYS.has(key)) continue;
    metadata[key] = record[key];
    present = true;
  }

  return present ? JSON.stringify(metadata, undefined, 2) : undefined;
}

/**
 * A stack already begins with `Name: message`, so it is printed alone when there is one and the
 * headline is reconstructed only when there is not — an error that crossed a process or a
 * `structuredClone` boundary often arrives without one.
 *
 * @param {unknown} value
 * @returns {string | undefined}
 */
function renderError(value) {
  if (value === null || typeof value !== 'object') return undefined;

  const head = typeof value.stack === 'string' ? value.stack : headline(value);
  const cause = renderError(value.cause);

  return cause === undefined ? head : `${head}\ncaused by: ${cause}`;
}

/**
 * @param {Record<string, unknown>} record
 * @returns {string}
 */
function headline(record) {
  const name = typeof record.name === 'string' ? record.name : 'Error';
  const message = typeof record.message === 'string' ? record.message : '';
  return `${name}: ${message}`;
}

/**
 * Colour is applied here rather than through `format.colorize()` so that the level can be padded to
 * a fixed width before the escape codes go on — padding a string that already contains them counts
 * the invisible bytes and leaves the column ragged — and so `NO_COLOR` and a non-TTY stdout are
 * honoured, which `colorize` does not check.
 *
 * @param {boolean} color
 */
function prettyPrinter(color) {
  return format.printf((info) => {
    const timestamp = typeof info.timestamp === 'string' ? info.timestamp : '';
    const level = String(info.level).toUpperCase().padEnd(LEVEL_WIDTH);

    const head = paint(timestamp, DIM, color);
    const badge = paint(level, LEVEL_COLORS[info.level] ?? '', color);
    const lines = [`${head} ${badge} ${renderMessage(info.message)}`];

    const metadata = collectMetadata(info);
    if (metadata !== undefined) lines.push(indent(metadata));

    const error = renderError(info.error);
    if (error !== undefined) lines.push(indent(error));

    return lines.join('\n');
  });
}

/**
 * Order is the whole design. Splat interpolation and error serialisation run first so redaction
 * sees the record's final shape, and redaction runs before the formatter that turns it into text,
 * because anything downstream of redaction would be printing values nothing inspected. The
 * timestamp is added afterwards only because it is generated here rather than supplied by a caller,
 * so there is nothing in it to redact.
 *
 * @param {LoggerConfig} config
 */
export function buildLogFormat(config) {
  const shared = format.combine(format.splat(), errorSerializer(), redactSecrets());

  if (config.output === 'json') {
    return format.combine(shared, format.timestamp(), format.json());
  }

  return format.combine(
    shared,
    format.timestamp({ format: PRETTY_TIMESTAMP }),
    prettyPrinter(config.color),
  );
}

/**
 * Exported separately from `logger` so a test can build an instance with its own config.
 *
 * @param {LoggerConfig} config
 * @returns {import('winston').Logger}
 */
export function createAppLogger(config) {
  return createLogger({
    level: config.level,
    silent: config.silent,
    format: buildLogFormat(config),
    defaultMeta: { service: config.serviceName },
    // One transport, and everything goes to stdout — errors included. Splitting a process's output
    // across stdout and stderr lets the two interleave unpredictably, and a collector that reads
    // them as separate streams can order the record explaining a failure after the failure itself.
    transports: [new transports.Console()],
    // A transport that cannot write — a full disk, a closed pipe, a broken sidecar — must not end
    // the process. Losing a log line is bad; losing the server because of one is worse.
    exitOnError: false,
  });
}

/** Created at import, so a module can log during its own initialisation. */
export const logger = createAppLogger(resolveLoggerConfig());

export {
  CIRCULAR,
  isSensitiveKey,
  REDACTED,
  redactValue,
  SENSITIVE_FIELD_NAMES,
} from './redact__IMPORT_SUFFIX__';
export { serializeError } from './serialize-error__IMPORT_SUFFIX__';
export { requestLogger } from './request-logger__IMPORT_SUFFIX__';
