import { checkbox, confirm, input, select } from '@inquirer/prompts';

import { UserAbortError } from '../errors/atlas-error.js';
import type { Reporter } from '../services/reporter.service.js';
import type {
  ConfirmQuestion,
  PromptRunner,
  SelectQuestion,
  TextQuestion,
} from '../types/prompts.js';

export interface PromptRunnerOptions {
  readonly reporter: Reporter;
  /** `--yes`: take every default without asking. */
  readonly assumeYes: boolean;
  /** Overridable for tests; defaults to whether stdin is a TTY. */
  readonly interactive?: boolean;
}

/**
 * Thrown by `@inquirer/prompts` when the user presses Ctrl+C at a prompt. Matched by name
 * rather than by importing the class, so an inquirer refactor cannot turn a clean
 * cancellation into an "unexpected error, please report this" message.
 */
function isPromptCancellation(error: unknown): boolean {
  return error instanceof Error && error.name === 'ExitPromptError';
}

/**
 * The one place Atlas decides whether to ask a question.
 *
 * Without a single gate here, every generator grows its own `if (options.yes)` branch and
 * the non-interactive path stops being exercised. Instead each question carries a default,
 * and this class decides whether the user ever sees it — so `--yes`, CI, and a piped stdin
 * all behave identically and are all testable.
 */
export class InteractivePromptRunner implements PromptRunner {
  readonly #reporter: Reporter;
  readonly #assumeYes: boolean;
  readonly #interactive: boolean;

  constructor(options: PromptRunnerOptions) {
    this.#reporter = options.reporter;
    this.#assumeYes = options.assumeYes;
    this.#interactive =
      options.interactive ??
      (process.stdin.isTTY === true && process.env['CI'] === undefined && !options.assumeYes);
  }

  get interactive(): boolean {
    return this.#interactive;
  }

  async text(question: TextQuestion): Promise<string> {
    if (!this.#interactive) {
      return this.#useDefault(question.message, question.defaultValue ?? '');
    }

    return this.#guard(async () =>
      input({
        message: question.message,
        ...(question.defaultValue === undefined ? {} : { default: question.defaultValue }),
        validate: (value: string) => question.validate?.(value) ?? true,
      }),
    );
  }

  async confirm(question: ConfirmQuestion): Promise<boolean> {
    if (!this.#interactive) {
      return this.#useDefault(question.message, question.defaultValue);
    }

    return this.#guard(async () =>
      confirm({ message: question.message, default: question.defaultValue }),
    );
  }

  async select<TValue>(question: SelectQuestion<TValue>): Promise<TValue> {
    const fallback = question.defaultValue ?? question.choices[0]?.value;

    if (!this.#interactive) {
      if (fallback === undefined) {
        throw new UserAbortError(`Cannot answer "${question.message}" without a default.`);
      }
      return this.#useDefault(question.message, fallback);
    }

    return this.#guard(async () =>
      select<TValue>({
        message: question.message,
        choices: question.choices.map((choice) => ({
          name: choice.label,
          value: choice.value,
          ...(choice.description === undefined ? {} : { description: choice.description }),
        })),
        ...(question.defaultValue === undefined ? {} : { default: question.defaultValue }),
      }),
    );
  }

  async multiSelect<TValue>(question: SelectQuestion<TValue>): Promise<readonly TValue[]> {
    if (!this.#interactive) {
      const fallback = question.defaultValue === undefined ? [] : [question.defaultValue];
      return this.#useDefault(question.message, fallback);
    }

    return this.#guard(async () =>
      checkbox<TValue>({
        message: question.message,
        choices: question.choices.map((choice) => ({
          name: choice.label,
          value: choice.value,
          checked: choice.value === question.defaultValue,
        })),
      }),
    );
  }

  /**
   * Non-interactive answers are logged at debug level rather than printed. In CI the whole
   * point is quiet output, but when something generated the wrong thing the first question
   * is always "what did it decide?" — so the answers must be recoverable with `--verbose`.
   */
  #useDefault<TValue>(message: string, value: TValue): TValue {
    this.#reporter.debug(`${message} → ${JSON.stringify(value)} (default)`);
    return value;
  }

  async #guard<TValue>(run: () => Promise<TValue>): Promise<TValue> {
    try {
      return await run();
    } catch (error) {
      if (isPromptCancellation(error)) {
        throw new UserAbortError();
      }
      throw error;
    }
  }
}

/** Answers questions from a fixed script. Used by tests and by `--dry-run` rehearsals. */
export class ScriptedPromptRunner implements PromptRunner {
  readonly interactive = false;
  readonly #answers: unknown[];
  #cursor = 0;

  constructor(answers: readonly unknown[] = []) {
    this.#answers = [...answers];
  }

  async text(question: TextQuestion): Promise<string> {
    return this.#next(question.defaultValue ?? '');
  }

  async confirm(question: ConfirmQuestion): Promise<boolean> {
    return this.#next(question.defaultValue);
  }

  async select<TValue>(question: SelectQuestion<TValue>): Promise<TValue> {
    const fallback = question.defaultValue ?? question.choices[0]?.value;
    return this.#next(fallback as TValue);
  }

  async multiSelect<TValue>(question: SelectQuestion<TValue>): Promise<readonly TValue[]> {
    const fallback = question.defaultValue === undefined ? [] : [question.defaultValue];
    return this.#next<readonly TValue[]>(fallback);
  }

  #next<TValue>(fallback: TValue): TValue {
    if (this.#cursor >= this.#answers.length) {
      return fallback;
    }

    const answer = this.#answers[this.#cursor];
    this.#cursor += 1;
    return answer as TValue;
  }
}
