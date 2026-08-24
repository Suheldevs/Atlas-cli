import type { Options } from 'prettier';
import { describe, expect, it } from 'vitest';

import { Formatter, parserForPath } from '../../src/engine/format/index.js';
import { AtlasError } from '../../src/errors/atlas-error.js';
import { ErrorCode } from '../../src/errors/error-catalog.js';
import { Reporter } from '../../src/services/reporter.service.js';
import type { FileOperation } from '../../src/types/generation-plan.js';

import { MemoryStream } from '../helpers/memory-stream.js';

/**
 * The project's style, supplied directly.
 *
 * Config *resolution* walks the real filesystem; injecting the result keeps these tests about
 * the formatter's behaviour and still runs the genuine prettier over the code.
 */
const PROJECT_OPTIONS: Options = {
  printWidth: 100,
  singleQuote: true,
  semi: true,
  tabWidth: 2,
  trailingComma: 'all',
};

interface Harness {
  readonly formatter: Formatter;
  readonly stderr: MemoryStream;
}

function harness(strict = false): Harness {
  const stderr = new MemoryStream();
  const reporter = new Reporter({
    stdout: new MemoryStream(),
    stderr,
    color: false,
    verbose: true,
  });

  return {
    stderr,
    formatter: new Formatter({
      reporter,
      strict,
      resolveOptions: (filePath) => Promise.resolve({ ...PROJECT_OPTIONS, filepath: filePath }),
    }),
  };
}

function operation(overrides: Partial<FileOperation>): FileOperation {
  return {
    path: '/project/src/thing.ts',
    contents: 'export const a = 1;\n',
    format: true,
    label: undefined,
    ...overrides,
  };
}

describe('Formatter.formatFile', () => {
  it('formats badly formatted but valid TypeScript', async () => {
    const { formatter } = harness();

    const result = await formatter.formatFile(
      '/project/src/user.ts',
      'export  const  user   =  {name:"ada",  age:36}',
    );

    expect(result).toBe("export const user = { name: 'ada', age: 36 };\n");
  });

  it('honours the resolved options rather than prettier defaults', async () => {
    const formatter = new Formatter({
      reporter: new Reporter({
        stdout: new MemoryStream(),
        stderr: new MemoryStream(),
        color: false,
      }),
      resolveOptions: (filePath) =>
        Promise.resolve({ tabWidth: 4, semi: false, filepath: filePath }),
    });

    const result = await formatter.formatFile('/project/src/user.ts', 'function f(){return 1}');

    expect(result).toBe('function f() {\n    return 1\n}\n');
  });

  it('returns a file with a genuine syntax error unchanged instead of throwing', async () => {
    const { formatter, stderr } = harness();
    const broken = 'export const oops = {{{ ;';

    const result = await formatter.formatFile('/project/src/broken.ts', broken);

    expect(result).toBe(broken);
    // Prettier's own diagnostic is the only place the failure is recorded, so it has to be there.
    expect(stderr.text).toContain('/project/src/broken.ts');
  });

  it('throws FormatFailed in strict mode', async () => {
    const { formatter } = harness(true);

    const error: unknown = await formatter
      .formatFile('/project/src/broken.ts', 'export const oops = {{{ ;')
      .then(
        () => undefined,
        (caught: unknown) => caught,
      );

    expect(AtlasError.isAtlasError(error)).toBe(true);
    expect((error as AtlasError).code).toBe(ErrorCode.FormatFailed);
  });

  it('skips a .env file without attempting to parse it', async () => {
    const { formatter, stderr } = harness(true);
    const contents = 'JWT_SECRET=replace-me\nPORT = 3000\n';

    // Strict mode is on, so a formatting attempt would throw rather than fall back.
    expect(await formatter.formatFile('/project/.env', contents)).toBe(contents);
    expect(await formatter.formatFile('/project/.env.example', contents)).toBe(contents);
    expect(stderr.text).toContain('no prettier parser');
  });
});

describe('parserForPath', () => {
  it('maps the extensions Atlas generates', () => {
    expect(parserForPath('/project/src/a.ts')).toBe('typescript');
    expect(parserForPath('/project/src/a.tsx')).toBe('typescript');
    expect(parserForPath('/project/src/a.mjs')).toBe('babel');
    expect(parserForPath('/project/package.json')).toBe('json');
    expect(parserForPath('/project/README.md')).toBe('markdown');
  });

  it('refuses files prettier cannot or must not handle', () => {
    expect(parserForPath('/project/.env')).toBeUndefined();
    expect(parserForPath('/project/.env.local')).toBeUndefined();
    expect(parserForPath('/project/pnpm-lock.yaml')).toBe('yaml');
    expect(parserForPath('/project/yarn.lock')).toBeUndefined();
    expect(parserForPath('/project/bun.lockb')).toBeUndefined();
    expect(parserForPath('/project/Dockerfile')).toBeUndefined();
    expect(parserForPath('/project/logo.png')).toBeUndefined();
  });
});

describe('Formatter.formatOperations', () => {
  it('formats operations that opted in', async () => {
    const { formatter } = harness();

    const [result] = await formatter.formatOperations([
      operation({ contents: 'export  const  a=1' }),
    ]);

    expect(result?.contents).toBe('export const a = 1;\n');
  });

  it('passes operations with format: false through untouched', async () => {
    const { formatter } = harness();
    const untouched = operation({
      path: '/project/.env.example',
      contents: 'PORT   =   3000',
      format: false,
    });
    const alsoUntouched = operation({ contents: 'export  const  a=1', format: false });

    const results = await formatter.formatOperations([untouched, alsoUntouched]);

    expect(results[0]).toBe(untouched);
    expect(results[1]).toBe(alsoUntouched);
  });

  it('preserves order and carries the other operation fields across', async () => {
    const { formatter } = harness();

    const results = await formatter.formatOperations([
      operation({ path: '/project/src/one.ts', contents: 'export  const  one=1', label: 'one' }),
      operation({ path: '/project/src/two.ts', contents: 'export  const  two=2', label: 'two' }),
    ]);

    expect(results.map((entry) => entry.label)).toEqual(['one', 'two']);
    expect(results[0]?.path).toBe('/project/src/one.ts');
    expect(results[0]?.format).toBe(true);
  });

  it('keeps going after a file that cannot be formatted', async () => {
    const { formatter } = harness();

    const results = await formatter.formatOperations([
      operation({ path: '/project/src/broken.ts', contents: 'const  {{{ =' }),
      operation({ path: '/project/src/fine.ts', contents: 'export  const  fine=1' }),
    ]);

    expect(results[0]?.contents).toBe('const  {{{ =');
    expect(results[1]?.contents).toBe('export const fine = 1;\n');
  });
});
