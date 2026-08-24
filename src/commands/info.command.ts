import type { Command } from 'commander';

import type { ProjectContext } from '../types/project-context.js';

import type { CommandContext } from './register-commands.js';

interface Row {
  readonly label: string;
  readonly value: string;
}

export function registerInfoCommand(program: Command, context: CommandContext): void {
  program
    .command('info')
    .description('Show what Atlas detects about the current project.')
    .action(async () => {
      await runInfo(context);
    });
}

/**
 * Prints the detected `ProjectContext`.
 *
 * This exists for support rather than decoration: almost every "it generated the wrong
 * thing" report comes down to one detector disagreeing with the user's expectation, and
 * this is how that gets diagnosed in one step instead of five.
 */
async function runInfo(context: CommandContext): Promise<void> {
  const { reporter } = context;
  const { cwd } = context.globals();

  const project = await context.scanner.scan(cwd);

  reporter.heading('Project');
  printRows(context, describeProject(project));

  if (project.manifest === undefined) {
    reporter.blank();
    reporter.warn('No package.json here, so this is not a project Atlas can generate into.');
    reporter.errorDetail('Change to a project directory, or use --cwd to point at one.');
  }
}

function describeProject(project: ProjectContext): readonly Row[] {
  const manifest = project.manifest;

  const packageLabel =
    manifest === undefined
      ? 'none found'
      : `${manifest.name ?? '(unnamed)'}${manifest.version === undefined ? '' : `@${manifest.version}`}`;

  const languageLabel =
    project.language === 'typescript'
      ? `typescript${project.typescript.strict ? ' (strict)' : ' (non-strict)'}`
      : 'javascript';

  // The import suffix is spelled out because it is the single most consequential detection
  // result: it decides the extension on every relative import Atlas writes.
  const moduleLabel = `${project.moduleSystem} — relative imports end in ${
    project.importSuffix === '' ? 'nothing' : `"${project.importSuffix}"`
  }`;

  const workspaceLabel = project.workspace.isMonorepo
    ? `monorepo — dependencies install at ${project.workspace.installRoot}`
    : 'single package';

  return [
    { label: 'Root', value: project.root },
    { label: 'Package', value: packageLabel },
    { label: 'Framework', value: project.framework },
    { label: 'Language', value: languageLabel },
    { label: 'Modules', value: moduleLabel },
    { label: 'Package manager', value: project.packageManager },
    { label: 'Database', value: project.database },
    {
      label: 'Source directory',
      value: project.layout.flat ? '. (flat)' : project.layout.sourceDir,
    },
    { label: 'Workspace', value: workspaceLabel },
  ];
}

function printRows(context: CommandContext, rows: readonly Row[]): void {
  const width = Math.max(...rows.map((row) => row.label.length));

  for (const row of rows) {
    context.reporter.plain(`  ${row.label.padEnd(width)}  ${row.value}`);
  }
}
