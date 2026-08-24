/**
 * The format stacks.
 *
 * Two shapes over one pipeline: structured JSON for production, where a log aggregator is the
 * reader, and a colourised line for development, where a person is. Everything before the final
 * formatter is shared, so a record cannot be redacted in one mode and not the other.
 */
import { format } from 'winston';

import { errorSerializer } from './errors__IMPORT_SUFFIX__';
import type { LoggerConfig } from './logger-config__IMPORT_SUFFIX__';
import { redactSecrets } from './redact__IMPORT_SUFFIX__';

/**
 * winston's own type for a format has moved around its 3.x line, so it is derived from a value
 * that has not rather than imported under a name that might not be there.
 */
export type LogFormat = ReturnType<typeof format.combine>;

/** The part of a log record the pretty printer reads, restated structurally for the same reason. */
interface LogRecord {
  readonly level: string;
  readonly message: unknown;
  readonly [key: string]: unknown;
}

const RESET = '\u001b[0m';
const DIM = '\u001b[2m';

const LEVEL_COLORS: Readonly<Record<string, string>> = {
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
 * Keys the pretty line renders itself, so the metadata block must not repeat them. `service` is
 * in the list because it is constant for the lifetime of the process: useful in JSON where
 * records from several deployments are mixed, pure noise on every line of a local terminal.
 */
const INLINE_KEYS: ReadonlySet<string> = new Set([
  'level',
  'message',
  'timestamp',
  'service',
  'error',
]);

function paint(text: string, color: string, enabled: boolean): string {
  return enabled ? `${color}${text}${RESET}` : text;
}

function indent(text: string): string {
  return text.replace(/^/gm, '  ');
}

function renderMessage(message: unknown): string {
  if (typeof message === 'string') return message;

  // `JSON.stringify` returns `undefined` for `undefined`, functions and symbols, which its lib
  // signature does not admit to. It cannot throw here: redaction has already replaced every
  // cycle and bigint, and the only values left that it rejects are the ones handled below.
  const json: string | undefined = JSON.stringify(message);
  return json ?? String(message);
}

function collectMetadata(record: LogRecord): string | undefined {
  const metadata: Record<string, unknown> = {};
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
 */
function renderError(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;

  const head = 'stack' in value && typeof value.stack === 'string' ? value.stack : headline(value);
  const cause = 'cause' in value ? renderError(value.cause) : undefined;

  return cause === undefined ? head : `${head}\ncaused by: ${cause}`;
}

function headline(value: object): string {
  const name = 'name' in value && typeof value.name === 'string' ? value.name : 'Error';
  const message = 'message' in value && typeof value.message === 'string' ? value.message : '';
  return `${name}: ${message}`;
}

/**
 * Colour is applied here rather than through `format.colorize()` so that the level can be padded
 * to a fixed width before the escape codes go on — padding a string that already contains them
 * counts the invisible bytes and leaves the column ragged — and so `NO_COLOR` and a non-TTY
 * stdout are honoured, which `colorize` does not check.
 */
function prettyPrinter(color: boolean): LogFormat {
  return format.printf((info) => {
    const timestamp = typeof info['timestamp'] === 'string' ? info['timestamp'] : '';
    const level = info.level.toUpperCase().padEnd(LEVEL_WIDTH);

    const head = paint(timestamp, DIM, color);
    const badge = paint(level, LEVEL_COLORS[info.level] ?? '', color);
    const lines = [`${head} ${badge} ${renderMessage(info.message)}`];

    const metadata = collectMetadata(info);
    if (metadata !== undefined) lines.push(indent(metadata));

    const error = renderError(info['error']);
    if (error !== undefined) lines.push(indent(error));

    return lines.join('\n');
  });
}

/**
 * Order is the whole design. Splat interpolation and error serialisation run first so redaction
 * sees the record's final shape, and redaction runs before the formatter that turns it into text,
 * because anything downstream of redaction would be printing values nothing inspected. The
 * timestamp is added afterwards only because it is generated here rather than supplied by a
 * caller, so there is nothing in it to redact.
 */
export function buildLogFormat(config: LoggerConfig): LogFormat {
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
