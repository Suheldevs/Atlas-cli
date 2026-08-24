import { describe, expect, it } from 'vitest';

import { ROUTES_ANCHOR } from '../../src/constants/markers.js';
import {
  AnchorInjector,
  injectAtAnchor,
  mergeEnvFile,
  mergeJsonFile,
  SECRET_PLACEHOLDER,
} from '../../src/engine/inject/index.js';
import { AtlasError } from '../../src/errors/atlas-error.js';
import { Reporter } from '../../src/services/reporter.service.js';
import type { EnvRequest, InjectionRequest } from '../../src/types/generation-plan.js';

import { InMemoryFileSystem } from '../helpers/in-memory-filesystem.js';
import { MemoryStream } from '../helpers/memory-stream.js';

const ROUTER_PATH = '/project/src/routes/index.ts';

function request(overrides: Partial<InjectionRequest> = {}): InjectionRequest {
  return {
    path: ROUTER_PATH,
    marker: ROUTES_ANCHOR,
    snippet: "router.use('/auth', authRoutes);",
    manualHint: `Add router.use('/auth', authRoutes) to your router.`,
    ...overrides,
  };
}

/** A router with the anchor nested two levels deep, which is where it realistically sits. */
const NESTED_ROUTER = [
  "import { Router } from 'express';",
  '',
  'export function createRouter(): Router {',
  '  const router = Router();',
  '',
  `  ${ROUTES_ANCHOR}`,
  '',
  '  return router;',
  '}',
  '',
].join('\n');

function quietReporter(): Reporter {
  return new Reporter({ stdout: new MemoryStream(), stderr: new MemoryStream(), color: false });
}

