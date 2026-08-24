import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectScanner } from '../../src/detection/index.js';
import { DependencyInstaller } from '../../src/engine/deps/index.js';
import { Formatter } from '../../src/engine/format/index.js';
import { GenerationEngine } from '../../src/engine/generation-engine.js';
import { TemplateLoader } from '../../src/engine/template/template-loader.js';
import { authGenerator } from '../../src/generators/auth/auth.generator.js';
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
 * The Phase 4 exit criterion, against the real `templates/auth` directory and a real filesystem.
 *
 * The unit tests in `auth-plan.test.ts` cover variant selection with a fake renderer; this proves
 * the shipped template actually renders and that what lands on disk is what a user would get.
 */

const SCRATCH = join(import.meta.dirname, '..', '.tmp');

class RecordingPackageManager implements PackageManagerService {
  readonly name = 'npm' as const;
  readonly requests: InstallRequest[] = [];

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async install(request: InstallRequest): Promise<void> {
    // Recorded rather than run: prisma would pull a toolchain, and what matters
    // is that the right packages were requested.
    this.requests.push(request);
  }

  addScriptCommand(): string {
    return 'npm run';
  }
}

let projectRoot: string;
let packageManager: RecordingPackageManager;

async function generate(flags: Readonly<Record<string, unknown>> = {}): Promise<GenerationResult> {
  const fs = new NodeFileSystemService();
  const stream = new MemoryStream();
  const reporter = new Reporter({ stdout: stream, stderr: stream, color: false, verbose: false });

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

  const verdict = await authGenerator.detect(context);
  expect(verdict.supported).toBe(true);

  const options = await authGenerator.prompt({ argument: undefined, flags }, context);
  authGenerator.validate(options, context);
  const plan = await authGenerator.generate(options, context);

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

function destinations(result: GenerationResult): readonly string[] {
  return result.files
    .map((file) =>
      file.path
        .slice(projectRoot.length + 1)
        .split('\\')
        .join('/'),
    )
    .sort();
}

function installedNames(): readonly string[] {
  return packageManager.requests.flatMap((request) =>
    request.packages.map((specifier) => specifier.replace(/@[^@]*$/u, '')),
  );
}

beforeEach(async () => {
  projectRoot = join(SCRATCH, `auth-${randomUUID()}`);
  await mkdir(join(projectRoot, 'src'), { recursive: true });

  await writeFile(
    join(projectRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'auth-target',
        version: '1.0.0',
        private: true,
        type: 'module',
        dependencies: { express: '^5.2.1' },
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

describe('atlas auth, end to end', () => {
  it('generates the module for the default variants', async () => {
    const result = await generate();
    const files = destinations(result);

    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain('src/auth/index.ts');
    expect(files).toContain('src/auth/services/auth-service.ts');
    expect(files).toContain('src/auth/http/auth-routes.ts');
  });

  it('produces a stable file set for mongoose', async () => {
    const result = await generate({ database: 'mongoose' });

    expect(destinations(result)).toMatchSnapshot();
  });

  it('produces a stable file set for prisma', async () => {
    const result = await generate({ database: 'prisma' });

    expect(destinations(result)).toMatchSnapshot();
  });

  /**
   * bcrypt is the only algorithm the template ships, so there is no variant to choose between.
   * Asserted anyway: the two deleted hashers were referenced by the plan's variant map, and a
   * half-finished revert that restored one file without the other would otherwise pass silently.
   */
  it('ships bcrypt as the only hasher', async () => {
    const files = destinations(await generate());

    expect(files).toContain('src/auth/security/bcrypt-hasher.ts');
    expect(files).not.toContain('src/auth/security/argon2-hasher.ts');
    expect(files).not.toContain('src/auth/security/scrypt-hasher.ts');
  });

  it('ships exactly one database adapter', async () => {
    const mongo = destinations(await generate({ database: 'mongoose' }));
    const prisma = destinations(await generate({ database: 'prisma' }));

    expect(mongo.some((file) => file.includes('mongoose-'))).toBe(true);
    expect(mongo.some((file) => file.includes('prisma'))).toBe(false);
    expect(prisma.some((file) => file.includes('prisma-'))).toBe(true);
    expect(prisma.some((file) => file.includes('mongoose'))).toBe(false);
  });

  it('puts the prisma fragment beside the schema, not inside src', async () => {
    const files = destinations(await generate({ database: 'prisma' }));

    expect(files).toContain('prisma/auth.prisma');
  });

  it('installs only the packages the chosen adapter needs', async () => {
    await generate({ database: 'mongoose' });
    const mongo = installedNames();

    expect(mongo).toContain('jsonwebtoken');
    expect(mongo).toContain('bcryptjs');
    expect(mongo).toContain('mongoose');
    expect(mongo).not.toContain('@prisma/client');
    // The packages the rewrite removed. Named explicitly, because a stale import left behind in one
    // template file would otherwise reintroduce a dependency nobody meant to ship.
    expect(mongo).not.toContain('jose');
    expect(mongo).not.toContain('zod');
    expect(mongo).not.toContain('argon2');

    await generate({ database: 'prisma' });
    const prisma = installedNames();

    expect(prisma).toContain('@prisma/client');
    expect(prisma).not.toContain('mongoose');
  });

  it('leaves no unresolved tokens anywhere in the output', async () => {
    const result = await generate({ database: 'prisma' });

    for (const file of result.files) {
      const contents = await readFile(file.path, 'utf8');
      expect(contents, file.path).not.toMatch(/__[A-Z][A-Z0-9_]*__/u);
    }
  });

  it('writes ESM-correct relative imports', async () => {
    const result = await generate();
    let checked = 0;

    for (const file of result.files.filter((entry) => entry.path.endsWith('.ts'))) {
      const contents = await readFile(file.path, 'utf8');

      for (const match of contents.matchAll(/from '(\.[^']*)'/gu)) {
        expect(match[1]?.endsWith('.js'), `${file.path}: ${String(match[1])}`).toBe(true);
        checked += 1;
      }
    }

    expect(checked).toBeGreaterThan(5);
  });

  it('never generates a file that imports Atlas', async () => {
    const result = await generate();

    for (const file of result.files) {
      const contents = await readFile(file.path, 'utf8');
      expect(contents).not.toContain('@suhel/atlas');
    }
  });

  it('placeholders the secret in .env.example rather than committing a real one', async () => {
    const result = await generate();

    const example = (await readFile(join(projectRoot, '.env.example'), 'utf8')).trim();

    expect(example).toContain('JWT_SECRET');
    expect(example).toContain('AUTH_COOKIE_SECURE=true');

    // `.env.example` is committed. A generated secret written here would be a real credential in
    // version control, so the engine substitutes a placeholder for anything marked secret.
    const secretLine = example
      .split('\n')
      .find((line) => line.startsWith('JWT_SECRET='))
      ?.slice('JWT_SECRET='.length);

    expect(secretLine).toBeDefined();
    expect(secretLine).not.toMatch(/^[A-Za-z0-9_-]{32,}$/u);

    // And the notes must say so, or a user ships the placeholder believing it was generated.
    expect(result.notes.join('\n')).toContain('placeholder');

    // No .env is created: it is gitignored, so a value written there reaches nobody else.
    await expect(readFile(join(projectRoot, '.env'), 'utf8')).rejects.toThrow();
  });

  it('reports router wiring as manual work when the app has no anchor', async () => {
    const result = await generate();

    // There is no src/app.ts in the fixture, so Atlas must not invent one.
    expect(result.manual).toHaveLength(1);
    expect(result.manual[0]?.manualHint).toContain('createAuthRouter');
  });

  it('is a no-op on a second run', async () => {
    await generate();
    const second = await generate();

    expect(second.files.every((file) => file.outcome === 'skipped')).toBe(true);
  });

  it('refuses a non-Express project with an actionable reason', async () => {
    await writeFile(
      join(projectRoot, 'package.json'),
      `${JSON.stringify(
        {
          name: 'fastify-target',
          version: '1.0.0',
          private: true,
          type: 'module',
          dependencies: { fastify: '^5.0.0' },
          devDependencies: { typescript: '^5.7.2' },
        },
        undefined,
        2,
      )}\n`,
      'utf8',
    );

    const fs = new NodeFileSystemService();
    const stream = new MemoryStream();
    const reporter = new Reporter({ stdout: stream, stderr: stream, color: false, verbose: false });
    const project = await new ProjectScanner({ fs }).requireProject(projectRoot);

    const verdict = await authGenerator.detect({
      project,
      globals: { cwd: projectRoot, yes: true, dryRun: false, verbose: false, color: false },
      reporter,
      prompts: new ScriptedPromptRunner(),
      templates: new TemplateLoader({ fs, reporter }),
      readFile: () => Promise.resolve(undefined),
      resolve: (...segments) => join(projectRoot, ...segments),
    });

    expect(verdict.supported).toBe(false);
    expect(verdict.reason).toContain('Express');
  });
});
