import { relative } from 'node:path';

import { createPackageManagerService } from '../../services/package-manager.service.js';
import type { ProcessRunner } from '../../services/process.service.js';
import type { Reporter } from '../../services/reporter.service.js';
import type { PackageManager } from '../../types/project-context.js';

import { CLIENT_DIR_NAME, SERVER_DIR_NAME } from './synthetic-context.js';

export interface SummaryRequest {
  readonly reporter: Reporter;
  readonly processes: ProcessRunner;
  /** The directory name the user typed, which is also what they have to `cd` into. */
  readonly projectName: string;
  /** Absolute project root, for turning written paths back into relative ones. */
  readonly root: string;
  readonly packageManager: PackageManager;
  /** Absolute paths of everything the run wrote, across both halves. */
  readonly files: readonly string[];
  readonly dryRun: boolean;
  /** False when `--skip-install` was passed or the run was a rehearsal. */
  readonly installed: boolean;
}

/**
 * The last thing `start` prints.
 *
 * Two blocks, in the order the user needs them: what now exists, then what to type next. The
 * tree comes first because it answers "did that do what I meant?" at a glance, and the commands
 * come last because that is where the eye lands when output stops scrolling.
 */
export function reportStartSummary(request: SummaryRequest): void {
  const { reporter, projectName, dryRun } = request;

  reporter.blank();
  reporter.heading(dryRun ? 'Would create' : 'Created');
  reporter.blank();
  reporter.tree(`${projectName}/`, relativePaths(request));

  reporter.blank();
  reporter.heading('Next steps');
  reporter.detail(
    'The client and the server are independent packages — run them in two terminals.',
  );

  const runScript = createPackageManagerService(
    request.packageManager,
    request.processes,
  ).addScriptCommand();

  for (const half of [SERVER_DIR_NAME, CLIENT_DIR_NAME]) {
    reporter.blank();
    reporter.plain(`  ${capitalize(half)}`);
    reporter.command(`cd ${projectName}/${half}`);

    // Printed even when Atlas has already installed, because this block is the one a user
    // copies into a README or hands to a teammate cloning the repository — where nothing is
    // installed yet. The note below says which case they are in.
    reporter.command(`${request.packageManager} install`);
    reporter.command(`${runScript} dev`);
  }

  reporter.blank();

  if (dryRun) {
    reporter.success('Dry run complete. Nothing was written.');
    return;
  }

  if (request.installed) {
    reporter.detail('Dependencies are already installed; the install step is for fresh clones.');
  }

  reporter.success(`${projectName} is ready.`);
}

/**
 * Paths relative to the project root, with POSIX separators.
 *
 * The tree is a picture of a directory layout, and a layout drawn with backslashes on Windows
 * and forward slashes elsewhere is the same layout described two ways.
 */
function relativePaths(request: SummaryRequest): readonly string[] {
  return request.files.map((path) => relative(request.root, path).split('\\').join('/'));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