describe('injectAtAnchor', () => {
  it('inserts the snippet above the marker with the marker indentation', () => {
    const result = injectAtAnchor(NESTED_ROUTER, request());

    expect(result.outcome).toBe('injected');
    expect(result.contents).toBe(
      [
        "import { Router } from 'express';",
        '',
        'export function createRouter(): Router {',
        '  const router = Router();',
        '',
        "  router.use('/auth', authRoutes);",
        `  ${ROUTES_ANCHOR}`,
        '',
        '  return router;',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('keeps the internal shape of a multi-line snippet while re-indenting it', () => {
    const result = injectAtAnchor(
      NESTED_ROUTER,
      request({ snippet: 'if (config.auth) {\n  router.use(authRoutes);\n}' }),
    );

    expect(result.contents).toContain(
      ['  if (config.auth) {', '    router.use(authRoutes);', '  }', `  ${ROUTES_ANCHOR}`].join(
        '\n',
      ),
    );
  });

  it('leaves everything outside the inserted lines byte-for-byte identical', () => {
    const result = injectAtAnchor(NESTED_ROUTER, request());
    const inserted = "  router.use('/auth', authRoutes);\n";

    expect(result.contents?.replace(inserted, '')).toBe(NESTED_ROUTER);
  });

  it('is idempotent: a second run reports already-present and changes nothing', () => {
    const first = injectAtAnchor(NESTED_ROUTER, request());
    const second = injectAtAnchor(first.contents ?? '', request());

    expect(second.outcome).toBe('already-present');
    expect(second.contents).toBeUndefined();

    // The same input run twice must converge, which is the property users actually feel.
    const third = injectAtAnchor(first.contents ?? '', request());
    expect(third.contents ?? first.contents).toBe(first.contents);
  });

  it('detects an existing snippet whose indentation or spacing differs', () => {
    const reformatted = NESTED_ROUTER.replace(
      `  ${ROUTES_ANCHOR}`,
      `\t\trouter.use('/auth', authRoutes);\n\n  ${ROUTES_ANCHOR}`,
    );

    expect(injectAtAnchor(reformatted, request()).outcome).toBe('already-present');
  });

  it('reports marker-missing and leaves the contents untouched when the anchor is absent', () => {
    const withoutAnchor = NESTED_ROUTER.replace(`  ${ROUTES_ANCHOR}\n`, '');

    const result = injectAtAnchor(withoutAnchor, request());

    expect(result.outcome).toBe('marker-missing');
    expect(result.contents).toBeUndefined();
  });

  it('keeps CRLF line endings on a CRLF file', () => {
    const crlf = NESTED_ROUTER.split('\n').join('\r\n');

    const result = injectAtAnchor(crlf, request());
    const contents = result.contents ?? '';

    expect(contents).toContain(`  router.use('/auth', authRoutes);\r\n  ${ROUTES_ANCHOR}`);
    // No lone LF anywhere: a stray one would show up as a modified line in the user's diff.
    expect(/[^\r]\n/u.test(contents)).toBe(false);
  });

  it('uses LF on an LF file even when the snippet arrives with CRLF', () => {
    const result = injectAtAnchor(
      NESTED_ROUTER,
      request({ snippet: 'const a = 1;\r\nconst b = 2;' }),
    );
    const contents = result.contents ?? '';

    expect(contents).not.toContain('\r');
    expect(contents).toContain('  const a = 1;\n  const b = 2;\n');
  });

  it('injects at the top level when the marker is not indented', () => {
    const flat = `${ROUTES_ANCHOR}\nexport {};\n`;

    expect(injectAtAnchor(flat, request()).contents).toBe(
      `router.use('/auth', authRoutes);\n${ROUTES_ANCHOR}\nexport {};\n`,
    );
  });

  it('handles a marker on the final line of a file with no trailing newline', () => {
    const result = injectAtAnchor(`const a = 1;\n${ROUTES_ANCHOR}`, request());

    expect(result.contents).toBe(
      `const a = 1;\nrouter.use('/auth', authRoutes);\n${ROUTES_ANCHOR}`,
    );
  });
});

describe('AnchorInjector', () => {
  it('writes the rewritten file through the filesystem service', async () => {
    const fs = new InMemoryFileSystem({ [ROUTER_PATH]: NESTED_ROUTER });
    const injector = new AnchorInjector({ fs, reporter: quietReporter() });

    const [result] = await injector.apply([request()]);

    expect(result?.outcome).toBe('injected');
    expect(await fs.readText(ROUTER_PATH)).toContain("  router.use('/auth', authRoutes);");
  });

  it('composes several requests against the same marker into one write', async () => {
    const fs = new InMemoryFileSystem({ [ROUTER_PATH]: NESTED_ROUTER });
    const injector = new AnchorInjector({ fs, reporter: quietReporter() });

    const results = await injector.apply([
      request({ snippet: "router.use('/auth', authRoutes);" }),
      request({ snippet: "router.use('/users', userRoutes);" }),
    ]);

    expect(results.map((entry) => entry.outcome)).toEqual(['injected', 'injected']);
    expect(await fs.readText(ROUTER_PATH)).toContain(
      [
        "  router.use('/auth', authRoutes);",
        "  router.use('/users', userRoutes);",
        `  ${ROUTES_ANCHOR}`,
      ].join('\n'),
    );
    expect(fs.operations).toEqual([`write ${ROUTER_PATH}`]);
  });

  it('reports file-missing without creating the file', async () => {
    const fs = new InMemoryFileSystem();
    const injector = new AnchorInjector({ fs, reporter: quietReporter() });

    const [result] = await injector.apply([request()]);

    expect(result?.outcome).toBe('file-missing');
    expect(fs.snapshot()).toEqual({});
  });

  it('writes nothing in dry-run mode but still reports the outcome', async () => {
    const fs = new InMemoryFileSystem({ [ROUTER_PATH]: NESTED_ROUTER });
    const injector = new AnchorInjector({ fs, reporter: quietReporter(), dryRun: true });

    const [result] = await injector.apply([request()]);

    expect(result?.outcome).toBe('injected');
    expect(fs.operations).toEqual([]);
    expect(await fs.readText(ROUTER_PATH)).toBe(NESTED_ROUTER);
  });
});

describe('mergeJsonFile', () => {
  const MANIFEST = [
    '{',
    '  "name": "demo",',
    '  "version": "1.0.0",',
    '  "scripts": {',
    '    "dev": "node --watch src/index.js",',
    '    "test": "vitest"',
    '  },',
    '  "dependencies": {',
    '    "express": "^5.0.0"',
    '  }',
    '}',
    '',
  ].join('\n');

  it('appends a new script at the end of the section and preserves key order', () => {
    const result = mergeJsonFile(MANIFEST, { scripts: { 'db:migrate': 'node migrate.js' } });

    expect(result.added).toEqual(['scripts.db:migrate']);
    expect(result.contents).toBe(
      [
        '{',
        '  "name": "demo",',
        '  "version": "1.0.0",',
        '  "scripts": {',
        '    "dev": "node --watch src/index.js",',
        '    "test": "vitest",',
        '    "db:migrate": "node migrate.js"',
        '  },',
        '  "dependencies": {',
        '    "express": "^5.0.0"',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('refuses to overwrite an existing script and reports it as skipped', () => {
    const result = mergeJsonFile(MANIFEST, {
      scripts: { dev: 'atlas-dev', 'db:seed': 'node seed.js' },
    });

    expect(result.skipped).toEqual(['scripts.dev']);
    expect(result.added).toEqual(['scripts.db:seed']);
    expect(result.contents).toContain('"dev": "node --watch src/index.js"');
    expect(result.contents).not.toContain('atlas-dev');
  });

  it('preserves four-space indentation', () => {
    const fourSpace = ['{', '    "name": "demo",', '    "scripts": {}', '}', ''].join('\n');

    const result = mergeJsonFile(fourSpace, { scripts: { build: 'tsc' } });

    expect(result.contents).toBe(
      [
        '{',
        '    "name": "demo",',
        '    "scripts": {',
        '        "build": "tsc"',
        '    }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('preserves tab indentation', () => {
    const tabbed = ['{', '\t"name": "demo"', '}', ''].join('\n');

    expect(mergeJsonFile(tabbed, { scripts: { build: 'tsc' } }).contents).toBe(
      ['{', '\t"name": "demo",', '\t"scripts": {', '\t\t"build": "tsc"', '\t}', '}', ''].join('\n'),
    );
  });

  it('creates a missing section at the end of the object', () => {
    const result = mergeJsonFile('{\n  "name": "demo"\n}\n', { scripts: { build: 'tsc' } });

    expect(result.contents).toBe(
      ['{', '  "name": "demo",', '  "scripts": {', '    "build": "tsc"', '  }', '}', ''].join('\n'),
    );
  });

  it('preserves a missing trailing newline and CRLF endings', () => {
    const crlf = '{\r\n  "name": "demo"\r\n}';

    const result = mergeJsonFile(crlf, { scripts: { build: 'tsc' } });

    expect(result.contents).toBe(
      '{\r\n  "name": "demo",\r\n  "scripts": {\r\n    "build": "tsc"\r\n  }\r\n}',
    );
  });

  it('returns the input verbatim when every change is skipped', () => {
    const result = mergeJsonFile(MANIFEST, { scripts: { dev: 'atlas-dev', test: 'atlas-test' } });

    expect(result.contents).toBe(MANIFEST);
    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual(['scripts.dev', 'scripts.test']);
  });

  it('skips a section whose existing value is not an object', () => {
    const result = mergeJsonFile('{\n  "scripts": "nope"\n}\n', { scripts: { build: 'tsc' } });

    expect(result.skipped).toEqual(['scripts.build']);
    expect(result.contents).toBe('{\n  "scripts": "nope"\n}\n');
  });

  it('throws an AtlasError on malformed JSON rather than rewriting the file', () => {
    expect(() => mergeJsonFile('{ "name": }', { scripts: { build: 'tsc' } })).toThrow(AtlasError);
  });
});

describe('mergeEnvFile', () => {
  function envRequest(overrides: Partial<EnvRequest> = {}): EnvRequest {
    return { key: 'PORT', value: '3000', comment: undefined, secret: false, ...overrides };
  }

  it('appends to a file that has no trailing newline', () => {
    const result = mergeEnvFile('NODE_ENV=development', [envRequest()]);

    expect(result.contents).toBe('NODE_ENV=development\n\nPORT=3000\n');
    expect(result.added).toEqual(['PORT']);
  });

  it('creates the whole file when it does not exist yet', () => {
    const result = mergeEnvFile(undefined, [
      envRequest(),
      envRequest({ key: 'HOST', value: '0.0.0.0' }),
    ]);

    expect(result.contents).toBe('PORT=3000\nHOST=0.0.0.0\n');
  });

  it('never changes an existing key and reports it as skipped', () => {
    const existing = 'PORT=8080\n';

    const result = mergeEnvFile(existing, [envRequest({ value: '3000' })]);

    expect(result.skipped).toEqual(['PORT']);
    expect(result.added).toEqual([]);
    expect(result.contents).toBe(existing);
  });

  it('recognises existing keys written with export or padded spacing', () => {
    const result = mergeEnvFile('export PORT = 8080\n', [envRequest()]);

    expect(result.skipped).toEqual(['PORT']);
  });

  it('writes the comment as a # line above the key', () => {
    const result = mergeEnvFile('NODE_ENV=development\n', [
      envRequest({ comment: 'Port the HTTP server listens on' }),
    ]);

    expect(result.contents).toBe(
      'NODE_ENV=development\n\n# Port the HTTP server listens on\nPORT=3000\n',
    );
  });

  it('writes a placeholder for a secret and marks it', () => {
    const result = mergeEnvFile(undefined, [
      envRequest({ key: 'JWT_SECRET', value: 'a-real-256-bit-key', secret: true }),
    ]);

    expect(result.contents).toContain(`JWT_SECRET=${SECRET_PLACEHOLDER}`);
    expect(result.contents).not.toContain('a-real-256-bit-key');
    expect(result.contents).toMatch(/^# atlas:.*\nJWT_SECRET=/u);
  });

  it('keeps a secret comment and the placeholder notice on separate lines', () => {
    const result = mergeEnvFile(undefined, [
      envRequest({ key: 'JWT_SECRET', value: 'x', comment: 'Signs access tokens', secret: true }),
    ]);

    expect(result.contents.split('\n').slice(0, 3)).toEqual([
      '# Signs access tokens',
      '# atlas: placeholder — replace this before running the app',
      `JWT_SECRET=${SECRET_PLACEHOLDER}`,
    ]);
  });

  it('does not stack a second blank line on a file that already ends with one', () => {
    const result = mergeEnvFile('NODE_ENV=development\n\n', [envRequest()]);

    expect(result.contents).toBe('NODE_ENV=development\n\nPORT=3000\n');
  });

  it('keeps CRLF endings on a CRLF file', () => {
    const result = mergeEnvFile('NODE_ENV=development\r\n', [envRequest()]);

    expect(result.contents).toBe('NODE_ENV=development\r\n\r\nPORT=3000\r\n');
  });

  it('returns the input unchanged when there is nothing to add', () => {
    expect(mergeEnvFile('PORT=3000\n', []).contents).toBe('PORT=3000\n');
  });

  it('ignores a key that only appears inside a comment', () => {
    const result = mergeEnvFile('# PORT=8080\n', [envRequest()]);

    expect(result.added).toEqual(['PORT']);
  });

  it('adds a duplicated key only once', () => {
    const result = mergeEnvFile(undefined, [envRequest(), envRequest({ value: '4000' })]);

    expect(result.added).toEqual(['PORT']);
    expect(result.skipped).toEqual(['PORT']);
    expect(result.contents).toBe('PORT=3000\n');
  });
});
