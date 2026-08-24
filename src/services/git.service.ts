import { AtlasError } from '../errors/atlas-error.js';
import { ErrorCode } from '../errors/error-catalog.js';

import type { ProcessRunner, RunResult } from './process.service.js';

export interface GitService {
  isAvailable(): Promise<boolean>;
  isRepository(cwd: string): Promise<boolean>;
  /**
   * True when the working tree has changes Git has not recorded.
   *
   * This is what lets a caller warn before it starts writing: in a clean tree every edit Atlas
   * makes can be undone with `git checkout`, and in a dirty one the user's own uncommitted work
   * is mixed in with Atlas's and can no longer be separated that way.
   */
  hasUncommittedChanges(cwd: string): Promise<boolean>;
  init(cwd: string): Promise<void>;
  currentBranch(cwd: string): Promise<string | undefined>;
}

const GIT = 'git';

/**
 * Local Git operations are fast; a long stall is a credential prompt or a hung network mount,
 * and neither is worth blocking a generation run on indefinitely. `git status` on a very large
 * repository is the slowest legitimate call here, hence a budget well above what it needs.
 */
const GIT_TIMEOUT_MS = 30_000;

export class GitCommandService implements GitService {
  readonly #processes: ProcessRunner;

  constructor(processes: ProcessRunner) {
    this.#processes = processes;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.#processes.probeVersion(GIT)) !== undefined;
  }

  async isRepository(cwd: string): Promise<boolean> {
    const result = await this.#run(['rev-parse', '--is-inside-work-tree'], cwd);
    // Outside a repository Git exits non-zero; inside a bare one it succeeds and prints `false`.
    return !result.failed && result.stdout.trim() === 'true';
  }

  async hasUncommittedChanges(cwd: string): Promise<boolean> {
    const result = await this.#run(['status', '--porcelain'], cwd);
    // A directory that is not a repository has no recorded state to lose, so it is not "dirty".
    if (result.failed) return false;

    return result.stdout.trim() !== '';
  }

  async init(cwd: string): Promise<void> {
    if (!(await this.isAvailable())) {
      throw new AtlasError({
        code: ErrorCode.GitUnavailable,
        message: 'Git is required to initialise a repository, but it is not installed.',
        hint: 'Install Git from https://git-scm.com/downloads, or skip repository setup.',
      });
    }

    const result = await this.#run(['init'], cwd);

    if (result.failed) {
      throw new AtlasError({
        code: ErrorCode.CommandFailed,
        message: `\`${result.command}\` failed with exit code ${String(result.exitCode)}.`,
        hint: `Run \`${result.command}\` in ${cwd} to see the full output.`,
        details: result.stderr.trim() === '' ? [] : [result.stderr.trim()],
      });
    }
  }

  async currentBranch(cwd: string): Promise<string | undefined> {
    const result = await this.#run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    if (result.failed) return undefined;

    const branch = result.stdout.trim();
    // A repository with no commits yet, and a detached HEAD, both answer the literal `HEAD`,
    // which is not a branch a caller can print or check out.
    if (branch === '' || branch === 'HEAD') return undefined;

    return branch;
  }

  async #run(args: readonly string[], cwd: string): Promise<RunResult> {
    return this.#processes.run(GIT, args, { cwd, timeoutMs: GIT_TIMEOUT_MS });
  }
}
