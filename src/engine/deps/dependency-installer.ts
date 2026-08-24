import type { PackageManagerService } from '../../services/package-manager.service.js';
import type { Reporter } from '../../services/reporter.service.js';
import type { DependencyRequest } from '../../types/generation-plan.js';

import type { DependencyPlan } from './dependency-planner.js';
import { splitByKind, toSpecifiers } from './dependency-resolver.js';

export interface DependencyInstallerOptions {
  readonly packageManager: PackageManagerService;
  readonly reporter: Reporter;
}

export interface DependencyInstallOptions {
  /** Directory the manager runs in — the workspace install root in a monorepo. */
  readonly cwd: string;
  readonly dryRun: boolean;
}

/**
 * Executes the install half of a dependency plan.
 *
 * All of the deciding happens in `planDependencies`; this class only runs what was decided and
 * narrates it. Keeping the two apart is what lets the plan be tested without a package manager
 * and rendered without one either.
 */
export class DependencyInstaller {
  readonly #packageManager: PackageManagerService;
  readonly #reporter: Reporter;

  constructor(options: DependencyInstallerOptions) {
    this.#packageManager = options.packageManager;
    this.#reporter = options.reporter;
  }

  /** Returns the requests that actually reached the project, which is nothing on a dry run. */
  async install(
    plan: DependencyPlan,
    options: DependencyInstallOptions,
  ): Promise<readonly DependencyRequest[]> {
    this.#reportSatisfied(plan.alreadySatisfied);

    // Silence is the right output here: most runs into an established project install nothing.
    if (plan.toInstall.length === 0) return [];

    const { prod, dev } = splitByKind(plan.toInstall);

    if (options.dryRun) {
      this.#reportDryRun(prod, dev);
      // Nothing was installed, and saying otherwise in the result would make `--dry-run` lie.
      return [];
    }

    const manager = this.#packageManager.name;
    const task = this.#reporter.task(
      `Installing ${describeCount(plan.toInstall.length)} with ${manager}`,
    );

    try {
      // Two invocations, not one: production and development dependencies differ only in a flag,
      // and a single call would file all of them in the same section of the manifest.
      if (prod.length > 0) {
        task.update(`Installing ${describeCount(prod.length)} with ${manager}`);
        await this.#packageManager.install({
          packages: toSpecifiers(prod),
          dev: false,
          cwd: options.cwd,
        });
      }

      if (dev.length > 0) {
        task.update(`Installing ${describeCount(dev.length)} with ${manager} (dev)`);
        await this.#packageManager.install({
          packages: toSpecifiers(dev),
          dev: true,
          cwd: options.cwd,
        });
      }
    } catch (error) {
      // The spinner owns the current line; leaving it running would smear the error message
      // across it.
      task.fail('Dependency installation failed.');
      throw error;
    }

    task.succeed(`Installed ${describeCount(plan.toInstall.length)}.`);

    return [...prod, ...dev];
  }

  /**
   * Debug level only. In a mature project nearly every dependency a template declares is
   * already present, and listing all of them each run buries the lines that matter.
   */
  #reportSatisfied(satisfied: readonly DependencyRequest[]): void {
    if (satisfied.length === 0) return;

    this.#reporter.debug(
      `Already installed, leaving untouched: ${satisfied
        .map((request) => `${request.name}@${request.range}`)
        .join(', ')}`,
    );
  }

  #reportDryRun(prod: readonly DependencyRequest[], dev: readonly DependencyRequest[]): void {
    const total = prod.length + dev.length;
    this.#reporter.info(`Would install ${describeCount(total)} with ${this.#packageManager.name}:`);
    this.#reporter.list([
      ...toSpecifiers(prod),
      ...toSpecifiers(dev).map((specifier) => `${specifier} (dev)`),
    ]);
  }
}

function describeCount(count: number): string {
  return `${String(count)} package${count === 1 ? '' : 's'}`;
}
