import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import {
  applyGlobalOptions,
  hoistGlobalFlags,
  prescanCwd,
  prescanPresentation,
  resolveGlobalOptions,
} from './commands/global-options.js';
import { registerCommands, type CommandContext } from './commands/register-commands.js';
import { getPackageMeta } from './config/package-meta.js';
import { CLI_NAME } from './constants/branding.js';
import { ExitCode } from './constants/exit-codes.js';
import { ConfigLoader } from './config/config-loader.js';
import { ProjectScanner, readManifest } from './detection/index.js';
import { presentError } from './errors/error-presenter.js';
import { discoverGenerators } from './registry/discovery.js';
import { SystemClock } from './services/clock.service.js';
import { NodeFileSystemService } from './services/filesystem.service.js';
import { ProcessService } from './services/process.service.js';
import { Reporter, type OutputStream } from './services/reporter.service.js';
import type { GlobalOptions } from './types/cli-options.js';

export interface CliRunOptions {
  /** Arguments without the `node` and script entries. Defaults to `process.argv.slice(2)`. */
  readonly argv?: readonly string[] | undefined;
  readonly stdout?: OutputStream | undefined;
  readonly stderr?: OutputStream | undefined;
}

/**
 * Runs Atlas and resolves with the exit status it earned.
 *
 * Deliberately does not touch `process.exitCode` or install signal handlers: that keeps
 * the whole CLI callable from a test without spawning a process. `main` adds the
 * process-level concerns.
 */
export async function run(options: CliRunOptions = {}): Promise<ExitCode> {
  const argv = hoistGlobalFlags(options.argv ?? process.argv.slice(2));
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  const presentation = prescanPresentation(argv);
  const reporter = new Reporter({ stdout, stderr, ...presentation });

  const earlyCwd = prescanCwd(argv);

  let exitCode: ExitCode = ExitCode.Success;
  let globals: GlobalOptions = {
    cwd: earlyCwd,
    yes: false,
    dryRun: false,
    verbose: presentation.verbose,
    color: presentation.color,
  };

  const fs = new NodeFileSystemService();

  const context: CommandContext = {
    reporter,
    processes: new ProcessService(),
    fs,
    clock: new SystemClock(),
    scanner: new ProjectScanner({ fs }),
    globals: () => globals,
    setExitCode: (code) => {
      exitCode = code;
    },
  };

  const program = buildProgram({ stdout, stderr });

  // Runs after parsing succeeds but before any command body, which is the first moment
  // the real flag values are known.
  program.hook('preAction', (rootCommand) => {
    globals = resolveGlobalOptions(rootCommand.opts());
    reporter.configure({ color: globals.color, verbose: globals.verbose });
  });

  try {
    // Discovery has to precede registration: each generator becomes a real subcommand with
    // its own arguments and flags, and which generators exist depends on the target project's
    // plugins. Only the manifest is read here, not a full project scan — that happens when a
    // generator actually runs.
    const loaded = await new ConfigLoader({ fs, reporter }).load(earlyCwd);

    const registry = await discoverGenerators({
      fs,
      reporter,
      root: earlyCwd,
      manifest: await readManifest(fs, earlyCwd),
      configuredPlugins: loaded.config.plugins,
    });

    registerCommands(program, context, registry);

    await program.parseAsync(argv, { from: 'user' });
    return exitCode;
  } catch (error) {
    return presentError(error, reporter, { verbose: reporter.verbose });
  }
}

/**
 * Process-level entry point used by `bin/atlas.js`.
 *
 * Sets `process.exitCode` rather than calling `process.exit`, so buffered stdout is
 * flushed before Node leaves — piping `atlas --help` into `head` truncates output
 * otherwise.
 */
export async function main(argv: readonly string[] = process.argv): Promise<void> {
  installInterruptHandler();
  process.exitCode = await run({ argv: argv.slice(2) });
}

interface ProgramStreams {
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
}

function buildProgram(streams: ProgramStreams): Command {
  const meta = getPackageMeta();

  const program = new Command()
    .name(CLI_NAME)
    .description(meta.description)
    .version(meta.version, '-V, --version', 'Print the Atlas version.')
    .showHelpAfterError(`(run \`${CLI_NAME} --help\` for usage)`)
    .showSuggestionAfterError()
    // Atlas owns its exit codes, so Commander must raise instead of exiting: even
    // `--help` becomes an exception, which `presentError` maps back to success.
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        streams.stdout.write(text);
      },
      writeErr: (text) => {
        streams.stderr.write(text);
      },
    });

  return applyGlobalOptions(program);
}

/**
 * Ctrl+C during a prompt has to terminate immediately — the prompt owns stdin and would
 * otherwise keep the process alive — so this is one of the few justified `process.exit`
 * calls. The newline stops the shell prompt from landing on a half-drawn spinner line.
 */
function installInterruptHandler(): void {
  process.once('SIGINT', () => {
    process.stderr.write('\n');
    process.exit(ExitCode.Interrupted);
  });
}

/**
 * True when this module is the program Node was asked to run, which is the case under
 * `tsx src/cli.ts` but not when `bin/atlas.js` imports the bundled entry.
 */
function isDirectInvocation(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }

  try {
    return resolve(entry) === resolve(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isDirectInvocation(import.meta.url)) {
  await main();
}
