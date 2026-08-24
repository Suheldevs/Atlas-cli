import { execa } from 'execa';

export interface RunOptions {
  readonly cwd?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly stdin?: string | undefined;
}

export interface RunResult {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly failed: boolean;
}

export interface ProcessRunner {
  run(file: string, args?: readonly string[], options?: RunOptions): Promise<RunResult>;
  /**
   * The supported way to ask "is this tool installed?".
   *
   * There is deliberately no `executableMissing` flag on `RunResult`: on Windows the
   * command is resolved through a shell, so a missing binary comes back as an ordinary
   * exit status 1 with no `ENOENT` anywhere on the error. A flag that is only correct on
   * POSIX would be a trap, so availability is answered by probing instead.
   */
  probeVersion(file: string, options?: RunOptions): Promise<string | undefined>;
}

/**
 * Environment variables npm exports to describe the package it is running a script for.
 * Compared case-insensitively: Windows stores environment names upper-cased, so
 * `npm_package_name` is enumerated as `NPM_PACKAGE_NAME`.
 */
const LEAKED_ENV_PREFIXES = ['npm_package_', 'npm_lifecycle_'] as const;

const describesAtlasItself = (key: string): boolean => {
  const normalized = key.toLowerCase();
  return LEAKED_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

const DEFAULT_TIMEOUT_MS = 120_000;
const VERSION_PROBE_TIMEOUT_MS = 5_000;

/** No exit status was ever reached — the process failed to spawn, or was killed. */
const NO_EXIT_CODE = -1;

/** execa's output type varies with its options (buffers, arrays of lines), so normalise it. */
const asText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8');
  if (Array.isArray(value)) return (value as unknown[]).map(asText).join('\n');
  return '';
};

const firstNonEmptyLine = (text: string): string | undefined => {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
};

/**
 * execa's error class is not worth importing for a `instanceof` check that would then be tied to a
 * single major version, so read the fields off the caught value defensively instead.
 */
const asFailure = (error: unknown, command: string): RunResult => {
  const fields: Record<string, unknown> =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const exitCode = fields['exitCode'];
  const stderr = asText(fields['stderr']);
  const message = asText(fields['message']);

  return {
    command,
    exitCode: typeof exitCode === 'number' ? exitCode : NO_EXIT_CODE,
    stdout: asText(fields['stdout']),
    // A missing executable or a timeout kill produces no child output at all; execa's own message
    // is then the only diagnostic a caller can show.
    stderr: stderr === '' ? message : stderr,
    failed: true,
  };
};

/**
 * Runs child processes with a bounded timeout and a sanitised environment.
 *
 * `run()` never rejects because of a non-zero exit status: it resolves with `failed: true` and the
 * captured output, leaving the decision of whether that is fatal to the caller. Turning a failure
 * into a thrown `AtlasError` is a separate helper's job, not this service's.
 */
export class ProcessService implements ProcessRunner {
  readonly #defaultTimeoutMs: number;

  constructor(options: { readonly defaultTimeoutMs?: number | undefined } = {}) {
    this.#defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async run(
    file: string,
    args: readonly string[] = [],
    options: RunOptions = {},
  ): Promise<RunResult> {
    // Used verbatim in error messages, so it has to read like something a user could retype.
    const command = [file, ...args].join(' ');

    try {
      const result = await execa(file, [...args], {
        cwd: options.cwd ?? process.cwd(),
        timeout: options.timeoutMs ?? this.#defaultTimeoutMs,
        env: this.#childEnv(options.env),
        extendEnv: false,
        stripFinalNewline: true,
        ...(options.stdin === undefined ? {} : { input: options.stdin }),
      });

      return {
        command,
        exitCode: result.exitCode ?? 0,
        stdout: asText(result.stdout),
        stderr: asText(result.stderr),
        failed: false,
      };
    } catch (error) {
      return asFailure(error, command);
    }
  }

  async probeVersion(file: string, options: RunOptions = {}): Promise<string | undefined> {
    const result = await this.run(file, ['--version'], {
      ...options,
      timeoutMs: VERSION_PROBE_TIMEOUT_MS,
    });
    if (result.failed) return undefined;

    // Several tools (older git wrappers, some JVM-based CLIs) print their version on stderr.
    return firstNonEmptyLine(result.stdout) ?? firstNonEmptyLine(result.stderr);
  }

  /**
   * When Atlas is itself launched through `npm run`, npm exports `npm_package_*` and
   * `npm_lifecycle_*` describing *Atlas's* own package and script. Leaking those into a child
   * package manager makes it misread the project it is operating on, so they are dropped.
   * `npm_config_*` is kept deliberately: it carries the user's registry, proxy and auth settings,
   * which the child genuinely needs.
   */
  #childEnv(overrides: Readonly<Record<string, string>> | undefined): Record<string, string> {
    const env: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (describesAtlasItself(key)) continue;
      env[key] = value;
    }

    // The result is a complete environment, so execa must not merge `process.env` back in.
    return { ...env, ...overrides };
  }
}
