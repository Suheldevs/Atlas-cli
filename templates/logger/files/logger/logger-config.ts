/**
 * Logger configuration, resolved from the environment.
 *
 * Kept apart from the logger itself for two reasons. A test can build a `LoggerConfig` literal
 * without touching `process.env`, and an unusable value fails at boot with a message naming the
 * variable — `LOG_LEVEL=verbse` silently downgraded to `info` hides the very logs somebody is
 * relying on during an incident, and hides them until the next deploy.
 */

/**
 * The npm levels winston uses, most severe first. A level's index is its severity: setting
 * `info` enables everything up to and including `info` and drops the rest.
 */
export const LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_OUTPUTS = ['json', 'pretty'] as const;

export type LogOutput = (typeof LOG_OUTPUTS)[number];

/** The slice of `process.env` this module reads, so a caller can pass a plain object. */
export type Environment = Readonly<Record<string, string | undefined>>;

export interface LoggerConfig {
  readonly level: LogLevel;
  /** `json` when a log aggregator is the reader, `pretty` when a person is. */
  readonly output: LogOutput;
  /** Only ever true for `pretty` output on a terminal, so a redirected log file stays clean. */
  readonly color: boolean;
  /** Stamped onto every record as `service`, so one aggregator can hold many deployments. */
  readonly serviceName: string;
  readonly silent: boolean;
  readonly nodeEnv: string;
}

const LEVEL_NAMES: ReadonlySet<string> = new Set(LOG_LEVELS);

const OUTPUT_NAMES: ReadonlySet<string> = new Set(LOG_OUTPUTS);

function isLogLevel(value: string): value is LogLevel {
  return LEVEL_NAMES.has(value);
}

function isLogOutput(value: string): value is LogOutput {
  return OUTPUT_NAMES.has(value);
}

/**
 * An empty or whitespace-only value counts as unset. `LOG_LEVEL=` in a `.env` file is a blank
 * somebody left behind, not a request for a level named `''`.
 */
function read(env: Environment, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function parseLevel(value: string): LogLevel {
  if (isLogLevel(value)) return value;
  throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}; received "${value}".`);
}

function parseOutput(value: string): LogOutput {
  if (isLogOutput(value)) return value;
  throw new Error(`LOG_FORMAT must be one of ${LOG_OUTPUTS.join(', ')}; received "${value}".`);
}

function parseBoolean(name: string, value: string): boolean {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`${name} must be one of true, false, 1, 0; received "${value}".`);
}

/**
 * Opt out with `NO_COLOR`, opt in with `FORCE_COLOR` (https://no-color.org), otherwise follow
 * the terminal. ANSI escapes written into a redirected log file are noise every later reader
 * has to strip back out, and the escape sequences break line-oriented greps.
 */
function resolveColor(env: Environment, output: LogOutput): boolean {
  if (output !== 'pretty') return false;
  if (read(env, 'NO_COLOR') !== undefined) return false;
  if (read(env, 'FORCE_COLOR') !== undefined) return true;
  return process.stdout.isTTY === true;
}

export function resolveLoggerConfig(env: Environment = process.env): LoggerConfig {
  const nodeEnv = read(env, 'NODE_ENV') ?? 'development';
  const isProduction = nodeEnv === 'production';

  const levelValue = read(env, 'LOG_LEVEL');
  const level = levelValue === undefined ? defaultLevel(isProduction) : parseLevel(levelValue);

  const outputValue = read(env, 'LOG_FORMAT');
  const output =
    outputValue === undefined ? defaultOutput(isProduction) : parseOutput(outputValue);

  // Silent under test so assertions are not buried in log output. `LOG_SILENT=false` brings it
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

function defaultLevel(isProduction: boolean): LogLevel {
  return isProduction ? 'info' : 'debug';
}

function defaultOutput(isProduction: boolean): LogOutput {
  return isProduction ? 'json' : 'pretty';
}
