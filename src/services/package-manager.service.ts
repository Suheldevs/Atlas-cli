import { AtlasError } from '../errors/atlas-error.js';
import { ErrorCode } from '../errors/error-catalog.js';
import type { PackageManager } from '../types/project-context.js';

import type { ProcessRunner } from './process.service.js';

export interface InstallRequest {
  /** Already-resolved `name@range` specifiers; this service never invents a version. */
  readonly packages: readonly string[];
  readonly dev: boolean;
  /**
   * Directory the manager runs in. In a monorepo this must be the workspace install root,
   * not the package being generated into.
   */
  readonly cwd: string;
}

export interface PackageManagerService {
  readonly name: PackageManager;
  isAvailable(): Promise<boolean>;
  install(request: InstallRequest): Promise<void>;
  /** How a user runs a `package.json` script with this manager, for printed next steps. */
  addScriptCommand(): string;
}

interface ManagerCommands {
  /** Subcommand that adds packages to the manifest. */
  readonly add: string;
  readonly devFlag: string;
  /** Flags applied to every install this manager performs. */
  readonly extraArgs: readonly string[];
  readonly runScript: string;
}

/**
 * One table instead of four near-identical classes: the managers differ only in a subcommand,
 * a flag spelling, and whether they need muting.
 */
const COMMANDS: Readonly<Record<PackageManager, ManagerCommands>> = {
  npm: {
    add: 'install',
    devFlag: '--save-dev',
    // Keeps generation output readable, and avoids two network round-trips the user did not
    // ask for in the middle of a code generation run.
    extraArgs: ['--no-audit', '--no-fund'],
    runScript: 'npm run',
  },
  pnpm: {
    add: 'add',
    devFlag: '--save-dev',
    extraArgs: [],
    runScript: 'pnpm',
  },
  yarn: {
    add: 'add',
    devFlag: '--dev',
    extraArgs: [],
    runScript: 'yarn',
  },
  bun: {
    add: 'add',
    devFlag: '--dev',
    extraArgs: [],
    runScript: 'bun run',
  },
};

/**
 * Installs are network-bound and routinely slow — a cold cache behind a corporate proxy takes
 * minutes — so the process service's default two-minute budget would kill legitimate work.
 */
const INSTALL_TIMEOUT_MS = 600_000;

class TablePackageManagerService implements PackageManagerService {
  readonly name: PackageManager;

  readonly #processes: ProcessRunner;
  readonly #commands: ManagerCommands;

  constructor(name: PackageManager, processes: ProcessRunner) {
    this.name = name;
    this.#processes = processes;
    this.#commands = COMMANDS[name];
  }

  async isAvailable(): Promise<boolean> {
    // `probeVersion` is the only reliable availability test: a missing binary and a failing one
    // are indistinguishable from a run result on Windows.
    return (await this.#processes.probeVersion(this.name)) !== undefined;
  }

  async install(request: InstallRequest): Promise<void> {
    // `npm install` with no package names reinstalls the entire tree from the lockfile, which is
    // emphatically not what "nothing to install" should mean.
    if (request.packages.length === 0) return;

    const result = await this.#processes.run(this.name, this.#buildArgs(request), {
      cwd: request.cwd,
      timeoutMs: INSTALL_TIMEOUT_MS,
    });

    if (!result.failed) return;

    throw new AtlasError({
      code: ErrorCode.DependencyInstallFailed,
      message: `\`${result.command}\` failed with exit code ${String(result.exitCode)}.`,
      hint: `Run \`${result.command}\` in ${request.cwd} to see the full output, then re-run Atlas. Generated files are already in place.`,
      // A failed install is the one thing users most need to read verbatim, so the child's own
      // output is carried through rather than summarised away.
      details: outputLines(result.stderr, result.stdout),
    });
  }

  addScriptCommand(): string {
    return this.#commands.runScript;
  }

  #buildArgs(request: InstallRequest): readonly string[] {
    const { add, devFlag, extraArgs } = this.#commands;
    return [add, ...(request.dev ? [devFlag] : []), ...extraArgs, ...request.packages];
  }
}

export function createPackageManagerService(
  name: PackageManager,
  processRunner: ProcessRunner,
): PackageManagerService {
  return new TablePackageManagerService(name, processRunner);
}

/** Some managers report failures on stdout, so stderr is preferred but not required. */
function outputLines(stderr: string, stdout: string): readonly string[] {
  const text = stderr.trim() === '' ? stdout : stderr;

  return text
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
}
