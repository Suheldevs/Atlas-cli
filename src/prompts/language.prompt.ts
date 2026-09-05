import { UsageError } from '../errors/atlas-error.js';
import type { Language } from '../types/project-context.js';
import type { Choice, PromptRunner } from '../types/prompts.js';

/**
 * Spellings `--language` accepts, mapped to the canonical value.
 *
 * `js` and `ts` are here because they are what people type. Accepting both forms costs one
 * table entry and removes the only way to get this flag wrong.
 */
const LANGUAGE_ALIASES: Readonly<Record<string, Language>> = {
  js: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
};

/**
 * The answer given when nobody can be asked.
 *
 * JavaScript rather than TypeScript, because it is the choice that cannot go wrong: a
 * JavaScript project runs under plain `node`, while a TypeScript one is only useful to someone
 * who wanted a build step. Under `--yes` or in CI there is no human to correct a wrong guess,
 * so the guess has to be the undemanding one.
 */
export const DEFAULT_LANGUAGE: Language = 'javascript';

const CHOICES: readonly Choice<Language>[] = [
  {
    label: 'JavaScript',
    value: 'javascript',
    description: 'Plain ESM. Runs under node with no build step.',
  },
  {
    label: 'TypeScript',
    value: 'typescript',
    description: 'Typed sources, with tsconfig and a build script wired up.',
  },
];

/**
 * Turns the raw `--language` value into a `Language`.
 *
 * Rejected as usage rather than defaulted quietly: a typo like `--language typscript` means the
 * user had an opinion, and silently scaffolding the other language would only be discovered
 * after the project exists.
 */
export function parseLanguageFlag(value: unknown): Language {
  if (typeof value !== 'string') {
    throw new UsageError(
      '--language needs a value.',
      'Pass one of: js, javascript, ts, typescript.',
    );
  }

  const language = LANGUAGE_ALIASES[value.trim().toLowerCase()];

  if (language === undefined) {
    throw new UsageError(
      `'${value}' is not a language Atlas can scaffold.`,
      'Pass one of: js, javascript, ts, typescript.',
    );
  }

  return language;
}

/**
 * The flag when it was given, the user's answer when it was not.
 *
 * Asked through the `PromptRunner` rather than by reaching for `@inquirer/prompts` directly, so
 * that `--yes`, a piped stdin and CI all resolve to `DEFAULT_LANGUAGE` through the same gate
 * every other question in Atlas goes through — and so this function is testable without a
 * terminal.
 */
export async function resolveLanguage(flag: unknown, prompts: PromptRunner): Promise<Language> {
  if (flag !== undefined) {
    return parseLanguageFlag(flag);
  }

  return prompts.select<Language>({
    message: 'Which language should the project use?',
    choices: CHOICES,
    defaultValue: DEFAULT_LANGUAGE,
  });
}
