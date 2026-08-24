import type { Command } from 'commander';

import type { GeneratorRegistry } from '../registry/generator-registry.js';
import { CLI_NAME } from '../constants/branding.js';

import { createGeneratorCommand } from './generator-command.js';
import type { CommandContext } from './register-commands.js';

/**
 * `atlas add <generator>` — the canonical spelling.
 *
 * Every registered generator becomes a real subcommand rather than a string argument, so
 * `atlas add --help` lists what is available and each generator's own flags are parsed and
 * validated by Commander instead of by hand.
 */
export function registerAddCommand(
  program: Command,
  context: CommandContext,
  registry: GeneratorRegistry,
): void {
  const add = program
    .command('add')
    .description('Generate a module into the current project.')
    .addHelpText(
      'after',
      `\nRun \`${CLI_NAME} list\` to see which generators apply to this project.`,
    );

  for (const entry of registry.list()) {
    add.addCommand(createGeneratorCommand(entry, context));
  }

  // With no generators registered, `add` would otherwise print an empty command list and
  // exit 0, which reads like success. Say what is actually going on.
  if (registry.size === 0) {
    add.action(() => {
      context.reporter.info('No generators are registered yet.');
      context.reporter.detail('Built-in generators arrive with the template system.');
    });
  }
}
