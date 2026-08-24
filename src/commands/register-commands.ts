import type { Command } from 'commander';

import type { ExitCode } from '../constants/exit-codes.js';
import type { ProjectScanner } from '../detection/index.js';
import type { Clock } from '../services/clock.service.js';
import type { FileSystemService } from '../services/filesystem.service.js';
import type { ProcessService } from '../services/process.service.js';
import type { Reporter } from '../services/reporter.service.js';
import type { GlobalOptions } from '../types/cli-options.js';

import type { GeneratorRegistry } from '../registry/generator-registry.js';

import { registerAddCommand } from './add.command.js';
import { registerDoctorCommand } from './doctor.command.js';
import { registerInfoCommand } from './info.command.js';
import { registerListCommand } from './list.command.js';
import { registerShortcuts } from './shortcuts.js';

/**
 * Everything a command is allowed to reach for.
 *
 * Passed explicitly rather than imported, so a command test constructs its own context with
 * in-memory fakes instead of monkey-patching modules.
 */
export interface CommandContext {
  readonly reporter: Reporter;
  readonly processes: ProcessService;
  readonly fs: FileSystemService;
  readonly clock: Clock;
  readonly scanner: ProjectScanner;
  /** Resolved global flags. A function because they are parsed after the context is built. */
  readonly globals: () => GlobalOptions;
  /**
   * Commander discards action return values, so a command that completes but wants a
   * non-zero status reports it here instead of calling `process.exit`.
   */
  readonly setExitCode: (code: ExitCode) => void;
}

/**
 * The single wiring point for the command tree.
 *
 * `cli.ts` never imports individual commands, so adding one touches this file and nothing
 * else. Generator-backed subcommands are registered from the registry in a later phase, not
 * hand-listed here.
 */
export function registerCommands(
  program: Command,
  context: CommandContext,
  registry: GeneratorRegistry,
): void {
  registerDoctorCommand(program, context);
  registerInfoCommand(program, context);
  registerListCommand(program, context, registry);
  registerAddCommand(program, context, registry);

  // Registered last so a generator shortcut cannot shadow a built-in command that was
  // already claimed above.
  registerShortcuts(program, context, registry);
}
