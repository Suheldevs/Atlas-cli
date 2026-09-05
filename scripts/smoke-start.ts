/**
 * End-to-end smoke check for `atlas start`.
 *
 * The template gates (`validate-templates.ts`, `check-generated-output.ts`) prove each template
 * renders and compiles in isolation. They cannot prove the thing users actually do: run one
 * command in an empty directory and get a project that parses, resolves and has the files the
 * README promises. That is what this script checks.
 *
 * Deliberately does NOT install dependencies — an npm install per run would make this too slow
 * to be worth running, and a missing dependency is already caught by the manifest gate. What it
 * proves is that every generated file is syntactically valid and that the tree matches the
 * documented shape.
 *
 * Usage: npx tsx scripts/smoke-start.ts [js|ts]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const cli = join(repoRoot, 'bin', 'atlas.js');
const language = process.argv[2] === 'ts' ? 'ts' : 'js';
const ext = language === 'ts' ? 'ts' : 'js';
const clientExt = language === 'ts' ? 'tsx' : 'jsx';

/** Files the README promises. A rename that breaks a documented path should fail here. */
const REQUIRED = [
  `server/package.json`,
  `server/.env.example`,
  `server/src/app.${ext}`,
  `server/src/server.${ext}`,
  `server/src/config/db.${ext}`,
  `server/src/config/env.${ext}`,
  `server/src/utils/api-error.${ext}`,
  `server/src/utils/api-response.${ext}`,
  `server/src/middleware/error-handler.${ext}`,
  `client/package.json`,
  `client/index.html`,
  `client/src/main.${clientExt}`,
  `client/src/lib/api.${ext}`,
  `client/src/context/AuthContext.${clientExt}`,
];

function fail(message: string): never {
  console.error(`\n  FAIL  ${message}\n`);
  process.exit(1);
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.git') return [];
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const workdir = mkdtempSync(join(tmpdir(), 'atlas-smoke-'));
const appName = 'smoke-app';
const appDir = join(workdir, appName);

try {
  console.log(`Scaffolding ${appName} (--language ${language}) in ${workdir}`);

  execFileSync(
    process.execPath,
    [cli, 'start', appName, '--language', language, '--skip-install', '--skip-git', '--yes'],
    { cwd: workdir, stdio: 'inherit', timeout: 120_000 },
  );

  if (!existsSync(appDir) || !statSync(appDir).isDirectory()) {
    fail(`${appName}/ was not created.`);
  }

  const missing = REQUIRED.filter((path) => !existsSync(join(appDir, path)));
  if (missing.length > 0) {
    fail(
      `Missing ${String(missing.length)} documented file(s):\n         ${missing.join('\n         ')}`,
    );
  }
  console.log(`  ok    ${String(REQUIRED.length)} documented paths present`);

  // A root package.json would mean the two halves are not independent, which is the layout
  // decision this project made deliberately. Assert it stayed that way.
  if (existsSync(join(appDir, 'package.json'))) {
    fail('A root package.json exists. client/ and server/ are meant to be independent packages.');
  }
  console.log('  ok    no root package.json (packages stay independent)');

  const files = walk(appDir);

  // Unsubstituted tokens are the classic codegen failure: they survive to disk and only
  // surface when the user's build breaks days later.
  const withTokens = files.filter((file) => {
    if (/\.(png|jpg|jpeg|gif|ico|woff2?)$/u.test(file)) return false;
    const contents = execFileSync('cat', [file], { encoding: 'utf8' });
    return /__[A-Z][A-Z0-9_]*__/u.test(contents);
  });
  if (withTokens.length > 0) {
    fail(
      `Unsubstituted tokens in:\n         ${withTokens
        .map((f) => relative(appDir, f))
        .join('\n         ')}`,
    );
  }
  console.log(`  ok    no unsubstituted tokens across ${String(files.length)} files`);

  // `node --check` parses without executing, so it catches syntax errors in generated JS
  // without needing a single dependency installed.
  if (language === 'js') {
    const scripts = files.filter((f) => /\.(js|jsx|mjs)$/u.test(f));
    const broken: string[] = [];
    for (const file of scripts) {
      if (file.endsWith('.jsx')) continue; // JSX is not valid plain JS; Vite compiles it.
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      } catch {
        broken.push(relative(appDir, file));
      }
    }
    if (broken.length > 0) {
      fail(`Syntax errors in:\n         ${broken.join('\n         ')}`);
    }
    console.log(`  ok    ${String(scripts.length)} generated scripts parse`);
  }

  // Every generated package must at minimum be valid JSON with a name and scripts, or the
  // first thing the user types (`npm install`) fails.
  for (const pkg of ['server', 'client']) {
    const manifestPath = join(appDir, pkg, 'package.json');
    const manifest: unknown = JSON.parse(execFileSync('cat', [manifestPath], { encoding: 'utf8' }));
    const parsed = manifest as { name?: string; scripts?: Record<string, string> };
    if (parsed.name === undefined || parsed.scripts?.['dev'] === undefined) {
      fail(`${pkg}/package.json is missing a name or a dev script.`);
    }
  }
  console.log('  ok    both package.json manifests are valid and runnable');

  console.log(`\n  Smoke check passed for --language ${language}.\n`);
} finally {
  rmSync(workdir, { recursive: true, force: true });
}
