import { config as loadDotenvFile } from 'dotenv';

/**
 * Configuration, read and validated exactly once at import time.
 *
 * This is the only module in the project that touches `process.env`. Everything else reads the
 * frozen `config` object below, which means a variable's name, its default, its type and its
 * validity all live in one file instead of being rediscovered at every use site — and a value
 * that reaches a caller has already been proved to be the shape that caller expects.
 *
 * A misconfigured process exits here, before Mongoose is dialled and before a port is bound. The
 * alternative — booting, reporting healthy, and failing on the third request that happens to need
 * the value — is the failure this file exists to prevent.
 */

/** The environments the application recognises. Anything else is a typo, not a deployment. */
const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;

export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export interface Config {
  readonly nodeEnv: NodeEnvironment;
  readonly isProduction: boolean;
  readonly port: number;
  readonly mongodbUri: string;
  readonly dbAutoIndex: boolean;
  readonly clientUrl: string;
  readonly jwtAccessSecret: string;
  readonly jwtRefreshSecret: string;
  readonly jwtAccessTtl: string;
  readonly jwtRefreshTtl: string;
}

/**
 * Every default, in one table.
 *
 * A default written at a use site (`config.port ?? 5000`) is a second source of truth that drifts
 * from `.env.example` and from the next use site. There is exactly one of each here.
 */
const DEFAULTS = {
  NODE_ENV: 'development',
  PORT: 5000,
  CLIENT_URL: 'http://localhost:5173',
  DB_AUTO_INDEX: false,
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
} as const;

const MAX_PORT = 65_535;

/** 32 characters is the floor for an HS256 key; anything shorter is brute-forceable offline. */
const MIN_SECRET_LENGTH = 32;

const MONGODB_URI_PREFIXES = ['mongodb://', 'mongodb+srv://'] as const;

/** Digits only. `Number('3000abc')` is NaN but `parseInt` is not, and neither is a leading '+'. */
const WHOLE_NUMBER = /^\d+$/u;

/** A duration such as `15m`, `24h`, `7d` — the vocabulary `jsonwebtoken` accepts. */
const DURATION = /^\d+(?:ms|s|m|h|d)$/u;

/** Anything between `//` and `@`: the credentials in a connection string. */
const URI_CREDENTIALS = /\/\/[^/@]*@/u;

/**
 * The literal secrets shipped in `.env.example`.
 *
 * A project deployed with the example secret is a project with no authentication at all, and it
 * is the single most common way that happens. Rejecting them costs two lines.
 */
const PLACEHOLDER_SECRETS: readonly string[] = [
  'change-me-access-secret-at-least-32-characters-long',
  'change-me-refresh-secret-at-least-32-characters-long',
];

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_SECRETS.includes(value) || value.startsWith('change-me');
}

function isAbsoluteUrl(value: string): boolean {
  try {
    return new URL(value).protocol !== '';
  } catch {
    return false;
  }
}

/** A connection string with its credentials removed, so it can be logged or put in an error. */
function withoutCredentials(uri: string): string {
  return uri.replace(URI_CREDENTIALS, '//***@');
}

