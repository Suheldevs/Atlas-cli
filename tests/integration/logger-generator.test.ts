import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectScanner } from '../../src/detection/index.js';
import { DependencyInstaller } from '../../src/engine/deps/index.js';
import { Formatter } from '../../src/engine/format/index.js';
import { GenerationEngine } from '../../src/engine/generation-engine.js';
import { TemplateLoader } from '../../src/engine/template/template-loader.js';
import { loggerGenerator } from '../../src/generators/logger/logger.generator.js';
import { ScriptedPromptRunner } from '../../src/prompts/prompt-runner.js';
import { SystemClock } from '../../src/services/clock.service.js';
import { NodeFileSystemService } from '../../src/services/filesystem.service.js';
import type {
  InstallRequest,
  PackageManagerService,
} from '../../src/services/package-manager.service.js';
import { Reporter } from '../../src/services/reporter.service.js';
import type { GenerationResult } from '../../src/types/generation-plan.js';
import type { GeneratorContext } from '../../src/types/generator.js';
import { MemoryStream } from '../helpers/memory-stream.js';

/**
 * The Phase 3 exit criterion, end to end.
 *
 * Uses the **real** `templates/logger` directory and the real filesystem, because the whole
 * point is proving that the shipped template renders. An in-memory double here would only
 * prove the plumbing, which the unit tests already cover.
 */

const SCRATCH = join(import.meta.dirname, '..', '.tmp');

class RecordingPackageManager implements PackageManagerService {
  readonly name = 'npm' as const;
  readonly requests: InstallRequest[] = [];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async install(request: InstallRequest): Promise<void> {
    // Recorded rather than executed: a real install would put this test at the mercy of the
    // network, and what matters is that the right packages were asked for.
    this.requests.push(request);
  }

  addScriptCommand(): string {
    return 'npm run';
  }
}

let projectRoot: string;
let packageManager: RecordingPackageManager;
let output: () => string;

async function generate(flags: Readonly<Record<string, unknown>> = {}): Promise<GenerationResult> {
  const fs = new NodeFileSystemService();
  const stdout = new MemoryStream();
  const stderr = new MemoryStream();
  const reporter = new Reporter({ stdout, stderr, color: false, verbose: false });
  output = () => stdout.text + stderr.text;

  const project = await new ProjectScanner({ fs }).requireProject(projectRoot);

  const context: GeneratorContext = {
    project,
    globals: { cwd: projectRoot, yes: true, dryRun: false, verbose: false, color: false },
    reporter,
    prompts: new ScriptedPromptRunner(),
    templates: new TemplateLoader({ fs, reporter }),
    readFile: (path) => fs.readTextIfExists(join(projectRoot, path)),
    resolve: (...segments) => join(projectRoot, ...segments),
  };

  const verdict = await loggerGenerator.detect(context);
  expect(verdict.supported).toBe(true);

  const options = await loggerGenerator.prompt({ argument: undefined, flags }, context);
  loggerGenerator.validate(options, context);
  const plan = await loggerGenerator.generate(options, context);

  packageManager = new RecordingPackageManager();

  const engine = new GenerationEngine({
    fs,
    clock: new SystemClock(),
    reporter,
    formatter: new Formatter({ reporter }),
    installer: new DependencyInstaller({ packageManager, reporter }),
    ask: () => Promise.resolve('overwrite'),
  });

  return engine.apply({ plan, project, dryRun: false, assumeYes: true });
}

function relativeDestinations(result: GenerationResult): readonly string[] {
  return result.files
    .map((file) =>
      file.path
        .slice(projectRoot.length + 1)
        .split('\\')
        .join('/'),
    )
    .sort();
}

