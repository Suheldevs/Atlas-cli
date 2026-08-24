import { resolve } from 'node:path';

import type { Command } from 'commander';
import type { GlobalOptions } from '../types/cli-options.js';

/**
 * Global flags taking no value. `--color` is accepted as the explicit opposite of
 * `--no-color` so scripts can force colour back on.
 */
const BOOLEAN_GLOBAL_FLAGS: ReadonlySet<string> = new Set([
  '-y',
  '--yes',
  '--dry-run',
  '-v',
  '--verbose',
  '--no-color',
  '--color',
]);

const VALUE_GLOBAL_FLAGS: ReadonlySet<string> = new Set(['--cwd']);

/** Shape Commander hands back from `opts()`, before validation. */
interface RawGlobalOptions {
  readonly cwd?: unknown;
  readonly yes?: unknown;
  readonly dryRun?: unknown;
  readonly verbose?: unknown;
  readonly color?: unknown;
}

/** Declares the flags that apply to every command. Only ever attached to the root. */
export function applyGlobalOptions(command: Command): Command {
  return command
    .option('--cwd <path>', 'Directory to operate on.', process.cwd())
    .option('-y, --yes', 'Accept every prompt using its default answer.', false)
    .option('--dry-run', 'Report what would change without writing anything.', false)
    .option('-v, --verbose', 'Print diagnostic output and full stack traces.', false)
    .option('--no-color', 'Disable coloured output.');
}

/**
 * Moves global flags to the front of the argument list.
 *
 * Commander attaches options to the command that declares them, so `atlas doctor
 * --verbose` would otherwise fail as an unknown option — even though every user expects
 * it to work. Declaring the same flags on every subcommand is the usual workaround, but
 * then each subcommand's defaults silently override a value given before the command
 * name. Reordering the tokens keeps one declaration site and accepts both positions.
 *
 * Anything after `--` is left untouched: those tokens belong to whatever Atlas forwards
 * them to, not to Atlas.
 */
export function hoistGlobalFlags(argv: readonly string[]): string[] {
  const hoisted: string[] = [];
  const remainder: string[] = [];
  let forwarding = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }

    if (forwarding) {
      remainder.push(token);
      continue;
    }

    if (token === '--') {
      forwarding = true;
      remainder.push(token);
      continue;
    }

    if (BOOLEAN_GLOBAL_FLAGS.has(token)) {
      hoisted.push(token);
      continue;
    }

    const [name] = token.split('=', 1);
    if (name !== undefined && VALUE_GLOBAL_FLAGS.has(name)) {
      hoisted.push(token);

      // `--cwd path` consumes the next token; `--cwd=path` already carries its value.
      if (!token.includes('=')) {
        const value = argv[index + 1];
        if (value !== undefined) {
          hoisted.push(value);
          index += 1;
        }
      }
      continue;
    }

    remainder.push(token);
  }

  return [...hoisted, ...remainder];
}

/**
 * Reads `--cwd` before Commander runs.
 *
 * Generator subcommands are built from the registry, and the registry depends on which
 * plugins the *target* project declares — so the working directory has to be known before
 * the command tree can be registered, which is strictly earlier than parsing.
 */
export function prescanCwd(argv: readonly string[]): string {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }

    if (token === '--cwd') {
      const value = argv[index + 1];
      if (value !== undefined) {
        return resolve(value);
      }
    }

    if (token.startsWith('--cwd=')) {
      return resolve(token.slice('--cwd='.length));
    }
  }

  return process.cwd();
}

export function resolveGlobalOptions(raw: RawGlobalOptions): GlobalOptions {
  return {
    cwd: typeof raw.cwd === 'string' ? resolve(raw.cwd) : process.cwd(),
    yes: raw.yes === true,
    dryRun: raw.dryRun === true,
    verbose: raw.verbose === true,
    // Commander reports `--no-color` as `color: false`; the environment can veto colour
    // even when the flag is absent.
    color: raw.color !== false && environmentAllowsColor(),
  };
}

/**
 * Read straight from argv, before Commander parses anything.
 *
 * The reporter has to exist early enough to render a parse error, and that error should
 * already respect `--no-color` and `--verbose`.
 */
export function prescanPresentation(argv: readonly string[]): {
  readonly color: boolean;
  readonly verbose: boolean;
} {
  const forcedOff = argv.includes('--no-color');
  const forcedOn = argv.includes('--color');

  return {
    color: forcedOn || (!forcedOff && environmentAllowsColor()),
    verbose: argv.includes('--verbose') || argv.includes('-v'),
  };
}

/**
 * Only the hard vetoes. Depth detection and TTY checks are chalk's job, and duplicating
 * them here would let the two disagree.
 */
function environmentAllowsColor(): boolean {
  return process.env['NO_COLOR'] === undefined && process.env['TERM'] !== 'dumb';
}
