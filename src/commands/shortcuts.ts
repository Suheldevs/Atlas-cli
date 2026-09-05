import type { Command } from 'commander';

import type { GeneratorRegistry } from '../registry/generator-registry.js';

import { createGeneratorCommand } from './generator-command.js';
import type { CommandContext } from './register-commands.js';

/** Command names a generator must never shadow. */
const RESERVED = new Set([
  'add',
  'start',
  'new',
  'create',
  'list',
  'ls',
  'info',
  'doctor',
  'help',
  'generate',
  'g',
]);

/**
 * Registers `atlas <generator>` as a top-level alias of `atlas add <generator>`.
 *
 * Generated from the registry rather than hand-listed, so a new generator gets its shortcut
 * for free and the two spellings cannot disagree. A generator whose name collides with a
 * built-in command is skipped here and remains reachable as `atlas add <name>` — silently
 * shadowing `atlas list` would be far worse than requiring the longer form.
 */
export function registerShortcuts(
  program: Command,
  context: CommandContext,
  registry: GeneratorRegistry,
): void {
  for (const entry of registry.list()) {
    if (RESERVED.has(entry.generator.meta.name)) {
      context.reporter.debug(
        `not registering shortcut for "${entry.generator.meta.name}": reserved command name`,
      );
      continue;
    }

    program.addCommand(createGeneratorCommand(entry, context), { hidden: true });
  }
}