function loadConfig(): Config {
  loadDotenvFile({ quiet: true });

  // Collected, not thrown. Fixing five variables one restart at a time is the difference between
  // a minute and a quarter of an hour, and it is the single biggest usability win in this file.
  const problems: string[] = [];

  /** Trimmed, with empty treated as absent: `PORT=` in a .env file means "not set". */
  const raw = (name: string): string | undefined => {
    const value = process.env[name];
    if (value === undefined) return undefined;

    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  };

  const requireValue = (name: string, purpose: string): string => {
    const value = raw(name);
    if (value !== undefined) return value;

    problems.push(`${name} is not set. ${purpose}`);
    return '';
  };

  const readEnum = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const value = raw(name);
    if (value === undefined) return fallback;

    const match = allowed.find((candidate) => candidate === value);
    if (match !== undefined) return match;

    problems.push(`${name} must be one of ${allowed.join(', ')}; got "${value}".`);
    return fallback;
  };

  const readPort = (name: string, fallback: number): number => {
    const value = raw(name);
    if (value === undefined) return fallback;

    if (!WHOLE_NUMBER.test(value)) {
      problems.push(`${name} must be a whole number; got "${value}".`);
      return fallback;
    }

    const parsed = Number(value);
    if (parsed < 1 || parsed > MAX_PORT) {
      problems.push(`${name} must be between 1 and ${MAX_PORT}; got ${parsed}.`);
      return fallback;
    }

    return parsed;
  };

  /** Only the two literals. `'yes'`, `'1'` and `'False'` are mistakes, not values. */
  const readBoolean = (name: string, fallback: boolean): boolean => {
    const value = raw(name);
    if (value === undefined) return fallback;
    if (value === 'true') return true;
    if (value === 'false') return false;

    problems.push(`${name} must be exactly "true" or "false"; got "${value}".`);
    return fallback;
  };

  const readUrl = (name: string, fallback: string, purpose: string): string => {
    const value = raw(name);
    if (value === undefined) return fallback;

    if (!isAbsoluteUrl(value)) {
      problems.push(`${name} must be an absolute URL such as ${fallback}; got "${value}". ${purpose}`);
      return fallback;
    }

    return value;
  };

  const readDuration = (name: string, fallback: string): string => {
    const value = raw(name);
    if (value === undefined) return fallback;

    if (!DURATION.test(value)) {
      problems.push(`${name} must be a duration such as 15m, 24h or 7d; got "${value}".`);
      return fallback;
    }

    return value;
  };

  const readMongodbUri = (name: string): string => {
    const value = requireValue(name, 'It is the MongoDB connection string the server dials.');
    if (value === '') return value;

    // The value is never quoted back: a connection string carries the database password.
    if (!MONGODB_URI_PREFIXES.some((prefix) => value.startsWith(prefix))) {
      problems.push(`${name} must start with ${MONGODB_URI_PREFIXES.join(' or ')}.`);
    }

    return value;
  };

  const readSecret = (name: string): string => {
    const value = requireValue(name, 'It signs and verifies JSON Web Tokens.');
    if (value === '') return value;

    // Length is reported, contents never are — a secret in a log line is a secret in whatever
    // aggregates those logs.
    if (value.length < MIN_SECRET_LENGTH) {
      problems.push(
        `${name} is ${value.length} characters; at least ${MIN_SECRET_LENGTH} are required. Generate one with: openssl rand -base64 48`,
      );
    } else if (isPlaceholder(value)) {
      problems.push(
        `${name} is still the placeholder from .env.example. Generate a real one with: openssl rand -base64 48`,
      );
    }

    return value;
  };

  const nodeEnv = readEnum('NODE_ENV', NODE_ENVIRONMENTS, DEFAULTS.NODE_ENV);

  const resolved: Config = {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: readPort('PORT', DEFAULTS.PORT),
    mongodbUri: readMongodbUri('MONGODB_URI'),
    dbAutoIndex: readBoolean('DB_AUTO_INDEX', DEFAULTS.DB_AUTO_INDEX),
    clientUrl: readUrl(
      'CLIENT_URL',
      DEFAULTS.CLIENT_URL,
      'It is the single origin the CORS allowlist permits, and a malformed one fails in the browser rather than here.',
    ),
    jwtAccessSecret: readSecret('JWT_ACCESS_SECRET'),
    jwtRefreshSecret: readSecret('JWT_REFRESH_SECRET'),
    jwtAccessTtl: readDuration('JWT_ACCESS_TTL', DEFAULTS.JWT_ACCESS_TTL),
    jwtRefreshTtl: readDuration('JWT_REFRESH_TTL', DEFAULTS.JWT_REFRESH_TTL),
  };

  if (problems.length > 0) {
    const count = problems.length;
    console.error(`\nCannot start: ${count} problem${count === 1 ? '' : 's'} with the environment.\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('\nCopy .env.example to .env, fix every line above, then start again.\n');
    process.exit(1);
  }

  // Frozen so a later "just override it for now" is a TypeError at the assignment rather than a
  // value that changes underneath everything already holding a reference to it.
  return Object.freeze(resolved);
}

export const config: Config = loadConfig();

/** The connection string with credentials stripped. The only form that may be printed. */
export const mongodbUriForDisplay: string = withoutCredentials(config.mongodbUri);

/**
 * The resolved configuration, safe to log.
 *
 * Secrets are absent by construction rather than filtered out afterwards: a key added to `Config`
 * is not printed until somebody adds it here deliberately.
 */
export function describeConfig(): Readonly<Record<string, string | number | boolean>> {
  return Object.freeze({
    nodeEnv: config.nodeEnv,
    port: config.port,
    clientUrl: config.clientUrl,
    mongodb: mongodbUriForDisplay,
    dbAutoIndex: config.dbAutoIndex,
    jwtAccessTtl: config.jwtAccessTtl,
    jwtRefreshTtl: config.jwtRefreshTtl,
  });
}
