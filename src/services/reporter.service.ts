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
  readonly mark: string;
  /** Tree drawing: a child with siblings below it, the last child, and the two spacers. */
  readonly treeBranch: string;
  readonly treeLast: string;
  readonly treeGuide: string;
  readonly treeGap: string;
  readonly ellipsis: string;
}

const UNICODE_SYMBOLS: SymbolSet = {
  success: '✔',
  error: '✖',
  warning: '⚠',
  info: 'ℹ',
  bullet: '•',
  arrow: '→',
  mark: '◆',
  treeBranch: '├── ',
  treeLast: '└── ',
  treeGuide: '│   ',
  treeGap: '    ',
  ellipsis: '…',
};

const ASCII_SYMBOLS: SymbolSet = {
  success: '√',
  error: '×',
  warning: '!',
  info: 'i',
  bullet: '-',
  arrow: '>',
  mark: '*',
  treeBranch: '|-- ',
  treeLast: '`-- ',
  treeGuide: '|   ',
  treeGap: '    ',
  ellipsis: '...',
};

export interface TreeOptions {
  /** Children drawn per directory before the remainder is summarised. Defaults to 12. */
  readonly maxChildren?: number;
}

/** One directory level while a tree is being assembled. Leaves simply have no children. */
interface TreeNode {
  readonly children: Map<string, TreeNode>;
}

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

  /**
   * Stops whatever spinner is running, if any.
   *
   * Exists for the paths that leave in a hurry — a signal handler, a top-level failure — where
   * the spinner is still animating and, more importantly, ora is still holding the terminal
   * cursor hidden. Safe to call when nothing is running.
   */
  stopTask(): void {
    this.#activeTask?.stop();
    this.#activeTask = undefined;
  }

  /**
   * One task in a sequence of known length, prefixed `[2/5]`.
   *
   * The counter is re-applied to every later message rather than written once, because ora
   * redraws the whole line on `succeed` — without this the counter would vanish exactly when
   * the line becomes permanent, leaving a finished transcript that no longer says where it got
   * to.
   */
  step(index: number, total: number, text: string): TaskHandle {
    const prefix = this.#chalk.dim(`[${String(index)}/${String(total)}]`);
    const handle = this.task(`${prefix} ${text}`);
    const decorate = (message?: string): string | undefined =>
      message === undefined ? undefined : `${prefix} ${message}`;

    return {
      update: (message: string): void => {
        handle.update(`${prefix} ${message}`);
      },
      succeed: (message?: string): void => {
        handle.succeed(decorate(message));
      },
      warn: (message?: string): void => {
        handle.warn(decorate(message));
      },
      fail: (message?: string): void => {
        handle.fail(decorate(message));
      },
      stop: (): void => {
        handle.stop();
      },
    };
  }

  /**
   * Masthead for a long-running command.
   *
   * Kept to two lines on purpose: a banner earns its space by telling the user which version of
   * Atlas is about to write to their disk, and stops earning it the moment it becomes ASCII art
   * they scroll past.
   */
  banner(title: string, subtitle?: string): void {
    this.blank();
    this.#write(this.#stdout, `${this.#chalk.cyan(this.#symbols.mark)} ${this.#chalk.bold(title)}`);

    if (subtitle !== undefined) {
      this.#write(this.#stdout, this.#chalk.dim(`  ${subtitle}`));
    }

    this.blank();
  }

  /**
   * A command the user is meant to type, set apart from the prose around it.
   *
   * The `$` is dimmed and the command is not, so a copy-paste that grabs the whole line is
   * still visibly wrong rather than silently broken.
   */
  command(text: string): void {
    this.#write(this.#stdout, `    ${this.#chalk.dim('$')} ${this.#chalk.cyan(text)}`);
  }

  /**
   * Draws `paths` as a directory tree under `label`.
   *
   * Paths arrive flat because that is what a generation result contains; the nesting is
   * reconstructed here so that callers never have to. Wide directories are truncated rather
   * than printed in full — a scaffold writes upwards of fifty files, and a summary the user has
   * to scroll is a summary they will not read.
   */
  tree(label: string, paths: readonly string[], options: TreeOptions = {}): void {
    const maxChildren = options.maxChildren ?? 12;
    const root: TreeNode = { children: new Map() };

    for (const path of paths) {
      let node = root;
      for (const segment of path.split(/[/\\]/u).filter((part) => part !== '')) {
        let child = node.children.get(segment);
        if (child === undefined) {
          child = { children: new Map() };
          node.children.set(segment, child);
        }
        node = child;
      }
    }

    this.#write(this.#stdout, this.#chalk.bold(label));
    this.#writeTreeLevel(root, '', maxChildren);
  }

  #writeTreeLevel(node: TreeNode, indent: string, maxChildren: number): void {
    // Directories first, then files, each alphabetical — the ordering every file browser uses,
    // and the one that makes a generated layout comparable between runs.
    const entries = [...node.children.entries()].sort(([leftName, left], [rightName, right]) => {
      const leftIsDirectory = left.children.size > 0;
      const rightIsDirectory = right.children.size > 0;
      if (leftIsDirectory !== rightIsDirectory) return leftIsDirectory ? -1 : 1;
      return leftName.localeCompare(rightName);
    });

    const shown = entries.slice(0, maxChildren);
    const hidden = entries.length - shown.length;

    for (const [index, entry] of shown.entries()) {
      const [name, child] = entry;
      const isLast = index === shown.length - 1 && hidden === 0;
      const connector = isLast ? this.#symbols.treeLast : this.#symbols.treeBranch;
      const isDirectory = child.children.size > 0;
      const rendered = isDirectory ? this.#chalk.bold(`${name}/`) : name;

      this.#write(this.#stdout, `${indent}${this.#chalk.dim(connector)}${rendered}`);

      if (isDirectory) {
        const guide = isLast ? this.#symbols.treeGap : this.#symbols.treeGuide;
        this.#writeTreeLevel(child, `${indent}${this.#chalk.dim(guide)}`, maxChildren);
      }
    }

    if (hidden > 0) {
      const connector = this.#chalk.dim(this.#symbols.treeLast);
      const summary = `${this.#symbols.ellipsis} ${String(hidden)} more`;
      this.#write(this.#stdout, `${indent}${connector}${this.#chalk.dim(summary)}`);
    }
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
