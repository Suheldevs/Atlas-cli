/**
 * Interaction contract.
 *
 * Declared here rather than in `src/prompts/` so generators can depend on the shape
 * without depending on the implementation — and so a test can satisfy it with a scripted
 * answer list instead of a terminal.
 */

export interface TextQuestion {
  readonly message: string;
  readonly defaultValue: string | undefined;
  /** Returns an error message when the answer is unusable, or undefined when it is fine. */
  readonly validate: ((value: string) => string | undefined) | undefined;
}

export interface ConfirmQuestion {
  readonly message: string;
  readonly defaultValue: boolean;
}

export interface Choice<TValue> {
  readonly label: string;
  readonly value: TValue;
  readonly description: string | undefined;
}

export interface SelectQuestion<TValue> {
  readonly message: string;
  readonly choices: readonly Choice<TValue>[];
  readonly defaultValue: TValue | undefined;
}

/**
 * Every question has a default, because every question must be answerable without a
 * human. `--yes`, a CI environment, and a piped stdin all take the default rather than
 * hanging on a prompt nobody can see.
 */
export interface PromptRunner {
  /** True when questions will actually be shown. */
  readonly interactive: boolean;
  text(question: TextQuestion): Promise<string>;
  confirm(question: ConfirmQuestion): Promise<boolean>;
  select<TValue>(question: SelectQuestion<TValue>): Promise<TValue>;
  multiSelect<TValue>(question: SelectQuestion<TValue>): Promise<readonly TValue[]>;
}
