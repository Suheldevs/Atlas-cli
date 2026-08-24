import { Command } from 'commander';

import type { RegisteredGenerator } from '../registry/generator-registry.js';

import { runGenerator } from './generator-runner.js';
import type { CommandContext } from './register-commands.js';

/**
 * Builds the Commander command for one generator, from that generator's own metadata.
 *
 * Used for both spellings — `atlas add logger` and the `atlas logger` shortcut — so the two
 * cannot drift, and so declaring a flag in `GeneratorMeta` is all a generator author has to
 * do to get it parsed and documented.
 */
export function createGeneratorCommand(
  entry: RegisteredGenerator,
  context: CommandContext,
): Command {
  const { meta } = entry.generator;
  const command = new Command(meta.name).description(meta.summary);

  for (const alias of meta.aliases) {
    command.alias(alias);
  }

  if (meta.argument !== undefined) {
    const { name, description, required } = meta.argument;
    command.argument(required ? `<${name}>` : `[${name}]`, description);
  }

  for (const flag of meta.flags) {
    if (flag.defaultValue === undefined) {
      command.option(flag.flag, flag.description);
    } else {
      command.option(flag.flag, flag.description, flag.defaultValue);
    }
  }

  command.action(async (...actionArguments: readonly unknown[]) => {
    // Commander passes the Command last and the declared positionals before it, so reading
    // the positional off `command.args` keeps this correct whether or not one was declared.
    const invoked = actionArguments.at(-1);
    const self = invoked instanceof Command ? invoked : command;

    await runGenerator({
      context,
      entry,
      invocation: {
        argument: meta.argument === undefined ? undefined : self.args[0],
        flags: self.opts<Record<string, unknown>>(),
      },
    });
  });

  return command;
}
