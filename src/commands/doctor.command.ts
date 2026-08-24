import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Command } from 'commander';

import { MINIMUM_NODE_VERSION, SUPPORTED_PACKAGE_MANAGERS } from '../constants/branding.js';
import { ExitCode } from '../constants/exit-codes.js';
import type { ProcessService } from '../services/process.service.js';

import type { CommandContext } from './register-commands.js';

type CheckStatus = 'pass' | 'warn' | 'fail';

interface CheckResult {
  readonly label: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly hint?: string;
}

export function registerDoctorCommand(program: Command, context: CommandContext): void {
  program
    .command('doctor')
    .description('Check that this environment can run Atlas.')
    .action(async () => {
      await runDoctor(context);
    });
}

async function runDoctor(context: CommandContext): Promise<void> {
  const { reporter, processes } = context;
  const { cwd } = context.globals();

  const task = reporter.task('Inspecting environment');

  // Independent probes, each shelling out to a different binary — running them
  // concurrently keeps `doctor` fast on Windows, where process spawn is expensive.
  const [packageManagers, git, workspace] = await Promise.all([
    checkPackageManagers(processes),
    checkGit(processes),
    checkWorkspace(cwd),
  ]);

  task.stop();

  const results: readonly CheckResult[] = [checkNodeVersion(), packageManagers, git, workspace];

  reporter.heading('Environment');
  report(results, context);
}

function report(results: readonly CheckResult[], context: CommandContext): void {
  const { reporter } = context;
  const labelWidth = Math.max(...results.map((result) => result.label.length));

  for (const result of results) {
    const line = `${result.label.padEnd(labelWidth)}  ${result.detail}`;

    if (result.status === 'pass') {
      reporter.success(line);
    } else if (result.status === 'warn') {
      reporter.warn(line);
    } else {
      reporter.error(line);
    }

    if (result.hint !== undefined) {
      reporter.detail(result.hint);
    }
  }

  const failures = results.filter((result) => result.status === 'fail').length;
  const warnings = results.filter((result) => result.status === 'warn').length;

  reporter.blank();

  if (failures > 0) {
    context.setExitCode(ExitCode.PreconditionFailed);
    reporter.error(`${describeCount(failures, 'problem')} found. Atlas cannot run reliably yet.`);
    return;
  }

  if (warnings > 0) {
    reporter.warn(`${describeCount(warnings, 'warning')}. Atlas will run, with limitations.`);
    return;
  }

  reporter.success('Everything looks good.');
}

function checkNodeVersion(): CheckResult {
  const current = process.versions.node;
  const [major = 0, minor = 0] = current.split('.').map(Number);

  const satisfied =
    major > MINIMUM_NODE_VERSION.major ||
    (major === MINIMUM_NODE_VERSION.major && minor >= MINIMUM_NODE_VERSION.minor);

  if (satisfied) {
    return { label: 'Node.js', status: 'pass', detail: `v${current}` };
  }

  const required = `${String(MINIMUM_NODE_VERSION.major)}.${String(MINIMUM_NODE_VERSION.minor)}`;
  return {
    label: 'Node.js',
    status: 'fail',
    detail: `v${current} (needs ${required} or newer)`,
    hint: 'Upgrade Node.js, or use a version manager such as nvm, fnm, or volta.',
  };
}

async function checkPackageManagers(processes: ProcessService): Promise<CheckResult> {
  const probes = await Promise.all(
    SUPPORTED_PACKAGE_MANAGERS.map(async (name) => ({
      name,
      version: await processes.probeVersion(name),
    })),
  );

  const available = probes.flatMap((probe) =>
    probe.version === undefined ? [] : [`${probe.name} ${probe.version}`],
  );

  if (available.length === 0) {
    return {
      label: 'Package managers',
      status: 'fail',
      detail: 'none found',
      hint: `Atlas installs generated dependencies with one of: ${SUPPORTED_PACKAGE_MANAGERS.join(', ')}.`,
    };
  }

  return { label: 'Package managers', status: 'pass', detail: available.join(', ') };
}

async function checkGit(processes: ProcessService): Promise<CheckResult> {
  const version = await processes.probeVersion('git');

  if (version === undefined) {
    return {
      label: 'Git',
      status: 'warn',
      detail: 'not found',
      hint: 'Only `atlas new` needs Git. Generating into an existing project works without it.',
    };
  }

  return { label: 'Git', status: 'pass', detail: version };
}

/**
 * Probes writability by actually writing.
 *
 * `fs.access(dir, W_OK)` is not trustworthy on Windows — it reports the read-only
 * attribute rather than the effective ACL — so the only honest check is to create a file
 * and remove it.
 *
 * Uses `node:fs` directly because `FileSystemService` arrives with the engine in the next
 * phase; this call site moves behind it then.
 */
async function checkWorkspace(cwd: string): Promise<CheckResult> {
  const probePath = join(cwd, `.atlas-write-probe-${randomBytes(6).toString('hex')}`);

  try {
    await writeFile(probePath, '', 'utf8');
    return { label: 'Workspace', status: 'pass', detail: `${cwd} (writable)` };
  } catch (error) {
    return {
      label: 'Workspace',
      status: 'fail',
      detail: `${cwd} (not writable)`,
      hint: error instanceof Error ? error.message : 'The directory rejected a test write.',
    };
  } finally {
    await rm(probePath, { force: true });
  }
}

function describeCount(count: number, singular: string): string {
  return `${String(count)} ${singular}${count === 1 ? '' : 's'}`;
}
