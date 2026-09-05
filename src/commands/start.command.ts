import type { Command } from 'commander';

import { CLI_NAME } from '../constants/branding.js';

import type { CommandContext } from './register-commands.js';
import { runStart } from './start/start-runner.js';

interface StartFlags {
  readonly language?: unknown;
  readonly skipInstall?: unknown;
  readonly skipGit?: unknown;
}

/**
 * `atlas start <name>` — scaffolds a new full-stack project.
 *
 * The odd one out among Atlas's commands: everything else generates *into* a project the user
 * already has, and this creates one. Aliased as `new` and `create` because those are the two
 * words people reach for when a tool has no `start`, and having all three cost nothing is
 * better than having a user guess wrong and read an error.
 *
 * The command itself only parses. Everything it does lives in `start/`, on the same principle
 * that keeps the generator commands thin: argument parsing and the work are different jobs, and
 * only one of them is testable without a terminal.
 */
export function registerStartCommand(program: Command, context: CommandContext): void {
  program
    .command('start')
    .alias('new')
    .alias('create')
    .argument('<name>', 'Directory to create the project in. Also its package name.')
    .description('Scaffold a new full-stack project: an Express API and a React client.')
    .option('--language <js|ts>', 'Language for both halves. Asked for when omitted.')
    .option('--skip-install', 'Write the project without installing dependencies.', false)
    .option('--skip-git', 'Do not initialise a Git repository.', false)
    .addHelpText(
      'after',
      `\nThe client and the server are independent packages. Example:\n  ${CLI_NAME} start my-app --language ts`,
    )
    .action(async (name: string, flags: StartFlags) => {
      await runStart({
        context,
        name,
        // Passed through unvalidated: `--language` is parsed where its accepted spellings are
        // declared, so the flag's vocabulary lives in one file rather than two.
        language: flags.language,
        skipInstall: flags.skipInstall === true,
        skipGit: flags.skipGit === true,
      });
    });
}
