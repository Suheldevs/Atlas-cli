import { Chalk } from 'chalk';
import ora, { type Ora } from 'ora';

/**
 * Deliberately narrower than `NodeJS.WriteStream` so tests can inject an in-memory buffer.
 * `process.stdout` and `process.stderr` satisfy it structurally.
 */
export interface OutputStream {
  write(chunk: string): boolean;
  readonly isTTY?: boolean | undefined;
  readonly columns?: number | undefined;
}

export interface ReporterConfig {
  readonly color: boolean;
  readonly verbose: boolean;
}

export interface ReporterOptions {
  readonly stdout?: OutputStream;
  readonly stderr?: OutputStream;
  readonly color?: boolean;
  readonly verbose?: boolean;
}

export interface TaskHandle {
  update(text: string): void;
  succeed(text?: string): void;
  warn(text?: string): void;
  fail(text?: string): void;
  stop(): void;
}

// `Chalk` is exported as a constructor value rather than a class declaration, so the instance
// type has to be derived from it.
type ChalkInstance = InstanceType<typeof Chalk>;

interface SymbolSet {
  readonly success: string;
  readonly error: string;
  readonly warning: string;
  readonly info: string;
  readonly bullet: string;
  readonly arrow: string;
}

const UNICODE_SYMBOLS: SymbolSet = {
  success: '✔',
  error: '✖',
  warning: '⚠',
  info: 'ℹ',
  bullet: '•',
  arrow: '→',
};

const ASCII_SYMBOLS: SymbolSet = {
  success: '√',
  error: '×',
  warning: '!',
  info: 'i',
  bullet: '-',
  arrow: '>',
};

const noop = (): void => {
  /* nothing to do without a spinner to drive */
};

/**
 * Legacy `cmd.exe` code pages render the unicode symbols as mojibake, so Windows only gets them
 * when the terminal is one that is known to speak UTF-8.
 */
const supportsUnicode = (): boolean => {
  if (process.platform !== 'win32') return true;
  return (
    process.env['WT_SESSION'] !== undefined ||
    process.env['TERM_PROGRAM'] === 'vscode' ||
    process.env['ConEmuANSI'] === 'ON' ||
    (process.env['TERM']?.includes('xterm') ?? false)
  );
};

// `new Chalk()` runs chalk's own detection, which honours NO_COLOR, FORCE_COLOR and TTY status;
// level 0 is the unconditional opt-out behind `--no-color`.
const createChalk = (color: boolean): ChalkInstance =>
  color ? new Chalk() : new Chalk({ level: 0 });

/**
 * The only permitted writer to stdout and stderr. Every other module reports through this service
 * so output can be redirected, silenced, or stripped of colour from one place.
 */
export class Reporter {
  readonly #stdout: OutputStream;
  readonly #stderr: OutputStream;
  readonly #symbols: SymbolSet;
  #color: boolean;
  #verbose: boolean;
  #chalk: ChalkInstance;
  #activeTask: Ora | undefined;

  constructor(options: ReporterOptions = {}) {
    this.#stdout = options.stdout ?? process.stdout;
    this.#stderr = options.stderr ?? process.stderr;
    this.#color = options.color ?? true;
    this.#verbose = options.verbose ?? false;
    this.#chalk = createChalk(this.#color);
    this.#symbols = supportsUnicode() ? UNICODE_SYMBOLS : ASCII_SYMBOLS;
  }

  /** Mutable because the reporter is built before argv is parsed, then reconfigured from it. */
  configure(config: Partial<ReporterConfig>): void {
    if (config.color !== undefined) this.#color = config.color;
    if (config.verbose !== undefined) this.#verbose = config.verbose;
    this.#chalk = createChalk(this.#color);
  }

  get verbose(): boolean {
    return this.#verbose;
  }

  get colorEnabled(): boolean {
    return this.#color;
  }

  blank(): void {
    this.#write(this.#stdout, '');
  }

  plain(message: string): void {
    this.#write(this.#stdout, message);
  }