beforeEach(async () => {
  projectRoot = join(SCRATCH, `logger-${randomUUID()}`);
  await mkdir(join(projectRoot, 'src'), { recursive: true });

  await writeFile(
    join(projectRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'logger-target',
        version: '1.0.0',
        private: true,
        type: 'module',
        dependencies: { express: '^5.0.1' },
        devDependencies: { typescript: '^5.7.2' },
      },
      undefined,
      2,
    )}\n`,
    'utf8',
  );

  await writeFile(
    join(projectRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
        },
        include: ['src'],
      },
      undefined,
      2,
    )}\n`,
    'utf8',
  );
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe('atlas logger, end to end', () => {
  it('writes the module into the project source directory', async () => {
    const result = await generate();

    const destinations = relativeDestinations(result);

    expect(destinations.length).toBeGreaterThan(3);
    for (const destination of destinations) {
      expect(destination.startsWith('src/')).toBe(true);
      expect(destination.endsWith('.ts')).toBe(true);
    }
  });

  it('produces a stable set of files', async () => {
    const result = await generate();

    // Committed snapshot: a template edit that adds, removes or renames a file becomes a
    // reviewable diff instead of a silent change in what users receive.
    expect(relativeDestinations(result)).toMatchSnapshot();
  });

  it('creates every file rather than skipping any', async () => {
    const result = await generate();

    expect(result.files.every((file) => file.outcome === 'created')).toBe(true);
  });

  it('leaves no unresolved tokens in the generated source', async () => {
    const result = await generate();

    for (const file of result.files) {
      const contents = await readFile(file.path, 'utf8');
      expect(contents).not.toMatch(/__[A-Z][A-Z0-9_]*__/u);
    }
  });

  it('writes ESM-correct relative imports for a "type": "module" project', async () => {
    const result = await generate();

    let checked = 0;

    for (const file of result.files) {
      const contents = await readFile(file.path, 'utf8');

      for (const match of contents.matchAll(/from '(\.[^']*)'/gu)) {
        const specifier = match[1];
        expect(specifier).toBeDefined();
        // Under ESM, TypeScript requires the emitted extension on relative specifiers. This
        // is the assertion that catches a wrong `__IMPORT_SUFFIX__`.
        expect(specifier?.endsWith('.js')).toBe(true);
        checked += 1;
      }
    }

    expect(checked).toBeGreaterThan(0);
  });

  it('declares winston from the template manifest, not from code', async () => {
    const result = await generate();

    const installed = result.installed.map((entry) => entry.name);
    expect(installed).toContain('winston');

    const specifiers = packageManager.requests.flatMap((request) => request.packages);
    expect(specifiers.some((specifier) => specifier.startsWith('winston@'))).toBe(true);
  });

  it('never generates a file that imports Atlas', async () => {
    const result = await generate();

    for (const file of result.files) {
      const contents = await readFile(file.path, 'utf8');
      // The core promise: the project keeps working after Atlas is uninstalled.
      expect(contents).not.toContain('@suhel/atlas');
      expect(contents).not.toContain('atlas-cli');
    }
  });

  it('honours --dir', async () => {
    const result = await generate({ dir: 'src/infra' });

    for (const destination of relativeDestinations(result)) {
      expect(destination.startsWith('src/infra/')).toBe(true);
    }
  });

  it('rejects a --dir that escapes the project', async () => {
    const fs = new NodeFileSystemService();
    const stdout = new MemoryStream();
    const reporter = new Reporter({ stdout, stderr: stdout, color: false, verbose: false });
    const project = await new ProjectScanner({ fs }).requireProject(projectRoot);

    const context: GeneratorContext = {
      project,
      globals: { cwd: projectRoot, yes: true, dryRun: false, verbose: false, color: false },
      reporter,
      prompts: new ScriptedPromptRunner(),
      templates: new TemplateLoader({ fs, reporter }),
      readFile: (path) => fs.readTextIfExists(join(projectRoot, path)),
      resolve: (...segments) => join(projectRoot, ...segments),
    };

    const options = await loggerGenerator.prompt(
      { argument: undefined, flags: { dir: '../escape' } },
      context,
    );

    expect(() => {
      loggerGenerator.validate(options, context);
    }).toThrow(/inside the project/u);
  });

  it('is a no-op on a second run, because the content already matches', async () => {
    await generate();
    const second = await generate();

    expect(second.files.every((file) => file.outcome === 'skipped')).toBe(true);
    expect(output()).not.toContain('already exists');
  });

  it('refuses a JavaScript project with an actionable reason', async () => {
    await rm(join(projectRoot, 'tsconfig.json'));
    await writeFile(
      join(projectRoot, 'package.json'),
      `${JSON.stringify({ name: 'js-target', version: '1.0.0', private: true }, undefined, 2)}\n`,
      'utf8',
    );

    const fs = new NodeFileSystemService();
    const stdout = new MemoryStream();
    const reporter = new Reporter({ stdout, stderr: stdout, color: false, verbose: false });
    const project = await new ProjectScanner({ fs }).requireProject(projectRoot);

    const verdict = await loggerGenerator.detect({
      project,
      globals: { cwd: projectRoot, yes: true, dryRun: false, verbose: false, color: false },
      reporter,
      prompts: new ScriptedPromptRunner(),
      templates: new TemplateLoader({ fs, reporter }),
      readFile: (path) => fs.readTextIfExists(join(projectRoot, path)),
      resolve: (...segments) => join(projectRoot, ...segments),
    });

    expect(verdict.supported).toBe(false);
    expect(verdict.reason).toContain('JavaScript');
    expect(verdict.hint).toBeDefined();
  });
});
