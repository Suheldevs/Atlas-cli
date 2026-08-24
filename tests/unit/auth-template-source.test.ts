/**
 * Assertions about the *text* of the auth template.
 *
 * Every other test here checks behaviour. These check source, because each one guards a bug that the
 * generated-output gate cannot catch: `scripts/check-generated-output.ts` compiles what the template
 * renders to, and all three failures below **typecheck perfectly** and only surface when the module
 * is imported or a request is served. They were found by running the generated code, not by building
 * it, and a grep is the cheapest thing that stops them coming back.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveTemplatesRoot } from '../../src/config/package-meta.js';

const AUTH_FILES = join(resolveTemplatesRoot(), 'auth', 'files', 'auth');

/** Every `.ts` file the auth template ships, so a new one cannot skip the checks below. */
async function authSources(dir: string = AUTH_FILES): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await authSources(full)));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }

  return files;
}

async function source(relative: string): Promise<string> {
  return readFile(join(AUTH_FILES, relative), 'utf8');
}

/**
 * Removes comments so a check can look at code alone.
 *
 * Needed because these files explain their own hazards in prose: the comment above the lazy
 * `options()` factory names `config.issuer` as the thing not to do, and a naive search for
 * `config.` finds the warning as readily as the mistake.
 *
 * Comment-aware only, not a parser — it would mangle a string literal containing `//`. Fine here,
 * where the results are only ever searched for identifiers.
 */
function stripComments(contents: string): string {
  return contents.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
}

describe('token-service.ts CommonJS interop', () => {
  /**
   * `jsonwebtoken` is CommonJS. Node synthesises named exports from a CJS module only when its
   * static analyser can see them being assigned, and it cannot here — so `import { sign }` compiles
   * against `@types/jsonwebtoken` and then throws `does not provide an export named 'sign'` the
   * moment the module is loaded. The default import is the module object and always works.
   */
  it('imports jsonwebtoken as a default, never as named bindings', async () => {
    const contents = await source('security/token-service.ts');

    expect(contents).toContain("import jwt from 'jsonwebtoken';");
    expect(contents).not.toMatch(/import\s*\{[^}]*\bsign\b[^}]*\}\s*from\s*'jsonwebtoken'/u);
    expect(contents).not.toMatch(/import\s*\{[^}]*\bverify\b[^}]*\}\s*from\s*'jsonwebtoken'/u);
    // A namespace import is the other tempting spelling, and it fails at runtime for the same
    // reason a named import does.
    expect(contents).not.toMatch(/import\s*\*\s*as\s+\w+\s*from\s*'jsonwebtoken'/u);
  });

  /**
   * `authConfig` is a lazily-resolving proxy so that importing any part of the auth module does not
   * demand a `JWT_SECRET`. Reading a property in the body of `createTokenService` resolves it
   * immediately — and because the module ends with `export const tokenService = createTokenService()`,
   * that turns every import of this file into a hard failure when the variable is unset. Which
   * includes a unit test for something unrelated, and a build step that imports the router.
   */
  it('does not read configuration until a token is issued or verified', async () => {
    const contents = stripComments(await source('security/token-service.ts'));
    const body = contents.slice(contents.indexOf('export function createTokenService'));
    const firstNested = body.indexOf('  function ');

    // Everything between the factory's opening line and its first nested function runs the moment
    // `createTokenService()` is called — and the module calls it at import time.
    expect(firstNested, 'expected a nested function in createTokenService').toBeGreaterThan(-1);
    expect(body.slice(0, firstNested)).not.toMatch(/config\.\w/u);
  });
});

describe('bcrypt-hasher.ts', () => {
  /**
   * bcrypt hashes only the first 72 bytes of its input and discards the rest silently, so a
   * password sharing its first 72 bytes with another authenticates as that other one. The library's
   * own `truncates` is asked rather than the length recomputed, because bcryptjs owns the definition
   * of where its limit falls.
   */
  it('refuses a password bcrypt would silently truncate', async () => {
    const contents = await source('security/bcrypt-hasher.ts');

    expect(contents).toContain('truncates');
    expect(contents).toMatch(/if \(truncates\(password\)\)/u);
  });

  it('reads the cost factor from config rather than hardcoding it', async () => {
    const contents = await source('security/bcrypt-hasher.ts');

    expect(contents).toContain('config.bcryptRounds');
    expect(contents).not.toMatch(/hash\(password,\s*\d+\)/u);
  });
});

describe('auth-service.ts timing equalisation', () => {
  /**
   * The decoy has to be a *bcrypt* hash, and at the configured cost. A hash from another scheme
   * makes `compare` throw immediately instead of doing the work, which returns faster than the real
   * path and reintroduces exactly the timing signal the constant exists to remove — an account
   * enumeration oracle, restored silently, with every test still green.
   */
  it('uses a bcrypt decoy hash, not one left over from argon2', async () => {
    const contents = await source('services/auth-service.ts');
    const match = /const TIMING_DECOY_HASH = '([^']+)';/u.exec(contents);

    expect(match, 'TIMING_DECOY_HASH should be a single-line string constant').not.toBe(null);

    const hash = match?.[1] ?? '';

    // `$2a$`, `$2b$` and `$2y$` are the bcrypt prefixes; 60 characters is bcrypt's fixed width.
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/u);
    expect(hash).toHaveLength(60);
    expect(hash).not.toContain('argon2');
  });
});

describe('the packages the rewrite removed', () => {
  it.each(['jose', 'zod', 'argon2'])('are imported by no auth template file: %s', async (name) => {
    const files = await authSources();

    // Guards against the list being silently empty, which would make this pass by testing nothing.
    expect(files.length).toBeGreaterThan(15);

    for (const file of files) {
      const contents = await readFile(file, 'utf8');

      expect(contents, `${file} imports ${name}`).not.toContain(`from '${name}'`);
    }
  });
});