  heading(message: string): void {
    this.#write(this.#stdout, this.#chalk.bold(message));
  }

  info(message: string): void {
    this.#write(this.#stdout, `${this.#chalk.cyan(this.#symbols.info)} ${message}`);
  }

  success(message: string): void {
    this.#write(this.#stdout, `${this.#chalk.green(this.#symbols.success)} ${message}`);
  }

  warn(message: string): void {
    this.#write(this.#stderr, `${this.#chalk.yellow(this.#symbols.warning)} ${message}`);
  }

  error(message: string): void {
    this.#write(this.#stderr, `${this.#chalk.red(this.#symbols.error)} ${message}`);
  }

  debug(message: string): void {
    if (!this.#verbose) return;
    this.#write(this.#stderr, this.#chalk.dim(`[debug] ${message}`));
  }

  /** Secondary lines: hints, resolved paths, the "why" under a headline message. */
  detail(message: string): void {
    this.#write(this.#stdout, this.#chalk.dim(`  ${message}`));
  }

  list(items: readonly string[]): void {
    for (const item of items) {
      this.#write(this.#stdout, this.#chalk.dim(`  ${this.#symbols.bullet} ${item}`));
    }
  }

  /**
   * `detail` and `list` on stderr.
   *
   * A failure's hint, offending paths and docs link belong with the failure itself:
   * splitting one message across two streams makes `2>/dev/null` hide the headline and
   * keep the orphaned explanation.
   */
  errorDetail(message: string): void {
    this.#write(this.#stderr, this.#chalk.dim(`  ${message}`));
  }

  errorList(items: readonly string[]): void {
    for (const item of items) {
      this.#write(this.#stderr, this.#chalk.dim(`  ${this.#symbols.bullet} ${item}`));
    }
  }

  task(text: string): TaskHandle {
    this.#activeTask?.stop();
    this.#activeTask = undefined;

    if (!this.#spinnersEnabled()) {
      this.info(text);
      return this.#staticHandle();
    }

    const spinner = ora({
      text,
      // ora demands a full `NodeJS.WritableStream`, while Atlas programs against the narrower
      // `OutputStream` so tests can inject a buffer — hence the cast. ora only ever calls
      // `write` on it.
      stream: this.#stderr as unknown as NodeJS.WritableStream,
    }).start();
    this.#activeTask = spinner;
    return this.#spinnerHandle(spinner);
  }

  // Diagnostics (warn/error/debug) go to stderr so stdout stays clean enough to pipe.
  #write(stream: OutputStream, line: string): void {
    const task = this.#activeTask;
    // ora's documented interleaving pattern: erase the spinner line, write, then redraw it.
    task?.clear();
    stream.write(`${line}\n`);
    task?.render();
  }

  // An animated spinner is noise rather than progress in a log file or a CI transcript.
  #spinnersEnabled(): boolean {
    return this.#stderr.isTTY === true && this.#color && process.env['CI'] === undefined;
  }

  #spinnerHandle(spinner: Ora): TaskHandle {
    return {
      update: (text: string): void => {
        spinner.text = text;
      },
      succeed: (text?: string): void => {
        this.#release(spinner);
        spinner.succeed(text);
      },
      warn: (text?: string): void => {
        this.#release(spinner);
        spinner.warn(text);
      },
      fail: (text?: string): void => {
        this.#release(spinner);
        spinner.fail(text);
      },
      stop: (): void => {
        this.#release(spinner);
        spinner.stop();
      },
    };
  }

  // Without a spinner the task text is already on screen, so a terminal call that carries no new
  // text has nothing left to say.
  #staticHandle(): TaskHandle {
    return {
      update: noop,
      succeed: (text?: string): void => {
        if (text !== undefined) this.success(text);
      },
      warn: (text?: string): void => {
        if (text !== undefined) this.warn(text);
      },
      fail: (text?: string): void => {
        if (text !== undefined) this.error(text);
      },
      stop: noop,
    };
  }

  #release(spinner: Ora): void {
    if (this.#activeTask === spinner) this.#activeTask = undefined;
  }
}
