/**
 * The generated-output gate.
 *
 * Renders every template exactly as a user would receive it — tokens resolved, ESM import
 * suffixes in place — into a scratch directory, then runs `tsc` over the result against the real
 * packages in this repository's `node_modules`.
 *
 * This replaces an earlier gate that typechecked template *sources* with tokens still embedded.
 * That required a hand-written ambient declaration per template file, because a specifier like
 * `./logger__IMPORT_SUFFIX__` resolves to nothing on disk. Those declarations re-exported the real
 * modules, so they were not dishonest — but they had to be maintained by hand, they made two
 * templates unable to share a filename, and a forgotten entry failed the build for a reason that
 * had nothing to do with the template.
 *
 * Checking the rendered output removes all of that and is a strictly stronger claim: it is the
 * thing users actually compile. It is also how the one real defect in `templates/logger` was
 * found — the source typechecked, the rendered output did not.
 *
 * Run with: npx tsx scripts/check-generated-output.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { TemplateLoader } from '../src/engine/template/template-loader.js';
import { buildTokenTable } from '../src/engine/template/token-table.js';
import { NodeFileSystemService } from '../src/services/filesystem.service.js';
import { Reporter } from '../src/services/reporter.service.js';
import type { ProjectContext } from '../src/types/project-context.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const TEMPLATES_DIR = join(ROOT, 'templates');
const SCRATCH = join(ROOT, 'tests', '.tmp', 'generated-check');
const SHIMS = join(TEMPLATES_DIR, '@types');

/** Directory under `templates/` holding CI-only shims rather than a template. */
const SHIMS_DIR_NAME = '@types';

/**
 * The project every template is rendered for.
 *
 * ESM and TypeScript, because that is the strictest combination: it is the one where a missing
 * `__IMPORT_SUFFIX__` produces an unresolvable specifier. A template that compiles here compiles
 * under CommonJS too, where the suffix is simply absent.
 */
const TARGET: ProjectContext = {
  root: SCRATCH,
  manifest: {
    path: join(SCRATCH, 'package.json'),
    name: 'generated-output-check',
    version: '1.0.0',
    type: 'module',
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    scripts: {},
    raw: {},
  },
  framework: 'express',
  language: 'typescript',
  moduleSystem: 'esm',
  packageManager: 'npm',
  database: 'none',
  typescript: { present: true, configPath: undefined, strict: true },
  layout: { sourceDir: '.', flat: true },
  workspace: { isMonorepo: false, installRoot: SCRATCH, workspaceRoot: undefined },
  importSuffix: '.js',
};

/**
 * At least as strict as a modern target project. Anything that only compiles under a looser
 * configuration is a bug delivered to a user.
 *
 * `paths` reaches the ambient shims for the three packages templates declare but this repository
 * does not install — argon2, mongoose and @prisma/client. Everything else (jose, zod, express,
 * cookie-parser) resolves for real from node_modules, which is the point: real types cannot lie.
 */
function tsconfigFor(templateName: string): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2023',
        lib: ['ES2023'],
        module: 'nodenext',
        moduleResolution: 'nodenext',
        types: ['node'],
        strict: true,
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        noImplicitOverride: true,
        noImplicitReturns: true,
        noFallthroughCasesInSwitch: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        useUnknownInCatchVariables: true,
        verbatimModuleSyntax: true,
        forceConsistentCasingInFileNames: true,
        skipLibCheck: true,
        noEmit: true,
        typeRoots: [relative(join(SCRATCH, templateName), join(ROOT, 'node_modules', '@types'))],
      },
      include: ['**/*.ts', relative(join(SCRATCH, templateName), join(SHIMS, '*.d.ts'))],
    },
    undefined,
    2,
  )}\n`;
}

async function templateNames(): Promise<readonly string[]> {
  if (!existsSync(TEMPLATES_DIR)) {
    return [];
  }

  const entries = await readdir(TEMPLATES_DIR, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== SHIMS_DIR_NAME)
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(TEMPLATES_DIR, name, 'template.json')))
    .sort();
}

/**
 * Renders every file a template ships, including variants a generator would filter out. All of
 * them reach users under some option combination, so all of them must compile.
 */
async function renderInto(templateName: string, destination: string): Promise<number> {
  const fs = new NodeFileSystemService();
  const reporter = new Reporter({ color: false, verbose: false });
  const loader = new TemplateLoader({ fs, reporter, templatesRoot: TEMPLATES_DIR });

  const template = await loader.load(templateName);
  const tokens = buildTokenTable({ project: TARGET, entity: 'ExampleEntity' });
  const rendered = await loader.render(template, tokens);

  for (const file of rendered) {
    const target = join(destination, file.destination);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.contents, 'utf8');
  }

  await writeFile(join(destination, 'tsconfig.json'), tsconfigFor(templateName), 'utf8');

  return rendered.length;
}

/**
 * Spawned through `process.execPath` against TypeScript's own entry rather than the `.bin` shim,
 * which on Windows is a `.cmd` file that cannot be spawned without a shell.
 */
function typecheck(directory: string): { readonly ok: boolean; readonly output: string } {
  const compiler = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

  const result = spawnSync(process.execPath, [compiler, '--noEmit', '--pretty', 'false'], {
    cwd: directory,
    encoding: 'utf8',
    shell: false,
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { ok: result.status === 0, output };
}

async function main(): Promise<number> {
  const names = await templateNames();

  if (names.length === 0) {
    console.log('No templates to check.');
    return 0;
  }

  await rm(SCRATCH, { recursive: true, force: true });
  await mkdir(SCRATCH, { recursive: true });

  console.log(`Checking generated output for ${String(names.length)} template(s).\n`);

  let failures = 0;

  for (const name of names) {
    const destination = join(SCRATCH, name);
    await mkdir(destination, { recursive: true });

    let fileCount: number;
    try {
      fileCount = await renderInto(name, destination);
    } catch (error) {
      failures += 1;
      console.log(`  FAIL  ${name} — render failed`);
      console.log(`        ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const { ok, output } = typecheck(destination);

    if (ok) {
      console.log(`  PASS  ${name} (${String(fileCount)} files)`);
      continue;
    }

    failures += 1;
    console.log(`  FAIL  ${name} (${String(fileCount)} files)`);
    for (const line of output.split('\n')) {
      console.log(`        ${line}`);
    }
  }

  console.log('');

  if (failures > 0) {
    console.log(
      `${String(failures)} of ${String(names.length)} template(s) produce output that does not compile.`,
    );
    console.log(`Rendered output kept for inspection: ${relative(ROOT, SCRATCH)}`);
    return 1;
  }

  await rm(SCRATCH, { recursive: true, force: true });
  console.log('Every template renders to output that compiles.');
  return 0;
}

process.exitCode = await main();
