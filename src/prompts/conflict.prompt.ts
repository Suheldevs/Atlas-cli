import type { ConflictAsk, ConflictChoice, FileConflict } from '../engine/conflict/index.js';
import { renderUnifiedDiff } from '../engine/conflict/index.js';
import type { Reporter } from '../services/reporter.service.js';
import type { Choice, PromptRunner } from '../types/prompts.js';

export interface ConflictPromptOptions {
  readonly reporter: Reporter;
  readonly prompts: PromptRunner;
  /** Whether the rendered diff may use ANSI colour. Mirrors the resolved `--no-color`. */
  readonly color: boolean;
}

/**
 * `diff` is not a decision — it is a request for more information, after which the same
 * question is asked again. Keeping it out of `ConflictChoice` is what lets the resolver's
 * return type be exhaustive; the loop below is where the distinction is handled.
 */
type MenuChoice = ConflictChoice | 'diff';

const MENU: readonly Choice<MenuChoice>[] = [
  {
    label: 'Skip — keep my version',
    value: 'skip',
    description: 'Leave the file exactly as it is.',
  },
  {
    label: 'Back up and replace',
    value: 'backup',
    description: 'Copy the current file alongside it, then write the new one.',
  },
  {
    label: 'Show diff',
    value: 'diff',
    description: 'Print the changes, then ask again.',
  },
  {
    label: 'Overwrite — discard my version',
    value: 'overwrite',
    description: 'Replace the file. The current contents are lost.',
  },
  {
    label: 'Abort',
    value: 'abort',
    description: 'Stop now. Nothing is written.',
  },
];

/**
 * Builds the interactive conflict question.
 *
 * Returned as a `ConflictAsk` callback rather than being reached for directly by the engine:
 * the engine has no business importing a prompt library, and a test can answer conflicts with
 * a two-line function instead of a terminal.
 *
 * Menu order is deliberate. `skip` is first so the least destructive answer is the one a user
 * selects by reflex, and `overwrite` sits below `diff` so nobody reaches it without having
 * scrolled past the offer to look first.
 */
export function createConflictPrompt(options: ConflictPromptOptions): ConflictAsk {
  const { reporter, prompts, color } = options;

  return async function ask(conflict: FileConflict): Promise<ConflictChoice> {
    reporter.blank();
    reporter.warn(`${conflict.path} already exists and differs from what Atlas would write.`);

    for (;;) {
      const choice = await prompts.select<MenuChoice>({
        message: 'What should Atlas do?',
        choices: MENU,
        defaultValue: 'skip',
      });

      if (choice !== 'diff') {
        return choice;
      }

      showDiff(conflict, reporter, color);
    }
  };
}

function showDiff(conflict: FileConflict, reporter: Reporter, color: boolean): void {
  reporter.blank();

  const diff = renderUnifiedDiff(conflict.existing ?? '', conflict.incoming, {
    color,
    existingLabel: `${conflict.path} (yours)`,
    incomingLabel: `${conflict.path} (Atlas)`,
  });

  // Written verbatim through `plain`, because the renderer already owns every prefix,
  // marker and colour in its output. Re-decorating it here would corrupt the diff.
  for (const line of diff.split('\n')) {
    reporter.plain(line);
  }

  reporter.blank();
}

/**
 * The answer used when nobody can be asked.
 *
 * Always `backup`: `--yes` and CI mean no human is watching, and the destructive answer must
 * never be the one Atlas picks on someone's behalf. A recoverable surprise is acceptable; an
 * unrecoverable one is not. The resolver applies this rule itself, so this exists for callers
 * that need an `ask` callback which will never actually be consulted.
 */
export const nonInteractiveConflictAsk: ConflictAsk = () => Promise.resolve('backup');
